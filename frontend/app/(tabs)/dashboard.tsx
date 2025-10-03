import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, DeviceEventEmitter, Modal, Alert, ScrollView } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { mockProjects, calculateProgress, Task, getDaysOfWeek, getCurrentWeek, priorityColor } from '@/utils/dashboard';
import { aiOrderedTasks } from '@/utils/aiTaskSort';
import axios from 'axios';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing, FadeInDown, FadeOutUp, Layout, withRepeat, withSequence, interpolate } from 'react-native-reanimated';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'expo-router';
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Helper to color dots by importance
const importanceDotColor = (importance?: string) => {
  switch(importance){
    case 'high': return '#dc2626';
    case 'medium': return '#f59e0b';
    case 'low': return '#3a7ca5';
    default: return '#3a7ca5';
  }
};

// Local date helpers: ensure app follows device local time (not UTC)
const toLocalISODate = (d?: Date) => {
  const dt = d || new Date();
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const weekdayVNFromISO = (iso: string) => {
  if(!iso) return '';
  const [y,m,d] = iso.split('-').map(Number);
  const dt = new Date(y, (m||1)-1, d||1);
  const names = ['Chủ nhật','Thứ 2','Thứ 3','Thứ 4','Thứ 5','Thứ 6','Thứ 7'];
  return names[dt.getDay()];
};

export default function DashboardScreen() {
  // NEW: date filtering enhancement plan
  // We'll introduce selectedDateISO, and dynamic generators for week and month views.
  const { user, token } = useAuth();
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  type RepeatRule = { frequency: 'daily' | 'weekly' | 'monthly' | 'yearly'; endMode?: 'never' | 'onDate' | 'after'; endDate?: string; count?: number };
  type EventItem = { id:string; title:string; date:string; endDate?:string; startTime?:string; endTime?:string; location?:string; repeat?: RepeatRule };
  const [events, setEvents] = useState<EventItem[]>([]);
  const [aiMode, setAiMode] = useState(false); // AI suggestion sorting active
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionTask, setActionTask] = useState<Task | null>(null);
  const [showActions, setShowActions] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showSubModal, setShowSubModal] = useState(false);
  const [subModalTask, setSubModalTask] = useState<Task | null>(null);
  const [showCompletedCollapse, setShowCompletedCollapse] = useState(true);
  const [showFabMenu, setShowFabMenu] = useState(false);
  const menuAnim = useSharedValue(0); // 0 closed, 1 open

  useEffect(()=>{
    if(toast){
      const t = setTimeout(()=> setToast(null), 1800);
      return () => clearTimeout(t);
    }
  },[toast]);

  const pendingDeletes = React.useRef<{[k:string]:ReturnType<typeof setTimeout>}>({});
  const cacheDeleted = React.useRef<{[k:string]:Task}>({});
  const performDelete = (id:string) => {
    if(!token) return;
    const target = tasks.find(t=>t.id===id);
    if(!target) return;
    setTasks(prev => prev.filter(t=>t.id!==id));
    cacheDeleted.current[id] = target;
    setToast('Đã xóa. Hoàn tác?');
    const API_BASE = process.env.EXPO_PUBLIC_API_BASE;
    const timeout = setTimeout(async () => {
      try { await axios.delete(`${API_BASE}/api/tasks/${id}`); DeviceEventEmitter.emit('toast','Xóa vĩnh viễn thành công'); }
      catch { DeviceEventEmitter.emit('toast','Lỗi xóa trên server'); }
      finally { delete cacheDeleted.current[id]; delete pendingDeletes.current[id]; }
    }, 2500);
    pendingDeletes.current[id] = timeout;
  };

  const handleDelete = (id:string) => {
    setShowActions(false);
    Alert.alert('Xác nhận','Bạn chắc chắn muốn xóa tác vụ này?',[
      { text:'Hủy', style:'cancel' },
      { text:'Xóa', style:'destructive', onPress:()=> performDelete(id) }
    ]);
  };

  const undoLastDelete = () => {
    // restore most recent
    const ids = Object.keys(cacheDeleted.current);
    if(!ids.length) return;
    const lastId = ids[ids.length-1];
    const task = cacheDeleted.current[lastId];
    if(pendingDeletes.current[lastId]){ clearTimeout(pendingDeletes.current[lastId]); delete pendingDeletes.current[lastId]; }
    delete cacheDeleted.current[lastId];
    setTasks(prev => [task, ...prev]);
    setToast('Đã hoàn tác');
  };
  const [selectedTab, setSelectedTab] = useState<'Hôm nay' | 'Tuần' | 'Tháng'>('Hôm nay');
  const [selectedDate, setSelectedDate] = useState<number>(() => new Date().getDate());
  // Keep a ticking now to refresh "today" and any relative date logic
  const [now, setNow] = useState<Date>(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60 * 1000); // refresh each minute
    return () => clearInterval(id);
  }, []);
  const todayISO = toLocalISODate(now);
  const [selectedDateISO, setSelectedDateISO] = useState<string>(todayISO);
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const days = getDaysOfWeek();
  const weekDates = getCurrentWeek();

  // Build a map date -> tasks[] for fast counts
  const taskMap = React.useMemo(()=> {
    // dayInfo: date -> { total, completed, color(highest importance of incomplete tasks) }
    const map: Record<string, { total:number; completed:number; color:string; }> = {};
    const rank = (imp?:string) => imp==='high'?3: imp==='medium'?2: imp==='low'?1:0;
    tasks.forEach(t => {
      if(!t.date) return;
      const key = t.date;
      if(!map[key]) map[key] = { total:0, completed:0, color:'#3a7ca5' };
      map[key].total++;
      if(t.completed) map[key].completed++;
      if(!t.completed){
        const curRank = rank(t.importance);
        // derive existing importance rank from stored color
        const existingRank = map[key].color === '#dc2626' ? 3 : map[key].color === '#f59e0b' ? 2 : 1;
        if(curRank > existingRank){ map[key].color = importanceDotColor(t.importance); }
      }
    });
    return map;
  }, [tasks]);

  // Week dates (ISO) based on selectedDateISO anchor
  const buildWeek = (anchorISO: string) => {
    const anchor = new Date(anchorISO + 'T00:00:00');
    const day = anchor.getDay(); // 0 Sun
    const mondayOffset = (day === 0 ? -6 : 1 - day); // make Monday first
    const start = new Date(anchor);
    start.setDate(anchor.getDate() + mondayOffset);
    const arr: string[] = [];
    for(let i=0;i<7;i++){
      const d = new Date(start);
      d.setDate(start.getDate()+i);
      arr.push(toLocalISODate(d));
    }
    return arr;
  };
  const weekISO = buildWeek(selectedDateISO);

  // Recurrence helpers (expand events with repeat)
  const isoToDate = (iso: string) => { const [y,m,d] = iso.split('-').map(n=>parseInt(String(n),10)); return new Date(y, (m||1)-1, d||1); };
  const addDaysISO = (iso: string, n: number) => { const dt = isoToDate(iso); dt.setDate(dt.getDate()+n); return toLocalISODate(dt); };
  const diffDays = (aIso: string, bIso: string) => { const a = isoToDate(aIso); const b = isoToDate(bIso); const ms = b.getTime()-a.getTime(); return Math.round(ms/86400000); };
  const addMonthsISO = (iso: string, n: number) => { const d = isoToDate(iso); const day = d.getDate(); const target = new Date(d.getFullYear(), d.getMonth()+n, day); if(target.getDate()!==day) return null; return toLocalISODate(target); };
  const diffMonths = (startIso: string, iso: string) => { const a = isoToDate(startIso); const b = isoToDate(iso); return (b.getFullYear()-a.getFullYear())*12 + (b.getMonth()-a.getMonth()); };
  const occursOnDate = (ev: EventItem, iso: string): boolean => {
    const span = ev.endDate ? (diffDays(ev.date, ev.endDate) + 1) : 1;
    const withinSpan = (occStart: string) => {
      if(span <= 1) return occStart === iso;
      const occEnd = addDaysISO(occStart, span-1);
      return occStart <= iso && iso <= occEnd;
    };
    if(!ev.repeat){
      if(!ev.endDate) return ev.date === iso;
      return ev.date <= iso && iso <= ev.endDate;
    }
    const r = ev.repeat;
    if(!r) return false;
    const start = ev.date;
    if(iso < start) return false;
    const endMode = r.endMode || 'never';
    if(r.frequency==='daily'){
      const k = diffDays(start, iso);
      if(k < 0) return false;
      const occStart = addDaysISO(start, k);
      const n = k + 1;
      if(endMode==='after' && r.count && n > r.count) return false;
      if(endMode==='onDate' && r.endDate && occStart > r.endDate) return false;
      return withinSpan(occStart);
    }
    if(r.frequency==='weekly'){
      const k = Math.floor(diffDays(start, iso)/7);
      if(k < 0) return false;
      const occStart = addDaysISO(start, k*7);
      if(occStart > iso) return false;
      const n = k + 1;
      if(endMode==='after' && r.count && n > r.count) return false;
      if(endMode==='onDate' && r.endDate && occStart > r.endDate) return false;
      return withinSpan(occStart);
    }
    if(r.frequency==='monthly'){
      const m = diffMonths(start, iso);
      if(m < 0) return false;
      const occStart = addMonthsISO(start, m);
      if(!occStart || occStart > iso) return false;
      const n = m + 1;
      if(endMode==='after' && r.count && n > r.count) return false;
      if(endMode==='onDate' && r.endDate && occStart > r.endDate) return false;
      return withinSpan(occStart);
    }
    if(r.frequency==='yearly'){
      const a = isoToDate(start), b = isoToDate(iso);
      const years = b.getFullYear() - a.getFullYear();
      if(years < 0) return false;
      const occStart = toLocalISODate(new Date(a.getFullYear()+years, a.getMonth(), a.getDate()));
      if(occStart > iso) return false;
      const n = years + 1;
      if(endMode==='after' && r.count && n > r.count) return false;
      if(endMode==='onDate' && r.endDate && occStart > r.endDate) return false;
      return withinSpan(occStart);
    }
    return false;
  };

  // Month matrix (6 rows x 7 cols) storing ISO or '' for padding
  const monthMatrix = React.useMemo(()=> {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const first = new Date(year, month, 1);
    const firstDay = (first.getDay() + 6) % 7; // convert Sun=0 to Sun=6, Mon=0
    const daysInMonth = new Date(year, month+1, 0).getDate();
    const cells: string[] = [];
    for(let i=0;i<firstDay;i++) cells.push('');
    for(let d=1; d<=daysInMonth; d++){
      const iso = toLocalISODate(new Date(year, month, d));
      cells.push(iso);
    }
    while(cells.length % 7 !== 0) cells.push('');
    if(cells.length < 42){ while(cells.length < 42) cells.push(''); }
    const rows: string[][] = [];
    for(let r=0;r<cells.length;r+=7) rows.push(cells.slice(r,r+7));
    return rows;
  }, [currentMonth]);

  // Determine if a repeating task occurs on a given ISO date
  const occursTaskOnDate = (t: Task, iso: string): boolean => {
    // respect multi-day span as well
    const span = t.endDate ? (diffDays(t.date, t.endDate) + 1) : 1;
    const withinSpan = (occStart: string) => {
      if(span <= 1) return occStart === iso;
      const occEnd = addDaysISO(occStart, span-1);
      return occStart <= iso && iso <= occEnd;
    };
    if(!t.repeat){
      if(!t.endDate) return t.date === iso;
      return t.date <= iso && iso <= t.endDate;
    }
    const r = t.repeat;
    const start = t.date;
    if(iso < start) return false;
    const endMode = r.endMode || 'never';
    if(r.frequency==='daily'){
      const k = diffDays(start, iso);
      if(k < 0) return false;
      const occStart = addDaysISO(start, k);
      const n = k + 1;
      if(endMode==='after' && r.count && n > r.count) return false;
      if(endMode==='onDate' && r.endDate && occStart > r.endDate) return false;
      return withinSpan(occStart);
    }
    if(r.frequency==='weekly'){
      const k = Math.floor(diffDays(start, iso)/7);
      if(k < 0) return false;
      const occStart = addDaysISO(start, k*7);
      if(occStart > iso) return false;
      const n = k + 1;
      if(endMode==='after' && r.count && n > r.count) return false;
      if(endMode==='onDate' && r.endDate && occStart > r.endDate) return false;
      return withinSpan(occStart);
    }
    if(r.frequency==='monthly'){
      const m = diffMonths(start, iso);
      if(m < 0) return false;
      const occStart = addMonthsISO(start, m);
      if(!occStart || occStart > iso) return false;
      const n = m + 1;
      if(endMode==='after' && r.count && n > r.count) return false;
      if(endMode==='onDate' && r.endDate && occStart > r.endDate) return false;
      return withinSpan(occStart);
    }
    if(r.frequency==='yearly'){
      const a = isoToDate(start), b = isoToDate(iso);
      const years = b.getFullYear() - a.getFullYear();
      if(years < 0) return false;
      const occStart = toLocalISODate(new Date(a.getFullYear()+years, a.getMonth(), a.getDate()));
      if(occStart > iso) return false;
      const n = years + 1;
      if(endMode==='after' && r.count && n > r.count) return false;
      if(endMode==='onDate' && r.endDate && occStart > r.endDate) return false;
      return withinSpan(occStart);
    }
    return false;
  };

  // Filter tasks based on tab + selected date (include recurring)
  const filteredTasks = React.useMemo(()=>{
    const today = todayISO;
    const applySort = (list:Task[]) => aiMode ? aiOrderedTasks(list, today) : list;
    if(selectedTab === 'Hôm nay'){
      const baseAll = tasks.filter(t => !t.completed && occursTaskOnDate(t, today));
      // Skip tasks already ended today if they have an endTime (align with events Today card logic)
      const nowHM = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
      const notEnded = baseAll.filter(t => {
        const et = t.endTime || (t.time && t.time.includes('-') ? t.time.split('-')[1] : undefined);
        if(!et) return true; // no end time => consider ongoing
        if(t.endDate){
          if(today === t.endDate) return et > nowHM; // ends today and after now
          if(today < t.endDate) return true;        // ends in the future
          return false;                             // ended before today (shouldn't occur if occursTaskOnDate true)
        }
        // single-day task
        return et > nowHM;
      });
      const base = notEnded;
      return applySort(base);
    }
    if(selectedTab === 'Tuần'){
      const base = tasks.filter(t=> !t.completed && occursTaskOnDate(t, selectedDateISO));
      return applySort(base);
    }
    if(selectedTab === 'Tháng'){
      const base = tasks.filter(t=> !t.completed && occursTaskOnDate(t, selectedDateISO));
      return applySort(base);
    }
    const base = tasks.filter(t=>!t.completed);
    return applySort(base);
  }, [tasks, selectedTab, selectedDateISO, weekISO, currentMonth, aiMode]);

  // Completed tasks (still show below) - you could scope per view if wanted
  const completedTasks = React.useMemo(()=> tasks.filter(t=> t.completed), [tasks]);

  // Handlers
  const selectDay = (iso:string) => { if(!iso) return; setSelectedDateISO(iso); if(selectedTab==='Hôm nay') {/* no-op */} };
  const goPrevMonth = () => { const d = new Date(currentMonth); d.setMonth(d.getMonth()-1); setCurrentMonth(d); };
  const goNextMonth = () => { const d = new Date(currentMonth); d.setMonth(d.getMonth()+1); setCurrentMonth(d); };

  const toggleTask = (id: string) => {
    const nowISO = new Date().toISOString();
    setTasks(prev => prev.map(t => {
      if(t.id !== id) return t;
      const willComplete = !t.completed;
      return { ...t, completed: willComplete, status: willComplete? 'completed':'todo', completedAt: willComplete? nowISO: undefined };
    }));
    // optimistic API
    const target = tasks.find(t=>t.id===id);
    if(!target) return;
  const API_BASE = process.env.EXPO_PUBLIC_API_BASE;
    const desiredStatus = target.completed ? 'todo' : 'completed'; // because we toggled state locally already
    axios.put(`${API_BASE}/api/tasks/${id}`, { status: desiredStatus })
      .then(res => {
        const u = res.data;
        DeviceEventEmitter.emit('taskUpdated', u);
      })
      .catch(()=>{
        // rollback on error
        setTasks(prev => prev.map(t => t.id===id ? target : t));
        setToast('Lỗi cập nhật');
      });
  };

  // Fetch tasks from API
  const API_BASE = process.env.EXPO_PUBLIC_API_BASE;
  const fetchTasks = async () => {
    if(!token) return;
    setLoading(true); setError(null);
    try {
      const res = await axios.get(`${API_BASE}/api/tasks`, { headers: { Authorization: token ? `Bearer ${token}` : '' } });
      // Map API tasks to local Task interface
      const mapped: Task[] = res.data.map((t: any) => ({
        id: t._id,
        title: t.title,
        time: t.startTime && t.endTime ? `${t.startTime}-${t.endTime}` : (t.time || ''),
        date: t.date?.split('T')[0] || '',
  endDate: t.endDate || undefined,
        startTime: t.startTime,
        endTime: t.endTime,
        priority: t.priority || 'medium',
        importance: t.importance,
        completed: t.status === 'completed',
        type: t.type || 'personal',
        status: t.status || 'todo',
        completedAt: t.completedAt,
        subTasks: t.subTasks,
        completionPercent: t.completionPercent,
        repeat: t.repeat,
      }));
      setTasks(mapped);
    } catch(e:any){
      setError(e?.response?.data?.message || 'Không tải được tasks');
    } finally { setLoading(false); }
  };

  useEffect(()=>{ fetchTasks(); },[token]);

  // Fetch events from API
  const fetchEvents = async () => {
    if(!token) return;
    try {
      const res = await axios.get(`${API_BASE}/api/events`, { headers: { Authorization: token ? `Bearer ${token}` : '' } });
      const mapped: EventItem[] = res.data.map((e:any)=>({
        id: e._id,
        title: e.title,
        date: e.date?.split('T')[0] || e.date,
        endDate: e.endDate,
        startTime: e.startTime,
        endTime: e.endTime,
        location: e.location,
        repeat: e.repeat
      }));
      setEvents(mapped);
    } catch(e){ /* silent for now */ }
  };
  useEffect(()=>{ fetchEvents(); },[token]);

  // Listen for eventCreated to update without refetch
  useEffect(()=>{
    const onEvt = DeviceEventEmitter.addListener('eventCreated', (ev:any) => {
      const adapted = {
        id: ev._id || ev.id,
        title: ev.title,
        date: ev.date?.split('T')[0] || ev.date,
        endDate: ev.endDate,
        startTime: ev.startTime,
        endTime: ev.endTime,
        location: ev.location,
        repeat: ev.repeat,
      } as EventItem;
      setEvents(prev => [adapted, ...prev]);
    });
    const onUpd = DeviceEventEmitter.addListener('eventUpdated', (ev:any) => {
      const adapted = {
        id: ev._id || ev.id,
        title: ev.title,
        date: ev.date?.split?.('T')?.[0] || ev.date,
        endDate: ev.endDate,
        startTime: ev.startTime,
        endTime: ev.endTime,
        location: ev.location,
        repeat: ev.repeat,
      } as EventItem;
      setEvents(prev => prev.map(e => e.id===adapted.id ? { ...e, ...adapted } : e));
    });
    const onDel = DeviceEventEmitter.addListener('eventDeleted', (id:any) => {
      const delId = typeof id === 'string' ? id : (id? id.toString() : '');
      setEvents(prev => prev.filter(e => e.id !== delId));
    });
    return () => { onEvt.remove(); onUpd.remove(); onDel.remove(); };
  }, []);

  // Listen for new task created from create-task screen (append without refetch)
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('taskCreated', (newTask: any) => {
      // adapt if newTask already has start/end times
      const adapted: Task = {
        id: newTask._id || newTask.id,
        title: newTask.title,
        time: newTask.startTime && newTask.endTime ? `${newTask.startTime}-${newTask.endTime}` : (newTask.time || ''),
        date: newTask.date?.split('T')[0] || newTask.date,
  endDate: newTask.endDate,
        startTime: newTask.startTime,
        endTime: newTask.endTime,
        priority: newTask.priority,
        importance: newTask.importance,
        completed: newTask.status === 'completed',
        type: newTask.type,
        status: newTask.status,
        subTasks: newTask.subTasks,
        completionPercent: newTask.completionPercent,
        repeat: newTask.repeat,
      };
      setTasks(prev => [adapted, ...prev]);
      setToast('Đã thêm tác vụ');
    });
    const upd = DeviceEventEmitter.addListener('taskUpdated', (uTask: any) => {
      const adapted: Task = {
        id: uTask._id || uTask.id,
        title: uTask.title,
        time: uTask.startTime && uTask.endTime ? `${uTask.startTime}-${uTask.endTime}` : (uTask.time || ''),
        date: uTask.date?.split('T')[0] || uTask.date,
  endDate: uTask.endDate,
        startTime: uTask.startTime,
        endTime: uTask.endTime,
        priority: uTask.priority,
        importance: uTask.importance,
        completed: uTask.status === 'completed',
        type: uTask.type,
        status: uTask.status,
        completedAt: uTask.completedAt,
        subTasks: uTask.subTasks,
        completionPercent: uTask.completionPercent,
        repeat: uTask.repeat,
      };
      setTasks(prev => prev.map(t=> t.id===adapted.id ? { ...t, ...adapted } : t));
      setToast('Đã cập nhật');
    });
  const toastListener = DeviceEventEmitter.addListener('toast', (msg:string)=> setToast(msg));
  const del = DeviceEventEmitter.addListener('taskDeleted', (id:any) => {
    const delId = typeof id === 'string' ? id : (id? id.toString() : '');
    setTasks(prev => prev.filter(t => t.id !== delId));
  });
  return () => { sub.remove(); upd.remove(); toastListener.remove(); del.remove(); };
  }, []);

  const completed = tasks.filter(t => t.completed).length;
  const total = tasks.length;
  const progress = calculateProgress(completed, total);

  // Progress bar animated width
  const progressSV = useSharedValue(0);
  useEffect(() => {
    progressSV.value = withTiming(progress, { duration: 600, easing: Easing.out(Easing.cubic) });
  }, [progress]);
  const progressStyle = useAnimatedStyle(() => ({ width: `${progressSV.value}%` }));

  // FAB pulse
  const fabScale = useSharedValue(1);
  useEffect(() => {
    fabScale.value = withRepeat(withSequence(
      withTiming(1.06, { duration: 900 }),
      withTiming(1.0, { duration: 900 })
    ), -1, false);
  }, []);
  const fabStyle = useAnimatedStyle(()=>({ transform:[{ scale: fabScale.value }] }));

  const openSubModal = (task:Task) => { setSubModalTask(task); setShowSubModal(true); };
  const closeSubModal = () => { setShowSubModal(false); setSubModalTask(null); };
  const toggleSubTask = (tId:string, index:number) => {
    // optimistic local update for immediate feedback
    let snapshot: Task | null = null;
    setTasks(prev => prev.map(t => {
      if(t.id!==tId) return t;
      snapshot = { ...t }; // keep snapshot for potential rollback
      const updatedSubs = (t.subTasks||[]).map((st,i)=> i===index? { ...st, completed: !st.completed }: st);
      const done = updatedSubs.filter(s=>s.completed).length;
      const percent = updatedSubs.length? Math.round(done/updatedSubs.length*100):0;
      // Do NOT auto change main task status/completed; user decides separately
      return { ...t, subTasks: updatedSubs, completionPercent: percent };
    }));
    if(subModalTask && subModalTask.id===tId){
      setSubModalTask(prev => {
        if(!prev) return prev;
        const updatedSubs = (prev.subTasks||[]).map((st,i)=> i===index? { ...st, completed: !st.completed }: st);
        const done = updatedSubs.filter(s=>s.completed).length;
        const percent = updatedSubs.length? Math.round(done/updatedSubs.length*100):0;
        return { ...prev, subTasks: updatedSubs, completionPercent: percent };
      });
    }
    // API call
  const API_BASE = process.env.EXPO_PUBLIC_API_BASE;
    axios.patch(`${API_BASE}/api/tasks/${tId}/subtasks/${index}`)
      .then(res => {
        const data = res.data;
        DeviceEventEmitter.emit('taskUpdated', data);
        // ensure subModalTask sync
        if(subModalTask && subModalTask.id===tId){
          setSubModalTask(prev => prev ? { ...prev, subTasks: data.subTasks, completionPercent: data.completionPercent } : prev);
        }
      })
      .catch(()=> {
        setToast('Lỗi cập nhật subtask');
        // rollback
        if(snapshot){
          setTasks(prev => prev.map(t=> t.id===tId? snapshot!: t));
          if(subModalTask && subModalTask.id===tId){
            setSubModalTask(snapshot as any);
          }
        }
      });
  };

  // Remove animation helpers for debug simple menu
  // const menuAnim = useSharedValue(0);
  // useEffect(()=>{ menuAnim.value = withTiming(showFabMenu?1:0,{ duration:280 }); },[showFabMenu]);
  // const fabRotateStyle = useAnimatedStyle(()=> ({ transform:[{ rotate: `${interpolate(menuAnim.value,[0,1],[0,45])}deg` }] }));
  // const buildItemStyle = (i:number)=> useAnimatedStyle(()=>({ opacity: menuAnim.value }));
  // const action1Style = buildItemStyle(0); const action2Style = buildItemStyle(1); const action3Style = buildItemStyle(2);
  // const menuStyle = useAnimatedStyle(()=> ({ opacity: menuAnim.value }));

  const bottomPad = showFabMenu ? 260 : 140;

  return (
    <SafeAreaView style={{ flex:1, backgroundColor:'#f1f5f9' }} edges={['top']}>
      <FlatList
        data={filteredTasks}
        keyExtractor={item => item.id}
        contentContainerStyle={{ padding:20, paddingBottom: bottomPad }}
        ListHeaderComponent={
          <View>
            <View style={styles.headerRow}>            
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Pressable onPress={()=> router.push('/profile')} style={styles.avatar}>
                  {user?.avatar ? (
                    <Animated.Image source={{ uri: user.avatar }} style={{ width:'100%', height:'100%', borderRadius:24 }} entering={FadeInDown} />
                  ) : (
                    <Ionicons name="person" size={22} color="#fff" />
                  )}
                </Pressable>
                <View>
                  <Text style={styles.greet}>Xin chào{user?.name ? `, ${user.name}` : ''}</Text>
                  <Text style={styles.role}>
                    {(user?.role === 'admin' && 'Quản trị') || (user?.role === 'leader' && 'Trưởng nhóm') || 'Sinh viên'} • Sẵn sàng học tập?
                  </Text>
                </View>
              </View>
              <Pressable onPress={()=> setAiMode(m=>!m)} style={[styles.aiTopBtn, aiMode && styles.aiTopBtnActive]}>
                <Ionicons name='sparkles' size={18} color={aiMode? '#fff':'#2f6690'} />
                <Text style={[styles.aiTopText, aiMode && styles.aiTopTextActive]}>AI</Text>
              </Pressable>
            </View>

            <View style={styles.progressCard}>
              <View style={styles.progressRow}>
                <Text style={styles.progressTitle}>Tiến độ hôm nay</Text>
                <Text style={styles.progressCounter}>{completed}/{total}</Text>
              </View>
              <View style={styles.progressBarBg}>
                <Animated.View style={[styles.progressBarFill, progressStyle]} />
              </View>
              <Text style={styles.progressHint}>
                {completed === total && total > 0 ? '🎉 Hoàn thành tất cả!' : `Còn ${total - completed} task`}
              </Text>
            </View>

            <View style={styles.tabs}>
              {(['Hôm nay','Tuần','Tháng'] as const).map(tab => (
                <Pressable key={tab} onPress={() => setSelectedTab(tab)} style={[styles.tabBtn, selectedTab === tab && styles.tabBtnActive]}>
                  <Text style={[styles.tabText, selectedTab === tab && styles.tabTextActive]}>{tab}</Text>
                </Pressable>
              ))}
            </View>
            {/* Dynamic date pickers */}
            {selectedTab === 'Hôm nay' && (
              <View style={{ marginBottom:16 }}> 
                <Text style={styles.sectionSub}>Chỉ hiển thị tác vụ của hôm nay ({(() => { const [y,m,d] = todayISO.split('-'); const w = weekdayVNFromISO(todayISO); return `${w}, ${d}/${m}/${y}`; })()})</Text>
                {(() => {
                  // Build today's events and filter out those already ended today
                  const todaysAll = events.filter(ev => occursOnDate(ev, todayISO));
                  const nowHM = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
                  const isEndedForToday = (ev: EventItem): boolean => {
                    if(!ev.endTime) return false; // without endTime, don't consider ended
                    if(ev.endDate){
                      if(todayISO === ev.endDate){ return ev.endTime <= nowHM; }
                      if(todayISO < ev.endDate){ return false; }
                      // todayISO > ev.endDate shouldn't occur when occursOnDate is true
                      return true;
                    } else {
                      // single-day
                      if(ev.date === todayISO){ return ev.endTime <= nowHM; }
                      return true;
                    }
                  };
                  const todaysEvents = todaysAll.filter(ev => !isEndedForToday(ev))
                    .sort((a,b) => (a.startTime||'99:99').localeCompare(b.startTime||'99:99'));
                  const [y,m,d] = todayISO.split('-');
                  const display = `${d}/${m}/${y}`;
                  const w = weekdayVNFromISO(todayISO);
                  return (
                    <Animated.View entering={FadeInDown.delay(40)} style={[styles.weekDayCard, { marginTop: 8 }, styles.weekDayCardToday]}>
                      <View style={styles.weekDayHeader}>
                        <View style={{ flexDirection:'row', alignItems:'center', gap:8, flexShrink:1 }}>
                          <Ionicons name='calendar-outline' size={16} color='#16425b' />
                          <Text style={styles.weekDayTitle}>{w}, {display}</Text>
                          <View style={styles.todayPill}>
                            <Ionicons name='sunny-outline' size={12} color='#fff' style={{ marginRight:4 }} />
                            <Text style={styles.todayPillText}>Hôm nay</Text>
                          </View>
                        </View>
                        <View style={styles.countsRow}>
                          <View style={[styles.countPill, styles.eventsCountPill]}>
                            <Ionicons name='calendar-outline' size={12} color='#2f6690' />
                            <Text style={[styles.countText, styles.eventsCountText]}>{todaysEvents.length}</Text>
                          </View>
                        </View>
                      </View>
                      {todaysEvents.length>0 ? (
                        <View style={styles.eventList}>
                          {todaysEvents.map((ev, idx) => {
                            const time = ev.startTime && (ev.endTime ? `${ev.startTime}–${ev.endTime}` : ev.startTime);
                            return (
                              <Pressable key={ev.id+idx} style={styles.eventChip} onPress={()=> router.push({ pathname:'/create-event', params:{ editId: ev.id, occDate: todayISO } })}>
                                <View style={styles.eventColorBar} />
                                <View style={{ flex:1 }}>
                                  <View style={styles.eventMetaRow}>
                                    <Ionicons name='time-outline' size={14} color='#2f6690' />
                                    {time ? (
                                      <Text style={styles.eventChipTime}>{time}</Text>
                                    ) : (
                                      <View style={styles.allDayPill}><Text style={styles.allDayPillText}>Cả ngày</Text></View>
                                    )}
                                  </View>
                                  <Text style={styles.eventChipTitle} numberOfLines={1}>{ev.title}</Text>
                                  {!!ev.location && (
                                    <View style={styles.eventMetaRow}>
                                      <Ionicons name='location-outline' size={14} color='#607d8b' />
                                      <Text style={styles.eventChipLoc} numberOfLines={1}>{ev.location}</Text>
                                    </View>
                                  )}
                                </View>
                              </Pressable>
                            );
                          })}
                        </View>
                      ) : (
                        <Text style={styles.emptyHint}>Không có sự kiện còn lại trong hôm nay</Text>
                      )}
                    </Animated.View>
                  );
                })()}
              </View>
            )}
            {/* Ẩn hàng ô số (ngày) ở chế độ tuần để tập trung phần thẻ bên dưới */}
            {selectedTab === 'Tuần' && (
              <View style={{ marginTop: 8 }}>
                {weekISO.map((iso, i) => {
                  const [y,m,d] = iso.split('-');
                  const display = `${d}/${m}`;
                  const w = weekdayVNFromISO(iso);
                  const dayEvents = events.filter(ev => occursOnDate(ev, iso));
                  const dayTasks = tasks.filter(t => !t.completed && occursTaskOnDate(t, iso));
                  const isToday = iso === todayISO;
                  return (
                    <Animated.View key={iso} entering={FadeInDown.delay(60 + i*30)} style={[styles.weekDayCard, isToday && styles.weekDayCardToday]}>
                      <View style={styles.weekDayHeader}>
                        <View style={{ flexDirection:'row', alignItems:'center', gap:8, flexShrink:1 }}>
                          <Ionicons name='calendar-outline' size={16} color='#16425b' />
                          <Text style={styles.weekDayTitle}>{w}, {display}</Text>
                          {isToday && (
                            <View style={styles.todayPill}>
                              <Ionicons name='sunny-outline' size={12} color='#fff' style={{ marginRight:4 }} />
                              <Text style={styles.todayPillText}>Hôm nay</Text>
                            </View>
                          )}
                        </View>
                        <View style={styles.countsRow}>
                          <View style={[styles.countPill, styles.eventsCountPill]}>
                            <Ionicons name='calendar-outline' size={12} color='#2f6690' />
                            <Text style={[styles.countText, styles.eventsCountText]}>{dayEvents.length}</Text>
                          </View>
                          <View style={[styles.countPill, styles.tasksCountPill]}>
                            <Ionicons name='checkmark-done-outline' size={12} color='#16425b' />
                            <Text style={[styles.countText, styles.tasksCountText]}>{dayTasks.length}</Text>
                          </View>
                        </View>
                      </View>
                      {dayEvents.length>0 ? (
                        <View style={styles.eventList}>
                          {dayEvents.map((ev, idx) => {
                            const time = ev.startTime && (ev.endTime ? `${ev.startTime}–${ev.endTime}` : ev.startTime);
                            return (
                              <Pressable key={ev.id+idx} style={styles.eventChip} onPress={()=> router.push({ pathname:'/create-event', params:{ editId: ev.id, occDate: iso } })}>
                                <View style={styles.eventColorBar} />
                                <View style={{ flex:1 }}>
                                  <View style={styles.eventMetaRow}>
                                    <Ionicons name='time-outline' size={14} color='#2f6690' />
                                    {time ? (
                                      <Text style={styles.eventChipTime}>{time}</Text>
                                    ) : (
                                      <View style={styles.allDayPill}><Text style={styles.allDayPillText}>Cả ngày</Text></View>
                                    )}
                                  </View>
                                  <Text style={styles.eventChipTitle} numberOfLines={1}>{ev.title}</Text>
                                  {!!ev.location && (
                                    <View style={styles.eventMetaRow}>
                                      <Ionicons name='location-outline' size={14} color='#607d8b' />
                                      <Text style={styles.eventChipLoc} numberOfLines={1}>{ev.location}</Text>
                                    </View>
                                  )}
                                </View>
                              </Pressable>
                            );
                          })}
                        </View>
                      ) : (
                        <Text style={styles.emptyHint}>Không có sự kiện</Text>
                      )}
                      {dayTasks.length>0 ? (
                        <View style={styles.dayTaskChips}>
                          {dayTasks.map((t, idx) => {
                            const timeText = (t.startTime && t.endTime) ? `${t.startTime}-${t.endTime}` : (t.time || '');
                            return (
                              <View key={t.id+idx} style={styles.taskChip}>
                                <View style={[styles.taskChipDot,{ backgroundColor: t.importance==='high'? '#dc2626' : t.importance==='medium'? '#f59e0b':'#3a7ca5' }]} />
                                <Text style={styles.taskChipText} numberOfLines={1}>{t.title}</Text>
                                {!!timeText && <Text style={styles.taskChipTime}>{timeText}</Text>}
                              </View>
                            );
                          })}
                        </View>
                      ) : (
                        <Text style={styles.emptyHint}>Không có tác vụ</Text>
                      )}
                    </Animated.View>
                  );
                })}
              </View>
            )}
            {selectedTab === 'Tháng' && (
              <View style={{ marginBottom:18 }}>
                <View style={styles.monthHeader}>
                  <Pressable onPress={goPrevMonth} style={styles.monthNav}><Ionicons name='chevron-back' size={18} color='#16425b' /></Pressable>
                  <Text style={styles.monthTitle}>{currentMonth.getFullYear()} - {String(currentMonth.getMonth()+1).padStart(2,'0')}</Text>
                  <Pressable onPress={goNextMonth} style={styles.monthNav}><Ionicons name='chevron-forward' size={18} color='#16425b' /></Pressable>
                </View>
                <View style={styles.weekLabels}>
                  {['T2','T3','T4','T5','T6','T7','CN'].map(l=> <Text key={l} style={styles.weekLabel}>{l}</Text>)}
                </View>
                {monthMatrix.map((row,r)=>(
                  <View key={r} style={styles.monthRow}>
                    {row.map((iso,c)=>{
                      if(!iso) return <View key={c} style={styles.monthCellEmpty} />;
                      const active = iso === selectedDateISO;
                      const dayNum = parseInt(iso.split('-')[2],10);
                      // Build dot info from tasks that occur on that iso (recurring aware)
                      const occTasks = tasks.filter(t => occursTaskOnDate(t, iso));
                      const info = (() => {
                        if(!occTasks.length) return undefined;
                        const total = occTasks.length;
                        const completed = occTasks.filter(t=> t.completed).length;
                        const rank = (imp?:string)=> imp==='high'?3: imp==='medium'?2: imp==='low'?1:0;
                        let best = 0; let color = '#3a7ca5';
                        occTasks.forEach(t=>{ if(!t.completed){ const r = rank(t.importance); if(r>best){ best = r; color = importanceDotColor(t.importance); } } });
                        if(best===0) color = '#9ca3af';
                        return { total, completed, color };
                      })();
                      return (
                        <Pressable key={iso} onPress={()=> selectDay(iso)} style={[styles.monthCell, active && styles.monthCellActive]}>
                          <Text style={[styles.monthCellText, active && styles.monthCellTextActive]}>{dayNum}</Text>
                          {info && (
                            <View style={styles.dotSmallWrapper}>
                              <View style={[styles.dotSmallBase, { backgroundColor: info.completed === info.total ? '#9ca3af' : info.color }, active && styles.dotSmallOutline]} />
                            </View>
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
                {/* Day detail card: show both events and tasks for selected day */}
                {selectedDateISO ? (
                  (() => {
                    const iso = selectedDateISO;
                    const [y,m,d] = iso.split('-');
                    const display = `${d}/${m}/${y}`;
                    const w = weekdayVNFromISO(iso);
                    const isToday = iso === todayISO;
                    const dayEvents = events.filter(ev => occursOnDate(ev, iso));
                    const dayTasks = tasks.filter(t => !t.completed && occursTaskOnDate(t, iso));
                    return (
                      <Animated.View entering={FadeInDown.delay(40)} style={[styles.weekDayCard, { marginTop: 8 }, isToday && styles.weekDayCardToday]}>
                        <View style={styles.weekDayHeader}>
                          <View style={{ flexDirection:'row', alignItems:'center', gap:8, flexShrink:1 }}>
                            <Ionicons name='calendar-outline' size={16} color='#16425b' />
                            <Text style={styles.weekDayTitle}>{w}, {display}</Text>
                            {isToday && (
                              <View style={styles.todayPill}>
                                <Ionicons name='sunny-outline' size={12} color='#fff' style={{ marginRight:4 }} />
                                <Text style={styles.todayPillText}>Hôm nay</Text>
                              </View>
                            )}
                          </View>
                          <View style={styles.countsRow}>
                            <View style={[styles.countPill, styles.eventsCountPill]}>
                              <Ionicons name='calendar-outline' size={12} color='#2f6690' />
                              <Text style={[styles.countText, styles.eventsCountText]}>{dayEvents.length}</Text>
                            </View>
                            <View style={[styles.countPill, styles.tasksCountPill]}>
                              <Ionicons name='checkmark-done-outline' size={12} color='#16425b' />
                              <Text style={[styles.countText, styles.tasksCountText]}>{dayTasks.length}</Text>
                            </View>
                          </View>
                        </View>
                        {dayEvents.length>0 ? (
                          <View style={styles.eventList}>
                            {dayEvents.map((ev, idx) => {
                              const time = ev.startTime && (ev.endTime ? `${ev.startTime}–${ev.endTime}` : ev.startTime);
                              return (
                                <Pressable key={ev.id+idx} style={styles.eventChip} onPress={()=> router.push({ pathname:'/create-event', params:{ editId: ev.id, occDate: iso } })}>
                                  <View style={styles.eventColorBar} />
                                  <View style={{ flex:1 }}>
                                    <View style={styles.eventMetaRow}>
                                      <Ionicons name='time-outline' size={14} color='#2f6690' />
                                      {time ? (
                                        <Text style={styles.eventChipTime}>{time}</Text>
                                      ) : (
                                        <View style={styles.allDayPill}><Text style={styles.allDayPillText}>Cả ngày</Text></View>
                                      )}
                                    </View>
                                    <Text style={styles.eventChipTitle} numberOfLines={1}>{ev.title}</Text>
                                    {!!ev.location && (
                                      <View style={styles.eventMetaRow}>
                                        <Ionicons name='location-outline' size={14} color='#607d8b' />
                                        <Text style={styles.eventChipLoc} numberOfLines={1}>{ev.location}</Text>
                                      </View>
                                    )}
                                  </View>
                                </Pressable>
                              );
                            })}
                          </View>
                        ) : (
                          <Text style={styles.emptyHint}>Không có sự kiện</Text>
                        )}
                        {dayTasks.length>0 ? (
                          <View style={styles.dayTaskChips}>
                            {dayTasks.map((t, idx) => { 
                              const ttime = (t.startTime && t.endTime) ? `${t.startTime}-${t.endTime}` : (t.time || null);
                              return (
                                <View key={t.id+idx} style={styles.taskChip}>
                                  <View style={[styles.taskChipDot,{ backgroundColor: t.importance==='high'? '#dc2626' : t.importance==='medium'? '#f59e0b':'#3a7ca5' }]} />
                                  <Text style={styles.taskChipText} numberOfLines={1}>{t.title}</Text>
                                  {!!ttime && <Text style={styles.taskChipTime}>{ttime}</Text>}
                                </View>
                              )})}
                          </View>
                        ) : (
                          <Text style={styles.emptyHint}>Không có tác vụ</Text>
                        )}
                      </Animated.View>
                    );
                  })()
                ) : null}
              </View>
            )}
            <View style={styles.sectionHeader}>
              <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
                <Text style={styles.sectionTitle}>Tác vụ</Text>
                {aiMode && (
                  <View style={styles.aiBadge}>
                    <Text style={styles.aiBadgeText}>AI</Text>
                  </View>
                )}
              </View>
              <Text style={styles.sectionSub}>{filteredTasks.length} hiển thị</Text>
            </View>
            {loading && <Text style={{ color:'#2f6690', marginBottom:12 }}>Đang tải...</Text>}
            {error && <Text style={{ color:'#ef4444', marginBottom:12 }}>{error}</Text>}
            {!loading && !error && filteredTasks.length===0 && (
              selectedTab === 'Hôm nay' ?
                <Text style={{ color:'#16425b', marginBottom:12, fontWeight:'600' }}>🎉 Bạn đã hoàn thành mọi tác vụ hôm nay!</Text> :
                <Text style={{ color:'#2f6690', marginBottom:12 }}>Không có tác vụ.</Text>
            )}
          </View>
        }
        renderItem={({ item, index }) => (
          <Animated.View
            entering={FadeInDown.delay(index*60).springify()}
            exiting={FadeOutUp}
            layout={Layout.springify()}
          >
            {(() => {
              // deadline color logic
              let deadlineStyle: any = null;
              if(item.endDate){
                const localToday = toLocalISODate(new Date());
                // Attempt to parse end time from item.time (pattern HH:MM-HH:MM)
                let endTime: string | undefined;
                if(item.time && item.time.includes('-')) endTime = item.time.split('-')[1];
                const endDeadline = endTime ? new Date(`${item.endDate}T${endTime}:00`) : new Date(`${item.endDate}T23:59:59`);
                const now = new Date();
                const isEndToday = item.endDate === localToday;
                const isOverdue = now > endDeadline;
                if(isOverdue) deadlineStyle = styles.deadlineOverdueCard;
                else if(isEndToday) deadlineStyle = styles.deadlineTodayCard;
              }
              return (
                <Swipeable
                  overshootRight={false}
                  renderRightActions={() => (
                    <Pressable style={styles.swipeDeleteBtn} onPress={()=> handleDelete(item.id)}>
                      <Ionicons name='trash' size={22} color='#fff' />
                    </Pressable>
                  )}
                >
                  <View style={[styles.taskCard, item.completed && styles.taskDone, deadlineStyle]}>          
                    <Pressable onPress={()=> toggleTask(item.id)} hitSlop={10} style={{ marginRight:12 }}>
                      <Animated.View style={[styles.checkCircle, item.completed && styles.checkCircleDone]} layout={Layout.springify()}>
                        {item.completed && <Ionicons name="checkmark" size={16} color="#fff" />}
                      </Animated.View>
                    </Pressable>
                    <Pressable
                      style={{ flex:1 }}
                      hitSlop={4}
                      delayLongPress={350}
                      onLongPress={()=>{ setActionTask(item); setShowActions(true); }}
                      onPress={()=> { if(item.subTasks && item.subTasks.length>0){ openSubModal(item); } else { const occ = selectedTab==='Hôm nay' ? todayISO : selectedDateISO; router.push({ pathname:'/create-task', params:{ editId: item.id, occDate: occ } }); } }}
                    >
                      <View style={{ flexDirection:'row', alignItems:'center' }}>
                        <View style={[styles.priorityDot,{ backgroundColor: priorityColor(item.priority)}]} />
                        <Text style={[styles.taskTitle, item.completed && styles.taskTitleDone]} numberOfLines={1}>{item.title}</Text>
                      </View>
                      <View style={styles.metaRow}>
                        {!!item.time && (<>
                          <Ionicons name="time" size={12} color="#2f6690" />
                          <Text style={styles.metaText}>{item.time}</Text>
                        </>)}
                        {item.importance && <Text style={[styles.importanceBadge, item.importance==='high' && styles.importanceHigh, item.importance==='medium' && styles.importanceMed]}>{item.importance==='high'?'Quan trọng': item.importance==='medium'?'Trung bình':'Thấp'}</Text>}
                        {item.type === 'group' && <Text style={styles.groupBadge}>Nhóm</Text>}
                      </View>
                    </Pressable>
                  </View>
                </Swipeable>
              );
            })()}
          </Animated.View>
        )}
        ListFooterComponent={
          <View style={{ marginTop: 16 }}>
          {/* Completed tasks section (collapsible) */}
          {tasks.some(t=>t.completed) && (
            <View style={{ marginBottom:24 }}>
              <Pressable style={styles.completedToggleRow} onPress={()=> setShowCompletedCollapse(s=>!s)}>
                <Text style={styles.completedHeader}>Đã hoàn thành</Text>
                <Ionicons name={showCompletedCollapse? 'chevron-up' : 'chevron-down'} size={20} color={'#16425b'} />
              </Pressable>
              {showCompletedCollapse && (
                <View style={styles.completedScrollWrapper}>
                  <ScrollView style={styles.completedScroll} nestedScrollEnabled>
                    {tasks.filter(t=>t.completed).map(t => (
                      <View key={t.id} style={styles.completedItem}>
                        <View style={{ flex:1 }}>
                          <Text style={styles.completedTitle}>{t.title}</Text>
                          {t.completedAt && (
                            <Text style={styles.completedMeta}>Hoàn thành lúc {new Date(t.completedAt).toLocaleString('vi-VN', { hour:'2-digit', minute:'2-digit', day:'2-digit', month:'2-digit', year:'numeric' })}</Text>
                          )}
                        </View>
                        <Pressable onPress={()=>toggleTask(t.id)} style={styles.undoBtn}>
                          <Text style={styles.undoText}>↺</Text>
                        </Pressable>
                      </View>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>
          )}
          {/* Projects (show leader projects) */}
          {mockProjects.some(p=>p.role==='leader') && (
            <View style={{ marginTop: 8 }}>
              <Text style={styles.projectsTitle}>Dự án đang quản lý</Text>
              {mockProjects.filter(p=>p.role==='leader').map(p => (
                <View key={p.id} style={styles.projectCard}>
                  <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                    <Text style={styles.projectName}>{p.name}</Text>
                    <Text style={styles.leaderBadge}>Trưởng nhóm</Text>
                  </View>
                  <View style={{ flexDirection:'row', justifyContent:'space-between' }}>
                    <Text style={styles.projectMeta}>{p.members} thành viên</Text>
                    <Text style={styles.projectMeta}>{p.progress}% hoàn thành</Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Quick Actions */}
          <View style={{ marginTop: 24 }}>
            <Text style={styles.quickTitle}>Thao tác nhanh</Text>
            <View style={styles.quickGrid}>
              <QuickAction iconName='add' label='Tác vụ mới' bg='rgba(58,124,165,0.1)' color='#3a7ca5' onPress={()=> router.push('/create-task')} />
              <QuickAction iconName='people' label='Dự án' bg='rgba(129,195,215,0.15)' color='#2f6690' />
              <QuickAction iconName='flag' label={aiMode ? 'Bỏ AI' : 'AI Gợi ý'} bg='rgba(47,102,144,0.12)' color={aiMode? '#dc2626':'#2f6690'} onPress={()=> setAiMode(m=>!m)} />
              <QuickAction iconName='book' label='Ghi chú' bg='rgba(22,66,91,0.1)' color='#16425b' />
            </View>
          </View>
        </View>
      }
    />
    {/* Floating Action Button with pulse */}
  <View style={styles.fabWrapper} pointerEvents="box-none">
      {showFabMenu && <Pressable style={styles.fabBackdrop} onPress={()=> setShowFabMenu(false)} />}
      {showFabMenu && (
        <View style={styles.fabMenu}>
          <Pressable style={[styles.fabAction,{ backgroundColor:'#3a7ca5' }]} onPress={()=>{ setShowFabMenu(false); router.push('/create-task'); }}>
            <Ionicons name='add-circle-outline' size={22} color='#fff' />
            <Text style={styles.fabActionText}>Tác vụ mới</Text>
          </Pressable>
          <Pressable style={[styles.fabAction,{ backgroundColor:'#2f6690' }]} onPress={()=>{ setShowFabMenu(false); router.push('/create-event'); }}>
            <Ionicons name='calendar-outline' size={22} color='#fff' />
            <Text style={styles.fabActionText}>Sự kiện mới</Text>
          </Pressable>
          <Pressable style={[styles.fabAction,{ backgroundColor:'#16425b' }]} onPress={()=>{ setShowFabMenu(false); router.push('/create-project'); }}>
            <Ionicons name='briefcase-outline' size={22} color='#fff' />
            <Text style={styles.fabActionText}>Dự án mới</Text>
          </Pressable>
        </View>
      )}
      <Pressable style={styles.fab} onPress={()=> setShowFabMenu(o=>!o)}>
        <Ionicons name={showFabMenu? 'close':'add'} size={28} color='#fff' />
      </Pressable>
    </View>
    {/* Action Sheet Modal for edit/delete */}
    <Modal visible={showActions} transparent animationType='fade' onRequestClose={()=> setShowActions(false)}>
      <Pressable style={styles.modalBackdrop} onPress={()=> setShowActions(false)}>
        <View style={styles.actionSheet}>
          <Text style={styles.sheetTitle}>{actionTask?.title}</Text>
          <Pressable style={styles.sheetBtn} onPress={()=>{ if(actionTask) { setShowActions(false); const occ = selectedTab==='Hôm nay' ? todayISO : selectedDateISO; router.push({ pathname:'/create-task', params:{ editId: actionTask.id, occDate: occ } }); } }}>
            <Ionicons name='create-outline' size={20} color='#2f6690' />
            <Text style={styles.sheetBtnText}>Chỉnh sửa</Text>
          </Pressable>
          <Pressable style={[styles.sheetBtn, styles.deleteBtn]} onPress={()=>{ if(actionTask) handleDelete(actionTask.id); }}>
            <Ionicons name='trash-outline' size={20} color='#dc2626' />
            <Text style={[styles.sheetBtnText,{ color:'#dc2626' }]}>Xóa</Text>
          </Pressable>
          <Pressable style={styles.cancelAction} onPress={()=> setShowActions(false)}>
            <Text style={styles.cancelActionText}>Đóng</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
    {toast && (
      <View style={styles.toast} pointerEvents='box-none'>
        <Text style={styles.toastText}>{toast}</Text>
        {toast.includes('Hoàn tác?') && (
          <Pressable style={styles.undoInline} onPress={undoLastDelete}>
            <Text style={styles.undoInlineText}>Hoàn tác</Text>
          </Pressable>
        )}
      </View>
    )}
    {/* Subtasks Modal */}
    <Modal
      visible={showSubModal}
      transparent
      animationType='fade'
      onRequestClose={closeSubModal}
    >
      <Pressable style={styles.modalBackdrop} onPress={closeSubModal}>
        <View style={styles.subModalBox}>
          <Text style={styles.subModalTitle}>{subModalTask?.title}</Text>
          <ScrollView style={styles.subList} nestedScrollEnabled>
            {subModalTask?.subTasks && subModalTask.subTasks.length>0 ? (
              subModalTask.subTasks.map((st, i) => (
                <Pressable key={i} style={styles.subItem} onPress={() => subModalTask && toggleSubTask(subModalTask.id, i)}>
                  <View style={[styles.subCheck, st.completed && styles.subCheckDone]}>
                    {st.completed && <Ionicons name='checkmark' size={14} color='#fff' />}
                  </View>
                  <Text style={[styles.subItemText, st.completed && styles.subItemTextDone]} numberOfLines={2}>{st.title}</Text>
                </Pressable>
              ))
            ) : (
              <Text style={styles.emptySub}>Chưa có subtask.</Text>
            )}
          </ScrollView>
          {subModalTask && (
            <Pressable
              style={[styles.closeSubBtn,{ backgroundColor:'#2f6690', marginTop:18 }]}
              onPress={() => { closeSubModal(); const occ = selectedTab==='Hôm nay' ? todayISO : selectedDateISO; router.push({ pathname:'/create-task', params:{ editId: subModalTask.id, occDate: occ } }); }}
            >
              <Text style={styles.closeSubText}>Chỉnh sửa</Text>
            </Pressable>
          )}
          <Pressable style={styles.closeSubBtn} onPress={closeSubModal}>
            <Text style={styles.closeSubText}>Đóng</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
    </SafeAreaView>
  );
}

// Action sheet modal appended after main return earlier? (Ensure inside component before export). Adding below component export logic isn't valid. We integrate above just before closing SafeAreaView.

interface QuickActionProps { iconName: any; label: string; bg: string; color: string; onPress?: () => void; }
const QuickAction = ({ iconName, label, bg, color, onPress }: QuickActionProps) => {
  const scale = useSharedValue(1);
  const aStyle = useAnimatedStyle(()=>({ transform:[{ scale: scale.value }] }));
  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={() => { scale.value = withTiming(0.93, { duration:120 }); }}
      onPressOut={() => { scale.value = withTiming(1, { duration:160 }); }}
      style={[styles.quickBtn, { backgroundColor: bg }, aStyle]}
    >
      <Ionicons name={iconName} size={22} color={color} />
      <Text style={[styles.quickLabel,{ color, marginTop:6 }]}>{label}</Text>
    </AnimatedPressable>
  );
};


const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#3a7ca5', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  greet: { fontSize: 18, fontWeight: '600', color: '#16425b' },
  role: { fontSize: 12, color: '#2f6690', marginTop: 2 },
  targetBtn: { width: 44, height:44, borderRadius: 22, backgroundColor: '#81c3d7', justifyContent: 'center', alignItems: 'center' },
  aiTopBtn:{ flexDirection:'row', alignItems:'center', backgroundColor:'rgba(47,102,144,0.1)', paddingHorizontal:14, height:44, borderRadius:22 },
  aiTopBtnActive:{ backgroundColor:'#3a7ca5' },
  aiTopText:{ marginLeft:6, color:'#2f6690', fontWeight:'600', fontSize:13 },
  aiTopTextActive:{ color:'#fff' },
  progressCard: { backgroundColor: 'rgba(58,124,165,0.08)', borderRadius: 20, padding: 16, marginBottom: 20 },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  progressTitle: { fontSize: 14, fontWeight: '600', color: '#16425b' },
  progressCounter: { fontSize: 14, color: '#2f6690', fontWeight: '500' },
  progressBarBg: { height: 8, borderRadius: 4, backgroundColor: '#d9dcd6', overflow: 'hidden', marginBottom: 6 },
  progressBarFill: { height: 8, backgroundColor: '#3a7ca5', borderRadius: 4 },
  progressHint: { fontSize: 12, color: '#2f6690' },
  tabs: { flexDirection: 'row', backgroundColor: '#d9dcd6', borderRadius: 16, padding: 4, marginBottom: 18 },
  tabBtn: { flex:1, paddingVertical: 8, borderRadius: 12, alignItems: 'center' },
  tabBtnActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  tabText: { fontSize: 13, color: '#2f6690' },
  tabTextActive: { color: '#3a7ca5', fontWeight: '600' },
  weekRow: { flexDirection:'row', justifyContent: 'space-between', marginBottom: 20 },
  dayBtn: { width:40, height:40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  dayActive: { backgroundColor: '#3a7ca5' },
  dayText: { fontSize: 13, fontWeight: '500', color: '#16425b' },
  dayTextActive: { color: '#fff' },
  sectionHeader: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#16425b' },
  aiBadge:{ backgroundColor:'#3a7ca5', paddingHorizontal:8, paddingVertical:2, borderRadius:8 },
  aiBadgeText:{ color:'#fff', fontSize:11, fontWeight:'700', letterSpacing:0.5 },
  sectionSub: { fontSize: 12, color: '#2f6690' },
  taskCard: { flexDirection:'row', alignItems:'center', padding:14, borderRadius: 18, backgroundColor: 'rgba(217,220,214,0.3)', marginBottom: 12 },
  taskDone: { backgroundColor: 'rgba(217,220,214,0.15)', opacity: 0.75 },
  deadlineTodayCard:{ borderWidth:1, borderColor:'#6d28d9' },
  deadlineOverdueCard:{ borderWidth:1, borderColor:'#dc2626' },
  checkCircle: { width:28, height:28, borderRadius:14, borderWidth:2, borderColor:'#2f6690', alignItems:'center', justifyContent:'center', marginRight: 12 },
  checkCircleDone: { backgroundColor:'#3a7ca5', borderColor:'#3a7ca5' },
  priorityDot: { width:10, height:10, borderRadius:5, marginRight: 12 },
  taskTitle: { fontSize:15, fontWeight:'500', color:'#16425b', marginBottom:4 },
  taskTitleDone: { textDecorationLine:'line-through', color:'#2f6690' },
  metaRow: { flexDirection:'row', alignItems:'center', gap:6 },
  metaText: { fontSize:12, color:'#2f6690', marginLeft:4, marginRight:8 },
  groupBadge: { fontSize:11, backgroundColor:'#81c3d7', color:'#fff', paddingHorizontal:8, paddingVertical:2, borderRadius:12 },
  importanceBadge:{ fontSize:11, backgroundColor:'rgba(58,124,165,0.15)', color:'#2f6690', paddingHorizontal:8, paddingVertical:2, borderRadius:12, marginRight:8 },
  importanceHigh:{ backgroundColor:'#ef4444', color:'#fff' },
  importanceMed:{ backgroundColor:'#f59e0b', color:'#fff' },
  subProgressWrap:{ marginTop:6, flexDirection:'row', alignItems:'center', gap:8 },
  subProgressBarBg:{ flex:1, height:6, borderRadius:3, backgroundColor:'rgba(0,0,0,0.08)', overflow:'hidden' },
  subProgressBarFill:{ height:6, backgroundColor:'#3a7ca5' },
  subProgressText:{ fontSize:10, color:'#2f6690', fontWeight:'600', width:42, textAlign:'right' },
  projectsTitle: { fontSize:16, fontWeight:'600', color:'#16425b', marginBottom:12 },
  projectCard: { backgroundColor:'rgba(58,124,165,0.08)', borderRadius:18, padding:14, marginBottom:12 },
  projectName: { fontSize:14, fontWeight:'600', color:'#16425b' },
  leaderBadge: { fontSize:10, backgroundColor:'#3a7ca5', color:'#fff', paddingHorizontal:8, paddingVertical:3, borderRadius:12 },
  projectMeta: { fontSize:12, color:'#2f6690' },
  quickTitle: { fontSize:16, fontWeight:'600', color:'#16425b', marginBottom:14 },
  quickGrid: { flexDirection:'row', flexWrap:'wrap', justifyContent:'space-between' },
  quickBtn: { width:'48%', borderRadius:18, paddingVertical:18, alignItems:'center', marginBottom:12 },
  quickLabel: { fontSize:12, fontWeight:'500', color:'#3a7ca5' },
  fabWrapper:{ position:'absolute', bottom:0, right:0, left:0, top:0, zIndex:50 },
  fabMenu:{ position:'absolute', bottom:110, right:24, alignItems:'flex-end', gap:14 },
  fabAction:{ flexDirection:'row', alignItems:'center', paddingHorizontal:14, paddingVertical:10, borderRadius:18, gap:8, shadowColor:'#000', shadowOpacity:0.18, shadowRadius:6, elevation:4 },
  fabActionText:{ color:'#fff', fontWeight:'600', fontSize:13 },
  fab: { position:'absolute', bottom:28, right:24, width:64, height:64, borderRadius:32, backgroundColor:'#3a7ca5', alignItems:'center', justifyContent:'center', shadowColor:'#000', shadowOpacity:0.2, shadowRadius:6, elevation:6 },
  modalBackdrop:{ flex:1, backgroundColor:'rgba(0,0,0,0.28)', justifyContent:'flex-end' },
  actionSheet:{ backgroundColor:'#fff', padding:20, borderTopLeftRadius:28, borderTopRightRadius:28 },
  sheetTitle:{ fontSize:15, fontWeight:'600', color:'#16425b', marginBottom:10 },
  sheetBtn:{ flexDirection:'row', alignItems:'center', paddingVertical:12, gap:10 },
  deleteBtn:{ },
  sheetBtnText:{ fontSize:14, fontWeight:'500', color:'#16425b' },
  cancelAction:{ marginTop:8, backgroundColor:'#f1f5f9', paddingVertical:12, borderRadius:14, alignItems:'center' },
  cancelActionText:{ color:'#2f6690', fontWeight:'600' },
  completedHeader:{ fontSize:16, fontWeight:'600', color:'#16425b', marginBottom:12 },
  completedItem:{ flexDirection:'row', alignItems:'center', backgroundColor:'rgba(217,220,214,0.22)', padding:12, borderRadius:16, marginBottom:10 },
  completedTitle:{ fontSize:14, fontWeight:'500', color:'#16425b' },
  completedMeta:{ fontSize:11, color:'#2f6690', marginTop:2 },
  undoBtn:{ width:34, height:34, borderRadius:17, backgroundColor:'#3a7ca5', alignItems:'center', justifyContent:'center', marginLeft:12 },
  undoText:{ color:'#fff', fontSize:16, fontWeight:'600' },
  toast:{ position:'absolute', bottom:110, alignSelf:'center', backgroundColor:'#16425b', paddingHorizontal:20, paddingVertical:12, borderRadius:24, shadowColor:'#000', shadowOpacity:0.2, shadowRadius:6 },
  toastText:{ color:'#fff', fontWeight:'500', fontSize:13 },
  undoInline:{ marginLeft:12, paddingHorizontal:10, paddingVertical:6, backgroundColor:'#3a7ca5', borderRadius:16 },
  undoInlineText:{ color:'#fff', fontSize:12, fontWeight:'600' },
  subModalBox:{ backgroundColor:'#fff', margin:20, borderRadius:24, padding:20 },
  subModalTitle:{ fontSize:16, fontWeight:'600', color:'#16425b', marginBottom:12 },
  subList:{ maxHeight:300 },
  subItem:{ flexDirection:'row', alignItems:'center', paddingVertical:10 },
  subCheck:{ width:24, height:24, borderRadius:12, borderWidth:2, borderColor:'#3a7ca5', marginRight:12, alignItems:'center', justifyContent:'center' },
  subCheckDone:{ backgroundColor:'#3a7ca5', borderColor:'#3a7ca5' },
  subItemText:{ fontSize:14, color:'#16425b', flex:1 },
  subItemTextDone:{ textDecorationLine:'line-through', color:'#2f6690' },
  emptySub:{ fontSize:12, color:'#2f6690', paddingVertical:8 },
  closeSubBtn:{ marginTop:12, backgroundColor:'#3a7ca5', paddingVertical:12, borderRadius:16, alignItems:'center' },
  closeSubText:{ color:'#fff', fontWeight:'600' },
  // Extend styles for calendar & dots
  monthHeader: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:8 },
  monthTitle: { fontSize:16, fontWeight:'600', color:'#16425b' },
  monthNav: { padding:6, borderRadius:10, backgroundColor:'#d9dcd6' },
  weekLabels: { flexDirection:'row', justifyContent:'space-between', marginBottom:4 },
  weekLabel: { width:40, textAlign:'center', fontSize:11, fontWeight:'600', color:'#2f6690' },
  monthRow: { flexDirection:'row', justifyContent:'space-between', marginBottom:6 },
  monthCell: { width:40, height:46, borderRadius:12, backgroundColor:'rgba(217,220,214,0.35)', alignItems:'center', justifyContent:'center', position:'relative' },
  monthCellActive: { backgroundColor:'#3a7ca5' },
  monthCellText: { fontSize:13, fontWeight:'500', color:'#16425b' },
  monthCellTextActive: { color:'#fff' },
  monthCellEmpty: { width:40, height:46 },
  dotSmallWrapper: { position:'absolute', bottom:4 },
  dotSmall: { width:6, height:6, borderRadius:3, backgroundColor:'#3a7ca5' },
  dotSmallActive: { backgroundColor:'#fff' },
  dotBase:{ position:'absolute', bottom:4, width:8, height:8, borderRadius:4 },
  dotActiveOutline:{ borderWidth:1, borderColor:'#fff' },
  dotSmallBase:{ width:6, height:6, borderRadius:3 },
  dotSmallOutline:{ borderWidth:1, borderColor:'#fff' },
  // remove old dot styles kept for backward compatibility
  // dot and dotActive no longer used by new logic
  completedToggleRow:{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:12 },
  completedScrollWrapper:{ maxHeight:200, borderRadius:16, overflow:'hidden' },
  completedScroll:{ },
  fabBackdrop:{ position:'absolute', top:0, left:0, right:0, bottom:0, backgroundColor:'rgba(0,0,0,0.25)' },
  swipeDeleteBtn:{ width:72, justifyContent:'center', alignItems:'center', backgroundColor:'#dc2626', marginBottom:12, borderTopRightRadius:18, borderBottomRightRadius:18 },
  // Week event/task section
  weekDayCard:{ backgroundColor:'#fff', borderRadius:16, padding:12, marginBottom:10, shadowColor:'#000', shadowOpacity:0.04, shadowRadius:6, elevation:1 },
  weekDayHeader:{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:8 },
  weekDayTitle:{ color:'#16425b', fontWeight:'700' },
  weekDayCount:{ color:'#607d8b', fontSize:12 },
  countsRow:{ flexDirection:'row', alignItems:'center', gap:6 },
  countPill:{ flexDirection:'row', alignItems:'center', gap:4, paddingHorizontal:8, paddingVertical:2, borderRadius:999 },
  eventsCountPill:{ backgroundColor:'rgba(129,195,215,0.18)' },
  tasksCountPill:{ backgroundColor:'rgba(217,220,214,0.6)' },
  countText:{ fontSize:12, fontWeight:'700' },
  eventsCountText:{ color:'#2f6690' },
  tasksCountText:{ color:'#16425b' },
  eventList:{ gap:8 },
  eventChip:{ backgroundColor:'rgba(58,124,165,0.06)', borderRadius:12, padding:10, flexDirection:'row' },
  eventChipTime:{ color:'#2f6690', fontSize:12, fontWeight:'600', marginBottom:2 },
  eventChipTitle:{ color:'#16425b', fontWeight:'600' },
  eventChipLoc:{ color:'#607d8b', fontSize:12 },
  dayTaskChips:{ flexDirection:'row', flexWrap:'wrap', gap:8, marginTop:10 },
  taskChip:{ flexDirection:'row', alignItems:'center', gap:6, backgroundColor:'rgba(217,220,214,0.5)', paddingHorizontal:10, paddingVertical:6, borderRadius:12 },
  taskChipDot:{ width:8, height:8, borderRadius:4 },
  taskChipText:{ color:'#16425b', maxWidth:220 },
  taskChipTime:{ marginLeft:6, color:'#607d8b', fontSize:12 },
  emptyHint:{ color:'#94a3b8', fontSize:12, marginTop:4 },
  // Enhancements for week card visuals
  weekDayCardToday:{ borderWidth:1, borderColor:'#2f6690' },
  todayPill:{ flexDirection:'row', alignItems:'center', backgroundColor:'#3a7ca5', borderColor:'#81c3d7', borderWidth:1, paddingHorizontal:10, paddingVertical:4, borderRadius:999, shadowColor:'#000', shadowOpacity:0.08, shadowRadius:4, elevation:2 },
  todayPillText:{ color:'#fff', fontSize:12, fontWeight:'700' },
  eventColorBar:{ width:4, alignSelf:'stretch', backgroundColor:'#3a7ca5', borderRadius:2, marginRight:8 },
  eventMetaRow:{ flexDirection:'row', alignItems:'center', gap:6, marginBottom:2 },
  allDayPill:{ backgroundColor:'#e0f2fe', borderColor:'#38bdf8', borderWidth:1, paddingHorizontal:8, paddingVertical:2, borderRadius:8 },
  allDayPillText:{ color:'#0369a1', fontSize:12, fontWeight:'600' },
});
