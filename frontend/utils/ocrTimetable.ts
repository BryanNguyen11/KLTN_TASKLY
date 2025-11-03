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

// School standard period mapping (from provided table)
// Morning:
// 1: 06:30–07:20, 2: 07:20–08:10, 3: 08:10–09:00, break 10',
// 4: 09:10–10:00, 5: 10:00–10:50, 6: 10:50–11:40
// Afternoon:
// 7: 12:30–13:20, 8: 13:20–14:10, 9: 14:10–15:00, break 10',
// 10: 15:10–16:00, 11: 16:00–16:50, 12: 16:50–17:40
// Evening:
// 13: 18:00–18:50, 14: 18:50–19:40, break 10',
// 15: 19:50–20:40, 16: 20:40–21:30
// Base period time map (school standard). We additionally normalize afternoon numbering 9..12 -> 7..10
// to support timetables that label afternoon periods as 9..12 while using the same actual times.
const PERIOD_TIME: Record<number, { start: string; end: string }> = {
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

// Some universities label afternoon periods as 9..12 instead of 7..10.
// Normalize those labels to keep a single time table: 9->7, 10->8, 11->9, 12->10
function normalizePeriodNumber(n: number): number {
  // Allow opt-out via env if ever needed
  const scheme = (process.env.EXPO_PUBLIC_PERIOD_SCHEME || 'vn-9-12').toLowerCase();
  if (scheme === 'vn-9-12') {
    if (n >= 9 && n <= 12) return n - 2; // 9..12 -> 7..10
  }
  return n;
}

export function periodsToSlot(from: number, to: number): 'morning' | 'afternoon' | 'evening' {
  const f = normalizePeriodNumber(from);
  const t = normalizePeriodNumber(to);
  if (t <= 6) return 'morning';
  if (t <= 12) return 'afternoon';
  return 'evening';
}

export function periodsRangeToTime(from: number, to: number): { startTime: string; endTime: string } {
  const f = normalizePeriodNumber(from);
  const t = normalizePeriodNumber(to);
  const s = PERIOD_TIME[f]?.start;
  const e = PERIOD_TIME[t]?.end;
  if (s && e) return { startTime: s, endTime: e };
  // Fallback if an unexpected period range appears
  const firstKnown = Object.keys(PERIOD_TIME).map(Number).sort((a,b)=>a-b)[0];
  const lastKnown = Object.keys(PERIOD_TIME).map(Number).sort((a,b)=>a-b).slice(-1)[0];
  const clamp = (n:number) => Math.min(lastKnown, Math.max(firstKnown, n));
  const s2 = PERIOD_TIME[clamp(f)]?.start || '07:30';
  const e2 = PERIOD_TIME[clamp(t)]?.end || '09:00';
  return { startTime: s2, endTime: e2 };
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
  // Accept variants: "Thứ 2".."Thứ 7", "Chủ nhật", and spelled-out words (hai, ba, tư, nam, sáu, bảy)
  const raw = line.trim();
  const n = stripDiacritics(raw).toLowerCase();
  // Detect weekday by number or name
  let weekday: number | null = null;
  // 1) Numeric form: Thu 2..7
  const mThu = n.match(/\bthu\s*(2|3|4|5|6|7)\b/);
  if (mThu) {
    weekday = parseInt(mThu[1], 10);
  }
  // 2) Spelled-out names
  if (weekday === null) {
    const mapByName: Record<string, number> = {
      'hai': 2,
      'ba': 3,
      'tu': 4, // "tư" normalized
      'nam': 5,
      'sau': 6,
      'bay': 7 // "bảy" normalized
    };
    const mName = n.match(/\bthu\s*(hai|ba|tu|nam|sau|bay)\b/);
    if (mName) weekday = mapByName[mName[1]] || null;
  }
  // 3) Chu nhat
  if (weekday === null) {
    if (/\bchu\s*nhat\b/.test(n)) weekday = 7;
  }
  if (!weekday) return null;
  // Extract date (prefer from raw)
  const mDate = raw.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/)
    || n.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
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
  // Detect any line that mentions periods/lessons "Tiết" or common OCR variants
  const isTietLine = (s: string) => {
    const t = norm(s);
    return /\btiet\b|\btie?t\b/i.test(t) || t.startsWith('tiet') || /\bperiods?\b|\blesson\b/i.test(t);
  };
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
  const rm = seg.find(s => /^(Phòng|Phong|Địa\s*điểm|Dia\s*diem)\s*:?/i.test(s));
  const gv = seg.find(s => /^(GV|Giảng\s*viên|Giang\s*vien)\s*:?/i.test(s));
      const nt = seg.find(s => /^(Ghi chú|Ghi chu)\s*:?/i.test(s));
      let from = 1, to = 3;
      const p = tz ? extractPeriods(tz) : null;
      if (p) { from = p.from; to = p.to; }
  const slot = periodsToSlot(from, to);
  const { startTime, endTime } = periodsRangeToTime(from, to);
  const location = rm?.replace(/^(Phòng|Phong|Địa\s*điểm|Dia\s*diem)\s*:\s*/i, '').trim();
  const lecturer = gv?.replace(/^(GV|Giảng\s*viên|Giang\s*vien)\s*:\s*/i, '').trim();
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
  const rm = seg.find(s => /^(Phòng|Phong|Địa\s*điểm|Dia\s*diem)\s*:?/i.test(s));
  const gv = seg.find(s => /^(GV|Giảng\s*viên|Giang\s*vien)\s*:?/i.test(s));
      const nt = seg.find(s => /^(Ghi chú|Ghi chu)\s*:?/i.test(s));
      let from = 1, to = 3;
      const p = tz ? extractPeriods(tz) : null;
      if (p) { from = p.from; to = p.to; }
  const slot = periodsToSlot(from, to);
  const { startTime, endTime } = periodsRangeToTime(from, to);
  const location = rm?.replace(/^(Phòng|Phong|Địa\s*điểm|Dia\s*diem)\s*:\s*/i, '').trim();
  const lecturer = gv?.replace(/^(GV|Giảng\s*viên|Giang\s*vien)\s*:\s*/i, '').trim();
      const notes = nt?.replace(/^(Ghi chú|Ghi chu)\s*:\s*/i, '').trim();
      events.push({ title, date: '', periods: { from, to }, slot, startTime, endTime, location, lecturer, notes });
    }
    return [{ weekday: 1, label: 'Tất cả', date: '', events }];
  }

  return days;
}
