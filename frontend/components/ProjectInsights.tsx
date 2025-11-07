import React from 'react';
import { View, Text, Dimensions, Platform, Pressable, ScrollView } from 'react-native';
import { PieChart } from 'react-native-chart-kit';
import Svg, { Rect, Line as SvgLine, Text as SvgText, Path as SvgPath } from 'react-native-svg';

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

const chartConfig = {
  backgroundGradientFrom: '#ffffff',
  backgroundGradientTo: '#ffffff',
  decimalPlaces: 0,
  color: (opacity = 1) => `rgba(22, 66, 91, ${opacity})`,
  labelColor: (opacity = 1) => `rgba(22, 66, 91, ${opacity})`,
  propsForBackgroundLines: { stroke: palette.grid, strokeDasharray: '0' },
  useShadowColorFromDataset: false,
};

const dayDiff = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86400000);
const toISODate = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
};
const fmtDM = (d: Date) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
const fmtDMY = (d: Date) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;

type ChartType = 'gantt' | 'pie';

export default function ProjectInsights({ project, tasks, events }: ProjectInsightsProps){
  const screenW = Dimensions.get('window').width;
  const [containerW, setContainerW] = React.useState<number | null>(null);
  const width = React.useMemo(() => {
    const base = containerW ? containerW - 16 : screenW - 24; // account for card padding
    return Math.max(240, Math.min(base, 820));
  }, [containerW, screenW]);
  const [chartType, setChartType] = React.useState<ChartType>('gantt');
  const [menuOpen, setMenuOpen] = React.useState(false);
  const scrollRef = React.useRef<ScrollView | null>(null);
  // Tooltip state for Gantt bars
  const [tt, setTt] = React.useState<null | { x: number; y: number; title: string; dateText: string; status: string }>(null);

  // Status filter toggles
  const [statusFilter, setStatusFilter] = React.useState<{todo: boolean; completed: boolean}>({
    todo: true,
    completed: true,
  });
  // Group 'in-progress' into 'todo'
  const statusMatches = (s: 'todo'|'in-progress'|'completed') =>
    (s === 'completed' && statusFilter.completed) || ((s === 'todo' || s === 'in-progress') && statusFilter.todo);

  // Filter to this project only (defensive)
  const projTasks = tasks.filter(t => (t as any).projectId === project._id || (t as any).type === 'group');
  const filteredTasks = projTasks.filter(t => statusMatches(t.status));
  const total = projTasks.length;

  // Pie uses filters too so it mirrors selection
  const pieCounts = {
    todo: projTasks.filter(t => (t.status === 'todo' || t.status === 'in-progress') && statusFilter.todo).length,
    done: projTasks.filter(t => t.status === 'completed' && statusFilter.completed).length,
  };
  const pieData = [
    { name: 'Chưa làm', population: pieCounts.todo, color: palette.todo, legendFontColor: palette.text, legendFontSize: 11 },
    { name: 'Hoàn thành', population: pieCounts.done, color: palette.completed, legendFontColor: palette.text, legendFontSize: 11 },
  ].filter(s => s.population > 0);

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

  // Note: temporarily removed Burndown and CFD per request.

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
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
      <Text style={{ color: palette.text, fontWeight: '700', fontSize: 14 }}>Giám sát dự án</Text>
      <View style={{ position: 'relative' }}>
        <Pressable onPress={()=> setMenuOpen(o=>!o)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, backgroundColor: '#fff' }}>
          <Text style={{ color: palette.text, fontSize: 12 }}>
            {chartType === 'gantt' ? 'Gantt' : 'Phân bố'} ▾
          </Text>
        </Pressable>
        {menuOpen && (
          <View style={{ position: 'absolute', right: 0, top: 34, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, overflow: 'hidden', zIndex: 20 }}>
            {([
              { key: 'gantt', label: 'Gantt' },
              { key: 'pie', label: 'Phân bố trạng thái' },
            ] as Array<{key: ChartType; label: string}>).map(opt => (
              <Pressable key={opt.key} onPress={()=> { setChartType(opt.key); setMenuOpen(false); }} style={{ paddingHorizontal: 12, paddingVertical: 10, minWidth: 180 }}>
                <Text style={{ color: palette.text, fontSize: 12 }}>{opt.label}</Text>
              </Pressable>
            ))}
          </View>
        )}
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

  return (
    <View style={{ marginTop: 12 }} onLayout={(e)=> setContainerW(e.nativeEvent.layout.width)}>
      {ChartHeader}
      {/* Chart container */}
      {chartType === 'gantt' && (
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

      {chartType === 'pie' && (
        <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#e5e7eb', overflow: 'hidden' }}>
          <Text style={{ color: palette.subtle, fontSize: 12, marginBottom: 6 }}>Phân bố trạng thái</Text>
          <View style={{ marginBottom: 8 }}>{FilterChips}</View>
          {pieData.length > 0 ? (
            <PieChart
              data={pieData as any}
              width={width}
              height={220}
              chartConfig={chartConfig}
              accessor="population"
              backgroundColor="transparent"
              paddingLeft={Platform.OS === 'web' ? '16' : '8'}
              hasLegend
              center={[0, 0]}
            />
          ) : (
            <Text style={{ color: palette.subtle, fontSize: 12 }}>Chưa có dữ liệu tác vụ</Text>
          )}
        </View>
      )}
    </View>
  );
}
