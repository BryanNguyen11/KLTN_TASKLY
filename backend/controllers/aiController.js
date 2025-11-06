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
