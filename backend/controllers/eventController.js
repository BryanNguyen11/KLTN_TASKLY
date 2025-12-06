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
const LLM_PROVIDER = (process.env.LLM_PROVIDER || 'gemini').toLowerCase();

// --- Time semantics helpers (map HH:MM to school periods like frontend) ---
const PERIOD_TIME = {
  1: { start: '06:30', end: '07:20' },
  2: { start: '07:20', end: '08:10' },
  3: { start: '08:10', end: '09:00' },
  4: { start: '09:10', end: '10:00' },
  5: { start: '10:00', end: '10:50' },
  6: { start: '10:50', end: '11:40' },
  7: { start: '12:30', end: '13:20' },
  8: { start: '13:20', end: '14:10' },
  9: { start: '14:10', end: '15:00' },
  10: { start: '15:10', end: '16:00' },
  11: { start: '16:00', end: '16:50' },
  12: { start: '16:50', end: '17:40' },
  13: { start: '18:00', end: '18:50' },
  14: { start: '18:50', end: '19:40' },
  15: { start: '19:50', end: '20:40' },
  16: { start: '20:40', end: '21:30' },
};
const __hm = (s)=>{ const [h,m] = String(s).split(':'); return (Math.min(23,Math.max(0,parseInt(h||'0',10)))*60) + (Math.min(59,Math.max(0,parseInt(m||'0',10)))); };
const __mins = Object.keys(PERIOD_TIME).map(n=>parseInt(n,10)).map(i=>({ i, s: __hm(PERIOD_TIME[i].start), e: __hm(PERIOD_TIME[i].end) }));
function hhmmToPeriodStart(hhmm){
  const t = __hm(hhmm);
  // choose the period whose start is <= t and closest to t; fallback to first
  let best = __mins[0].i; let bestDiff = 1e9;
  for(const p of __mins){
    if(p.s <= t){ const d = t - p.s; if(d < bestDiff){ bestDiff = d; best = p.i; } }
  }
  return best;
}
function hhmmToPeriodEnd(hhmm){
  if(!prompt){ return res.status(400).json({ message: 'Thiếu prompt' }); }
  if(!req.body?.items || !Array.isArray(req.body.items) || req.body.items.length === 0) {
    return res.status(400).json({ message: 'Thiếu danh sách items để biến đổi' });
  }
  // choose the period whose end is >= t and closest; fallback to last
  let best = __mins[__mins.length-1].i; let bestDiff = 1e9; let found=false;
  for(const p of __mins){
    if(p.e >= t){ const d = p.e - t; if(d < bestDiff){ bestDiff = d; best = p.i; found=true; } }
  }
  return found? best : __mins[__mins.length-1].i;
}
function parseTimeFromText(txt){
  try{
    const s = String(txt||'');
    const re1 = /\b(\d{1,2}):(\d{2})\b/; const m1 = s.match(re1);
    if(m1){ const h=m1[1], m=m1[2]; return `${String(Math.min(23,Math.max(0,parseInt(h,10)))).padStart(2,'0')}:${String(Math.min(59,Math.max(0,parseInt(m,10)))).padStart(2,'0')}`; }
    const re2 = /\b(\d{1,2})h(\d{2})?\b/i; const m2 = s.match(re2);
    if(m2){ const h=m2[1], m=m2[2]||'00'; return `${String(Math.min(23,Math.max(0,parseInt(h,10)))).padStart(2,'0')}:${String(Math.min(59,Math.max(0,parseInt(m,10)))).padStart(2,'0')}`; }
    return null;
  }catch{ return null; }
}
function parseDateFromText(txt){
  try{
    const s = String(txt||'');
    let m = s.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/); // DD/MM/YYYY
    if(m){ const dd=String(m[1]).padStart(2,'0'); const mm=String(m[2]).padStart(2,'0'); const yyyy=String(m[3]); return `${yyyy}-${mm}-${dd}`; }
    m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/); // YYYY-MM-DD
    if(m){ const yyyy=String(m[1]); const mm=String(m[2]).padStart(2,'0'); const dd=String(m[3]).padStart(2,'0'); return `${yyyy}-${mm}-${dd}`; }
    m = s.match(/(\d{1,2})[\/-](\d{1,2})(?![\/-]\d)/); // DD/MM
    if(m){ const now=new Date(); const yyyy=now.getFullYear(); const dd=String(m[1]).padStart(2,'0'); const mm=String(m[2]).padStart(2,'0'); return `${yyyy}-${mm}-${dd}`; }
    return null;
  }catch{ return null; }
}
function detectSemanticsFromPrompt(prompt){
  const p = String(prompt||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]+/g,'');
  // Detect "due/deadline" semantics vs "start" semantics in Vietnamese (diacritics stripped)
  const due = /(\bhan\b|\bhan chot\b|deadline|\btruoc\b|\bden han\b|\bnop\b|phai xong|phai hoan thanh)/i.test(p);
  const start = /(bat ?dau|khoi ?dong|start)/i.test(p);
  const time = parseTimeFromText(p);
  const date = parseDateFromText(p);
  return { mode: due? 'due' : (start? 'start' : 'none'), time, date };
}
function normalizeItemsBySemantics(items, prompt){
  try{
      // Rule-based mode: ignore userPrompt/AI paths
    const sem = detectSemanticsFromPrompt(prompt);
    if(sem.mode==='none') return out;
    // If a time is specified in prompt, align period range accordingly
    const t = sem.time;
    for(const it of out){
      if(!it) continue;
      if(sem.mode==='due' && t){
        const to = hhmmToPeriodEnd(t);
        const from = Math.max(1, to - 1); // single-period by default
        it.from = from; it.to = Math.max(from, to);
          // Rule-based parsing to structured progress-table
        if(sem.mode==='start' && sem.date && !it.startDate) it.startDate = sem.date;
        if(sem.mode==='due' && sem.date && !it.endDate) it.endDate = sem.date;
      }
    }
    return out;
  }catch{ return Array.isArray(items)? items: []; }
}

function detectStrictFromPrompt(prompt){
  try{
    const p = String(prompt||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]+/g,'');
    // Vietnamese and English hints for "strict/exact"
    return /(chinh\s*xac|chuan\s*xac|that\s*sat|exact|strict|nguyen\s*van)/i.test(p);
  }catch{ return false; }
}

// Resolve Vietnamese relative expressions like "9h sáng ngày t7 tuần này"
function resolveRelativeDateTime(prompt, baseNowISO){
  try{
      // Rule-based OCR only: use Tesseract, then parse
    const weekdayNames = { 'thu 2':1, 'thu 3':2, 'thu 4':3, 'thu 5':4, 'thu 6':5, 'thu 7':6, 'chu nhat':0, 'cn':0 };
    const findWeekdayToken = ()=>{
      for(const [k,v] of Object.entries(weekdayNames)){
        if(s.includes(k)) return v;
      }
      // Short form like "t7", "t3"
      const m = s.match(/\bt\s*(2|3|4|5|6|7)\b/);
      if(m){ return parseInt(m[1],10) - 1; /* convert VN Mon=2..Sat=7 to 1..6 (Sun=0) below */ }
      return null;
    };
    const hhmm = (()=>{
      let m = s.match(/\b(\d{1,2}):(\d{2})\b/); if(m) return `${pad2(Math.min(23,Math.max(0,parseInt(m[1],10))))}:${pad2(Math.min(59,Math.max(0,parseInt(m[2],10))))}`;
      m = s.match(/\b(\d{1,2})h(\d{2})?\b/); if(m){ const h=parseInt(m[1],10)||0; const mm=parseInt(m[2]||'0',10)||0; return `${pad2(Math.min(23,Math.max(0,h)))}:${pad2(Math.min(59,Math.max(0,mm)))}`; }
      return null;
    })();
    const thisWeek = /(tuan nay|tuan\s*nay)/i.test(s);
    const nextWeek = /(tuan sau|tuan toi)/i.test(s);
    const wd = findWeekdayToken();
    if(wd!==null){
      // compute target date for this/next week
      const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const baseDow = base.getDay(); // 0=Sun..6=Sat
      const targetDow = wd; // 0..6
      const delta = ((targetDow - baseDow + 7) % 7) + (nextWeek? 7 : 0);
      let dayOffset = delta;
      if(thisWeek && delta===0){ dayOffset = 0; }
      if(!thisWeek && !nextWeek && delta===0 && s.includes('hom nay')){ dayOffset = 0; }
      const target = new Date(base.getFullYear(), base.getMonth(), base.getDate()+dayOffset);
      return { date: toISO(target), time: hhmm || timeOfDayFallback || null };
    }
    // Relative phrases without explicit weekday (e.g., "ngay mai", "hom nay", "tomorrow")
    const dayShift = (()=>{
      if(/(ngay\s*mai|\bmai\b|tomorrow)/.test(s)) return 1;
      if(/(hom\s*nay|today)/.test(s)) return 0;
      if(/(ngay\s*kia)/.test(s)) return 2;
      return null;
    })();
    if(dayShift !== null){
      const target = new Date(now.getFullYear(), now.getMonth(), now.getDate()+dayShift);
      return { date: toISO(target), time: hhmm || timeOfDayFallback || null };
    }
    // Specific date mentioned already? let callers handle
    return null;
  }catch{ return null; }
}

// Minimal Ollama chat caller (optional, when LLM_PROVIDER=ollama)
async function ollamaChat(messages, opts={}){
  try{
    const base = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
    const model = process.env.OLLAMA_MODEL || 'llama3.1:8b';
    const body = { model, messages, stream: false, options: { temperature: 0.1, ...opts } };
    const ctrl = new AbortController();
    const timeoutMs = Math.min(30000, Number(process.env.OLLAMA_TIMEOUT_MS||15000)); // default 15s, cap 30s
    const to = setTimeout(()=> ctrl.abort(), timeoutMs);
    const url = `${base}/api/chat`;
    const resp = await fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body), signal: ctrl.signal }).finally(()=> clearTimeout(to));
    if(!resp.ok) throw new Error(`ollama http ${resp.status}`);
    const data = await resp.json();
    const content = String(data?.message?.content || '').trim();
    return content;
  }catch(e){ if(OCR_DEBUG) console.log('[OLLAMA] chat failed', e?.message||e); return null; }
}

// Notification helpers (similar to tasks)
function evToDisplayDate(iso){ try{ const [y,m,d] = String(iso||'').split('-').map(n=>parseInt(n,10)); if(!y||!m||!d) return ''; return `${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`; }catch{ return String(iso||''); } }
function evSafeJoinTime(a,b){ const s=a||''; const e=b||''; if(s&&e) return `${s}–${e}`; return s||e||''; }
function diffEventFields(before, after){
  const changes = [];
  const push=(label, from, to)=>{ if(from===to) return; changes.push({ label, from, to }); };
  push('Tiêu đề', before?.title||'', after?.title||'');
  push('Ngày', evToDisplayDate(before?.date), evToDisplayDate(after?.date));
  push('Đến ngày', evToDisplayDate(before?.endDate), evToDisplayDate(after?.endDate));
  push('Giờ', evSafeJoinTime(before?.startTime, before?.endTime), evSafeJoinTime(after?.startTime, after?.endTime));
  push('Địa điểm', before?.location||'', after?.location||'');
  push('Ghi chú', before?.notes||'', after?.notes||'');
  return changes;
}
function evSummarizeChanges(changes){ if(!Array.isArray(changes)||!changes.length) return ''; return changes.filter(ch=> (ch.from||'') !== (ch.to||'')).map(ch=> `• ${ch.label}: ${ch.from||'—'} → ${ch.to||'—'}`).join('\n'); }

function tesseractParams(){
  return {
    logger: () => {},
    langPath: path.join(__dirname, '..'),
    // Hints for table-like text
    psm: 6,
  };
}

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
async function tryGeminiOCR(buffer, userPrompt){
  try{
    if(LLM_PROVIDER === 'ollama') return null; // skip vision when using local provider
    const key = process.env.GEMINI_API_KEY;
    if(!key || !GoogleGenerativeAI) return null;
    const candidates = [
      process.env.GEMINI_MODEL,
      // Latest aliases first
      'gemini-1.5-flash-latest',
      'gemini-1.5-pro-latest',
      // Specific revisions
      'gemini-1.5-flash-002',
      'gemini-1.5-pro-002',
      'gemini-1.5-flash-001',
      'gemini-1.5-pro-001',
      // 8B variants
      'gemini-1.5-flash-8b-latest',
      'gemini-1.5-flash-8b-001',
      'gemini-1.5-flash-8b',
      // Base names
      'gemini-1.5-flash',
      'gemini-1.5-pro',
      // Legacy names for image
      'gemini-pro-vision'
    ].filter(Boolean);
    const genAI = new GoogleGenerativeAI(key);
    // Generation config from env (defaults optimized for OCR: deterministic)
    const temp = isFinite(parseFloat(process.env.GEMINI_TEMPERATURE||'')) ? parseFloat(process.env.GEMINI_TEMPERATURE||'') : 0;
    const topP = isFinite(parseFloat(process.env.GEMINI_TOP_P||'')) ? parseFloat(process.env.GEMINI_TOP_P||'') : undefined;
    const topK = isFinite(parseInt(process.env.GEMINI_TOP_K||'')) ? parseInt(process.env.GEMINI_TOP_K||'') : undefined;
    const maxOutputTokens = isFinite(parseInt(process.env.GEMINI_MAX_OUTPUT_TOKENS||'')) ? parseInt(process.env.GEMINI_MAX_OUTPUT_TOKENS||'') : undefined;
    const b64 = buffer.toString('base64');
    const prompt = [
      'You are an OCR engine. Return ONLY the UTF-8 plain text extracted from the image.',
      'Strict requirements:',
      '- Preserve all original line breaks; do not join or reorder lines.',
      '- Keep visual reading order left-to-right, top-to-bottom.',
      "- Do not translate or summarize; don't add commentary or Markdown.",
      "- If the image is a weekly timetable in Vietnamese, include day headers exactly as they appear, e.g. 'Thứ 2 10/02/2025', 'Thứ 3 11/02/2025', ... 'Chủ nhật 16/02/2025'.",
      '- Keep each cell/box content as separate lines, including labels like "Tiết:", "Phòng:", "GV:", "Ghi chú:".',
      userPrompt ? `Additional user instruction: ${String(userPrompt).slice(0, 500)}` : '',
    ].join('\n');
    const contents = [{ role: 'user', parts: [ { text: prompt }, { inlineData: { mimeType: 'image/jpeg', data: b64 } } ] }];
    const generationConfig = { temperature: temp, ...(topP!==undefined? { topP }: {}), ...(topK!==undefined? { topK }: {}), ...(maxOutputTokens!==undefined? { maxOutputTokens }: {}) };

    let text = '';
    for(const name of candidates){
      try{
        if(OCR_DEBUG) console.log(`[OCR] Trying Gemini Vision model=${name}`);
        const model = genAI.getGenerativeModel({ model: name });
        const result = await model.generateContent({ contents, generationConfig });
        text = String(result?.response?.text?.() || '').trim();
        if(text) break;
      }catch(e){ if(OCR_DEBUG) console.log(`[OCR] model ${name} failed: ${e?.message||e}`); }
    }
    if(OCR_DEBUG) console.log(`[OCR] Gemini response length=${text.length}`);
    if(!text) return null;
    // Strip possible Markdown fences
    text = text.replace(/^```[a-zA-Z]*\n|```$/g, '').trim();
    return text || null;
  }catch(_e){ return null; }
}

// Vision → structured JSON (skip OCR text step, ask directly for JSON items)
async function tryGeminiVisionToStructured(buffer, userPrompt){
  try{
    if(LLM_PROVIDER === 'ollama') return null; // skip vision when using local provider
    const key = process.env.GEMINI_API_KEY; if(!key || !GoogleGenerativeAI) return null;
    const candidates = [
      process.env.GEMINI_MODEL,
      // Latest aliases first
      'gemini-1.5-flash-latest',
      'gemini-1.5-pro-latest',
      // Specific revisions
      'gemini-1.5-flash-002',
      'gemini-1.5-pro-002',
      'gemini-1.5-flash-001',
      'gemini-1.5-pro-001',
      // 8B variants
      'gemini-1.5-flash-8b-latest',
      'gemini-1.5-flash-8b-001',
      'gemini-1.5-flash-8b',
      // Base names
      'gemini-1.5-flash',
      'gemini-1.5-pro',
      // Legacy names for image
      'gemini-pro-vision'
    ].filter(Boolean);
    const genAI = new GoogleGenerativeAI(key);
    const prompt = [
      'Bạn là engine OCR + trích xuất thời khoá biểu (tiếng Việt).',
      'Chỉ trả về JSON hợp lệ theo schema. Không giải thích hay Markdown.',
      'Schema: { "items": [ { "title": string, "weekday": number, "from": number, "to": number, "startDate": "YYYY-MM-DD"|"", "endDate": "YYYY-MM-DD"|"", "location": string, "lecturer": string, "notes": string } ] }',
      '- weekday: Thứ 2..7 => 2..7; Chủ nhật => 7',
      '- from/to: số tiết theo "Tiết a-b"; nếu bảng dùng 9–12 cho buổi chiều, vẫn ghi 9..12',
      '- startDate/endDate: nếu có ngày bắt đầu/kết thúc, điền ISO; nếu không rõ để ""',
      userPrompt ? `Yêu cầu bổ sung của người dùng: ${String(userPrompt).slice(0, 500)}` : '',
    ].join('\n');
    const b64 = buffer.toString('base64');

    let raw = '';
    for(const name of candidates){
      try{
        if(OCR_DEBUG) console.log(`[OCR] Trying Gemini Vision structured model=${name}`);
        const model = genAI.getGenerativeModel({ model: name });
        const result = await model.generateContent({
          contents: [ { role:'user', parts:[ { text: prompt }, { inlineData: { mimeType: 'image/jpeg', data: b64 } } ] } ],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'object',
              properties: {
                items: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      title: { type:'string' },
                      weekday: { type:'integer' },
                      from: { type:'integer' },
                      to: { type:'integer' },
                      startDate: { type:'string' },
                      endDate: { type:'string' },
                      location: { type:'string' },
                      lecturer: { type:'string' },
                      notes: { type:'string' }
                    },
                    required: ['title','weekday','from','to','startDate','endDate','location','lecturer','notes']
                  }
                }
              },
              required: ['items']
            }
          }
        });
        raw = String(result?.response?.text?.() || '').trim();
        if(raw) break;
      }catch(e){ if(OCR_DEBUG) console.log(`[OCR] structured model ${name} failed: ${e?.message||e}`); }
    }
    let data = null; try { data = JSON.parse(raw); } catch(_) { data = null; }
    const items = Array.isArray(data?.items) ? data.items : [];
    if(items.length){ if(OCR_DEBUG) console.log(`[OCR] Vision structured items=${items.length}`); return items; }
    return null;
  }catch(_e){ return null; }
}
// Gemini text-only parse for progress timetable from raw text (PDF text or OCR text)
// Returns array of { title, weekday (2..7 for Thu 2..7, 7 for Sunday), from, to, startDate, endDate, location }
async function tryGeminiParseProgress(text, userPrompt){
  try{
    if(LLM_PROVIDER === 'ollama'){
      // Use local Ollama to parse text into items JSON
      const sys = [
        'Bạn là trợ lý trích xuất thời khoá biểu từ văn bản (tiếng Việt).',
        'Chỉ trả về JSON hợp lệ theo schema, không kèm giải thích hay Markdown.',
        '{ "items": [ { "title": string, "weekday": number, "from": number, "to": number, "startDate": "YYYY-MM-DD"|"", "endDate": "YYYY-MM-DD"|"", "location": string, "lecturer": string, "notes": string } ] }',
        '- weekday: Thứ 2..7 => 2..7; Chủ nhật => 7',
        '- from/to: số tiết theo định dạng "Tiết a-b"',
      ].join('\n');
      const user = [ userPrompt? `Yêu cầu thêm: ${String(userPrompt).slice(0, 500)}` : '', 'Văn bản cần phân tích:', String(text||'').slice(0, 8000) ].filter(Boolean).join('\n');
      const content = await ollamaChat([
        { role:'system', content: sys },
        { role:'user', content: user }
      ]);
      let data = null; if(content){
        let s = content.replace(/^```json\n|```$/g,'').trim();
        try{ data = JSON.parse(s); }catch(_){ data=null; }
      }
      const items = Array.isArray(data?.items)? data.items: [];
      if(items.length) return items;
      return null;
    }
    const key = process.env.GEMINI_API_KEY;
    if(!key || !GoogleGenerativeAI) return null;
    const candidates = [
      process.env.GEMINI_TASK_MODEL,
      process.env.GEMINI_MODEL,
      // Latest aliases first
      'gemini-1.5-pro-latest',
      'gemini-1.5-flash-latest',
      // Specific revisions
      'gemini-1.5-pro-002',
      'gemini-1.5-pro-001',
      'gemini-1.5-flash-002',
      'gemini-1.5-flash-001',
      // Smaller/older
      'gemini-1.0-pro',
      // Base names
      'gemini-1.5-pro',
      'gemini-1.5-flash',
      // v1beta classic text model
      'gemini-pro'
    ].filter(Boolean);
    const genAI = new GoogleGenerativeAI(key);
    const temp = isFinite(parseFloat(process.env.GEMINI_TASK_TEMPERATURE||'')) ? parseFloat(process.env.GEMINI_TASK_TEMPERATURE||'') : 0.1;
    if(OCR_DEBUG) console.log(`[OCR] Trying Gemini text parse candidates=${candidates.join(',')}`);
    const prompt = [
      'Bạn là trợ lý trích xuất thời khoá biểu từ văn bản (tiếng Việt).',
      'Hãy phân tích văn bản dưới đây và trả về JSON với dạng:',
      '{ "items": [ { "title": string, "weekday": number, "from": number, "to": number, "startDate": "YYYY-MM-DD"|"", "endDate": "YYYY-MM-DD"|"", "location": string } ] }',
      '- weekday: dùng hệ Việt Nam: Thứ 2..7 => 2..7; Chủ nhật => 7',
      '- from/to: là số tiết theo định dạng "Tiết a-b"',
      '- startDate, endDate: nếu có ngày bắt đầu/kết thúc học phần, hãy điền theo ISO; nếu không rõ, để trống ""',
      '- Không thêm bình luận khác. Chỉ trả JSON hợp lệ.',
      userPrompt ? `Yêu cầu bổ sung của người dùng: ${String(userPrompt).slice(0, 500)}` : '',
    ].join('\n');
    const contents = [ { role:'user', parts:[ { text: prompt }, { text } ] } ];
    let raw = '';
    for(const name of candidates){
      try{
        const model = genAI.getGenerativeModel({ model: name });
        const result = await model.generateContent({
          contents,
          generationConfig: {
            temperature: temp,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'object',
              properties: {
                items: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      title: { type: 'string' },
                      weekday: { type: 'integer' },
                      from: { type: 'integer' },
                      to: { type: 'integer' },
                      startDate: { type: 'string' },
                      endDate: { type: 'string' },
                      location: { type: 'string' },
                      lecturer: { type: 'string' },
                      notes: { type: 'string' }
                    },
                    required: ['title','weekday','from','to','startDate','endDate','location','lecturer','notes']
                  }
                }
              },
              required: ['items']
            }
          }
        });
        raw = String(result?.response?.text?.() || '').trim();
        if(raw) break;
      }catch(e){ if(OCR_DEBUG) console.log(`[OCR] text parse model ${name} failed: ${e?.message||e}`); }
    }
    let data = null;
    try { data = JSON.parse(raw); } catch(_) { data = null; }
    const items = Array.isArray(data?.items) ? data.items : [];
    if(OCR_DEBUG) console.log(`[OCR] Gemini parse progress items=${items.length}`);
    if(items.length) return items;
    return null;
  }catch(_e){ return null; }
}

// Parse tabular "Lịch học theo tiến độ" style: rows with Thứ, Tiết a-b, Bắt đầu, Kết thúc, Phòng, Tên môn
function parseProgressTable(text){
  try{
    const strip = (s)=> s.normalize('NFD').replace(/[\u0300-\u036f]+/g,'').replace(/đ/gi,'d');
    const rawLines = String(text||'').split(/\r?\n/).map(s=>s.replace(/[\t\u00A0]+/g,' ').replace(/\s{2,}/g,' ').trim());
    const lines = rawLines.filter(Boolean);
    if(lines.length<3) return [];
    const L = lines.map(l=> ({ raw:l, n: strip(l).toLowerCase() }));
    const isMeta = (s)=> /^(lich|lich hoc|lich thi|thong tin|thoi gian|thu\b|tiet\b|phong\b|nhom\b|gio\b|bat dau\b|ket thuc\b|ma hoc phan\b|so tin chi\b|ma giang\b|stt\b)/i.test(strip(s));
    const looksTitle = (s)=>{
      const t = s.trim();
      if(!t) return false; if(isMeta(t)) return false;
      const letters = (t.match(/[A-Za-zÀ-ỹ]/g)||[]).length;
      const digits = (t.match(/\d/g)||[]).length;
      return letters >= 3 && letters > digits; // text-heavy
    };
    const mapThuByName = { hai:2, ba:3, tu:4, nam:5, sau:6, bay:7 };
    const dateRe = /(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/;
    const uniq = new Set();
    const items = [];
    let lastTitle = '';
    for(let i=0;i<L.length;i++){
      const raw = L[i].raw; const n = L[i].n;
      if(looksTitle(raw)) lastTitle = raw;
      // build a wider forward window for columns that may be on separate lines
      const winArr = L.slice(i, i+12);
      const win = winArr.map(o=>o.raw).join(' | ');
      const winN = strip(win).toLowerCase();
      // weekday detection
      let weekday = null;
      let m = winN.match(/\bthu\s*(2|3|4|5|6|7)\b/);
      if(m) weekday = parseInt(m[1],10);
      if(weekday===null){ const mm = winN.match(/\bthu\s*(hai|ba|tu|nam|sau|bay)\b/); if(mm) weekday = mapThuByName[mm[1]]||null; }
      if(weekday===null && /\bchu\s*nhat\b/.test(winN)) weekday = 7;
      if(!weekday) continue;
      // periods (Tiết a-b) may be a few tokens after 'Tiết'; fallback to generic a-b within range 1..16
      let pm = winN.match(/tiet[^\d]*(\d{1,2})\s*[\-–]\s*(\d{1,2})/);
      if(!pm){
        const any = winN.match(/\b(\d{1,2})\s*[\-–]\s*(\d{1,2})\b/);
        if(any){ pm = any; }
      }
      if(!pm) continue;
      let from = parseInt(pm[1],10), to = parseInt(pm[2],10);
      if(!(from&&to)) continue;
      if(from>to){ const t=from; from=to; to=t; }
      // clamp plausible periods
      if(from<1||from>16||to<1||to>16) continue;
      if(!(from&&to)) continue;
      // dates: around words 'bat dau' & 'ket thuc' (or standalone dd/mm/yyyy tokens)
      let startDate='', endDate='';
      const bdIdx = winN.indexOf('bat dau');
      if(bdIdx>=0){ const sPart = winN.slice(bdIdx, bdIdx+60); const md = sPart.match(dateRe); if(md){ startDate = `${md[3]}-${String(md[2]).padStart(2,'0')}-${String(md[1]).padStart(2,'0')}`; } }
      const ktIdx = winN.indexOf('ket thuc');
      if(ktIdx>=0){ const sPart = winN.slice(ktIdx, ktIdx+60); const md = sPart.match(dateRe); if(md){ endDate = `${md[3]}-${String(md[2]).padStart(2,'0')}-${String(md[1]).padStart(2,'0')}`; } }
      // If not found, scan nearby lines individually for date tokens
      if(!startDate||!endDate){
        for(const o of winArr){ const md = o.n.match(dateRe); if(md){ const iso = `${md[3]}-${String(md[2]).padStart(2,'0')}-${String(md[1]).padStart(2,'0')}`; if(!startDate) startDate=iso; else if(!endDate && iso!==startDate) endDate=iso; } }
      }
      // location: phong, truc tuyen, codes like C2.04, B3.03, H5.1.2
      let location='';
      const locRegex = /(ph\s?o?ng|phòng|phong|truc\s*tuyen|ms\s*teams|c\d+\.\d+|b\d+\.\d+|h\d+\.\d+(?:\.\d+)?|clc|knn)/i;
      const locMatch = win.match(locRegex);
      if(locMatch) location = locMatch[0].replace(/^.*?:\s*/,'');
      // title: prefer lastTitle; else look back a few lines
      let title = lastTitle;
      if(!title){
        for(let k=i-1;k>=Math.max(0,i-5);k--){ if(looksTitle(L[k].raw)){ title = L[k].raw; break; } }
      }
      if(!title) title = 'Lich hoc';
      const key = [title, weekday, from, to, startDate, endDate, location].join('|');
      if(!uniq.has(key)){
        items.push({ title, weekday, from, to, startDate, endDate, location });
        uniq.add(key);
      }
      i += 2; // skip ahead a bit to reduce duplicates
    }
    if(OCR_DEBUG) console.log(`[OCR] progress-table items=${items.length}`);
    return items;
  }catch(e){ if(OCR_DEBUG) console.log('[OCR] progress-table parse error', e.message); return []; }
}

// AI transform of structured timetable items according to a free-form user prompt
exports.aiTransform = async (req, res) => {
  try{
    const userId = req.user.userId;
  const prompt = String(req.body?.prompt || '').trim();
  const strictFlag = !!req.body?.strict;
  const strict = strictFlag || detectStrictFromPrompt(prompt);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if(OCR_DEBUG) console.log(`[AI-TRANSFORM] prompt.len=${prompt.length} items=${items.length}`);
    if(!prompt){ return res.status(400).json({ message: 'Thiếu prompt' }); }
    if(items.length === 0){ return res.status(400).json({ message: 'Thiếu danh sách items để biến đổi' }); }
    if(LLM_PROVIDER === 'ollama'){
      const sys = [
        'Bạn là trợ lý chuyển đổi thời khoá biểu. Dựa trên yêu cầu của người dùng, hãy LỌC/CHỈNH SỬA/CẬP NHẬT các mục trong danh sách dưới đây.',
        'Chỉ trả về JSON hợp lệ theo schema, không giải thích.',
        '{ "items": [ { "title": string, "weekday": number, "from": number, "to": number, "startDate": "YYYY-MM-DD"|"", "endDate": "YYYY-MM-DD"|"", "location": string, "lecturer": string, "notes": string } ] }'
      ].join('\n');
      const userMsg = [ `Yêu cầu người dùng: ${prompt}`, 'Danh sách items:', JSON.stringify({ items }, null, 2) ].join('\n');
      const content = await ollamaChat([
        { role:'system', content: sys },
        { role:'user', content: userMsg }
      ]);
      let data = null; if(content){ let s = content.replace(/^```json\n|```$/g,'').trim(); try{ data = JSON.parse(s); }catch(_){ data=null; } }
      let out = Array.isArray(data?.items)? data.items: [];
      const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(n)? n : lo));
      let safe = out.map(it => ({
        title: String(it.title||'').slice(0,120) || 'Lịch học',
        weekday: clamp(parseInt(it.weekday,10), 1, 7) || 2,
        from: clamp(parseInt(it.from,10), 1, 16),
        to: clamp(parseInt(it.to,10), 1, 16),
        startDate: String(it.startDate||''),
        endDate: String(it.endDate||''),
        location: String(it.location||''),
        lecturer: String(it.lecturer||''),
        notes: String(it.notes||'')
      })).filter(it => it.from <= it.to && it.weekday>=1 && it.weekday<=7);
      if(!strict){
        // First, apply semantic normalization (deadline vs start)
        safe = normalizeItemsBySemantics(safe, prompt);
        // Then, overlay any relative date/time from the prompt (start by default if not explicitly 'due')
        const sem = detectSemanticsFromPrompt(prompt);
  const rel = resolveRelativeDateTime(prompt, req.body?.now);
        if(rel){
          safe = safe.map(it => ({
            ...it,
            startDate: it.startDate || rel.date || it.startDate,
            endDate: it.endDate || '',
            ...(rel.time ? ( ()=>{ if(sem.mode==='due'){ const to = hhmmToPeriodEnd(rel.time); const from = Math.max(1, to-1); return { from, to }; } else { const from = hhmmToPeriodStart(rel.time); const to = Math.min(16, from+1); return { from, to }; } } )() : {}),
          }));
        }
      } else {
  const rel = resolveRelativeDateTime(prompt, req.body?.now);
        if(rel){
          safe = safe.map(it => ({
            ...it,
            startDate: it.startDate || rel.date || it.startDate,
            endDate: it.endDate || '',
            ...(rel.time ? ( ()=>{ const from = hhmmToPeriodStart(rel.time); const to = Math.min(16, from+1); return { from, to }; } )() : {}),
          }));
        }
      }
      if(safe.length===0) return res.json({ items });
      return res.json({ items: safe });
    }
    const key = process.env.GEMINI_API_KEY;
    if(!key || !GoogleGenerativeAI){ return res.status(500).json({ message: 'Máy chủ chưa cấu hình AI' }); }
    const modelName = process.env.GEMINI_TASK_MODEL || process.env.GEMINI_MODEL || 'gemini-1.5-pro';
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: modelName });
    const sys = [
      'Bạn là trợ lý chuyển đổi thời khoá biểu. Dựa trên yêu cầu của người dùng, hãy LỌC/CHỈNH SỬA/CẬP NHẬT các mục trong danh sách dưới đây.',
      'Trả về JSON hợp lệ theo schema, không kèm giải thích hay Markdown.',
      'Yêu cầu quan trọng:',
      '- Nếu người dùng không yêu cầu thay đổi một trường, giữ nguyên giá trị cũ.',
      strict ? '- CHẾ ĐỘ CHÍNH XÁC: Không suy diễn. Giữ nguyên các giá trị (weekday, from/to, startDate, endDate, location, v.v.) trừ khi prompt yêu cầu thay đổi rõ ràng.' : '',
      '- Có thể xoá mục không phù hợp với yêu cầu.',
      '- Không bịa đặt dữ liệu mới không có căn cứ.',
      '- Giữ weekday (2..7, Chủ nhật=7) và from/to (số tiết) trong phạm vi hợp lệ. startDate/endDate có thể giữ nguyên hoặc cập nhật theo yêu cầu.',
      strict ? '' : '- Nếu người dùng mô tả HẠN (deadline, đến hạn) lúc HH:MM thì coi đó là thời điểm KẾT THÚC (end) và chọn from/to sao cho "to" gần HH:MM nhất. Nếu mô tả BẮT ĐẦU lúc HH:MM thì chọn from/to sao cho "from" gần HH:MM nhất.',
    ].join('\n');
    const user = [
      `Yêu cầu người dùng: ${prompt}`,
      'Danh sách items (JSON):',
      JSON.stringify({ items }, null, 2)
    ].join('\n');
    const result = await model.generateContent({
      contents: [ { role:'user', parts: [ { text: sys }, { text: user } ] } ],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type:'string' },
                  weekday: { type:'integer' },
                  from: { type:'integer' },
                  to: { type:'integer' },
                  startDate: { type:'string' },
                  endDate: { type:'string' },
                  location: { type:'string' },
                  lecturer: { type:'string' },
                  notes: { type:'string' }
                },
                required: ['title','weekday','from','to','startDate','endDate','location','lecturer','notes']
              }
            }
          },
          required: ['items']
        }
      }
    });
    const raw = String(result?.response?.text?.() || '').trim();
    let data = null; try{ data = JSON.parse(raw); }catch(_){ data = null; }
    const out = Array.isArray(data?.items) ? data.items : [];
    if(OCR_DEBUG) console.log(`[AI-TRANSFORM] in=${items.length} out=${out.length}`);
    if(out.length === 0){ return res.json({ items }); }
    // Sanitize numeric ranges
    const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(n)? n : lo));
    let safe = out.map(it => ({
      title: String(it.title||'').slice(0,120) || 'Lịch học',
      weekday: clamp(parseInt(it.weekday,10), 2, 7) || 2,
      from: clamp(parseInt(it.from,10), 1, 16),
      to: clamp(parseInt(it.to,10), 1, 16),
      startDate: String(it.startDate||''),
      endDate: String(it.endDate||''),
      location: String(it.location||''),
      lecturer: String(it.lecturer||''),
      notes: String(it.notes||'')
    })).filter(it => it.from <= it.to);
    // Apply due/start-time semantics inferred from prompt unless strict
    if(!strict){ safe = normalizeItemsBySemantics(safe, prompt); }
    return res.json({ items: safe });
  }catch(e){
    return res.status(500).json({ message: 'Lỗi AI transform', error: e.message });
  }
};

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
    const before = await Event.findOne({ _id: req.params.id, userId }).lean();
    const doc = await Event.findOneAndUpdate({ _id: req.params.id, userId }, updates, { new: true });
    if (!doc) return res.status(404).json({ message: 'Không tìm thấy sự kiện' });
    res.json(doc);

    // Send detailed push to owner (and later project members if needed)
    try{
      const User = require('../models/User');
      // Avoid notifying the actor when they update their own event
      const isOwner = String(before?.userId||'') === String(userId||'');
      if(isOwner){ /* skip self-notify to reduce duplicates */ return; }
      const u = await User.findById(before?.userId||userId).select('expoPushTokens');
      let tokens = Array.isArray(u?.expoPushTokens)? u.expoPushTokens: [];
      // Deduplicate tokens for a single device
      tokens = Array.from(new Set(tokens.filter(t => typeof t==='string' && t.startsWith('ExpoPushToken['))));
      if(tokens.length){
        const changes = diffEventFields(before, doc);
        const body = changes.length? `${doc.title}\n${evSummarizeChanges(changes)}` : `${doc.title}`;
        await (async () => {
          const doFetch = globalThis.fetch;
          try{
            const list = tokens.map(to => ({ to, sound:'default', title:'Cập nhật lịch', body, data:{ type:'event-updated', id: String(doc._id) }, ttl: 600 }));
            if(list.length){ await doFetch('https://exp.host/--/api/v2/push/send', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(list) }); }
          }catch(_e){}
        })();
      }
    }catch(_e){}
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
    const userPrompt = (req.body && req.body.prompt) ? String(req.body.prompt) : undefined;
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
        .resize({ width: 3000, withoutEnlargement: true })
        .grayscale()
        .normalise()
        .toFormat('jpeg', { quality: 95 })
        .toBuffer();
      // Try Gemini Vision structured first
      try{
        const gStruct = await tryGeminiVisionToStructured(base, userPrompt);
        if(gStruct && gStruct.length){
          if(OCR_DEBUG) console.log('[OCR] Using Gemini Vision structured result');
          return res.json({ structured: { kind:'progress-table', items: gStruct }, raw: '', rawLength: 0 });
        }
      }catch(_){ }
      // Try Gemini OCR text next
      try{
        const gText = await tryGeminiOCR(base, userPrompt);
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
          // Try structured progress-table parse
          const items = parseProgressTable(bestText);
          if(items && items.length){ return res.json({ structured: { kind:'progress-table', items }, raw: bestText, rawLength: bestText.length }); }
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
          const items = parseProgressTable(bestText);
          if(items && items.length){ return res.json({ structured: { kind:'progress-table', items }, raw: bestText, rawLength: bestText.length }); }
          return res.json({ extracted: result, raw: bestText, rawLength: bestText.length });
        }
      }catch(_){ }
      variants.push(base);
      // High contrast threshold (use PNG to avoid JPEG artifacts)
      variants.push(await sharp(base).threshold(128).toFormat('png').toBuffer());
      // Slight blur then threshold
      variants.push(await sharp(base).blur(0.7).threshold(140).toFormat('png').toBuffer());
      // Stronger threshold
      variants.push(await sharp(base).threshold(180).toFormat('png').toBuffer());
      // Gamma + sharpen
      variants.push(await sharp(base).gamma(1.2).sharpen().toFormat('jpeg', { quality: 95 }).toBuffer());
      // Median (using Jimp) to remove speckles + contrast
      try {
        const j = await Jimp.read(base);
        j.median(1).contrast(0.35).normalize();
        variants.push(await j.getBufferAsync(Jimp.MIME_PNG));
      } catch(_) {}
    } catch(_) {
      variants.push(buffer);
    }
    // Try OCR across variants and language combos
    const langs = ['vie+eng', 'vie', 'eng'];
    let bestText = '';
    for (const v of variants) {
      for (const lang of langs) {
        try {
          const { data } = await Tesseract.recognize(v, lang, tesseractParams());
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
        const thr = await sharp(variants[0] || buffer).threshold(180).toFormat('png').toBuffer();
        const { data } = await Tesseract.recognize(thr, 'vie+eng', tesseractParams());
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

  const items = parseProgressTable(bestText);
  if(items && items.length){ return res.json({ structured: { kind:'progress-table', items }, raw: bestText, rawLength: bestText.length }); }
  return res.json({ extracted: result, raw: bestText, rawLength: bestText.length });
  } catch(e){
    return res.status(500).json({ message: 'Lỗi OCR', error: e.message });
  }
};

// Unified scanner for PDF or image uploads. If PDF, extract text from pages; if image, run OCR like scanImage.
exports.scanFile = async (req, res) => {
  try {
    const userId = req.user.userId;
    // Accept both multipart file and base64 string from mobile
    let uploadBuffer = null;
    let uploadMime = '';
    let uploadName = '';
    if (req.file && req.file.buffer) {
      uploadBuffer = req.file.buffer;
      uploadMime = String(req.file.mimetype||'');
      uploadName = String(req.file.originalname||'');
    } else if (req.body && (req.body.fileBase64 || req.body.imageBase64)) {
      try {
        const b64 = String(req.body.fileBase64 || req.body.imageBase64 || '').trim();
        // Allow data URL or plain base64
        const m = b64.match(/^data:([^;]+);base64,(.+)$/);
        if (m) { uploadMime = m[1]; uploadBuffer = Buffer.from(m[2], 'base64'); }
        else { uploadBuffer = Buffer.from(b64, 'base64'); }
      } catch(_e) { uploadBuffer = null; }
      uploadName = 'upload';
    }
    if (!uploadBuffer) {
      return res.status(400).json({ message: 'Thiếu tệp tải lên (file hoặc fileBase64)' });
    }
    const userPrompt = (req.body && req.body.prompt) ? String(req.body.prompt) : undefined;
    const mimetype = uploadMime;
    const originalname = uploadName;
    const isPdf = (mimetype && mimetype.includes('pdf')) || /\.pdf$/i.test(originalname);
    if (isPdf) {
      if (!pdfParse) {
        return res.status(500).json({ message: 'Máy chủ chưa hỗ trợ đọc PDF (thiếu pdf-parse)' });
      }
      try {
        const parsed = await pdfParse(uploadBuffer);
        const text = String(parsed.text || '').trim();
        if (!text) return res.status(400).json({ message: 'Không đọc được nội dung PDF', reason: 'empty-pdf' });
        if(OCR_DEBUG){
          const sample = text.slice(0, 400).replace(/\s+/g,' ').trim();
          console.log(`[OCR] pdf text.len=${text.length} sample="${sample}"`);
        }
        // Rule-based parse only
        const items = parseProgressTable(text) || [];
        if(OCR_DEBUG) console.log('[OCR] rule-based progress-table items='+items.length);
        if(items.length){
          // Map to events-form fields
          const toHHMM = (from,to)=>({ startTime: PERIOD_TIME[from]?.start || '09:00', endTime: PERIOD_TIME[to]?.end || '' });
          const pad2 = (n)=> String(n).padStart(2,'0');
          const todayISO = (()=>{ const d=new Date(); return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; })();
          const firstWeekdayOnOrAfter = (baseISO, weekday)=>{
            try{ const [y,m,d] = String(baseISO||'').split('-').map(n=>parseInt(n,10)); const dt = new Date(y||new Date().getFullYear(), (m||1)-1, d||1); const js = dt.getDay() || 7; const w = Math.min(7,Math.max(1,weekday||2)); const diff = (w - js + 7) % 7; if(diff>0) dt.setDate(dt.getDate()+diff); return `${dt.getFullYear()}-${pad2(dt.getMonth()+1)}-${pad2(dt.getDate())}`; }catch{ const now=new Date(); return `${now.getFullYear()}-${pad2(now.getMonth()+1)}-${pad2(now.getDate())}`; }
          };
          const forms = items.map(it => {
            const { startTime, endTime } = toHHMM(it.from, it.to);
            const base = String(it.startDate||'').match(/^\d{4}-\d{2}-\d{2}$/) ? it.startDate : todayISO;
            const date = firstWeekdayOnOrAfter(base, it.weekday);
            const repeat = it.endDate ? { frequency:'weekly', endMode:'onDate', endDate: it.endDate } : undefined;
            return {
              title: String(it.title||'').trim() || 'Lịch',
              date,
              endDate: '',
              startTime,
              endTime,
              location: String(it.location||'').trim() || undefined,
              notes: String(it.notes||'').trim() || undefined,
              repeat,
            };
          });
          return res.json({ raw: text, rawLength: text.length, structured: { kind:'events-form', items: forms } });
        }
        // Try parsing tabular credit schedule when progress-table returns empty
        const creditItems = parseCreditScheduleTable(text) || [];
        if(OCR_DEBUG) console.log('[OCR] credit-table items='+creditItems.length);
        if(OCR_DEBUG && creditItems.length){
          const samp = creditItems.slice(0, Math.min(3, creditItems.length));
          for(let si=0; si<samp.length; si++){
            const it = samp[si];
            console.log(`[OCR] credit-items[${si}] code=${it.code||''} title="${it.title||''}" mode=${it.mode||''} from=${it.from} to=${it.to} start=${it.startDate||''} end=${it.endDate||''}`);
          }
        }
        if(creditItems.length){
          const toHHMM = (from,to)=>({ startTime: PERIOD_TIME[from]?.start || '09:00', endTime: PERIOD_TIME[to]?.end || '' });
          const pad2 = (n)=> String(n).padStart(2,'0');
          const todayISO = (()=>{ const d=new Date(); return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; })();
          const firstWeekdayOnOrAfter = (baseISO, weekday)=>{
            try{ const [y,m,d] = String(baseISO||'').split('-').map(n=>parseInt(n,10)); const dt = new Date(y||new Date().getFullYear(), (m||1)-1, d||1); const js = dt.getDay() || 7; const w = Math.min(7,Math.max(1,weekday||2)); const diff = (w - js + 7) % 7; if(diff>0) dt.setDate(dt.getDate()+diff); return `${dt.getFullYear()}-${pad2(dt.getMonth()+1)}-${pad2(dt.getDate())}`; }catch{ const now=new Date(); return `${now.getFullYear()}-${pad2(now.getMonth()+1)}-${pad2(now.getDate())}`; }
          };
          const toISO = (dmy)=>{ const m = String(dmy||'').match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if(!m) return todayISO; const dd=parseInt(m[1],10), mm=parseInt(m[2],10)-1, yy=parseInt(m[3],10); const d=new Date(yy,mm,dd); const p=(n)=> String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; };
          const titleFromText = (code)=>{
            try{
              // Markers that indicate schedule info begins; also include standalone credit count like '3' or '134'
              const markerRegex = /(\bThứ\b|\bTiết\b|\bLý\s*thuyết\b|\bThực\s*hành\b|\bPhòng\b|\b\d{1,3}\b\s+(?=\d{1,2}\s*[\-–]\s*\d{1,2})|\d{1,2}\/\d{1,2}\/\d{4})/i;
              let idx = -1; let keyCode = String(code||'').trim();
              if(keyCode){ idx = text.indexOf(keyCode); }
              if(idx<0){
                const mFirstCode = text.match(/\b(\d{6,})\b/);
                if(mFirstCode){ keyCode = mFirstCode[1]; idx = text.indexOf(keyCode); }
              }
              if(idx<0){
                // Direct regex over whole text: code + course name up to first marker
                const re = new RegExp(String.raw`(\d{6,})\s*([A-Za-zÀ-ỹ][A-Za-zÀ-ỹ\s\-()]*?(?:\d)?)\s*(?=(?:\b\d{1,3}\b\s+\d{1,2}\s*[\-–]\s*\d{1,2}|\d{1,2}\s*[\-–]\s*\d{1,2}|Lý\s*thuyết|Thực\s*hành|Phòng|\d{1,2}\/\d{1,2}\/\d{4}))`, 'i');
                const m = text.match(re);
                if(m){ const nm = String(m[2]||'').replace(/\s+/g,' ').trim(); return nm; }
                return '';
              }
              const window = text.slice(Math.max(0, idx), Math.min(text.length, idx+400)).replace(/\s+/g,' ').trim();
              const seg = window.substring(String(keyCode).length).trim();
              const cutIdx = seg.search(markerRegex);
              const cand = (cutIdx>-1? seg.slice(0,cutIdx): seg).trim();
              const m = cand.match(/^[A-Za-zÀ-ỹ][A-Za-zÀ-ỹ\s\-()]*\d*$/);
              return m? m[0].replace(/\s+/g,' ').trim() : '';
            }catch{ return ''; }
          };
          const forms = creditItems.map((it, idx) => {
            const { startTime, endTime } = toHHMM(it.from, it.to);
            const base = toISO(it.startDate);
            // If weekday is missing, use the start date directly; else align to next occurrence of weekday
            const date = (it.weekday && Number.isFinite(it.weekday)) ? firstWeekdayOnOrAfter(base, it.weekday) : base;
            const endISO = it.endDate ? toISO(it.endDate) : undefined;
            const repeat = endISO ? { frequency:'weekly', endMode:'onDate', endDate: endISO } : undefined;
            let titlePrimary = String(it.title||'').trim();
            if(!titlePrimary){ titlePrimary = titleFromText(it.code); }
            if(OCR_DEBUG){
              console.log(`[OCR] credit-map[${idx}] code=${it.code} mode=${it.mode} rawTitle="${String(it.title||'').trim()}" titleFromText="${titlePrimary}"`);
            }
            const title = titlePrimary ? [ titlePrimary, String(it.mode||'').trim() ].filter(Boolean).join(' ') : (it.code ? `Môn ${String(it.code).trim()}${it.mode? ' '+String(it.mode).trim(): ''}` : (String(it.mode||'').trim() || ''));
            const notes = [ String(it.lecturer||'').trim() ? `GV: ${String(it.lecturer).trim()}` : '', String(it.code||'').trim() ? `MH: ${String(it.code).trim()}` : '' ].filter(Boolean).join(' • ');
            return {
              title: title || 'Lịch mới',
              date,
              endDate: '',
              startTime,
              endTime,
              location: String(it.room||'').trim() || undefined,
              notes: notes || undefined,
              repeat,
            };
          });
          const metaTitles = OCR_DEBUG? forms.map(f=>f.title).slice(0,10): undefined;
          return res.json({ raw: text, rawLength: text.length, structured: { kind:'events-form', items: forms }, meta: { strategy: 'credit-table', titlesSample: metaTitles } });
        }
        // Fallback: direct Vietnamese date/time extraction to events-form
        const direct = directEventsFromText(text);
        if(direct.items.length){
          return res.json({ raw: text, rawLength: text.length, structured: { kind:'events-form', items: direct.items }, meta: { strategy: 'direct' } });
        }
        // Return raw when no items parsed
        return res.json({ raw: text, rawLength: text.length, structured: { kind:'events-form', items: [] }, meta: { strategy: 'none', hint: 'no-items-after-progress-and-credit' } });
      } catch (e) {
        return res.status(500).json({ message: 'Lỗi đọc PDF', error: e.message });
      }
    }
    // else treat as image (reuse scanImage pipeline but inline to avoid re-calling middleware)
  let buffer = uploadBuffer;
    try {
      buffer = await sharp(buffer)
        .rotate()
        .resize({ width: 2800, withoutEnlargement: true })
        .grayscale()
        .normalise()
        .toFormat('jpeg', { quality: 94 })
        .toBuffer();
    } catch(_e) {}
    // Rule-based only: no AI/external OCR fallbacks
    try {
      const img = await Jimp.read(buffer);
      img.contrast(0.35).normalize();
      buffer = await img.getBufferAsync(Jimp.MIME_PNG);
    } catch(_e) {}
    let data;
    try {
      ({ data } = await Tesseract.recognize(buffer, 'vie+eng', tesseractParams()));
    } catch(_e) {
      ({ data } = await Tesseract.recognize(buffer, 'eng', tesseractParams()));
    }
    let text = (data && data.text ? String(data.text) : '').trim();
    if (!text) {
      try {
        const thr = await sharp(buffer).threshold(140).toFormat('png').toBuffer();
        let data2;
        try { ({ data: data2 } = await Tesseract.recognize(thr, 'vie+eng', tesseractParams())); }
        catch(_ee){ ({ data: data2 } = await Tesseract.recognize(thr, 'eng', tesseractParams())); }
        text = (data2 && data2.text ? String(data2.text) : '').trim();
      } catch(_e) {}
    }
  if (!text) return res.status(400).json({ message: 'Không nhận dạng được nội dung từ ảnh', reason: 'empty-ocr' });
  const prog = parseProgressTable(text) || [];
    const toHHMM = (from,to)=>{
      const st = PERIOD_TIME[from]?.start || '09:00';
      const en = PERIOD_TIME[to]?.end || '';
      return { startTime: st, endTime: en };
    };
    const pad2 = (n)=> String(n).padStart(2,'0');
    const todayISO = (()=>{ const d=new Date(); return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; })();
    const firstWeekdayOnOrAfter = (baseISO, weekday)=>{
      try{ const [y,m,d] = String(baseISO||'').split('-').map(n=>parseInt(n,10)); const dt = new Date(y||new Date().getFullYear(), (m||1)-1, d||1); const js = dt.getDay() || 7; const w = Math.min(7,Math.max(1,weekday||2)); const diff = (w - js + 7) % 7; if(diff>0) dt.setDate(dt.getDate()+diff); return `${dt.getFullYear()}-${pad2(dt.getMonth()+1)}-${pad2(dt.getDate())}`; }catch{ const now=new Date(); return `${now.getFullYear()}-${pad2(now.getMonth()+1)}-${pad2(now.getDate())}`; }
    };
    const forms = prog.map(it => {
      const { startTime, endTime } = toHHMM(it.from, it.to);
      const base = String(it.startDate||'').match(/^\d{4}-\d{2}-\d{2}$/) ? it.startDate : todayISO;
      const date = firstWeekdayOnOrAfter(base, it.weekday);
      const repeat = it.endDate ? { frequency:'weekly', endMode:'onDate', endDate: it.endDate } : undefined;
      return {
        title: String(it.title||'').trim() || 'Lịch',
        date,
        endDate: '',
        startTime,
        endTime,
        location: String(it.location||'').trim() || undefined,
        notes: String(it.notes||'').trim() || undefined,
        repeat,
      };
    });
    if(forms.length){ return res.json({ raw: text, rawLength: text.length, structured: { kind:'events-form', items: forms } }); }
    // Fallback: direct Vietnamese date/time extraction to events-form
    const direct = directEventsFromText(text);
    if(direct.items.length){
      return res.json({ raw: text, rawLength: text.length, structured: { kind:'events-form', items: direct.items }, meta: { strategy: 'direct' } });
    }
    return res.json({ raw: text, rawLength: text.length, structured: { kind:'events-form', items: [] }, meta: { strategy: 'none' } });
  } catch (e) {
    return res.status(500).json({ message: 'Lỗi xử lý tệp', error: e.message });
  }
};

// Fallback: extract events directly from Vietnamese text (dates like dd/mm/yyyy, weekdays, and time ranges HH:MM-HH:MM or "Tiết a-b")
function directEventsFromText(raw){
  const text = String(raw||'');
  const lines = text.split(/\r?\n+/).map(s=>s.trim()).filter(Boolean);
  const pad2 = (n)=> String(n).padStart(2,'0');
  const norm = (s)=> s.normalize('NFC');
  const mapThuByName = { hai:2, ba:3, tu:4, tư:4, nam:5, năm:5, sau:6, bảy:7, bay:7, cn:7, chủnhật:7, 'chủ nhật':7 };
  const toISO = (d)=> `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
  const parseDate = (s)=>{
    // dd/mm/yyyy or dd-mm-yyyy
    const m = s.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})\b/);
    if(m){ const dd=parseInt(m[1]); const mm=parseInt(m[2])-1; let yy=parseInt(m[3]); if(yy<100) yy+=2000; const d=new Date(yy,mm,dd); if(!isNaN(d.getTime())) return toISO(d); }
    return null;
  };
  const parseWeekday = (s)=>{
    const p = s.toLowerCase();
    const m = p.match(/\bthu\s*(hai|ba|tu|tư|nam|năm|sau|bay|bảy)\b/) || p.match(/\b(chu nhat|chủ nhật|cn)\b/);
    if(m){ const k=(m[1]||m[0]).replace(/\s+/g,''); return mapThuByName[k]||null; }
    return null;
  };
  const parseTimeRange = (s)=>{
    // HH:MM - HH:MM or Hh-Hh, also "Tiết a-b"
    const mm = s.match(/\b(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})\b/);
    if(mm){ const st=`${pad2(parseInt(mm[1]))}:${mm[2]}`; const en=`${pad2(parseInt(mm[3]))}:${mm[4]}`; return { startTime: st, endTime: en }; }
    const hm = s.match(/\b(\d{1,2})h\s*[-–]\s*(\d{1,2})h\b/);
    if(hm){ const st=`${pad2(parseInt(hm[1]))}:00`; const en=`${pad2(parseInt(hm[2]))}:00`; return { startTime: st, endTime: en }; }
    const tm = s.match(/\b(tiết|tiet)\s*(\d{1,2})\s*[-–]\s*(\d{1,2})\b/i);
    if(tm){ const from=parseInt(tm[2]); const to=parseInt(tm[3]); const st=PERIOD_TIME[from]?.start||'09:00'; const en=PERIOD_TIME[to]?.end||''; return { startTime: st, endTime: en }; }
    return null;
  };
  const items = [];
  let currentDateISO = null;
  let currentWeekday = null;
  for(const rawLine of lines){
    const line = norm(rawLine);
    const dISO = parseDate(line);
    if(dISO){ currentDateISO = dISO; continue; }
    const wd = parseWeekday(line);
    if(wd){ currentWeekday = wd; continue; }
    const tr = parseTimeRange(line);
    if(tr){
      // Title on same line or previous non-empty line
      const idx = lines.indexOf(rawLine);
      let title = 'Lịch';
      for(let j=Math.max(0, idx-1); j>=Math.max(0, idx-3); j--){ const t = lines[j]; if(t && !parseTimeRange(t) && !parseDate(t) && !parseWeekday(t)){ title = t.replace(/^[\-•\*]\s*/, '').slice(0, 120); break; } }
      const date = currentDateISO || (()=>{ const today=new Date(); // if weekday known, find next
        if(currentWeekday){ const js = today.getDay()||7; const diff = (currentWeekday - js + 7) % 7; const d=new Date(today); d.setDate(today.getDate()+diff); return toISO(d); }
        return toISO(today);
      })();
      items.push({ title, date, endDate:'', startTime: tr.startTime, endTime: tr.endTime, location: undefined, notes: undefined });
    }
  }
  // Deduplicate trivial duplicates (same date+time+title)
  const key = (it)=> `${it.title}|${it.date}|${it.startTime}|${it.endTime}`.toLowerCase();
  const uniq = []; const seen = new Set();
  for(const it of items){ const k=key(it); if(!seen.has(k)){ seen.add(k); uniq.push(it); } }
  return { items: uniq };
}

// Parse tabular credit schedule (Lịch học tín chỉ) from PDF text
function parseCreditScheduleTable(raw){
  const text = String(raw||'');
  const lines = text.split(/\r?\n+/).map(s=>s.trim()).filter(Boolean);
  const pad2 = (n)=> String(n).padStart(2,'0');
  const weekdayFromThu = (s)=>{ const m = s.match(/\bTh(?:ứ)?\s*(\d)\b/i); return m? parseInt(m[1],10): null; };
  const parseTiet = (s)=>{ const m = s.match(/\bTiết\s*(\d{1,2})\s*[-–]\s*(\d{1,2})\b/i); if(m){ return { from: parseInt(m[1],10), to: parseInt(m[2],10) }; } return null; };
  const parseDateDMY = (s)=>{ const m = s.match(/\b(\d{1,2})[\/]?(\d{1,2})[\/]?(\d{4})\b/); if(m){ return `${pad2(parseInt(m[1],10))}/${pad2(parseInt(m[2],10))}/${m[3]}`; } return null; };
  const isCourseName = (s)=>{
    const t = String(s||'').trim();
    if(!/[A-Za-zÀ-ỹ]{2,}/.test(t)) return false;
    if(/^(STT|Mã\s*học\s*phần|Lịch\s*học\s*tín\s*chỉ|HK|Trường|Họ\s*tên|Mã\s*sinh\s*viên|Lớp\s*học|Thông\s*tin|Thời\s*gian\s*học|Giờ|Bắt\s*đầu|Kết\s*thúc|Phòng\s*học|Giảng\s*viên)$/i.test(t)) return false;
    const digits = (t.match(/\d/g)||[]).length;
    const letters = (t.match(/[A-Za-zÀ-ỹ]/g)||[]).length;
    if(digits>letters) return false;
    return true;
  };
  const items = [];
  let currentCourse = '';
  let currentMode = '';
  let currentCode = '';
  for(let i=0;i<lines.length;i++){
    const line = lines[i];
    // New: handle rows like 'STT CODE NAME ...' where STT is a leading number
    const sttCodeName = line.match(/^\s*\d+\s+(\d{6,})\s+([A-Za-zÀ-ỹ][A-Za-zÀ-ỹ\s\-()]*)(?:\s+\d{1,3})?/);
    if(sttCodeName){
      currentCode = sttCodeName[1];
      // Stop name before the next numeric-only token (credits/weekday)
      let nm = String(sttCodeName[2]||'').trim();
      // If next line continues name (rare), append until hitting a marker or numeric-only token
      for(let k=1;k<=2;k++){
        const nxt = (lines[i+k]||'').trim();
        if(nxt && /^(Lý\s*thuyết|Thực\s*hành|Thi\s*(giữa|cuối)\s*kỳ|Phòng|TT\.TEAMS|Trực\s*tuyến)/i.test(nxt)) break;
        if(nxt && !/^\d{1,3}$/.test(nxt) && /[A-Za-zÀ-ỹ]{2,}/.test(nxt)){ nm = (nm + ' ' + nxt).trim(); } else { break; }
      }
      currentCourse = nm.replace(/\s+/g,' ').trim();
    }
    // Pattern: <Mã học phần><Tên môn>[<Số tín chỉ>?]
    // Do not greedily treat trailing digit in course name (e.g., 'Anh văn 1') as credits.
  // Allow no space between code and course name (e.g., '1422001525570Anh văn 1')
    const codeNameCredits = line.match(/(\d{6,})\s*([A-Za-zÀ-ỹ][A-Za-zÀ-ỹ\s\-()]*?)(?:\s+(\d{1,3})\b)?/);
    if(codeNameCredits){
      currentCode = codeNameCredits[1];
      // Derive course name as the segment between code and the first schedule marker
      const afterCode = line.slice(line.indexOf(codeNameCredits[1]) + codeNameCredits[1].length);
      const markers = [/\bTiết\b/i, /\bLý\s*thuyết\b/i, /\bThực\s*hành\b/i, /\bPhòng\b/i, /\b\d{1,2}\s*[\-–]\s*\d{1,2}\b/, /\b\d{1,2}\/\d{1,2}\/\d{4}\b/];
      let cutIdx = afterCode.length;
      for(const re of markers){ const m = afterCode.match(re); if(m){ cutIdx = Math.min(cutIdx, m.index||cutIdx); } }
      let nameCand = afterCode.slice(0, cutIdx).trim();
      // If regex group already captured name, prefer longer meaningful segment
      const groupName = String(codeNameCredits[2]||'').trim();
      if(groupName.length && groupName.length >= nameCand.length) nameCand = groupName;
      // Keep trailing digit (e.g., 'Anh văn 1') if present
      nameCand = nameCand.replace(/^[:\-\s]+|[:\-\s]+$/g,'').trim();
      currentCourse = nameCand;
    }
    // Pattern: <Mã học phần><Tên môn> (no credits token visible)
    if(!currentCourse){
      const codeNameOnly = line.match(/\b(\d{6,})\b\s*([A-Za-zÀ-ỹ][A-Za-zÀ-ỹ\s\-()]+)/);
      if(codeNameOnly){
        currentCode = codeNameOnly[1];
        currentCourse = String(codeNameOnly[2]||'').trim();
      }
    }
    // Capture course code and name (often adjacent)
    const codeMatch = line.match(/\b\d{6,}\b/);
    if(codeMatch){
      currentCode = codeMatch[0];
      // Capture course title segment between code and first schedule marker.
      const markerRegex = /(\bThứ\b|\bTiết\b|\bLý\s*thuyết\b|\bThực\s*hành\b|\bPhòng\b|\d{1,2}\/\d{1,2}\/\d{4})/i;
      // Join current and a couple of next lines to handle OCR newlines
      const lookahead = [lines[i]||'', lines[i+1]||'', lines[i+2]||''].join(' ').replace(/\s+/g,' ').trim();
      const seg = lookahead.substring(lookahead.indexOf(currentCode) + currentCode.length).trim();
      if(seg){
        const cutIdx = seg.search(markerRegex);
        const rawTitle = (cutIdx > -1 ? seg.slice(0, cutIdx) : seg).trim();
        // Title should start with a letter (including Vietnamese) and may contain spaces, hyphens, and digits (e.g., 'Anh văn 1')
        const titleMatch = rawTitle.match(/^[A-Za-zÀ-ỹ][A-Za-zÀ-ỹ\s\-()]*\d*$/);
        if(titleMatch){
          currentCourse = titleMatch[0].replace(/\s+/g,' ').trim();
        }
      }
    }
    if(isCourseName(line)){
      // If line includes code then name, strip code from the course title
      const m2 = line.match(/\b\d{6,}\b\s*([A-Za-zÀ-ỹ][A-Za-zÀ-ỹ\s\-()]+)/);
      currentCourse = m2 ? String(m2[1]).trim() : line;
      // Mode on next lines (Lý thuyết/Thực hành)
      const next2 = [lines[i+1]||'', lines[i+2]||''].join(' ');
      const mMode = next2.match(/\b(Lý\s*thuyết|Thực\s*hành)\b/i);
      currentMode = mMode? mMode[1] : '';
    }
    const wd = weekdayFromThu(line);
    const t = parseTiet(line);
    const roomMatch = line.match(/\bPhòng\s*học\b[:\s]*([A-Za-z0-9\.\-() ]+)/i) || (lines[i+1]||'').match(/\bPhòng\s*học\b[:\s]*([A-Za-z0-9\.\-() ]+)/i);
    const room = roomMatch? String(roomMatch[1]).trim() : undefined;
    const start = parseDateDMY(line) || parseDateDMY(lines[i+1]||'') || parseDateDMY(lines[i+2]||'');
    // Kết thúc thường nằm cùng khối với Bắt đầu
    let end = null;
    for(let k=0;k<3;k++){ const mm = (lines[i+k]||'').match(/\bKết\s*thúc\b.*?(\d{1,2}[\/]\d{1,2}[\/]\d{4})/i); if(mm){ end = mm[1]; break; } }
    // Lecturer on nearby lines (giảng viên)
    const lecMatch = (lines[i+3]||'').match(/\bGiảng\s*viên\b[:\s]*([A-Za-zÀ-ỹ .\-']+)/i) || (lines[i+4]||'').match(/\bGiảng\s*viên\b[:\s]*([A-Za-zÀ-ỹ .\-']+)/i);
    const lecturer = lecMatch? String(lecMatch[1]).trim(): undefined;
    if(start && t){
      // Allow missing weekday (some PDFs lose the 'Thứ' token when flattened)
      let title = currentCourse || '';
      // Neighborhood window to recover code/title if missing
      const neighLines = [lines[i-2]||'', lines[i-1]||'', lines[i]||'', lines[i+1]||'', lines[i+2]||''];
      const neighJoined = neighLines.join(' ').replace(/\s+/g,' ').trim();
      if(!currentCode){
        const cm = neighJoined.match(/\b(\d{6,})\b/);
        if(cm) currentCode = cm[1];
      }
      if(!title || /^\s*$/.test(title)){
        // Scan neighborhood for a course name between code and schedule markers
        const neigh = [lines[i-1]||'', lines[i]||'', lines[i+1]||'', lines[i+2]||''];
  const markerRegex = /(\bThứ\b|\bTiết\b|\bTiet\b|\bLý\s*thuyết\b|\bLy\s*thuyet\b|\bThực\s*hành\b|\bThuc\s*hanh\b|\bPhòng\b|\bPhong\b|\d{1,2}\/\d{1,2}\/\d{4})/i;
        const joined = neighJoined;
        if(currentCode && joined.includes(currentCode)){
          const seg = joined.substring(joined.indexOf(currentCode)+String(currentCode).length).trim();
          const cutIdx = seg.search(markerRegex);
          const cand = (cutIdx>-1? seg.slice(0,cutIdx): seg).trim();
          if(cand && isCourseName(cand)) title = cand;
        }
        // Fallback: pick the first nearby line that looks like a course name
        if(!title || /^\s*$/.test(title)){
          for(const l of neigh){ if(isCourseName(l)){ title = l.trim(); break; } }
        }
        // Final fallback: derive from code + mode
        if(!title || /^\s*$/.test(title)) title = currentCode? `Môn ${currentCode}${currentMode? ' '+currentMode: ''}` : (currentMode||'');
      }
      items.push({ title, code: currentCode, mode: currentMode, weekday: wd || null, from: t.from, to: t.to, room, startDate: start, endDate: end || undefined, lecturer });
    }
  }
  // Fallback: dense text without line breaks – scan whole text with regex
  if(items.length === 0){
    const re = new RegExp(
      String.raw`(?:\b(\d{6,})\b)?\s*([A-Za-zÀ-ỹ][A-Za-zÀ-ỹ\s\-()]+?)\s+(\d{1,2})\s*[\-–]\s*(\d{1,2})\s*(Lý\s*thuyết|Thực\s*hành)?\s*([A-Z]\d+\.\d+(?:\.\d+)?|[A-Z]\d+|C\d+\.\d+(?:\.\d+)?|B\d+\.\d+(?:\.\d+)?|H\d+(?:\.\d+)+|C\d+\.\d+\s*\([^)]*\))?[^\d]*(\d{1,2}\/\d{1,2}\/\d{4})(?:[^\d]*(\d{1,2}\/\d{1,2}\/\d{4}))?`,
      'gi'
    );
    let m;
    while((m = re.exec(text))){
      const code = m[1] || '';
      const title = (m[2] || '').trim();
      const from = parseInt(m[3],10);
      const to = parseInt(m[4],10);
      const mode = m[5] || '';
      const roomRaw = m[6] || '';
      const room = roomRaw.replace(/\s+/g,' ').trim();
      const start = m[7];
      const end = m[8] || undefined;
      if(title && from && to && start){
        let finalTitle = title;
        if(!finalTitle){
          const backCand = [lines[(m.index||0)/1 - 1]||'', lines[(m.index||0)/1 - 2]||''];
          const fwdCand = [lines[(m.index||0)/1 + 1]||'', lines[(m.index||0)/1 + 2]||''];
          const cands = [...backCand, ...fwdCand];
          for(const c of cands){ if(isCourseName(c)){ finalTitle = c.trim(); break; } }
        }
        items.push({ title: finalTitle, code, mode, weekday: null, from, to, room, startDate: start, endDate: end });
      }
    }
    // Secondary fallback: look for glued labels like "Bắt đầuKết thúc" and parse dates around them
    if(items.length === 0){
      const glued = text.replace(/\s+/g,' ');
      const datePairs = [...glued.matchAll(/(\d{1,2}\/\d{1,2}\/\d{4}).{0,40}?(\d{1,2}\/\d{1,2}\/\d{4})/g)];
      const periodMatches = [...glued.matchAll(/\b(\d{1,2})\s*[\-–]\s*(\d{1,2})\b/g)];
      if(datePairs.length && periodMatches.length){
        // Heuristic: assume same order; take nearest room token preceding
        for(let idx=0; idx<Math.min(datePairs.length, periodMatches.length); idx++){
          const dp = datePairs[idx]; const pm = periodMatches[idx];
          const start = dp[1]; const end = dp[2];
          const from = parseInt(pm[1],10); const to = parseInt(pm[2],10);
          // Room token near pair
          let room = '';
          const pre = glued.slice(Math.max(0, dp.index-60), dp.index);
          const r = pre.match(/([A-Z]\d+\.\d+(?:\.\d+)?(?:\s*\([^)]*\))?)/);
          if(r) room = r[1];
          // Title nearby (previous 100 chars)
          let title = '';
          const tPrev = glued.slice(Math.max(0, pm.index-100), pm.index).match(/([A-Za-zÀ-ỹ][A-Za-zÀ-ỹ\s\-()]{4,})$/);
          if(tPrev) title = tPrev[1].trim();
          if(from && to && start){ items.push({ title, code:'', mode:'', weekday: null, from, to, room, startDate: start, endDate: end }); }
        }
      }
    }
  }
  // Augmentation: for items missing code/title, derive them by scanning around the start date in full text
  if(items.length){
    const normalize = (s)=> String(s||'').replace(/\s+/g,' ').trim();
    for(const it of items){
      const hasTitle = Boolean(normalize(it.title));
      const hasCode = Boolean(normalize(it.code));
      if(hasTitle && hasCode) continue;
      const dStr = normalize(it.startDate||'');
      if(!dStr) continue;
      const idx = text.indexOf(dStr);
      if(idx<0) continue;
      const windowBack = text.slice(Math.max(0, idx-300), idx).replace(/\s+/g,' ').trim();
      // Find the last 6+ digit code before the date
      const codes = [...windowBack.matchAll(/\b(\d{6,})\b/g)];
      const code = codes.length? codes[codes.length-1][1] : '';
      // Find course name after that code, stopping at markers
      let title = '';
      if(code){
        const pos = windowBack.lastIndexOf(code);
        const seg = windowBack.slice(pos + String(code).length).trim();
        const marker = /(\bThứ\b|\bTiết\b|\bTiet\b|\bLý\s*thuyết\b|\bLy\s*thuyet\b|\bThực\s*hành\b|\bThuc\s*hanh\b|\bPhòng\b|\bPhong\b|\b\d{1,3}\b\s+\d{1,2}\s*[\-–]\s*\d{1,2}|\d{1,2}\/\d{1,2}\/\d{4})/i;
        const cut = seg.search(marker);
        const cand = (cut>-1? seg.slice(0,cut): seg).trim();
        if(/^[A-Za-zÀ-ỹ][A-Za-zÀ-ỹ\s\-()]*\d*$/i.test(cand)) title = cand.replace(/\s+/g,' ').trim();
      }
      if(title && !hasTitle) it.title = title;
      if(code && !hasCode) it.code = code;
    }
  }
  return items;
}

// AI generate timetable items purely from a user prompt (no files)
exports.aiGenerate = async (req, res) => {
  try{
    const userId = req.user.userId;
  const prompt = String(req.body?.prompt || '').trim();
  const strictFlag = !!req.body?.strict;
  const strict = strictFlag || detectStrictFromPrompt(prompt);
    if(OCR_DEBUG) console.log(`[AI-GENERATE] prompt.len=${prompt.length}`);
    if(!prompt) return res.status(400).json({ message: 'Thiếu prompt' });
    if(LLM_PROVIDER === 'ollama'){
      const sys = [
        'Bạn là trợ lý tạo thời khoá biểu từ mô tả (tiếng Việt).',
        'Chỉ trả về JSON hợp lệ theo schema, không giải thích hay Markdown.',
        '{ "items": [ { "title": string, "weekday": number, "from": number, "to": number, "startDate": "YYYY-MM-DD"|"", "endDate": "YYYY-MM-DD"|"", "location": string, "lecturer": string, "notes": string } ] }'
      ].join('\n');
      const userMsg = `Yêu cầu người dùng:\n${prompt}`;
      const content = await ollamaChat([
        { role:'system', content: sys },
        { role:'user', content: userMsg }
      ]);
      // If Ollama fails/aborts, fall back to Gemini (if configured)
      if(content === null){ /* fall through to Gemini below */ }
      // Try parse JSON strictly, then relaxed extraction
      let data = null; let raw = String(content||'');
      const tryParse = (s)=>{ try{ return JSON.parse(s); }catch(_){ return null; } };
      const stripFences = (s)=> s.replace(/^```json\n|```$/g,'').trim();
      const tryExtractJson = (s)=>{
        // Try code-fence first
        let m = s.match(/```json\n([\s\S]*?)```/i); if(m){ const d = tryParse(m[1]); if(d) return d; }
        // Try first {...} block (best-effort)
        const i = s.indexOf('{'); const j = s.lastIndexOf('}');
        if(i>=0 && j>i){ const cand = s.slice(i, Math.min(j+1, i+20000)); const d = tryParse(cand); if(d) return d; }
        return null;
      };
      if(raw){
        data = tryParse(stripFences(raw));
        if(!data) data = tryExtractJson(raw);
      }
      let items = Array.isArray(data?.items)? data.items: [];
      // If empty, try a stricter second pass
      if(!items.length && content !== null){
        const strictSys = [
          'Chỉ trả về JSON hợp lệ theo đúng schema, không thêm chữ, không Markdown.',
          '{ "items": [ { "title": string, "weekday": number, "from": number, "to": number, "startDate": "YYYY-MM-DD"|"", "endDate": "YYYY-MM-DD"|"", "location": string, "lecturer": string, "notes": string } ] }',
          'Bắt đầu bằng { và kết thúc bằng }.'
        ].join('\n');
        const content2 = await ollamaChat([
          { role:'system', content: strictSys },
          { role:'user', content: userMsg }
        ], { temperature: 0 });
        if(content2){
          let d2 = tryParse(stripFences(content2));
          if(!d2) d2 = tryExtractJson(content2);
          items = Array.isArray(d2?.items)? d2.items: [];
          raw = content2;
        }
      }
      const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(n)? n : lo));
      items = items.map(it => ({
        title: String(it.title||'').slice(0,120) || 'Lịch học',
        weekday: clamp(parseInt(it.weekday,10), 1, 7) || 2,
        from: clamp(parseInt(it.from,10), 1, 16),
        to: clamp(parseInt(it.to,10), 1, 16),
        startDate: String(it.startDate||''),
        endDate: String(it.endDate||''),
        location: String(it.location||''),
        lecturer: String(it.lecturer||''),
        notes: String(it.notes||'')
      })).filter(it => it.from <= it.to && it.weekday>=1 && it.weekday<=7);
  if(!strict){ items = normalizeItemsBySemantics(items, prompt); }
      if(items.length){ return res.json({ items, model: process.env.OLLAMA_MODEL || 'llama3.1:8b', provider: 'ollama' }); }
      // Else fall through to Gemini implementation below
    }
    const key = process.env.GEMINI_API_KEY;
    if(!key || !GoogleGenerativeAI) return res.status(500).json({ message: 'Máy chủ chưa cấu hình AI' });
    const primaryModel = process.env.GEMINI_TASK_MODEL || process.env.GEMINI_MODEL || 'gemini-1.5-pro';
    const fallbackModel = process.env.GEMINI_FALLBACK_MODEL || 'gemini-1.5-flash';
    const candidates = [
      primaryModel,
      fallbackModel,
      process.env.GEMINI_MODEL,
      'gemini-1.5-flash-8b-latest',
      'gemini-1.5-flash-latest',
      'gemini-1.5-pro-latest',
      'gemini-1.5-flash-8b',
      'gemini-1.5-flash',
      'gemini-1.5-pro',
      // v1beta-compatible text model
      'gemini-pro'
    ].filter(Boolean);
    const genAI = new GoogleGenerativeAI(key);

    const sys = [
      'Bạn là trợ lý tạo thời khoá biểu từ mô tả (tiếng Việt).',
      'Hãy tạo danh sách các buổi học/sự kiện theo yêu cầu người dùng.',
      'Yêu cầu output: CHỈ JSON hợp lệ theo schema, không giải thích hay Markdown.',
      'Schema: { "items": [ { "title": string, "weekday": number, "from": number, "to": number, "startDate": "YYYY-MM-DD"|"", "endDate": "YYYY-MM-DD"|"", "location": string, "lecturer": string, "notes": string } ] }',
      '- weekday: Thứ 2..7 => 2..7; Chủ nhật => 7',
      '- from/to: tiết 1..16; nếu không rõ, ước lượng hợp lý và nhất quán',
      '- startDate/endDate: nếu thiếu, để ""',
      '- Không bịa đặt quá mức: dựa theo yêu cầu. Nếu thông tin thiếu hãy để trống.',
      strict ? '- CHẾ ĐỘ CHÍNH XÁC: Giữ nguyên giá trị người dùng mô tả. Không tự ý thay đổi weekday, from/to, startDate/endDate nếu prompt không chỉ định.' : '- Nếu người dùng nói "có hạn (deadline) lúc HH:MM" thì hiểu đó là thời điểm kết thúc và chọn "to" gần HH:MM nhất. Nếu nói "bắt đầu lúc HH:MM" thì chọn "from" gần HH:MM nhất.',
    ].join('\n');
    const user = `Yêu cầu người dùng:\n${prompt}`;

    const extractJson = (raw) => {
      try{
        if(!raw) return null;
        let s = String(raw).trim();
        // Strip code fences if present
        const fence = s.match(/```(?:json)?\n([\s\S]*?)```/i);
        if(fence) s = fence[1].trim();
        return JSON.parse(s);
      }catch(_){ return null; }
    };

    const sanitizeItems = (items) => {
      // Sanitize
      const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(n)? n : lo));
      return (Array.isArray(items)? items: []).map(it => ({
        title: String(it.title||'').slice(0,120) || 'Lịch học',
        weekday: clamp(parseInt(it.weekday,10), 1, 7) || 2,
        from: clamp(parseInt(it.from,10), 1, 16),
        to: clamp(parseInt(it.to,10), 1, 16),
        startDate: String(it.startDate||''),
        endDate: String(it.endDate||''),
        location: String(it.location||''),
        lecturer: String(it.lecturer||''),
        notes: String(it.notes||'')
      })).filter(it => it.from <= it.to && it.weekday>=1 && it.weekday<=7);
    };

    let modelUsed = primaryModel;
    let items = [];
    let raw = '';
    let primaryErr = null;

    async function tryWithModel(modelName, useSchema){
      const model = genAI.getGenerativeModel({ model: modelName });
      const cfg = useSchema ? {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type:'string' },
                  weekday: { type:'integer' },
                  from: { type:'integer' },
                  to: { type:'integer' },
                  startDate: { type:'string' },
                  endDate: { type:'string' },
                  location: { type:'string' },
                  lecturer: { type:'string' },
                  notes: { type:'string' }
                },
                required: ['title','weekday','from','to','startDate','endDate','location','lecturer','notes']
              }
            }
          },
          required: ['items']
        }
      } : { temperature: 0.1 };
      const result = await model.generateContent({ contents: [ { role:'user', parts:[ { text: sys }, { text: user } ] } ], generationConfig: cfg });
      return String(result?.response?.text?.() || '').trim();
    }

    // Iterate candidates: for each, try schema then relaxed
    for(const name of candidates){
      if(items.length) break;
      try{
        raw = await tryWithModel(name, true);
        const data = extractJson(raw);
        items = sanitizeItems(data?.items);
        modelUsed = name;
        if(OCR_DEBUG) console.log(`[AI-GENERATE] model=${name} strict items=${items.length} raw.len=${raw.length}`);
      }catch(e){ if(OCR_DEBUG) console.log(`[AI-GENERATE] ${name} strict failed: ${e?.message||e}`); }
      if(!items.length){
        try{
          raw = await tryWithModel(name, false);
          const data = extractJson(raw);
          items = sanitizeItems(data?.items || data?.schedule || data?.timetable);
          modelUsed = name;
          if(OCR_DEBUG) console.log(`[AI-GENERATE] model=${name} relaxed items=${items.length}`);
        }catch(e){ if(OCR_DEBUG) console.log(`[AI-GENERATE] ${name} relaxed failed: ${e?.message||e}`); }
      }
    }

    if(!items.length){
      // Provide a clear 400 with reason and minimal debug (first 200 chars) to avoid opaque 500
      const debug = raw ? String(raw).slice(0, 200) : undefined;
      return res.status(400).json({ message: 'AI không tạo được danh sách phù hợp', reason: 'empty-items', model: modelUsed, debug });
    }

    // Always apply normalization + relative overlay: if prompt contains relative time/day, enforce it
    let finalItems = normalizeItemsBySemantics(items, prompt);
    const sem = detectSemanticsFromPrompt(prompt);
  const rel = resolveRelativeDateTime(prompt, req.body?.now);
    if(rel){
      finalItems = finalItems.map(it => ({
        ...it,
        startDate: it.startDate || rel.date || it.startDate,
        endDate: it.endDate || '',
        ...(rel.time ? ( ()=>{ if(sem.mode==='due'){ const to = hhmmToPeriodEnd(rel.time); const from = Math.max(1, to-1); return { from, to }; } else { const from = hhmmToPeriodStart(rel.time); const to = Math.min(16, from+1); return { from, to }; } } )() : {}),
      }));
    }
    return res.json({ items: finalItems, model: modelUsed });
  }catch(e){
    return res.status(500).json({ message: 'Lỗi AI generate', reason: 'exception', error: e?.message || String(e) });
  }
};

// Debug: echo the prompt/items seen by server (no AI call)
exports.aiEcho = async (req, res) => {
  try{
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt : null;
    const itemsLen = Array.isArray(req.body?.items) ? req.body.items.length : undefined;
    return res.json({ prompt, promptLen: prompt? prompt.length: 0, itemsLen });
  }catch(e){ return res.status(500).json({ message: 'echo failed', error: e.message }); }
};

// Convert AI schedule items into EventForm-ready objects (date & HH:mm)
exports.aiGenerateForm = async (req, res) => {
  try{
    const prompt = String(req.body?.prompt || '').trim();
    if(!prompt) return res.status(400).json({ message: 'Thiếu prompt' });
    // Reuse aiGenerate to get normalized items (weekday/from/to/startDate/endDate)
    // Call the internal logic by simulating a request: to avoid duplication we call our own endpoint handler in-process
    // Here we re-run the core generation logic inline to stay within same process context
    const key = process.env.GEMINI_API_KEY;
    let GoogleGenerativeAI;
    try { ({ GoogleGenerativeAI } = require('@google/generative-ai')); } catch(_) {}
    let items = [];
    // Try ollama first if configured
    if(LLM_PROVIDER === 'ollama'){
      const content = await (async ()=>{
        try{
          const c = await (async()=>{
            const base = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
            const model = process.env.OLLAMA_MODEL || 'llama3.1:8b';
            const sys = 'Bạn là trợ lý tạo thời khoá biểu từ mô tả (tiếng Việt). Chỉ trả về JSON {"items": [...]} theo schema.';
            const body = { model, messages: [ { role:'system', content: sys }, { role:'user', content: `Yêu cầu:\n${prompt}` } ], stream:false, options:{ temperature: 0.1 } };
            const resp = await fetch(`${base}/api/chat`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) });
            if(!resp.ok) return '';
            const data = await resp.json();
            return String(data?.message?.content||'');
          })();
          return c || '';
        }catch{ return ''; }
      })();
      const tryParse = (s)=>{ try{ return JSON.parse(s); }catch{ return null; } };
      const code = (s)=>{ const m = s.match(/```json\n([\s\S]*?)```/i); return m? m[1]: s; };
      const data = tryParse(code(content));
      const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(n)? n : lo));
      items = Array.isArray(data?.items)? data.items.map(it => ({
        title: String(it.title||'').slice(0,120) || 'Lịch',
        weekday: clamp(parseInt(it.weekday,10),1,7)||2,
        from: clamp(parseInt(it.from,10),1,16),
        to: clamp(parseInt(it.to,10),1,16),
        startDate: String(it.startDate||''),
        endDate: String(it.endDate||''),
        location: String(it.location||''),
        notes: String(it.notes||'')
      })) : [];
    }
    if(!items.length){
      if(!key || !GoogleGenerativeAI) return res.status(500).json({ message: 'Máy chủ chưa cấu hình AI' });
      const genAI = new GoogleGenerativeAI(key);
      const modelName = process.env.GEMINI_TASK_MODEL || process.env.GEMINI_MODEL || 'gemini-1.5-pro';
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent({ contents:[ { role:'user', parts:[ { text: 'Trả về JSON {"items":[{"title": string, "weekday": number, "from": number, "to": number, "startDate": string, "endDate": string, "location": string, "notes": string}] }' }, { text: `Yêu cầu:\n${prompt}` } ] } ], generationConfig:{ responseMimeType:'application/json', temperature: 0.1 } });
      const raw = String(result?.response?.text?.()||'');
      let data = null; try{ data = JSON.parse(raw); }catch{ /* ignore */ }
      const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(n)? n : lo));
      items = Array.isArray(data?.items)? data.items.map(it => ({
        title: String(it.title||'').slice(0,120) || 'Lịch',
        weekday: clamp(parseInt(it.weekday,10),1,7)||2,
        from: clamp(parseInt(it.from,10),1,16),
        to: clamp(parseInt(it.to,10),1,16),
        startDate: String(it.startDate||''),
        endDate: String(it.endDate||''),
        location: String(it.location||''),
        notes: String(it.notes||'')
      })) : [];
      if(!items.length) return res.status(400).json({ message: 'AI không tạo được items', reason:'empty-items' });
    }
    // Normalize by semantics + relative phrases
    items = normalizeItemsBySemantics(items, prompt);
  const rel = resolveRelativeDateTime(prompt, req.body?.now);
    const sem = detectSemanticsFromPrompt(prompt);
    if(rel){
      items = items.map(it => ({
        ...it,
        startDate: it.startDate || rel.date || it.startDate,
        endDate: it.endDate || '',
        ...(rel.time ? ( ()=>{ if(sem.mode==='due'){ const to = hhmmToPeriodEnd(rel.time); const from = Math.max(1, to-1); return { from, to }; } else { const from = hhmmToPeriodStart(rel.time); const to = Math.min(16, from+1); return { from, to }; } } )() : {}),
      }));
    }
    // Convert to form
    const pad2 = (n)=> String(n).padStart(2,'0');
    const toHHMM = (from,to)=>{
      const st = PERIOD_TIME[from]?.start || '09:00';
      const en = PERIOD_TIME[to]?.end || '';
      return { startTime: st, endTime: en };
    };
    const firstWeekdayOnOrAfter = (baseISO, weekday)=>{
      try{
        const [y,m,d] = String(baseISO||'').split('-').map(n=>parseInt(n,10));
        const dt = new Date(y||new Date().getFullYear(), (m||1)-1, d||1);
        const js = dt.getDay() || 7; // 1..7
        const w = Math.min(7,Math.max(1,weekday));
        const diff = (w - js + 7) % 7;
        if(diff>0) dt.setDate(dt.getDate()+diff);
        return `${dt.getFullYear()}-${pad2(dt.getMonth()+1)}-${pad2(dt.getDate())}`;
      }catch{ const now=new Date(); return `${now.getFullYear()}-${pad2(now.getMonth()+1)}-${pad2(now.getDate())}`; }
    };
    const todayISO = (()=>{ const n=new Date(); return `${n.getFullYear()}-${pad2(n.getMonth()+1)}-${pad2(n.getDate())}`; })();
    const forms = items.map(it => {
      // If AI provided explicit HH:mm in notes or title (rare), future: parse; for now rely on semantics overlay next
      const { startTime, endTime } = toHHMM(it.from, it.to);
      const base = it.startDate || todayISO;
      // weekday in 1..7, JS conversion handled in helper
      const date = /^\d{4}-\d{2}-\d{2}$/.test(base) ? (it.weekday ? firstWeekdayOnOrAfter(base, it.weekday) : base) : todayISO;
      const repeat = it.endDate ? { frequency:'weekly', endMode:'onDate', endDate: it.endDate } : undefined;
      return {
        title: it.title || 'Lịch',
        date,
        // Preserve explicit time if prompt carried relative time (resolveRelativeDateTime handled before building items)
        startTime,
        endDate: '',
        endTime: endTime || '',
        location: it.location || '',
        notes: it.notes || '',
        link: '',
        repeat,
      };
    });
    return res.json({ items: forms });
  }catch(e){ return res.status(500).json({ message: 'Lỗi AI form', error: e?.message || String(e) }); }
};
