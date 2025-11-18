#!/usr/bin/env node
/**
 * Seed demo timeline for "Khoá Luận Tốt Nghiệp" project into current account.
 * Usage:
 *  node ./scripts/seed-demo.js --base http://localhost:5050 --email you@gmail.com --password ********
 *  # or provide an existing token
 *  node ./scripts/seed-demo.js --base http://localhost:5050 --token <JWT>
 */

const fetch = globalThis.fetch;
// Robust CLI args parser: supports --key value and --key=value
function parseArgs(argv){
  const out = {};
  for(let i=0;i<argv.length;i++){
    const token = argv[i];
    if(token.startsWith('--')){
      const eq = token.indexOf('=');
      if(eq>2){
        const key = token.slice(2, eq);
        const val = token.slice(eq+1);
        out[key] = val;
      } else {
        const key = token.slice(2);
        const next = argv[i+1];
        if(next && !next.startsWith('--')){ out[key] = next; i++; }
        else { out[key] = true; }
      }
    }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));

const BASE = (args.base && String(args.base)) || process.env.EXPO_PUBLIC_API_BASE || 'http://localhost:5050';
const EMAIL = args.email || process.env.SEED_EMAIL;
const PASSWORD = args.password || process.env.SEED_PASSWORD;
let TOKEN = args.token || process.env.SEED_TOKEN;

function authHeader(){
  const raw = String(TOKEN||'').replace(/^Bearer\s+/i,'');
  return { Authorization: `Bearer ${raw}` };
}

function log(...m){ console.log('[seed]', ...m); }
function pad(n){ return String(n).padStart(2,'0'); }
function isoDate(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }

async function login(){
  if(TOKEN) return TOKEN;
  if(!EMAIL || !PASSWORD) throw new Error('Provide --token or --email/--password');
  const res = await fetch(`${BASE}/api/auth/login`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  if(!res.ok){ const t = await res.text(); throw new Error('Login failed: '+t); }
  const data = await res.json();
  TOKEN = data.token; return TOKEN;
}

async function ensureProject(name){
  const res = await fetch(`${BASE}/api/projects`, { headers:{ ...authHeader() }});
  if(!res.ok) throw new Error('List projects failed');
  const list = await res.json();
  const found = list.find((p)=> (p.name||'').trim().toLowerCase() === name.trim().toLowerCase());
  if(found) return found;
  const created = await fetch(`${BASE}/api/projects`, { method:'POST', headers:{ 'Content-Type':'application/json', ...authHeader() }, body: JSON.stringify({ name, description: 'Dự án demo dữ liệu', startDate: '2025-08-18' }) });
  if(!created.ok){ const t = await created.text(); throw new Error('Create project failed: '+t); }
  return created.json();
}

async function getEventTypes(){
  const res = await fetch(`${BASE}/api/event-types`, { headers:{ ...authHeader() }});
  if(!res.ok){ const t = await res.text(); throw new Error('List event-types failed: '+t); }
  return res.json();
}

async function postEvent(payload){
  const res = await fetch(`${BASE}/api/events`, { method:'POST', headers:{ 'Content-Type':'application/json', ...authHeader() }, body: JSON.stringify(payload) });
  if(res.status===409) return null; // skip duplicate if controller supports; else just create
  if(!res.ok){ const t = await res.text(); throw new Error('Create event failed: '+t); }
  return res.json();
}

async function postTask(payload){
  const res = await fetch(`${BASE}/api/tasks`, { method:'POST', headers:{ 'Content-Type':'application/json', ...authHeader() }, body: JSON.stringify(payload) });
  if(res.status===409) return null;
  if(!res.ok){ const t = await res.text(); throw new Error('Create task failed: '+t); }
  return res.json();
}

function buildEvents(eventTypeId, projectId){
  const data = [];
  // Anchors
  data.push({ title:'Daily Standup', typeId:eventTypeId, date:'2025-08-18', startTime:'09:30', endTime:'09:45', location:'Online', notes:'Cập nhật tiến độ, vướng mắc', repeat:{ frequency:'daily', endMode:'onDate', endDate:'2025-11-19' }, projectId });
  data.push({ title:'Sprint Planning', typeId:eventTypeId, date:'2025-08-18', startTime:'10:00', endTime:'11:00', location:'Phòng họp/Online', notes:'Lập kế hoạch sprint tuần', repeat:{ frequency:'weekly', endMode:'onDate', endDate:'2025-11-17' }, projectId });
  data.push({ title:'Sprint Review', typeId:eventTypeId, date:'2025-08-22', startTime:'16:00', endTime:'16:45', location:'Phòng họp/Online', notes:'Demo kết quả sprint', repeat:{ frequency:'weekly', endMode:'onDate', endDate:'2025-11-14' }, projectId });
  data.push({ title:'Sprint Retrospective', typeId:eventTypeId, date:'2025-08-22', startTime:'17:00', endTime:'17:30', location:'Phòng họp/Online', notes:'Nhìn lại, cải tiến quy trình', repeat:{ frequency:'weekly', endMode:'onDate', endDate:'2025-11-14' }, projectId });
  const milestones = [
    ['Milestone Demo: Setup & CI','2025-08-22'],
    ['Milestone Demo: Auth + CRUD','2025-08-29'],
    ['Milestone Demo: Events Core','2025-09-05'],
    ['Milestone Demo: OCR MVP','2025-09-12'],
    ['Milestone Demo: OCR Robust','2025-09-19'],
    ['Milestone Demo: Preview-first UX','2025-09-26'],
    ['Milestone Demo: Device Import','2025-10-03'],
    ['Milestone Demo: Google Calendar','2025-10-10'],
    ['Milestone Demo: Insights','2025-10-17'],
    ['Milestone Demo: QA & Perf','2025-10-24'],
    ['Milestone Demo: Polish','2025-10-31'],
    ['Milestone Demo: Beta RC','2025-11-07'],
    ['Milestone Demo: UAT','2025-11-14'],
    ['Release & Follow-up','2025-11-19']
  ];
  milestones.forEach(([title,date])=>{
    data.push({ title, typeId:eventTypeId, date, startTime:'15:00', endTime:'15:30', location:'Online', projectId });
  });
  return data;
}

function buildTasks(projectId){
  const T = [];
  const add = (t)=>T.push({ projectId, priority:'medium', status:'todo', estimatedHours:6, time:'10:00', ...t });
  const list = [
    { title:'Khởi tạo repo & cấu trúc monorepo', description:'Thiết lập workspace, README, scripts', date:'2025-08-18', priority:'high', status:'completed', estimatedHours:4 },
    { title:'Cấu hình CI lint/typecheck', description:'ESLint, TS, Husky', date:'2025-08-19', priority:'medium', status:'completed', estimatedHours:3 },
    { title:'Auth backend (JWT)', description:'Đăng ký/đăng nhập, middleware', date:'2025-08-26', priority:'high', status:'completed', estimatedHours:8 },
    { title:'Mô hình Mongo: User/Project/Task/Event', description:'Schema & quan hệ', date:'2025-08-27', priority:'high', status:'completed', estimatedHours:6 },
    { title:'CRUD Project', description:'API + frontend form', date:'2025-08-29', priority:'medium', status:'completed', estimatedHours:6 },

    { title:'Events core: repeat/reminders', description:'API event + repeat + reminders', date:'2025-09-03', priority:'high', status:'completed', estimatedHours:10 },
    { title:'Push notifications', description:'Cấu hình thông báo', date:'2025-09-06', priority:'medium', status:'completed', estimatedHours:5 },

    { title:'OCR MVP (ảnh TKB → text)', description:'Tesseract + pipeline', date:'2025-09-11', priority:'high', status:'completed', estimatedHours:12 },
    { title:'Preview form từ OCR', description:'Điền form, sửa nhanh', date:'2025-09-12', priority:'medium', status:'completed', estimatedHours:6 },

    { title:'Tiền xử lý ảnh (binarize/resize)', description:'Nâng chất OCR', date:'2025-09-16', priority:'medium', status:'completed', estimatedHours:8 },
    { title:'AI parsing text fallback', description:'Fallback structured', date:'2025-09-18', priority:'high', status:'completed', estimatedHours:10 },

    { title:'Preview-first flow UX', description:'Scan → xem trước → chỉnh', date:'2025-09-24', priority:'medium', status:'completed', estimatedHours:6 },
    { title:'OKR metadata & cảnh báo', description:'Gợi ý OKR, warnings', date:'2025-09-26', priority:'low', status:'completed', estimatedHours:4 },

    { title:'Import lịch thiết bị', description:'Quyền, fetch, map form', date:'2025-10-01', priority:'high', status:'completed', estimatedHours:10 },
    { title:'UI nhóm/ngày & chọn nhiều', description:'Modal import, sticky', date:'2025-10-03', priority:'medium', status:'completed', estimatedHours:6 },

    { title:'Google OAuth', description:'Đăng nhập, scopes calendar.readonly', date:'2025-10-08', priority:'high', status:'completed', estimatedHours:8 },
    { title:'List calendars & events', description:'Chọn calendar, range filter', date:'2025-10-10', priority:'medium', status:'completed', estimatedHours:8 },

    { title:'Dashboard KPIs', description:'Hôm nay/tuần/tháng, chart', date:'2025-10-15', priority:'medium', status:'completed', estimatedHours:8 },
    { title:'Tối ưu hiệu năng list', description:'Memo render, stable keys', date:'2025-10-23', priority:'medium', status:'completed', estimatedHours:6 },

    { title:'Polish UI/UX', description:'Theme, spacing', date:'2025-10-30', priority:'low', status:'completed', estimatedHours:6 },
    { title:'Beta RC & logging', description:'Ghi log, xử lý lỗi', date:'2025-11-06', priority:'medium', status:'completed', estimatedHours:6 },

    { title:'UAT & docs', description:'Checklist phát hành, README', date:'2025-11-13', priority:'medium', status:'todo', estimatedHours:6 },
    { title:'Phát hành & theo dõi', description:'Release, feedback loop', date:'2025-11-19', priority:'high', status:'todo', estimatedHours:4 }
  ];
  list.forEach(add);
  return T;
}

(async function main(){
  try{
    log('Base:', BASE);
    await login();
    log('Login OK');
    const project = await ensureProject('Khoá Luận Tốt Nghiệp');
    log('Project:', project._id, project.name);
    const types = await getEventTypes();
    const defaultType = types.find(t=> t.isDefault) || types[0];
    if(!defaultType) throw new Error('No EventType found. Create one via /api/event-types before seeding.');
    const eventTypeId = defaultType._id;

    const events = buildEvents(eventTypeId, project._id);
    const tasks = buildTasks(project._id);

    for(const ev of events){
      try{ await postEvent(ev); log('Event ✅', ev.title, ev.date); } catch(e){ console.error('Event ❌', ev.title, e?.message || e); }
    }
    for(const tk of tasks){
      try{ await postTask(tk); log('Task ✅', tk.title, tk.date); } catch(e){ console.error('Task ❌', tk.title, e?.message || e); }
    }

    log('Done.');
  }catch(e){
    console.error('[seed] Error:', e.message);
    process.exitCode = 1;
  }
})();
