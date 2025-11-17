import React from 'react';
import { View, Text, Dimensions, Platform, Pressable, ScrollView } from 'react-native';
import Svg, { Rect, Circle as SvgCircle, Line as SvgLine, Text as SvgText, Path as SvgPath, G as SvgG } from 'react-native-svg';

// Lightweight props to avoid importing large dashboard types
export type ProjectInsightsProps = {
  project: { _id: string; name: string; startDate?: string; dueDate?: string };
  tasks: Array<{
    id: string;
    title?: string;
    date?: string; // start date (ISO yyyy-mm-dd)
    endDate?: string; // optional end date (ISO)
    status: 'todo'|'in-progress'|'completed';
    completedAt?: string;
    projectId?: string;
  }>; 
  events: Array<{ id: string; date?: string; startTime?: string; endTime?: string; projectId?: string }>; 
  onOverduePress?: () => void;
  onUpcomingEventsPress?: () => void;
  onRemainingPress?: () => void;
  onCompletedPress?: () => void;
  onlyGantt?: boolean;
  // Optional fine-grained control over which sections to show and how
  visibleSections?: Array<'overview'|'burndown'|'flow'|'gantt'>;
  overviewSimple?: boolean; // when true: Overview shows only Completed vs Uncompleted
  hideTabs?: boolean; // hide the tab header even if not using visibleSections
  onDueSoon3Press?: () => void;
  onDueSoon7Press?: () => void;
};

const palette = {
  todo: '#f59e0b',       // amber-500
  inProgress: '#3b82f6', // blue-500
  completed: '#10b981',  // emerald-500
  grid: '#e5e7eb',       // gray-200
  text: '#16425b',
  subtle: '#607d8b',
};

// No external chart config; we render charts with react-native-svg for full control

const dayDiff = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86400000);
const toISODate = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
};
const fmtDM = (d: Date) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
const fmtDMY = (d: Date) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;

type ChartTab = 'overview' | 'burndown' | 'flow' | 'gantt';

export default function ProjectInsights({ project, tasks, events, onOverduePress, onUpcomingEventsPress, onRemainingPress, onCompletedPress, onlyGantt, visibleSections, overviewSimple, hideTabs, onDueSoon3Press, onDueSoon7Press }: ProjectInsightsProps){
  const screenW = Dimensions.get('window').width;
  const [containerW, setContainerW] = React.useState<number | null>(null);
  const width = React.useMemo(() => {
    const base = containerW ? containerW - 16 : screenW - 24; // account for card padding
    return Math.max(240, Math.min(base, 820));
  }, [containerW, screenW]);
  const [tab, setTab] = React.useState<ChartTab>(onlyGantt ? 'gantt' : 'overview');
  const scrollRef = React.useRef<ScrollView | null>(null);
  // Tooltip state for Gantt bars
  const [tt, setTt] = React.useState<null | { x: number; y: number; title: string; dateText: string; status: string }>(null);
  // Tooltip for line points
  const [lt, setLt] = React.useState<null | { x: number; y: number; label: string; value: number }>(null);

  // Status filter toggles
  const [statusFilter, setStatusFilter] = React.useState<{todo: boolean; completed: boolean}>({
    todo: true,
    completed: true,
  });
  // Group 'in-progress' into 'todo'
  const statusMatches = (s: 'todo'|'in-progress'|'completed') =>
    (s === 'completed' && statusFilter.completed) || ((s === 'todo' || s === 'in-progress') && statusFilter.todo);

  // Filter to this project only (defensive)
  // Use provided tasks directly (caller should scope by project). Avoid special 'group' handling to keep counts correct.
  const projTasks = tasks.slice();
  const filteredTasks = projTasks.filter(t => statusMatches(t.status));
  const total = projTasks.length;

  // Pie uses filters too so it mirrors selection
  const pieCounts = {
    todo: projTasks.filter(t => (t.status === 'todo' || t.status === 'in-progress') && statusFilter.todo).length,
    done: projTasks.filter(t => t.status === 'completed' && statusFilter.completed).length,
  };

  // Burndown data: remaining tasks over time (approximation)
  // Remaining(d) = total - completedUpTo(d)
  const start = project.startDate ? new Date(project.startDate + 'T00:00:00') : new Date();
  const endBound = (() => {
    const due = project.dueDate ? new Date(project.dueDate + 'T23:59:59') : null;
    const today = new Date();
    // Show up to due date or today if before due; ensure at least 7 days span
    const end = due ? (today < due ? today : due) : today;
    const minSpan = 6; // 7 days points
    const span = dayDiff(start, end);
    if(span < minSpan){ const e = new Date(start); e.setDate(e.getDate() + minSpan); return e; }
    return end;
  })();

  // Build date labels and remaining series
  const dateLabels: string[] = [];
  const remaining: number[] = [];
  const totalCompletedByDay = new Map<string, number>();
  projTasks.forEach(t => {
    if(t.completedAt){
      const iso = toISODate(new Date(t.completedAt));
      totalCompletedByDay.set(iso, (totalCompletedByDay.get(iso) || 0) + 1);
    }
  });
  let cumDone = 0;
  const cursor = new Date(start);
  while(cursor <= endBound){
    const iso = toISODate(cursor);
    cumDone += totalCompletedByDay.get(iso) || 0;
    const rem = Math.max(total - cumDone, 0);
    dateLabels.push(`${cursor.getDate()}/${cursor.getMonth()+1}`);
    remaining.push(rem);
    cursor.setDate(cursor.getDate()+1);
  }

  // KPIs
  const today = new Date();
  const todayISO = toISODate(today);
  const endInDays = (iso?: string) => {
    if(!iso) return NaN; const d = new Date(iso + 'T00:00:00'); return dayDiff(today, d);
  };
  const completedCount = projTasks.filter(t => t.status==='completed').length;
  const inProgCount = projTasks.filter(t => t.status==='in-progress' || t.status==='todo').length;
  const uncompletedCount = total - completedCount;
  const overdueCount = projTasks.filter(t => (t.status!=='completed') && !!t.endDate && (new Date(t.endDate+'T23:59:59') < today)).length;
  const dueSoonCount = projTasks.filter(t => (t.status!=='completed') && !!t.endDate && endInDays(t.endDate) >= 0 && endInDays(t.endDate) <= 7).length;
  const dueSoon3Count = projTasks.filter(t => (t.status!=='completed') && !!t.endDate && endInDays(t.endDate) >= 0 && endInDays(t.endDate) <= 3).length;
  const pctDone = total ? Math.round((completedCount/total)*100) : 0;

  // Weekly due bar chart (easier visual than per-task Gantt)
  const renderDueByWeek = () => {
    const sDate = new Date(start);
    const eDate = new Date(endBound);
    // Build week buckets (Mon..Sun)
    const getMonday = (d: Date) => {
      const day = d.getDay();
      const off = day === 0 ? -6 : 1 - day;
      const m = new Date(d);
      m.setDate(d.getDate() + off);
      m.setHours(0,0,0,0);
      return m;
    };
    const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
    const wStart = getMonday(sDate);
    const wEnd = getMonday(eDate);
    const weeks: Array<{ start: Date; end: Date }> = [];
    for(let cur = new Date(wStart); cur <= wEnd; cur = addDays(cur, 7)){
      weeks.push({ start: new Date(cur), end: addDays(new Date(cur), 6) });
    }
    const series = weeks.map(wk => {
      const startIso = toISODate(wk.start);
      const endIso = toISODate(wk.end);
      // Count tasks due this week (use endDate; exclude completed)
      const cnt = projTasks.filter(t => t.status !== 'completed' && t.endDate && t.endDate >= startIso && t.endDate <= endIso).length;
      return cnt;
    });
    const n = series.length;
    if(n === 0){ return <Text style={{ color: palette.subtle, fontSize:12 }}>Chưa có dữ liệu tác vụ</Text>; }
    const h = 220; const pad = { l: 36, r: 12, t: 18, b: 36 };
    const chartW = Math.max(width, 280);
    const plotW = chartW - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;
    const maxY = Math.max(1, ...series);
    const gap = 6;
    const barW = Math.max(12, Math.floor((plotW - gap*(n-1)) / Math.max(1,n)));
    const xOf = (i:number)=> pad.l + i*(barW+gap);
    const yOf = (v:number)=> pad.t + plotH - (plotH * (v/maxY));
    return (
      <Svg width={chartW} height={h}>
        {/* y grid */}
        {[0,.25,.5,.75,1].map((f,idx)=>{
          const yv = Math.round(maxY*f);
          const y = yOf(yv);
          return (
            <React.Fragment key={idx}>
              <SvgLine x1={pad.l} y1={y} x2={chartW - pad.r} y2={y} stroke={palette.grid} strokeWidth={1} strokeDasharray="3 4" />
              <SvgText x={pad.l - 6} y={y + 4} fontSize={10} fill={palette.subtle} textAnchor="end">{yv}</SvgText>
            </React.Fragment>
          );
        })}
        {/* x labels */}
        {weeks.map((wk,i)=> (
          <SvgText key={i} x={xOf(i) + barW/2} y={h - 14} fontSize={10} fill={palette.subtle} textAnchor="middle">{fmtDM(wk.start)}</SvgText>
        ))}
        {/* bars */}
        {series.map((v,i)=> {
          const x = xOf(i); const y = yOf(v); const bh = Math.max(2, (pad.t + plotH) - y);
          return (
            <React.Fragment key={i}>
              <Rect x={x} y={y} width={barW} height={bh} rx={4} ry={4} fill={palette.todo} opacity={0.9}
                onPress={() => setLt({ x: x + barW/2, y: y - 10, label: `${fmtDM(weeks[i].start)}–${fmtDM(weeks[i].end)}`, value: v })}
              />
            </React.Fragment>
          );
        })}
        {/* tooltip (reuse lt state) */}
        {lt && (
          <React.Fragment>
            <Rect x={Math.max(lt.x - 54, 4)} y={Math.max(lt.y - 24, 2)} width={108} height={22} rx={6} ry={6} fill="#111827" opacity={0.92} />
            <SvgText x={Math.max(lt.x - 48, 8)} y={Math.max(lt.y - 10, 14)} fill="#fff" fontSize={10} fontWeight="bold">{lt.value} tác vụ</SvgText>
            <SvgText x={Math.max(lt.x - 48, 8)} y={Math.max(lt.y + 4, 26)} fill="#d1d5db" fontSize={9}>{lt.label}</SvgText>
          </React.Fragment>
        )}
      </Svg>
    );
  };

  const ChartHeader = (!onlyGantt && !visibleSections && !hideTabs) ? (
    <View style={{ marginBottom: 6 }}>
      <Text style={{ color: palette.text, fontWeight: '700', fontSize: 14, marginBottom: 8 }}>Giám sát dự án</Text>
      <View style={{ flexDirection:'row', backgroundColor:'#eef2f7', borderRadius: 999, padding: 4, alignSelf:'flex-start' }}>
        {([
          { key:'overview', label:'Tổng quan' },
          { key:'burndown', label:'Burndown' },
          { key:'flow', label:'Tiến độ (Flow)' },
          { key:'gantt', label:'Gantt' },
        ] as Array<{key: ChartTab; label: string}>).map(opt => (
          <Pressable key={opt.key} onPress={()=> setTab(opt.key)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: tab===opt.key? '#fff':'transparent', borderWidth: tab===opt.key? 1: 0, borderColor:'#e5e7eb', marginRight: 4 }}>
            <Text style={{ color: palette.text, fontSize: 12, fontWeight: tab===opt.key? '700':'500' }}>{opt.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  ) : null;

  const rangeText = `Khoảng thời gian: ${fmtDMY(new Date(start))} – ${fmtDMY(new Date(endBound))}`;

  const FilterChips = (
    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
      {([
        { key: 'todo', label: 'Chưa làm', color: palette.todo },
        { key: 'completed', label: 'Hoàn thành', color: palette.completed },
      ] as Array<{ key: 'todo'|'completed'; label: string; color: string }>).map(it => {
        const active = (statusFilter as any)[it.key];
        return (
          <Pressable
            key={it.key}
            onPress={() => setStatusFilter(s => ({ ...s, [it.key]: !((s as any)[it.key]) }))}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: active ? it.color : '#e5e7eb',
              backgroundColor: active ? `${it.color}22` : '#fff',
            }}
          >
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: it.color }} />
            <Text style={{ color: palette.text, fontSize: 12 }}>{it.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  // Donut chart (percent complete)
  const renderDonut = () => {
    const size = Math.max(140, Math.min(width * 0.6, 220));
    const strokeW = 14;
    const r = (size - strokeW) / 2;
    const cx = size/2, cy = size/2;
    const circ = 2 * Math.PI * r;
    const progress = Math.max(0, Math.min(1, pctDone/100));
    const dash = circ * progress;
    return (
      <Svg width={size} height={size}>
        <SvgCircle cx={cx} cy={cy} r={r} stroke={palette.grid} strokeWidth={strokeW} fill="none" />
        <SvgCircle
          cx={cx}
          cy={cy}
          r={r}
          stroke={palette.completed}
          strokeWidth={strokeW}
          fill="none"
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
        />
        <SvgText x={cx} y={cy - 2} fontSize={18} fontWeight="bold" fill={palette.text} textAnchor="middle">{pctDone}%</SvgText>
        <SvgText x={cx} y={cy + 16} fontSize={11} fill={palette.subtle} textAnchor="middle">Hoàn thành</SvgText>
      </Svg>
    );
  };

  // Burndown line chart
  const renderBurndown = () => {
    const h = 220; const pad = { l: 36, r: 12, t: 18, b: 28 };
    const n = remaining.length; if(n===0) return <Text style={{ color: palette.subtle, fontSize: 12 }}>Chưa có dữ liệu tác vụ</Text>;
    const maxY = Math.max(...remaining, 1);
    const chartW = Math.max(width, 280);
    const plotW = chartW - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;
    const xOf = (i:number)=> pad.l + (plotW * (i/(Math.max(1,n-1))));
    const yOf = (v:number)=> pad.t + plotH - (plotH * (v/maxY));
    // grid y ticks at 0, 25%, 50%, 75%, 100%
    const yTicks = [0, .25, .5, .75, 1].map(f => Math.round(maxY * f));
    const points = remaining.map((v,i)=> ({ x:xOf(i), y:yOf(v), v, i }));
    const pathD = points.map((p, i) => `${i===0? 'M':'L'} ${p.x} ${p.y}`).join(' ');
    return (
      <Svg width={chartW} height={h}>
        {/* grid */}
        {yTicks.map((yv, idx)=>{
          const y = yOf(yv);
          return (
            <React.Fragment key={idx}>
              <SvgLine x1={pad.l} y1={y} x2={chartW - pad.r} y2={y} stroke={palette.grid} strokeWidth={1} strokeDasharray="3 4" />
              <SvgText x={pad.l - 6} y={y + 4} fontSize={10} fill={palette.subtle} textAnchor="end">{yv}</SvgText>
            </React.Fragment>
          );
        })}
        {/* axis labels */}
        <SvgText x={chartW/2} y={h - 6} fontSize={10} fill={palette.subtle} textAnchor="middle">Thời gian</SvgText>
        {/* line */}
        <SvgPath d={pathD} fill="none" stroke={palette.inProgress} strokeWidth={2} />
        {/* points */}
        {points.map(p => (
          <SvgG key={p.i}>
            <SvgCircle cx={p.x} cy={p.y} r={3} fill={palette.inProgress} />
            <Rect x={p.x - 8} y={p.y - 8} width={16} height={16} fill="transparent" onPress={() => setLt({ x: p.x, y: p.y - 12, label: dateLabels[p.i] || '', value: p.v })} />
          </SvgG>
        ))}
        {/* x labels (sparse) */}
        {dateLabels.map((lbl, i)=> (i%Math.max(1,Math.floor(n/6))===0) ? (
          <SvgText key={i} x={xOf(i)} y={h - pad.b + 12} fontSize={10} fill={palette.subtle} textAnchor="middle">{lbl}</SvgText>
        ) : null)}
        {/* tooltip */}
        {lt && (
          <React.Fragment>
            <Rect x={Math.max(lt.x - 34, 4)} y={Math.max(lt.y - 26, 2)} width={68} height={24} rx={6} ry={6} fill="#111827" opacity={0.92} />
            <SvgText x={Math.max(lt.x - 30, 8)} y={Math.max(lt.y - 12, 14)} fill="#fff" fontSize={10} fontWeight="bold">{lt.value}</SvgText>
            <SvgText x={Math.max(lt.x - 30, 8)} y={Math.max(lt.y + 2, 26)} fill="#d1d5db" fontSize={9}>{lt.label}</SvgText>
          </React.Fragment>
        )}
      </Svg>
    );
  };

  // Flow (stacked area: Done vs Remaining)
  const renderFlow = () => {
    const h = 220; const pad = { l: 36, r: 12, t: 18, b: 28 };
    const n = remaining.length; if(n===0) return <Text style={{ color: palette.subtle, fontSize: 12 }}>Chưa có dữ liệu tác vụ</Text>;
    const completedCum: number[] = [];
    {
      // rebuild from completion map used earlier
      const map = new Map<string, number>();
      projTasks.forEach(t=>{ if(t.completedAt){ const iso = toISODate(new Date(t.completedAt)); map.set(iso, (map.get(iso)||0)+1); } });
      let cum = 0; const sDate = new Date(start); const eDate = new Date(endBound); const cur = new Date(sDate);
      while(cur <= eDate){ const iso = toISODate(cur); cum += map.get(iso)||0; completedCum.push(cum); cur.setDate(cur.getDate()+1); }
    }
    const remainingSeries = remaining; // already computed
    const maxY = Math.max(total, ...completedCum, ...remainingSeries, 1);
    const chartW = Math.max(width, 280);
    const plotW = chartW - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;
    const xOf = (i:number)=> pad.l + (plotW * (i/(Math.max(1,n-1))));
    const yOf = (v:number)=> pad.t + plotH - (plotH * (v/maxY));
    const areaPath = (series:number[]) => series.map((v,i)=> `${i===0? 'M':'L'} ${xOf(i)} ${yOf(v)}`).join(' ') + ` L ${xOf(n-1)} ${pad.t+plotH} L ${xOf(0)} ${pad.t+plotH} Z`;
    const donePath = areaPath(completedCum);
    const remPath = areaPath(remainingSeries);
    // grid y ticks
    const yTicks = [0, .25, .5, .75, 1].map(f => Math.round(maxY * f));
    return (
      <Svg width={chartW} height={h}>
        {yTicks.map((yv, idx)=>{
          const y = yOf(yv);
          return (
            <React.Fragment key={idx}>
              <SvgLine x1={pad.l} y1={y} x2={chartW - pad.r} y2={y} stroke={palette.grid} strokeWidth={1} strokeDasharray="3 4" />
              <SvgText x={pad.l - 6} y={y + 4} fontSize={10} fill={palette.subtle} textAnchor="end">{yv}</SvgText>
            </React.Fragment>
          );
        })}
        <SvgPath d={remPath} fill="#3b82f622" stroke={palette.inProgress} strokeWidth={1} />
        <SvgPath d={donePath} fill="#10b98133" stroke={palette.completed} strokeWidth={1} />
        <SvgText x={pad.l + 8} y={pad.t + 16} fontSize={10} fill={palette.inProgress}>Còn lại</SvgText>
        <SvgText x={pad.l + 8} y={pad.t + 30} fontSize={10} fill={palette.completed}>Hoàn thành</SvgText>
      </Svg>
    );
  };

  const cardBase: any = Platform.select({
    ios: { backgroundColor:'#fff', borderRadius:12, padding:12, shadowColor:'#000', shadowOpacity:0.08, shadowOffset:{ width:0, height:2 }, shadowRadius:8 },
    default: { backgroundColor:'#fff', borderRadius:12, padding:12, borderWidth:1, borderColor:'#e5e7eb' }
  });
  const chipCardBase: any = Platform.select({
    ios: { padding:12, borderRadius:12, backgroundColor:'#fff', shadowColor:'#000', shadowOpacity:0.06, shadowOffset:{ width:0, height:1 }, shadowRadius:6 },
    default: { padding:10, borderRadius:10, borderWidth:1, borderColor:'#e5e7eb' }
  });

  const OverviewSection = (
    <View style={cardBase}>
      <View style={{ flexDirection:'row', flexWrap:'wrap', gap:12, marginBottom:12 }}>
        {overviewSimple ? (
          <>
            <Pressable onPress={onRemainingPress} style={{ flexGrow:1, minWidth:140, ...chipCardBase }}>
              <Text style={{ color: palette.subtle, fontSize:12 }}>Chưa hoàn thành</Text>
              <Text style={{ color: palette.text, fontSize:22, fontWeight:'800', marginTop:2 }}>{uncompletedCount}</Text>
              <Text style={{ color:'#3b82f6', fontSize:11, marginTop:6 }}>Bấm để xem</Text>
            </Pressable>
            <Pressable onPress={onCompletedPress} style={{ flexGrow:1, minWidth:140, ...chipCardBase }}>
              <Text style={{ color: palette.subtle, fontSize:12 }}>Hoàn thành</Text>
              <Text style={{ color: palette.text, fontSize:22, fontWeight:'800', marginTop:2 }}>{completedCount}</Text>
              <Text style={{ color:'#3b82f6', fontSize:11, marginTop:6 }}>Bấm để xem</Text>
            </Pressable>
            <Pressable onPress={onOverduePress} style={{ flexGrow:1, minWidth:140, ...chipCardBase }}>
              <Text style={{ color: '#b91c1c', fontSize:12 }}>Quá hạn</Text>
              <Text style={{ color: '#b91c1c', fontSize:22, fontWeight:'800', marginTop:2 }}>{overdueCount}</Text>
              <Text style={{ color:'#ef4444', fontSize:11, marginTop:6 }}>Bấm để xem</Text>
            </Pressable>
            <Pressable onPress={onDueSoon3Press} style={{ flexGrow:1, minWidth:140, ...chipCardBase }}>
              <Text style={{ color: palette.subtle, fontSize:12 }}>Sắp tới hạn (3 ngày)</Text>
              <Text style={{ color: palette.text, fontSize:22, fontWeight:'800', marginTop:2 }}>{dueSoon3Count}</Text>
              <Text style={{ color:'#3b82f6', fontSize:11, marginTop:6 }}>Bấm để xem</Text>
            </Pressable>
            <Pressable onPress={onDueSoon7Press} style={{ flexGrow:1, minWidth:140, ...chipCardBase }}>
              <Text style={{ color: palette.subtle, fontSize:12 }}>Sắp tới hạn (7 ngày)</Text>
              <Text style={{ color: palette.text, fontSize:22, fontWeight:'800', marginTop:2 }}>{dueSoonCount}</Text>
              <Text style={{ color:'#3b82f6', fontSize:11, marginTop:6 }}>Bấm để xem</Text>
            </Pressable>
          </>
        ) : (
          ([
            {label:'Tổng tác vụ', value: total, onPress: undefined },
            {label:'Hoàn thành', value: completedCount, onPress: onCompletedPress },
            {label:'Đang làm/Chờ', value: inProgCount, onPress: onRemainingPress },
            {label:'Quá hạn', value: overdueCount, onPress: onOverduePress },
            {label:'Sắp đến hạn (7d)', value: dueSoonCount, onPress: onUpcomingEventsPress },
          ] as Array<{label:string; value:number; onPress?: ()=>void}>).map((kpi, idx)=>(
            <Pressable key={idx} onPress={kpi.onPress} disabled={!kpi.onPress} style={{ flexGrow:1, minWidth:120, ...chipCardBase, opacity: kpi.onPress? 1: 0.85 }}>
              <Text style={{ color: palette.subtle, fontSize:11 }}>{kpi.label}</Text>
              <Text style={{ color: palette.text, fontSize:18, fontWeight:'800' }}>{kpi.value}</Text>
              {kpi.onPress && <Text style={{ color:'#3b82f6', fontSize:10, marginTop:4 }}>Bấm để xem</Text>}
            </Pressable>
          ))
        )}
      </View>
      {(() => {
        const isNarrow = width < 420;
        return (
          <View style={{ flexDirection: isNarrow ? 'column' : 'row', alignItems: isNarrow ? 'stretch' : 'center', justifyContent:'space-between' }}>
            <View style={{ flex: isNarrow ? undefined : 1, alignItems:'center' }}>{renderDonut()}</View>
            <View style={{ flex: isNarrow ? undefined : 1, paddingLeft: isNarrow ? 0 : 12, marginTop: isNarrow ? 12 : 0 }}>
              <Text style={{ color: palette.text, fontWeight:'700', marginBottom:6 }}>Phân bố trạng thái</Text>
              <View style={{ gap:8 }}>
                <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
                  <View style={{ width:10, height:10, borderRadius:5, backgroundColor: palette.completed }} />
                  <Text style={{ color: palette.text, fontSize:12 }}>Hoàn thành: {completedCount}</Text>
                </View>
                <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
                  <View style={{ width:10, height:10, borderRadius:5, backgroundColor: palette.todo }} />
                  <Text style={{ color: palette.text, fontSize:12 }}>{overviewSimple ? 'Chưa hoàn thành' : 'Chưa làm/Đang làm'}: {overviewSimple ? uncompletedCount : inProgCount}</Text>
                </View>
                <Text style={{ color: palette.subtle, fontSize:11, marginTop:8 }}>{rangeText}</Text>
              </View>
            </View>
          </View>
        );
      })()}
    </View>
  );

  if (onlyGantt) {
    return (
      <View style={{ marginTop: 12 }} onLayout={(e)=> setContainerW(e.nativeEvent.layout.width)}>
        <View style={{ ...(cardBase as object), padding: 8, overflow: 'hidden' }}>
          <Text style={{ color: palette.subtle, fontSize: 12, marginBottom: 6 }}>Hạn theo tuần</Text>
          <Text style={{ color: palette.subtle, fontSize: 11, marginBottom: 8 }}>{rangeText}</Text>
          <View style={{ marginBottom: 8 }}>{FilterChips}</View>
          {renderDueByWeek()}
        </View>
      </View>
    );
  }

  if (visibleSections && visibleSections.length) {
    return (
      <View style={{ marginTop: 12 }} onLayout={(e)=> setContainerW(e.nativeEvent.layout.width)}>
        {/* No tabs in this controlled mode */}
        {visibleSections.includes('overview') && OverviewSection}
        {visibleSections.includes('burndown') && (
          <View style={{ ...(cardBase as object), marginTop:12 }}>
            <Text style={{ color: palette.subtle, fontSize:12, marginBottom:6 }}>Burndown (Số tác vụ còn lại)</Text>
            {renderBurndown()}
          </View>
        )}
        {visibleSections.includes('flow') && (
          <View style={{ ...(cardBase as object), marginTop:12 }}>
            <Text style={{ color: palette.subtle, fontSize:12, marginBottom:6 }}>Tiến độ tích lũy</Text>
            {renderFlow()}
          </View>
        )}
        {visibleSections.includes('gantt') && (
          <View style={{ ...(cardBase as object), padding: 8, overflow: 'hidden', marginTop:12 }}>
            <Text style={{ color: palette.subtle, fontSize: 12, marginBottom: 6 }}>Hạn theo tuần</Text>
            <Text style={{ color: palette.subtle, fontSize: 11, marginBottom: 8 }}>{rangeText}</Text>
            <View style={{ marginBottom: 8 }}>{FilterChips}</View>
            {renderDueByWeek()}
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={{ marginTop: 12 }} onLayout={(e)=> setContainerW(e.nativeEvent.layout.width)}>
      {ChartHeader}
      {tab === 'overview' && (
        OverviewSection
      )}
      {tab === 'burndown' && (
        <View style={cardBase}>
          <Text style={{ color: palette.subtle, fontSize:12, marginBottom:6 }}>Burndown (Số tác vụ còn lại)</Text>
          {renderBurndown()}
        </View>
      )}
      {tab === 'flow' && (
        <View style={cardBase}>
          <Text style={{ color: palette.subtle, fontSize:12, marginBottom:6 }}>Tiến độ tích lũy</Text>
          {renderFlow()}
        </View>
      )}
      {tab === 'gantt' && (
        <View style={{ ...(cardBase as object), padding: 8, overflow: 'hidden' }}>
          <Text style={{ color: palette.subtle, fontSize: 12, marginBottom: 6 }}>Hạn theo tuần</Text>
          <Text style={{ color: palette.subtle, fontSize: 11, marginBottom: 8 }}>{rangeText}</Text>
          <View style={{ marginBottom: 8 }}>{FilterChips}</View>
          {renderDueByWeek()}
        </View>
      )}
    </View>
  );
}
