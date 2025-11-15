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

export default function ProjectInsights({ project, tasks, events }: ProjectInsightsProps){
  const screenW = Dimensions.get('window').width;
  const [containerW, setContainerW] = React.useState<number | null>(null);
  const width = React.useMemo(() => {
    const base = containerW ? containerW - 16 : screenW - 24; // account for card padding
    return Math.max(240, Math.min(base, 820));
  }, [containerW, screenW]);
  const [tab, setTab] = React.useState<ChartTab>('overview');
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
  const projTasksAll = tasks.filter(t => (t as any).projectId === project._id || (t as any).type === 'group');
  const projTasks = projTasksAll.filter(t => (t as any).type !== 'group');
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
  const overdueCount = projTasks.filter(t => (t.status!=='completed') && !!t.endDate && (new Date(t.endDate+'T23:59:59') < today)).length;
  const dueSoonCount = projTasks.filter(t => (t.status!=='completed') && !!t.endDate && endInDays(t.endDate) >= 0 && endInDays(t.endDate) <= 7).length;
  const pctDone = total ? Math.round((completedCount/total)*100) : 0;

  // Simple Gantt renderer using react-native-svg
  // zoom via pixel-per-day
  const [pxPerDay, setPxPerDay] = React.useState(18);
  const minPxPerDay = 8;
  const maxPxPerDay = 48;

  // Auto-scroll near today when possible
  React.useEffect(() => {
    const sDate = new Date(start);
    const eDate = new Date(endBound);
    const totalDays = Math.max(1, dayDiff(sDate, eDate));
    const padX = 12;
    const today = new Date();
    if (today < sDate || today > eDate) return;
    const idx = Math.max(0, Math.min(totalDays, dayDiff(sDate, today)));
    const todayX = padX + idx * pxPerDay;
    if (scrollRef.current) {
      const target = Math.max(0, todayX - width * 0.4);
      // slight timeout allows ScrollView to mount
      const t = setTimeout(() => scrollRef.current?.scrollTo({ x: target, y: 0, animated: true }), 50);
      return () => clearTimeout(t);
    }
  }, [pxPerDay, width, start.toString(), (endBound as any).toString()]);

  const renderGantt = () => {
    if (projTasks.length === 0) {
      return <Text style={{ color: palette.subtle, fontSize: 12 }}>Chưa có dữ liệu tác vụ</Text>;
    }
    const padX = 12;
    const padY = 34; // extra space for bigger labels
    const barH = 22; // larger bars for readability
    const gap = 12;
    const maxRows = Math.min(filteredTasks.length, 40);
    const rows = filteredTasks
      .slice()
      .sort((a,b) => {
        const ad = (a as any).date || '';
        const bd = (b as any).date || '';
        return ad.localeCompare(bd);
      })
      .slice(0, maxRows);
    // timeline sizing by days
    const sDate = new Date(start);
    const eDate = new Date(endBound);
    const totalDays = Math.max(1, dayDiff(sDate, eDate));
    const chartW = padX * 2 + totalDays * pxPerDay;
    const calcX = (iso: string) => {
      const cur = new Date(iso + 'T00:00:00');
      const idx = Math.max(0, Math.min(totalDays, dayDiff(sDate, cur)));
      return padX + idx * pxPerDay;
    };
    const today = new Date();
    const showToday = today >= sDate && today <= eDate;
    const todayX = calcX(toISODate(today));
    const contentH = padY*2 + rows.length * (barH + gap) + 6;

    // Build tick marks (max ~7)
    const tickStep = Math.max(1, Math.ceil(totalDays / 10));
    const tickDates: Date[] = [];
    const cur = new Date(sDate);
    while (cur <= eDate) {
      tickDates.push(new Date(cur));
      cur.setDate(cur.getDate() + tickStep);
    }
    if (tickDates[tickDates.length-1].getTime() !== eDate.getTime()) {
      tickDates.push(new Date(eDate));
    }
    return (
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator
        contentContainerStyle={{}}
      >
      <Svg width={Math.max(chartW, width)} height={contentH}>
        {/* top axis baseline */}
        <SvgLine x1={padX} y1={padY - 18} x2={chartW - padX} y2={padY - 18} stroke={palette.grid} strokeWidth={1} />
        {/* ticks */}
        {tickDates.map((d,i) => {
          const iso = toISODate(d);
          const x = calcX(iso);
          const label = fmtDM(d);
          const isRight = x > (chartW - 30);
          return (
            <React.Fragment key={`tick-${i}`}>
              <SvgLine x1={x} y1={padY - 22} x2={x} y2={contentH} stroke={palette.grid} strokeWidth={1} strokeDasharray="3 4" />
              <SvgText
                x={isRight ? x - 2 : x + 2}
                y={padY - 24}
                fill={palette.subtle}
                fontSize={11}
                textAnchor={isRight ? 'end' : 'start'}
              >
                {label}
              </SvgText>
            </React.Fragment>
          );
        })}
        {/* today line */}
        {showToday && (
          <SvgLine x1={todayX} y1={0} x2={todayX} y2={contentH} stroke="#ef4444" strokeWidth={1} strokeDasharray="4 3" />
        )}
        {rows.map((t, i) => {
          const d = (t as any).date as string;
          const ed = ((t as any).endDate as string) || d;
          const x1 = calcX(d);
          const x2 = calcX(ed);
          const y = padY + i * (barH + gap);
          // Collapse 'in-progress' into 'todo' for color/display
          const color = t.status==='completed' ? palette.completed : palette.todo;
          const minX = Math.min(x1, x2);
          const maxX = Math.max(x1, x2);
          const w = Math.max(6, maxX - minX);
          return (
            <React.Fragment key={(t as any).id}>
              <Rect
                x={minX}
                y={y}
                width={w}
                height={barH}
                rx={4}
                ry={4}
                fill={color}
                opacity={0.88}
                onPress={() => {
                  const title = (t as any).title || 'Tác vụ';
                  const dateText = d === ed ? fmtDM(new Date(d + 'T00:00:00')) : `${fmtDM(new Date(d + 'T00:00:00'))}–${fmtDM(new Date(ed + 'T00:00:00'))}`;
                  setTt({ x: minX + w / 2, y, title, dateText, status: t.status });
                }}
              />
              <SvgText x={minX + 8} y={y + barH - 5} fill="#ffffff" fontSize={11}>
                {(t as any).title?.slice(0, 20) || 'Tác vụ'}
              </SvgText>
            </React.Fragment>
          );
        })}
        {/* tooltip */}
        {tt && (
          <React.Fragment>
            {/* bubble */}
            <Rect x={Math.max(tt.x - 80, 4)} y={Math.max(tt.y - 36, 2)} width={160} height={34} rx={6} ry={6} fill="#111827" opacity={0.92} />
            {/* pointer triangle */}
            <SvgPath d={`M ${tt.x - 6} ${tt.y - 2} L ${tt.x + 6} ${tt.y - 2} L ${tt.x} ${tt.y + 6} Z`} fill="#111827" opacity={0.92} />
            <SvgText x={Math.max(tt.x - 72, 8)} y={Math.max(tt.y - 23, 14)} fill="#ffffff" fontSize={11} fontWeight="bold">
              {tt.title?.slice(0, 24)}
            </SvgText>
            <SvgText x={Math.max(tt.x - 72, 8)} y={Math.max(tt.y - 9, 28)} fill="#d1d5db" fontSize={10}>
              {tt.dateText} · {tt.status === 'completed' ? 'Hoàn thành' : 'Chưa làm'}
            </SvgText>
          </React.Fragment>
        )}
      </Svg>
      </ScrollView>
    );
  };

  const ChartHeader = (
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
  );

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

  const OverviewSection = (
    <View style={{ backgroundColor:'#fff', borderRadius:12, padding:12, borderWidth:1, borderColor:'#e5e7eb' }}>
      <View style={{ flexDirection:'row', flexWrap:'wrap', gap:12, marginBottom:12 }}>
        {[{label:'Tổng tác vụ', value: total },{label:'Hoàn thành', value: completedCount },{label:'Đang làm/Chờ', value: inProgCount },{label:'Quá hạn', value: overdueCount },{label:'Sắp đến hạn (7d)', value: dueSoonCount }].map((kpi, idx)=>(
          <View key={idx} style={{ flexGrow:1, minWidth:120, padding:10, borderWidth:1, borderColor:'#e5e7eb', borderRadius:10 }}>
            <Text style={{ color: palette.subtle, fontSize:11 }}>{kpi.label}</Text>
            <Text style={{ color: palette.text, fontSize:18, fontWeight:'800' }}>{kpi.value}</Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between' }}>
        <View style={{ flex:1, alignItems:'center' }}>{renderDonut()}</View>
        <View style={{ flex:1, paddingLeft:12 }}>
          <Text style={{ color: palette.text, fontWeight:'700', marginBottom:6 }}>Phân bố trạng thái</Text>
          <View style={{ gap:8 }}>
            <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
              <View style={{ width:10, height:10, borderRadius:5, backgroundColor: palette.completed }} />
              <Text style={{ color: palette.text, fontSize:12 }}>Hoàn thành: {completedCount}</Text>
            </View>
            <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
              <View style={{ width:10, height:10, borderRadius:5, backgroundColor: palette.todo }} />
              <Text style={{ color: palette.text, fontSize:12 }}>Chưa làm/Đang làm: {inProgCount}</Text>
            </View>
            <Text style={{ color: palette.subtle, fontSize:11, marginTop:8 }}>{rangeText}</Text>
          </View>
        </View>
      </View>
    </View>
  );

  return (
    <View style={{ marginTop: 12 }} onLayout={(e)=> setContainerW(e.nativeEvent.layout.width)}>
      {ChartHeader}
      {/* Overview */}
      {tab === 'overview' && (
        OverviewSection
      )}
      {/* Burndown */}
      {tab === 'burndown' && (
        <View style={{ backgroundColor:'#fff', borderRadius:12, padding:12, borderWidth:1, borderColor:'#e5e7eb' }}>
          <Text style={{ color: palette.subtle, fontSize:12, marginBottom:6 }}>Burndown (Số tác vụ còn lại)</Text>
          {renderBurndown()}
        </View>
      )}
      {/* Flow */}
      {tab === 'flow' && (
        <View style={{ backgroundColor:'#fff', borderRadius:12, padding:12, borderWidth:1, borderColor:'#e5e7eb' }}>
          <Text style={{ color: palette.subtle, fontSize:12, marginBottom:6 }}>Tiến độ tích lũy</Text>
          {renderFlow()}
        </View>
      )}
      {/* Gantt */}
      {tab === 'gantt' && (
        <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 8, borderWidth: 1, borderColor: '#e5e7eb', overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <Text style={{ color: palette.subtle, fontSize: 12 }}>Gantt chart</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <Pressable onPress={() => setPxPerDay(p => Math.max(minPxPerDay, Math.round((p - 2))))} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: '#e5e7eb' }}>
                <Text style={{ color: palette.text, fontSize: 12 }}>−</Text>
              </Pressable>
              <View style={{ paddingHorizontal: 6, paddingVertical: 4 }}>
                <Text style={{ color: palette.subtle, fontSize: 11 }}>{pxPerDay}px/ngày</Text>
              </View>
              <Pressable onPress={() => setPxPerDay(p => Math.min(maxPxPerDay, Math.round((p + 2))))} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: '#e5e7eb' }}>
                <Text style={{ color: palette.text, fontSize: 12 }}>+</Text>
              </Pressable>
            </View>
          </View>
          <Text style={{ color: palette.subtle, fontSize: 11, marginBottom: 8 }}>{rangeText}</Text>
          <View style={{ marginBottom: 8 }}>{FilterChips}</View>
          {renderGantt()}
        </View>
      )}
    </View>
  );
}
