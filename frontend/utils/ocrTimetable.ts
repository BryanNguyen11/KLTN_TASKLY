export type CandidateEvent = {
  title: string;
  date: string; // ISO YYYY-MM-DD
  periods?: { from: number; to: number };
  slot: 'morning' | 'afternoon' | 'evening';
  startTime: string; // HH:MM
  endTime: string;   // HH:MM
  location?: string;
  lecturer?: string;
  notes?: string;
};

export type WeekdayBlock = {
  weekday: number; // 1=Mon .. 7=Sun
  label: string;   // Thứ 2, ... Chủ nhật
  date: string;    // ISO YYYY-MM-DD
  events: CandidateEvent[];
};

function stripDiacritics(s: string) {
  // Use NFD and strip common combining marks to avoid needing Unicode property escapes
  return s.normalize('NFD').replace(/[\u0300-\u036f]+/g, '').replace(/đ/gi, 'd');
}

function norm(s: string){
  return stripDiacritics(s).toLowerCase();
}

// A rough mapping commonly used: (heuristic, user can edit later)
const SLOT_DEFAULTS: Record<string, { startTime: string; endTime: string }> = {
  '1-3': { startTime: '07:30', endTime: '10:15' },
  '4-6': { startTime: '10:30', endTime: '13:15' },
  '7-9': { startTime: '13:30', endTime: '16:15' },
  '10-12': { startTime: '16:30', endTime: '19:15' },
  '13-15': { startTime: '19:30', endTime: '22:15' },
};

function periodsToSlot(from: number, to: number): 'morning' | 'afternoon' | 'evening' {
  if (to <= 6) return 'morning';
  if (to <= 12) return 'afternoon';
  return 'evening';
}

function periodsToTime(from: number, to: number): { startTime: string; endTime: string } {
  const key = `${from}-${to}`;
  if (SLOT_DEFAULTS[key]) return SLOT_DEFAULTS[key];
  // fallback: estimate 45 min per period from 07:30 baseline
  const base = new Date(`1970-01-01T07:30:00`);
  const mins = (from - 1) * 45;
  const dur = (to - from + 1) * 45;
  const s = new Date(base.getTime() + mins * 60000);
  const e = new Date(s.getTime() + dur * 60000);
  const hh = (d: Date) => String(d.getHours()).padStart(2, '0');
  const mm = (d: Date) => String(d.getMinutes()).padStart(2, '0');
  return { startTime: `${hh(s)}:${mm(s)}`, endTime: `${hh(e)}:${mm(e)}` };
}

function toISO(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function chooseTitle(lines: string[]): string {
  // Prefer lines that look like natural language course names over codes
  // Heuristics:
  // - Exclude all-uppercase alphanumerics like DHKTPM17ATT
  // - Exclude mostly digits or lines starting with long digits (e.g., 422000...)
  // - Exclude obvious labels handled elsewhere
  const isMeta = (s: string) => /^(Tiết|Tiet|Phòng|Phong|GV|Ghi chú|Ghi chu)\b/i.test(s);
  const isCodey = (s: string) => {
    const t = s.trim();
    if (/^[A-Z0-9\-]{6,}$/.test(t)) return true;
    if (/^\d{6,}/.test(t)) return true;
    const letters = (t.match(/[A-Za-zÀ-ỹ]/g) || []).length;
    const digits = (t.match(/\d/g) || []).length;
    return digits > letters * 1.5; // too many digits compared to letters
  };
  const candidates = lines.filter(s => s && !isMeta(s) && !isCodey(s));
  if (candidates.length === 0) {
    // fall back to first non-meta line
    const fallback = lines.find(s => !isMeta(s));
    return fallback || 'Môn học';
  }
  // Pick the line with the highest letter count (more textual)
  const scored = candidates.map(s => ({
    s,
    score: (s.match(/[A-Za-zÀ-ỹ]/g) || []).length - (s.match(/\d/g) || []).length,
  }));
  scored.sort((a,b)=> b.score - a.score);
  return scored[0].s.trim();
}

function parseDayHeader(line: string): { weekday: number; label: string; date?: string } | null {
  // Accept: "Thứ 2" .. "Thứ 7", "Chủ nhật" with or without accents
  const raw = line.trim();
  const norm = stripDiacritics(raw).toLowerCase();
  // Detect weekday
  let weekday: number | null = null;
  let label = raw;
  const mThu = norm.match(/\bthu\s*(2|3|4|5|6|7)\b/);
  if (mThu) {
    weekday = parseInt(mThu[1], 10);
  }
  if (weekday === null) {
    if (/\bchu\s*nhat\b/.test(norm)) weekday = 7;
  }
  if (!weekday) return null;
  // Extract date (prefer from raw)
  const mDate = raw.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/)
    || norm.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  let date: string | undefined;
  if (mDate) {
    const d = parseInt(mDate[1], 10), mm = parseInt(mDate[2], 10), y = parseInt(mDate[3], 10);
    date = toISO(y, mm, d);
  }
  // Build label in Vietnamese normalized form
  const labelVI = weekday === 7 ? 'Chủ nhật' : `Thứ ${weekday}`;
  return { weekday, label: labelVI, date };
}

export function parseWeeklyFromRaw(raw: string): WeekdayBlock[] {
  const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const days: WeekdayBlock[] = [];
  let current: WeekdayBlock | null = null;

  const pushCurrent = () => { if (current) days.push(current); };

  // First pass: split into day blocks by day headers
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const dh = parseDayHeader(line);
    if (dh) {
      pushCurrent();
      // If date missing, try to read next 1-2 lines for a date token
      let date = dh.date || '';
      if (!date) {
        for (let k = 1; k <= 2 && i + k < lines.length; k++) {
          const mm = lines[i + k].match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
          if (mm) { date = toISO(parseInt(mm[3],10), parseInt(mm[2],10), parseInt(mm[1],10)); break; }
        }
      }
      current = { weekday: dh.weekday, label: dh.label, date, events: [] };
      continue;
    }
    if (!current) continue;
    // Accumulate into a temporary buffer within current day
    (current as any)._buf = ((current as any)._buf || []).concat(line);
  }
  pushCurrent();

  // Helper matchers (diacritics-insensitive)
  const isTietLine = (s: string) => /^(tiet|tiet)\b|^(ti?t)\b/i.test(norm(s)) || norm(s).startsWith('tiet');
  const extractPeriods = (s: string): { from: number; to: number } | null => {
    // Accept formats like:
    //  "Tiết: 1 - 3" | "Tiet 1-3" | "Tiet:1 – 3" | anywhere in the line
    const m = s.match(/(\d+)\s*[\-–]\s*(\d+)/);
    if(!m) return null;
    const from = parseInt(m[1], 10), to = parseInt(m[2], 10);
    if(Number.isFinite(from) && Number.isFinite(to)) return { from, to };
    return null;
  };
  const findLine = (arr: string[], re: RegExp) => arr.find(s => re.test(s));

  // Parse each day's buffer into events
  for (const d of days) {
    const buf: string[] = ((d as any)._buf || []) as string[];
    delete (d as any)._buf;
    // Find all indexes of lines containing 'Tiết a - b' (colon optional)
    const idxs: number[] = [];
    const blocks: { start: number; end: number }[] = [];
    for (let i = 0; i < buf.length; i++) {
      const li = buf[i];
      if (isTietLine(li) && extractPeriods(li)) idxs.push(i);
    }
    // Build blocks: from a title line before 'Tiết' to the next blank or next 'Tiết'
    for (let k = 0; k < idxs.length; k++) {
      const ti = idxs[k];
      // backtrack to find title line (first preceding line that isn't labels like 'Ghi chú:')
      let titleIdx = ti - 1;
      while (titleIdx >= 0 && /^(Tiết|Tiet|Phòng|Phong|GV|Ghi chú|Ghi chu)/i.test(buf[titleIdx])) titleIdx--;
      if (titleIdx < 0) titleIdx = ti - 1;
      let end = (k + 1 < idxs.length) ? idxs[k + 1] - 1 : buf.length - 1;
      blocks.push({ start: Math.max(0, titleIdx), end });
    }
    // Parse blocks
    for (const b of blocks) {
      const seg = buf.slice(b.start, b.end + 1);
      const title = chooseTitle(seg);
      const tz = seg.find(s => isTietLine(s));
      const rm = seg.find(s => /^(Phòng|Phong)\s*:?/i.test(s));
      const gv = seg.find(s => /^GV\s*:?/i.test(s));
      const nt = seg.find(s => /^(Ghi chú|Ghi chu)\s*:?/i.test(s));
      let from = 1, to = 3;
      const p = tz ? extractPeriods(tz) : null;
      if (p) { from = p.from; to = p.to; }
      const slot = periodsToSlot(from, to);
      const { startTime, endTime } = periodsToTime(from, to);
      const location = rm?.replace(/^Phòng\s*:\s*/i, '').trim();
      const lecturer = gv?.replace(/^GV\s*:\s*/i, '').trim();
      const notes = nt?.replace(/^Ghi chú\s*:\s*/i, '').trim();
      const date = d.date || '';
      d.events.push({ title, date, periods: { from, to }, slot, startTime, endTime, location, lecturer, notes });
    }
  }
  // Fallback: if no day blocks found or total events is 0, parse globally into one block
  const total = days.reduce((acc, d) => acc + d.events.length, 0);
  if (days.length === 0 || total === 0) {
    const buf = lines;
    const idxs: number[] = [];
    for (let i = 0; i < buf.length; i++) {
      if (isTietLine(buf[i]) && extractPeriods(buf[i])) idxs.push(i);
    }
    const events: CandidateEvent[] = [];
    for (let k = 0; k < idxs.length; k++) {
      const ti = idxs[k];
      let titleIdx = ti - 1;
      while (titleIdx >= 0 && /^(Tiết|Tiet|Phòng|Phong|GV|Ghi chú|Ghi chu)/i.test(buf[titleIdx])) titleIdx--;
      if (titleIdx < 0) titleIdx = ti - 1;
      const nextIdx = (k + 1 < idxs.length) ? idxs[k + 1] : buf.length;
      const seg = buf.slice(Math.max(0, titleIdx), nextIdx);
      const title = chooseTitle(seg);
      const tz = seg.find(s => isTietLine(s));
      const rm = seg.find(s => /^(Phòng|Phong)\s*:?/i.test(s));
      const gv = seg.find(s => /^GV\s*:?/i.test(s));
      const nt = seg.find(s => /^(Ghi chú|Ghi chu)\s*:?/i.test(s));
      let from = 1, to = 3;
      const p = tz ? extractPeriods(tz) : null;
      if (p) { from = p.from; to = p.to; }
      const slot = periodsToSlot(from, to);
      const { startTime, endTime } = periodsToTime(from, to);
      const location = rm?.replace(/^(Phòng|Phong)\s*:\s*/i, '').trim();
      const lecturer = gv?.replace(/^GV\s*:\s*/i, '').trim();
      const notes = nt?.replace(/^(Ghi chú|Ghi chu)\s*:\s*/i, '').trim();
      events.push({ title, date: '', periods: { from, to }, slot, startTime, endTime, location, lecturer, notes });
    }
    return [{ weekday: 1, label: 'Tất cả', date: '', events }];
  }

  return days;
}
