const LLM_PROVIDER = (process.env.LLM_PROVIDER || 'gemini').toLowerCase();
let GoogleGenerativeAI;
try { ({ GoogleGenerativeAI } = require('@google/generative-ai')); } catch(_) { GoogleGenerativeAI = null; }

async function ollamaChat(messages, opts={}){
  try{
    const base = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
    const model = process.env.OLLAMA_MODEL || 'llama3.1:8b';
    const temperature = isFinite(parseFloat(process.env.OLLAMA_TEMPERATURE||'')) ? parseFloat(process.env.OLLAMA_TEMPERATURE||'') : 0.2;
    const top_p = isFinite(parseFloat(process.env.OLLAMA_TOP_P||'')) ? parseFloat(process.env.OLLAMA_TOP_P||'') : undefined;
    const num_predict = isFinite(parseInt(process.env.OLLAMA_NUM_PREDICT||'')) ? parseInt(process.env.OLLAMA_NUM_PREDICT||'') : undefined;
    const options = { temperature, ...(top_p!==undefined? { top_p }: {}), ...(num_predict!==undefined? { num_predict }: {}), ...opts };
    const body = { model, messages, stream: false, options };
    const ctrl = new AbortController();
    const timeoutMs = Math.min(45000, Number(process.env.OLLAMA_TIMEOUT_MS||30000));
    const to = setTimeout(()=> ctrl.abort(), timeoutMs);
    const url = `${base}/api/chat`;
    const resp = await fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body), signal: ctrl.signal }).finally(()=> clearTimeout(to));
    if(!resp.ok) throw new Error(`ollama http ${resp.status}`);
    const data = await resp.json();
    const content = String(data?.message?.content || '').trim();
    return content || '';
  }catch(e){ return ''; }
}

exports.chat = async (req, res) => {
  try{
    const prompt = String(req.body?.prompt || '').trim();
    const baseNowISO = (typeof req.body?.now === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.now)) ? req.body.now : null;
    const now = (()=>{
      if(baseNowISO){ const [y,m,d] = baseNowISO.split('-').map(n=>parseInt(n,10)); return new Date(y,(m||1)-1,d||1); }
      return new Date();
    })();
    const pad2 = (n)=> String(n).padStart(2,'0');
    const toISO = (d)=> `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
    const toVN = (d)=> `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}/${d.getFullYear()}`;
    const norm = (s)=> s.normalize('NFD').replace(/[\u0300-\u036f]+/g,'').toLowerCase();
    const pN = norm(prompt);

    // Fast-path: simple date queries (today / tomorrow in VI/EN)
    const isToday = /\b(hom nay|homnay|today)\b/.test(pN);
    const isTomorrow = /\b(ngay mai|ngaymai|tomorrow)\b/.test(pN);
    if(isToday || isTomorrow){
      const d = new Date(now);
      if(isTomorrow){ d.setDate(d.getDate()+1); }
      const answer = `Ngày ${isTomorrow? 'mai' : 'hôm nay'} là ${toVN(d)} (ISO: ${toISO(d)})`;
      return res.json({ answer, provider:'builtin' });
    }
    if(!prompt) return res.status(400).json({ message: 'Thiếu prompt' });
    // System style: concise, helpful programming assistant (VN/EN)
    const sys = [
      'Bạn là trợ lý lập trình thân thiện. Trả lời ngắn gọn, rõ ràng, có ví dụ khi cần.',
      'Ngôn ngữ: ưu tiên tiếng Việt nếu câu hỏi là tiếng Việt; nếu không, dùng tiếng Anh.',
      'Nếu câu hỏi mơ hồ, hãy nêu giả định hợp lý trước khi trả lời.'
    ].join('\n');

    // Heuristic fallback: if user asks to evaluate schedule, return a local-only guidance message
    const isEvalReq = /danh gia thoi gian bieu|đánh giá thời gian biểu|danh\s*gia\s*lich/iu.test(prompt);
    if(isEvalReq && (!process.env.GEMINI_API_KEY && LLM_PROVIDER !== 'ollama')){
      const hint = [
        'Mình chưa thể dùng AI nâng cao để đánh giá thời gian biểu ở cấu hình hiện tại. Tuy nhiên, bạn có thể tự rà soát nhanh:',
        '- Kiểm tra ngày nào có nhiều lịch/tác vụ sát nhau → dãn cách 10–15 phút giữa các mục.',
        '- Ưu tiên tác vụ sắp hết hạn (hôm nay/mai), hạn chế tạo thêm trong ngày quá tải.',
        '- Gom nhóm các đầu việc tương tự trong cùng buổi để giảm chuyển ngữ cảnh.',
        '- Với lịch lặp lại hàng tuần, đặt ngày kết thúc rõ ràng (ví dụ: sau 6–8 tuần).',
      ].join('\n');
      return res.json({ answer: hint, provider: 'builtin' });
    }

    // Built-in: generalized time-range Q&A (events/tasks/both)
  async function summarizeRange({ startISO, endISO, scopeLabel }){
      const Event = require('../models/Event');
      const Task = require('../models/Task');
      const userId = req.user?.userId || req.user?.id;
      const pad2=(n)=> String(n).padStart(2,'0');
      const fmt = (iso)=> { if(!iso) return ''; const [y,m,d]=String(iso).split('-'); return `${d}/${m}`; };
      const within = (d, e)=> { const s = d; const t = e || d; return !(t < startISO || s > endISO); };
      // fetch
      const [events, tasks] = await Promise.all([
        (scopeLabel==='tasks'? Promise.resolve([]) : Event.find({ userId, $or:[ { date:{ $lte: endISO }, endDate:{ $gte: startISO } }, { date:{ $gte: startISO, $lte: endISO } } ] }).limit(800).lean()),
        (scopeLabel==='events'? Promise.resolve([]) : Task.find({ $or:[ { userId }, { assignedTo: userId } ] }).limit(1000).lean()),
      ]);
      const evs = (events||[]).filter(e => within(e.date, e.endDate));
      const tks = (tasks||[]).filter(t => within(t.date, t.endDate));
      const toHM = (s,e)=> s? (e? `${s}–${e}` : s) : '';
      const sortByDateTime = (a,b)=> {
        const ak = `${a.date || '9999-12-31'} ${a.startTime || '99:99'}`;
        const bk = `${b.date || '9999-12-31'} ${b.startTime || '99:99'}`;
        return ak.localeCompare(bk);
      };
      const topEFull = [...evs].sort(sortByDateTime).slice(0,8);
      const topTFull = [...tks].sort(sortByDateTime).slice(0,8);
      const topE = topEFull.map(x=> ({ date:x.date, title:x.title, time: toHM(x.startTime, x.endTime) }));
      const topT = topTFull.map(x=> ({ date:x.date, title:x.title, time: toHM(x.startTime, x.endTime) }));
      const lines = [];
      lines.push(`Khoảng thời gian: ${fmt(startISO)}–${fmt(endISO)}`);
      if(scopeLabel==='events' || scopeLabel==='both') lines.push(`- Lịch: ${evs.length}`);
      if(scopeLabel==='tasks' || scopeLabel==='both') lines.push(`- Tác vụ: ${tks.length}`);
      if(topE.length && (scopeLabel==='events' || scopeLabel==='both')){
        lines.push('Lịch sắp tới:');
        topE.forEach(e => lines.push(`  • ${fmt(e.date)} ${e.time? `(${e.time}) `:''}${e.title}`));
      }
      if(topT.length && (scopeLabel==='tasks' || scopeLabel==='both')){
        lines.push('Tác vụ sắp tới:');
        topT.forEach(t => lines.push(`  • ${fmt(t.date)} ${t.time? `(${t.time}) `:''}${t.title}`));
      }
      const eventsPayload = (scopeLabel==='tasks') ? [] : topEFull.map(e => ({ id: String(e._id||e.id||''), date: e.date, endDate: e.endDate||'', startTime: e.startTime||'', endTime: e.endTime||'', title: e.title||'', projectId: e.projectId||null }));
      const tasksPayload = (scopeLabel==='events') ? [] : topTFull.map(t => ({ id: String(t._id||t.id||''), date: t.date, endDate: t.endDate||'', startTime: t.startTime||'', endTime: t.endTime||'', title: t.title||'', projectId: t.projectId||null }));
      return res.json({ answer: lines.join('\n'), provider:'builtin', events: eventsPayload, tasks: tasksPayload, range: { start: startISO, end: endISO } });
    }

    function startOfWeek(d){ const day = d.getDay(); const mondayOffset = (day===0? -6 : 1-day); const s = new Date(d); s.setDate(d.getDate()+mondayOffset); return new Date(s.getFullYear(), s.getMonth(), s.getDate()); }
    function endOfWeek(d){ const s = startOfWeek(d); const e = new Date(s); e.setDate(s.getDate()+6); return e; }
    function toISOd(d){ const pad2=(n)=> String(n).padStart(2,'0'); return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }

    // Determine range and scope from prompt
    const scopeLabel = /\btac\s*vu\b|\btask(s)?\b/.test(pN) ? 'tasks' : (/\blich\b|\bevent(s)?\b/.test(pN) ? 'events' : 'both');
    let rangeStart = null, rangeEnd = null;
    // 'trong X ngày tới' or 'in X days'
    let m = pN.match(/(?:trong\s*)?(\d+)\s*ngay(s)?\s*(toi|tiep|tiep\s*theo)?/);
    if(!m){ m = pN.match(/\b(?:in|for)\s*(\d+)\s*day(s)?\b/); }
    if(m){
      const nDays = Math.max(1, Math.min(60, parseInt(m[1],10)));
      const s = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const e = new Date(s); e.setDate(s.getDate()+ (nDays-1));
      rangeStart = s; rangeEnd = e;
    }
    // 'tuần này' / 'this week'
    if(!rangeStart && (/\btuan\s*nay\b/.test(pN) || /\bthis\s*week\b/.test(pN))){ rangeStart = startOfWeek(now); rangeEnd = endOfWeek(now); }
    // 'tuần tới' / 'next week'
    if(!rangeStart && (/\btuan\s*(toi|toi)\b/.test(pN) || /\bnext\s*week\b/.test(pN))){ const nextMon = startOfWeek(now); nextMon.setDate(nextMon.getDate()+7); const nextSun = new Date(nextMon); nextSun.setDate(nextMon.getDate()+6); rangeStart = nextMon; rangeEnd = nextSun; }
    // 'tháng này' / 'this month'
    if(!rangeStart && (/\bthang\s*nay\b/.test(pN) || /\bthis\s*month\b/.test(pN))){ const s = new Date(now.getFullYear(), now.getMonth(), 1); const e = new Date(now.getFullYear(), now.getMonth()+1, 0); rangeStart = s; rangeEnd = e; }
    // 'tháng tới' / 'next month'
    if(!rangeStart && (/\bthang\s*(toi|toi)\b/.test(pN) || /\bnext\s*month\b/.test(pN))){ const s = new Date(now.getFullYear(), now.getMonth()+1, 1); const e = new Date(now.getFullYear(), now.getMonth()+2, 0); rangeStart = s; rangeEnd = e; }
    // 'cuối tuần' / 'weekend'
    if(!rangeStart && (/\bcuoi\s*tuan\b/.test(pN) || /\bweekend\b/.test(pN))){ const mon = startOfWeek(now); const sat = new Date(mon); sat.setDate(mon.getDate()+5); const sun = new Date(mon); sun.setDate(mon.getDate()+6); rangeStart = sat; rangeEnd = sun; }
    // 'từ dd/mm đến dd/mm' (optional year)
    if(!rangeStart){
      const rm = pN.match(/\btu\s*(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?\s*den\s*(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?/);
      if(rm){
        const [ , d1, m1, y1, d2, m2, y2 ] = rm;
        const Y1 = y1 ? (parseInt(y1,10) < 100 ? 2000+parseInt(y1,10) : parseInt(y1,10)) : now.getFullYear();
        const Y2 = y2 ? (parseInt(y2,10) < 100 ? 2000+parseInt(y2,10) : parseInt(y2,10)) : now.getFullYear();
        const s = new Date(Y1, parseInt(m1,10)-1, parseInt(d1,10));
        const e = new Date(Y2, parseInt(m2,10)-1, parseInt(d2,10));
        if(!isNaN(s.getTime()) && !isNaN(e.getTime())){ rangeStart = s; rangeEnd = e; }
      }
    }
    // If matched a range, respond with summary now
    if(rangeStart && rangeEnd){
      const startISO = toISO(rangeStart);
      const endISO = toISO(rangeEnd);
      await summarizeRange({ startISO, endISO, scopeLabel });
      return; // response sent
    }

    if(LLM_PROVIDER === 'ollama'){
      const answer = await ollamaChat([
        { role:'system', content: sys },
        { role:'user', content: `${baseNowISO? `Hôm nay (theo thiết bị): ${baseNowISO}. `:''}Câu hỏi:\n${prompt}` }
      ]);
      if(answer) return res.json({ answer, provider:'ollama', model: process.env.OLLAMA_MODEL || 'llama3.1:8b' });
      // Fallback to Gemini if configured
    }

    const key = process.env.GEMINI_API_KEY;
    if(!key || !GoogleGenerativeAI){
      // No Gemini; return a graceful message
      return res.status(200).json({ answer: 'Mình chưa thể trả lời câu hỏi này với cấu hình hiện tại. Hãy cấu hình GEMINI_API_KEY để có câu trả lời tốt hơn.', provider: LLM_PROVIDER });
    }
    const genAI = new GoogleGenerativeAI(key);
    const modelName = process.env.GEMINI_TASK_MODEL || process.env.GEMINI_MODEL || 'gemini-1.5-pro';
    const model = genAI.getGenerativeModel({ model: modelName });
    const temp = isFinite(parseFloat(process.env.GEMINI_TEMPERATURE||'')) ? parseFloat(process.env.GEMINI_TEMPERATURE||'') : 0.2;
    const topP = isFinite(parseFloat(process.env.GEMINI_TOP_P||'')) ? parseFloat(process.env.GEMINI_TOP_P||'') : undefined;
    const topK = isFinite(parseInt(process.env.GEMINI_TOP_K||'')) ? parseInt(process.env.GEMINI_TOP_K||'') : undefined;
    const maxOutputTokens = isFinite(parseInt(process.env.GEMINI_MAX_OUTPUT_TOKENS||'')) ? parseInt(process.env.GEMINI_MAX_OUTPUT_TOKENS||'') : undefined;
    const result = await model.generateContent({
      contents: [ { role:'user', parts:[ { text: sys }, { text: `${baseNowISO? `Hôm nay (theo thiết bị): ${baseNowISO}. `:''}Câu hỏi:\n${prompt}` } ] } ],
      generationConfig: { temperature: temp, ...(topP!==undefined? { topP }: {}), ...(topK!==undefined? { topK }: {}), ...(maxOutputTokens!==undefined? { maxOutputTokens }: {}) }
    });
    const answer = String(result?.response?.text?.() || '').trim();
    return res.json({ answer, provider:'gemini', model: modelName });
  }catch(e){ return res.status(500).json({ message: 'Lỗi AI chat', error: e?.message || String(e) }); }
};
