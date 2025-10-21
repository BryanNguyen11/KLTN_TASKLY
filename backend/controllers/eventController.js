const Event = require('../models/Event');
const EventType = require('../models/EventType');
const Tesseract = require('tesseract.js');
const path = require('path');
const Jimp = require('jimp');
const sharp = require('sharp');
let pdfParse;
try { pdfParse = require('pdf-parse'); } catch(_) { pdfParse = null; }
let GoogleGenerativeAI;
try { ({ GoogleGenerativeAI } = require('@google/generative-ai')); } catch(_) { GoogleGenerativeAI = null; }
const OCR_DEBUG = process.env.OCR_DEBUG === '1' || process.env.OCR_DEBUG === 'true';

// External OCR (e.g., DEMINI free API) via JSON base64 request
async function tryExternalOCR(buffer){
  try{
    const url = process.env.DEMINI_OCR_URL;
    if(!url) return null;
    const mode = (process.env.DEMINI_OCR_SEND_MODE||'json-base64').toLowerCase();
    const key = process.env.DEMINI_OCR_KEY;
    const keyHeader = process.env.DEMINI_OCR_KEY_HEADER || 'x-api-key';
    const imgField = process.env.DEMINI_OCR_IMAGE_FIELD || 'imageBase64';
    const textPath = process.env.DEMINI_OCR_TEXT_PATH || 'text';
    const headers = {};
    if(key) headers[keyHeader] = key;
    let resp;
    if(mode === 'json-base64'){
      const b64 = 'data:image/jpeg;base64,' + buffer.toString('base64');
      headers['Content-Type'] = 'application/json';
      resp = await fetch(url, { method:'POST', headers, body: JSON.stringify({ [imgField]: b64 }) });
    } else {
      // fallback: also send as json-base64 if multipart unsupported here
      const b64 = 'data:image/jpeg;base64,' + buffer.toString('base64');
      headers['Content-Type'] = 'application/json';
      resp = await fetch(url, { method:'POST', headers, body: JSON.stringify({ [imgField]: b64 }) });
    }
  if(!resp.ok){ if(OCR_DEBUG) console.log(`[OCR] DEMINI HTTP ${resp.status}`); return null; }
    const data = await resp.json().catch(()=>null);
    if(!data) return null;
    const getByPath = (obj, path) => {
      try{ return path.split('.').reduce((o,k)=> (o && k in o) ? o[k] : undefined, obj); }catch(_){ return undefined; }
    };
    const candidates = [ getByPath(data, textPath), data.text, data.raw, getByPath(data,'data.text') ].map(v=> (typeof v==='string'? v.trim(): ''));
    const best = candidates.find(s=> s && s.length>0) || '';
    if(OCR_DEBUG) console.log(`[OCR] DEMINI text length=${best.length}`);
    return best || null;
  }catch(_e){ return null; }
}

// Google Gemini Vision OCR (free tier friendly) – returns plain text
async function tryGeminiOCR(buffer){
  try{
    const key = process.env.GEMINI_API_KEY;
    if(!key || !GoogleGenerativeAI) return null;
    const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
    const genAI = new GoogleGenerativeAI(key);
    // Generation config from env (defaults optimized for OCR: deterministic)
    const temp = isFinite(parseFloat(process.env.GEMINI_TEMPERATURE||'')) ? parseFloat(process.env.GEMINI_TEMPERATURE||'') : 0;
    const topP = isFinite(parseFloat(process.env.GEMINI_TOP_P||'')) ? parseFloat(process.env.GEMINI_TOP_P||'') : undefined;
    const topK = isFinite(parseInt(process.env.GEMINI_TOP_K||'')) ? parseInt(process.env.GEMINI_TOP_K||'') : undefined;
    const maxOutputTokens = isFinite(parseInt(process.env.GEMINI_MAX_OUTPUT_TOKENS||'')) ? parseInt(process.env.GEMINI_MAX_OUTPUT_TOKENS||'') : undefined;
    const model = genAI.getGenerativeModel({ model: modelName });
    const b64 = buffer.toString('base64');
    const prompt = [
      'You are an OCR engine. Return ONLY the UTF-8 plain text extracted from the image.',
      'Strict requirements:',
      '- Preserve all original line breaks; do not join or reorder lines.',
      '- Keep visual reading order left-to-right, top-to-bottom.',
      "- Do not translate or summarize; don't add commentary or Markdown.",
      "- If the image is a weekly timetable in Vietnamese, include day headers exactly as they appear, e.g. 'Thứ 2 10/02/2025', 'Thứ 3 11/02/2025', ... 'Chủ nhật 16/02/2025'.",
      '- Keep each cell/box content as separate lines, including labels like "Tiết:", "Phòng:", "GV:", "Ghi chú:".',
    ].join('\n');
    const contents = [{ role: 'user', parts: [ { text: prompt }, { inlineData: { mimeType: 'image/jpeg', data: b64 } } ] }];
    const generationConfig = { temperature: temp, ...(topP!==undefined? { topP }: {}), ...(topK!==undefined? { topK }: {}), ...(maxOutputTokens!==undefined? { maxOutputTokens }: {}) };
    const result = await model.generateContent({ contents, generationConfig });
    let text = String(result?.response?.text?.() || '').trim();
    if(OCR_DEBUG) console.log(`[OCR] Gemini response length=${text.length}`);
    if(!text) return null;
    // Strip possible Markdown fences
    text = text.replace(/^```[a-zA-Z]*\n|```$/g, '').trim();
    return text || null;
  }catch(_e){ return null; }
}

exports.createEvent = async (req, res) => {
  try {
    const userId = req.user.userId;
  const { title, typeId, date, endDate, startTime, endTime, location, notes, link, tags = [], props = {}, repeat, reminders, projectId } = req.body;
    if (!title || !typeId || !date) return res.status(400).json({ message: 'Thiếu trường bắt buộc' });
    // check type exists
    const et = await EventType.findById(typeId);
    if (!et) return res.status(400).json({ message: 'Loại sự kiện không hợp lệ' });
    if (endDate && endDate < date) return res.status(400).json({ message: 'endDate phải >= date' });
  const payload = { userId, title, typeId, date, endDate, startTime, endTime, location, notes, link, tags, props, repeat };
  // If projectId is provided, ensure requester is member of that project
  if(projectId){
    try{
      const Project = require('../models/Project');
      const p = await Project.findOne({ _id: projectId, $or:[ { owner: userId }, { 'members.user': userId } ] });
      if(!p) return res.status(403).json({ message: 'Bạn không thuộc dự án này' });
      payload.projectId = projectId;
    }catch(_e){ /* ignore, treat as no project */ }
  }
  if(Array.isArray(reminders) && (startTime || endTime)){
    const targetDate = endDate || date;
    const baseTime = endTime || startTime || '09:00';
    const baseAt = new Date(`${targetDate}T${baseTime}:00`);
    const rems = reminders.map((r)=>{
      if(r?.type==='relative') return { at: new Date(baseAt.getTime() - (r.minutes||0)*60000), sent:false };
      if(r?.type==='absolute' && r.at) return { at: new Date(r.at), sent:false };
      return null;
    }).filter(Boolean);
  if(rems.length) payload.reminders = rems;
  }
  const doc = await Event.create(payload);
    res.status(201).json(doc);
  } catch (e) {
    res.status(500).json({ message: 'Lỗi tạo sự kiện', error: e.message });
  }
};

exports.getEvents = async (req, res) => {
  try {
    const userId = req.user.userId;
    const base = { userId };
    const and = [];
    if(req.query && req.query.projectId){
      and.push({ projectId: req.query.projectId });
    }
    const q = String(req.query?.q||'').trim();
    if(q){
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      and.push({ $or: [ { title: re }, { location: re }, { notes: re } ] });
    }
    const from = String(req.query?.from||'');
    if(from){ and.push({ $or:[ { date: { $gte: from } }, { endDate: { $gte: from } } ] }); }
    const to = String(req.query?.to||'');
    if(to){ and.push({ date: { $lte: to } }); }
    const finalFilter = and.length ? { $and: [ base, ...and ] } : base;
    const list = await Event.find(finalFilter).sort({ date: 1, startTime: 1 }).lean();
    res.json(list);
  } catch (e) {
    res.status(500).json({ message: 'Lỗi lấy danh sách sự kiện', error: e.message });
  }
};

exports.getEvent = async (req, res) => {
  try {
    const userId = req.user.userId;
    const doc = await Event.findOne({ _id: req.params.id, userId });
    if (!doc) return res.status(404).json({ message: 'Không tìm thấy sự kiện' });
    res.json(doc);
  } catch (e) {
    res.status(500).json({ message: 'Lỗi lấy sự kiện', error: e.message });
  }
};

exports.updateEvent = async (req, res) => {
  try {
    const userId = req.user.userId;
    const updates = { ...req.body };
    if (updates.endDate && updates.date && updates.endDate < updates.date) {
      return res.status(400).json({ message: 'endDate phải >= date' });
    }
    // If moving an event into a project, ensure membership
    if(updates.projectId){
      try{
        const Project = require('../models/Project');
        const p = await Project.findOne({ _id: updates.projectId, $or:[ { owner: userId }, { 'members.user': userId } ] });
        if(!p) return res.status(403).json({ message: 'Bạn không thuộc dự án này' });
      }catch(_e){ /* ignore */ }
    }
    // Recompute reminders if provided
    if(Array.isArray(req.body.reminders)){
      const before = await Event.findOne({ _id: req.params.id, userId }).lean();
      const baseDate = updates.endDate || updates.date || before?.endDate || before?.date;
      const baseTime = updates.endTime || updates.startTime || before?.endTime || before?.startTime || '09:00';
      if(baseDate && baseTime){
        const baseAt = new Date(`${baseDate}T${baseTime}:00`);
        updates.reminders = req.body.reminders.map((r)=>{
          if(r?.type==='relative') return { at: new Date(baseAt.getTime() - (r.minutes||0)*60000), sent:false };
          if(r?.type==='absolute' && r.at) return { at: new Date(r.at), sent:false };
          return null;
        }).filter(Boolean);
      }
    }
    const doc = await Event.findOneAndUpdate({ _id: req.params.id, userId }, updates, { new: true });
    if (!doc) return res.status(404).json({ message: 'Không tìm thấy sự kiện' });
    res.json(doc);
  } catch (e) {
    res.status(500).json({ message: 'Lỗi cập nhật sự kiện', error: e.message });
  }
};

exports.deleteEvent = async (req, res) => {
  try {
    const userId = req.user.userId;
    const doc = await Event.findOneAndDelete({ _id: req.params.id, userId });
    if (!doc) return res.status(404).json({ message: 'Không tìm thấy sự kiện' });
    res.json({ message: 'Đã xóa', id: doc._id });
  } catch (e) {
    res.status(500).json({ message: 'Lỗi xóa sự kiện', error: e.message });
  }
};

// OCR scan from uploaded image and extract event fields (free Tesseract.js)
exports.scanImage = async (req, res) => {
  try {
    const userId = req.user.userId;
    let buffer = null;
    if (req.file && req.file.buffer) {
      buffer = req.file.buffer;
    } else if (req.body && req.body.imageBase64) {
      const b64 = String(req.body.imageBase64).replace(/^data:image\/\w+;base64,/, '');
      buffer = Buffer.from(b64, 'base64');
    } else {
      return res.status(400).json({ message: 'Thiếu ảnh tải lên (image file hoặc imageBase64)' });
    }
    // Build multiple preprocessing variants to maximize OCR accuracy
    const variants = [];
    try {
      const base = await sharp(buffer)
        .rotate()
        .resize({ width: 2200, withoutEnlargement: true })
        .grayscale()
        .normalise()
        .toFormat('jpeg', { quality: 95 })
        .toBuffer();
      // Try Gemini first
      try{
        const gText = await tryGeminiOCR(base);
        if(gText && gText.trim().length>0){
          if(OCR_DEBUG) console.log('[OCR] Using Gemini result');
          const bestText = gText.trim();
          const lines = bestText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
          const all = lines.join(' \n ');
          const result = { title: '', date: '', endDate: '', startTime: '', endTime: '', location: '', notes: '' };
          const datePatterns = [
            /(\b|\D)(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(\b|\D)/,
            /(\b|\D)(\d{4})-(\d{1,2})-(\d{1,2})(\b|\D)/,
            /(\b|\D)(\d{1,2})[\/-](\d{1,2})(\b|\D)/
          ];
          let y = new Date().getFullYear();
          for(const re of datePatterns){
            const m = all.match(re);
            if(m){
              if(re === datePatterns[0]){ const dd = String(m[2]).padStart(2,'0'); const mm = String(m[3]).padStart(2,'0'); const yyyy = String(m[4]); result.date = `${yyyy}-${mm}-${dd}`; }
              else if(re === datePatterns[1]){ const yyyy = String(m[2]); const mm = String(m[3]).padStart(2,'0'); const dd = String(m[4]).padStart(2,'0'); result.date = `${yyyy}-${mm}-${dd}`; }
              else { const dd = String(m[2]).padStart(2,'0'); const mm = String(m[3]).padStart(2,'0'); result.date = `${y}-${mm}-${dd}`; }
              break;
            }
          }
          const timeMatches = []; const reTimes = [/\b(\d{1,2}):(\d{2})\b/g, /\b(\d{1,2})h(\d{2})?\b/gi];
          for(const re of reTimes){ let m; const s = all; while((m = re.exec(s))){ timeMatches.push(m); if(timeMatches.length>4) break; } if(timeMatches.length>4) break; }
          const normHM = (h, m) => `${String(Math.min(23,Math.max(0,parseInt(h||'0',10)))) .padStart(2,'0')}:${String(Math.min(59,Math.max(0,parseInt(m||'0',10)))) .padStart(2,'0')}`;
          if(timeMatches.length>=1){ const t1 = timeMatches[0]; result.startTime = normHM(t1[1], t1[2] || '00'); }
          if(timeMatches.length>=2){ const t2 = timeMatches[1]; result.endTime = normHM(t2[1], t2[2] || '00'); }
          if(!result.endTime){ const range = all.match(/(\d{1,2}[:h]\d{0,2})\s*[\-–]\s*(\d{1,2}[:h]\d{0,2})/); if(range){ const parseHM = (s)=>{ const m=s.match(/^(\d{1,2})(?::(\d{2}))?$/)||s.match(/^(\d{1,2})h(\d{2})?$/i); if(!m) return null; return normHM(m[1], m[2]||'00'); }; const a=parseHM(range[1]); const b=parseHM(range[2]); if(a) result.startTime=a; if(b) result.endTime=b; } }
          if(result.endTime && result.startTime && result.endTime <= result.startTime){ result.endTime = ''; }
          const locLine = lines.find(l => /(đi?a\s*đi?e?m|phòng|phong|room|tại|tai|at)\b/i.test(l));
          if(locLine){ result.location = locLine.replace(/^(.*?:)\s*/, ''); }
          const isMeta = (s) => /\d{1,2}[\/:h]\d{1,2}|\d{4}-\d{2}-\d{2}|đi?a\s*đi?e?m|phòng|room|tại|at/i.test(s);
          result.title = (lines.find(l => !isMeta(l)) || '').slice(0,120) || 'Lịch mới từ ảnh';
          result.notes = bestText.length>600 ? (bestText.slice(0,580)+'...') : bestText;
          if(!result.date){ const d = new Date(); const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; result.date = iso; }
          return res.json({ extracted: result, raw: bestText, rawLength: bestText.length });
        }
      }catch(_){ }
      // Try DEMINI next
      try{
        const extText = await tryExternalOCR(base);
        if(extText && extText.trim().length>0){
          if(OCR_DEBUG) console.log('[OCR] Using DEMINI result');
          const bestText = extText.trim();
          const lines = bestText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
          const all = lines.join(' \n ');
          const result = { title: '', date: '', endDate: '', startTime: '', endTime: '', location: '', notes: '' };
          const datePatterns = [
            /(\b|\D)(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(\b|\D)/,
            /(\b|\D)(\d{4})-(\d{1,2})-(\d{1,2})(\b|\D)/,
            /(\b|\D)(\d{1,2})[\/-](\d{1,2})(\b|\D)/
          ];
          let y = new Date().getFullYear();
          for(const re of datePatterns){ const m = all.match(re); if(m){ if(re===datePatterns[0]){ const dd=String(m[2]).padStart(2,'0'); const mm=String(m[3]).padStart(2,'0'); const yyyy=String(m[4]); result.date=`${yyyy}-${mm}-${dd}`; } else if(re===datePatterns[1]){ const yyyy=String(m[2]); const mm=String(m[3]).padStart(2,'0'); const dd=String(m[4]).padStart(2,'0'); result.date=`${yyyy}-${mm}-${dd}`; } else { const dd=String(m[2]).padStart(2,'0'); const mm=String(m[3]).padStart(2,'0'); result.date=`${y}-${mm}-${dd}`; } break; } }
          const timeMatches = []; const reTimes = [/\b(\d{1,2}):(\d{2})\b/g, /\b(\d{1,2})h(\d{2})?\b/gi];
          for(const re of reTimes){ let m; const s = all; while((m=re.exec(s))){ timeMatches.push(m); if(timeMatches.length>4) break; } if(timeMatches.length>4) break; }
          const normHM = (h, m) => `${String(Math.min(23,Math.max(0,parseInt(h||'0',10)))) .padStart(2,'0')}:${String(Math.min(59,Math.max(0,parseInt(m||'0',10)))) .padStart(2,'0')}`;
          if(timeMatches.length>=1){ const t1=timeMatches[0]; result.startTime = normHM(t1[1], t1[2]||'00'); }
          if(timeMatches.length>=2){ const t2=timeMatches[1]; result.endTime = normHM(t2[1], t2[2]||'00'); }
          if(!result.endTime){ const range = all.match(/(\d{1,2}[:h]\d{0,2})\s*[\-–]\s*(\d{1,2}[:h]\d{0,2})/); if(range){ const parseHM=(s)=>{ const m=s.match(/^(\d{1,2})(?::(\d{2}))?$/)||s.match(/^(\d{1,2})h(\d{2})?$/i); if(!m) return null; return normHM(m[1], m[2]||'00'); }; const a=parseHM(range[1]); const b=parseHM(range[2]); if(a) result.startTime=a; if(b) result.endTime=b; } }
          if(result.endTime && result.startTime && result.endTime <= result.startTime){ result.endTime = ''; }
          const locLine = lines.find(l => /(đi?a\s*đi?e?m|phòng|phong|room|tại|tai|at)\b/i.test(l)); if(locLine){ result.location = locLine.replace(/^(.*?:)\s*/, ''); }
          const isMeta = (s) => /\d{1,2}[\/:h]\d{1,2}|\d{4}-\d{2}-\d{2}|đi?a\s*đi?e?m|phòng|room|tại|at/i.test(s);
          result.title = (lines.find(l => !isMeta(l)) || '').slice(0,120) || 'Lịch mới từ ảnh';
          result.notes = bestText.length>600 ? (bestText.slice(0,580)+'...') : bestText;
          if(!result.date){ const d=new Date(); const iso=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; result.date=iso; }
          return res.json({ extracted: result, raw: bestText, rawLength: bestText.length });
        }
      }catch(_){ }
      variants.push(base);
      // High contrast threshold
      variants.push(await sharp(base).threshold(128).toBuffer());
      // Slight blur to reduce noise
      variants.push(await sharp(base).blur(0.7).toBuffer());
      // Stronger threshold
      variants.push(await sharp(base).threshold(160).toBuffer());
      // Median (using Jimp) to remove speckles + contrast
      try {
        const j = await Jimp.read(base);
        j.median(1).contrast(0.35).normalize();
        variants.push(await j.getBufferAsync(Jimp.MIME_JPEG));
      } catch(_) {}
    } catch(_) {
      variants.push(buffer);
    }
    // Try OCR across variants and language combos
    const langs = ['vie+eng', 'eng'];
    let bestText = '';
    for (const v of variants) {
      for (const lang of langs) {
        try {
          const { data } = await Tesseract.recognize(v, lang, { logger: () => {}, langPath: path.join(__dirname, '..') });
          const t = (data && data.text ? String(data.text) : '').trim();
          if(OCR_DEBUG) console.log(`[OCR] Tesseract variant lang=${lang} length=${t.length}`);
          if (t && t.length > bestText.length) {
            bestText = t;
          }
        } catch(_) { /* try next */ }
      }
      if (bestText && bestText.length > 100) break; // early stop when good enough
    }
    const text = bestText.trim();
    
    // If still empty, do a last-resort heavy threshold
    if (!text) {
      try {
        const thr = await sharp(variants[0] || buffer).threshold(180).toBuffer();
        const { data } = await Tesseract.recognize(thr, 'vie+eng', { logger: () => {}, langPath: path.join(__dirname, '..') });
        if (!bestText && data?.text) bestText = String(data.text).trim();
      } catch(_) {}
    }
    if (!bestText) return res.status(400).json({ message: 'Không nhận dạng được nội dung từ ảnh', reason: 'empty-ocr', bytes: buffer?.length||0 });
    if (!text) return res.status(400).json({ message: 'Không nhận dạng được nội dung từ ảnh', reason: 'empty-ocr', bytes: buffer?.length||0 });

    // Parse basic fields
  const lines = bestText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const all = lines.join(' \n ');
    const result = { title: '', date: '', endDate: '', startTime: '', endTime: '', location: '', notes: '' };

    // Date patterns: support DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, DD/MM, and Vietnamese weekday hints
    const datePatterns = [
      /(\b|\D)(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(\b|\D)/, // DD/MM/YYYY or DD-MM-YYYY
      /(\b|\D)(\d{4})-(\d{1,2})-(\d{1,2})(\b|\D)/,          // YYYY-MM-DD
      /(\b|\D)(\d{1,2})[\/-](\d{1,2})(\b|\D)/               // DD/MM (assume current year)
    ];
  let y = new Date().getFullYear();
    for(const re of datePatterns){
      const m = all.match(re);
      if(m){
        if(re === datePatterns[0]){ // DD/MM/YYYY
          const dd = String(m[2]).padStart(2,'0'); const mm = String(m[3]).padStart(2,'0'); const yyyy = String(m[4]);
          result.date = `${yyyy}-${mm}-${dd}`;
        } else if(re === datePatterns[1]){ // YYYY-MM-DD
          const yyyy = String(m[2]); const mm = String(m[3]).padStart(2,'0'); const dd = String(m[4]).padStart(2,'0');
          result.date = `${yyyy}-${mm}-${dd}`;
        } else { // DD/MM
          const dd = String(m[2]).padStart(2,'0'); const mm = String(m[3]).padStart(2,'0');
          result.date = `${y}-${mm}-${dd}`;
        }
        break;
      }
    }

  // Time patterns: HH:MM, H:MM, "7h30", "19h", ranges with '-' or '–'
  const timeMatches = [];
  const reTimes = [/\b(\d{1,2}):(\d{2})\b/g, /\b(\d{1,2})h(\d{2})?\b/gi];
    for(const re of reTimes){
      let m; const s = all;
      while((m = re.exec(s))){ timeMatches.push(m); if(timeMatches.length>4) break; }
      if(timeMatches.length>4) break;
    }
    const normHM = (h, m) => `${String(Math.min(23,Math.max(0,parseInt(h||'0',10)))) .padStart(2,'0')}:${String(Math.min(59,Math.max(0,parseInt(m||'0',10)))) .padStart(2,'0')}`;
    if(timeMatches.length>=1){
      const t1 = timeMatches[0];
      const h1 = t1[1]; const m1 = t1[2] || '00';
      result.startTime = normHM(h1, m1);
    }
    if(timeMatches.length>=2){
      const t2 = timeMatches[1];
      const h2 = t2[1]; const m2 = t2[2] || '00';
      result.endTime = normHM(h2, m2);
    }
    // If a range like "07:30–09:00" appears in one token, try to split it
    if(!result.endTime){
      const range = all.match(/(\d{1,2}[:h]\d{0,2})\s*[\-–]\s*(\d{1,2}[:h]\d{0,2})/);
      if(range){
        const parseHM = (s) => {
          const m = s.match(/^(\d{1,2})(?::(\d{2}))?$/) || s.match(/^(\d{1,2})h(\d{2})?$/i);
          if(!m) return null; return normHM(m[1], m[2]||'00');
        };
        const a = parseHM(range[1]); const b = parseHM(range[2]);
        if(a){ result.startTime = a; }
        if(b){ result.endTime = b; }
      }
    }
    if(result.endTime && result.startTime && result.endTime <= result.startTime){
      // ensure end after start
      result.endTime = '';
    }

    // Location: look for keywords
    const locLine = lines.find(l => /(đi?a\s*đi?e?m|phòng|phong|room|tại|tai|at)\b/i.test(l));
    if(locLine){
      const cleaned = locLine.replace(/^(.*?:)\s*/,'');
      result.location = cleaned;
    }

    // Title: first non-meta line
    const isMeta = (s) => /\d{1,2}[\/:h]\d{1,2}|\d{4}-\d{2}-\d{2}|đi?a\s*đi?e?m|phòng|room|tại|at/i.test(s);
    result.title = (lines.find(l => !isMeta(l)) || '').slice(0,120) || 'Lịch mới từ ảnh';
    // Notes: include raw text for reference (truncated)
  result.notes = bestText.length>600 ? (bestText.slice(0,580)+'...') : bestText;

    // Default date fallback to today if missing
    if(!result.date){
      const d = new Date();
      const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      result.date = iso;
    }

  return res.json({ extracted: result, raw: bestText, rawLength: bestText.length });
  } catch(e){
    return res.status(500).json({ message: 'Lỗi OCR', error: e.message });
  }
};

// Unified scanner for PDF or image uploads. If PDF, extract text from pages; if image, run OCR like scanImage.
exports.scanFile = async (req, res) => {
  try {
    const userId = req.user.userId;
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ message: 'Thiếu tệp tải lên (file)' });
    }
    const { mimetype = '', originalname = '' } = req.file;
    const isPdf = (mimetype && mimetype.includes('pdf')) || /\.pdf$/i.test(originalname);
    if (isPdf) {
      if (!pdfParse) {
        return res.status(500).json({ message: 'Máy chủ chưa hỗ trợ đọc PDF (thiếu pdf-parse)' });
      }
      try {
        const parsed = await pdfParse(req.file.buffer);
        const text = String(parsed.text || '').trim();
        if (!text) return res.status(400).json({ message: 'Không đọc được nội dung PDF', reason: 'empty-pdf' });
        // Return raw text; frontend will parse to weekly preview
        return res.json({ raw: text, rawLength: text.length, extracted: {} });
      } catch (e) {
        return res.status(500).json({ message: 'Lỗi đọc PDF', error: e.message });
      }
    }
    // else treat as image (reuse scanImage pipeline but inline to avoid re-calling middleware)
    let buffer = req.file.buffer;
    try {
      buffer = await sharp(buffer)
        .rotate()
        .resize({ width: 2000, withoutEnlargement: true })
        .grayscale()
        .normalise()
        .toFormat('jpeg', { quality: 92 })
        .toBuffer();
    } catch(_e) {}
    // Try Gemini first, then external DEMINI
    try{
      const gText = await tryGeminiOCR(buffer);
      if(gText && gText.trim().length>0){
        const best = gText.trim();
        return res.json({ raw: best, rawLength: best.length, extracted: {} });
      }
    }catch(_){ }
    try{
      const extText = await tryExternalOCR(buffer);
      if(extText && extText.trim().length>0){
        const best = extText.trim();
        return res.json({ raw: best, rawLength: best.length, extracted: {} });
      }
    }catch(_){ }
    try {
      const img = await Jimp.read(buffer);
      img.contrast(0.3).normalize();
      buffer = await img.getBufferAsync(Jimp.MIME_JPEG);
    } catch(_e) {}
    let data;
    try {
      ({ data } = await Tesseract.recognize(buffer, 'vie+eng', { logger: () => {}, langPath: path.join(__dirname, '..') }));
    } catch(_e) {
      ({ data } = await Tesseract.recognize(buffer, 'eng', { logger: () => {}, langPath: path.join(__dirname, '..') }));
    }
    let text = (data && data.text ? String(data.text) : '').trim();
    if (!text) {
      try {
        const thr = await sharp(buffer).threshold(128).toBuffer();
        let data2;
        try { ({ data: data2 } = await Tesseract.recognize(thr, 'vie+eng', { logger: () => {}, langPath: path.join(__dirname, '..') })); }
        catch(_ee){ ({ data: data2 } = await Tesseract.recognize(thr, 'eng', { logger: () => {}, langPath: path.join(__dirname, '..') })); }
        text = (data2 && data2.text ? String(data2.text) : '').trim();
      } catch(_e) {}
    }
    if (!text) return res.status(400).json({ message: 'Không nhận dạng được nội dung từ ảnh', reason: 'empty-ocr' });
    return res.json({ raw: text, rawLength: text.length, extracted: {} });
  } catch (e) {
    return res.status(500).json({ message: 'Lỗi xử lý tệp', error: e.message });
  }
};
