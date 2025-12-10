import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, DeviceEventEmitter, Modal, Alert, ScrollView, TextInput, Platform, Dimensions } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Notifications from 'expo-notifications';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { Swipeable } from 'react-native-gesture-handler';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { mockProjects, calculateProgress, Task, getDaysOfWeek, getCurrentWeek, priorityColor, getPriorityLabel } from '@/utils/dashboard'; // mockProjects kept temporary fallback
import { aiOrderedTasks } from '@/utils/aiTaskSort';
import axios from 'axios';
import { Ionicons } from '@expo/vector-icons';
import io from 'socket.io-client';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing, FadeInDown, FadeOutUp, Layout, withRepeat, withSequence, interpolate } from 'react-native-reanimated';
import ProjectInsights from '@/components/ProjectInsights';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'expo-router';
import { useNotifications, type NotificationItem as NotiItemCtx } from '@/contexts/NotificationContext';
import Constants from 'expo-constants';
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
  const insets = useSafeAreaInsets();
  // NEW: date filtering enhancement plan
  // We'll introduce selectedDateISO, and dynamic generators for week and month views.
  const { user, token, shouldSimulatePush, pushToken } = useAuth();
  const router = useRouter();
  // Use a safe initial today ISO for early state initializers
  const initialTodayISO = toLocalISODate(new Date());
  const [tasks, setTasks] = useState<Task[]>([]);
  type RepeatRule = { frequency: 'daily' | 'weekly' | 'monthly' | 'yearly'; endMode?: 'never' | 'onDate' | 'after'; endDate?: string; count?: number };
  type EventItem = { id:string; title:string; date:string; endDate?:string; startTime?:string; endTime?:string; location?:string; repeat?: RepeatRule; projectId?: string; notes?: string };
  const [events, setEvents] = useState<EventItem[]>([]);
  const matchesQueryTask = (t: Task) => {
    const q = searchQuery.trim().toLowerCase();
    if(!q) return true;
    return (
      (t.title||'').toLowerCase().includes(q) ||
      (t as any).description?.toLowerCase?.().includes(q)
    );
  };
  const matchesQueryEvent = (e: EventItem) => {
    const q = searchQuery.trim().toLowerCase();
    if(!q) return true;
    return (
      (e.title||'').toLowerCase().includes(q) ||
      (e.location||'').toLowerCase().includes(q) ||
      (e.notes||'').toLowerCase().includes(q)
    );
  };
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
  // Projects (real backend)
  const [projects, setProjects] = useState<any[]>([]);
  const [showProjectsModal, setShowProjectsModal] = useState(false);
  // Control modal animation to avoid flicker when navigating to create screens
  const [projectModalAnim, setProjectModalAnim] = useState<'none'|'fade'|'slide'>('fade');
  const [activeProject, setActiveProject] = useState<any|null>(null);
  // Đã bỏ phần mời thành viên trực tiếp trong chi tiết dự án; dùng trang quản lý thành viên
  const [deletingProject, setDeletingProject] = useState(false);
  const [acceptingInvite, setAcceptingInvite] = useState<string | null>(null);
  // Edit project info states
  const [editingProject, setEditingProject] = useState(false);
  const [projName, setProjName] = useState('');
  const [projDescr, setProjDescr] = useState('');
  const [projStart, setProjStart] = useState('');
  const [projDue, setProjDue] = useState('');
  const [savingProject, setSavingProject] = useState(false);
  const menuAnim = useSharedValue(0); // 0 closed, 1 open
  // Slide animation for project full-screen view
  const screenW = Dimensions.get('window').width;
  const projectSlide = useSharedValue(1); // 1: off-screen right, 0: on-screen
  const projectSlideStyle = useAnimatedStyle(() => ({ transform:[{ translateX: projectSlide.value * screenW }] }));
  useEffect(() => {
    if (activeProject) {
      // reset to off-screen and slide in
      projectSlide.value = 1;
      projectSlide.value = withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) });
    }
  }, [activeProject?._id]);
  const closeProjectFull = () => {
    // slide out then dismiss, avoid modal fade showing underlying sheet
    projectSlide.value = withTiming(1, { duration: 240, easing: Easing.in(Easing.cubic) });
    setTimeout(() => {
      setProjectModalAnim('none');
      setShowProjectsModal(false);
      // clear active after modal hidden to prevent a flash of the sheet
      setTimeout(() => setActiveProject(null), 0);
    }, 240);
  };
  const [socket, setSocket] = useState<any | null>(null); // using any to bypass type mismatch; can refine with proper Socket type
  const [projectSelectedTab, setProjectSelectedTab] = useState<'Hôm nay' | 'Tuần' | 'Tháng'>('Hôm nay');
  // Project-scoped calendar anchor (do not affect global)
  const [projSelectedDateISO, setProjSelectedDateISO] = useState<string>(initialTodayISO);
  // Inline compute project week to avoid hoisting issues
  const projWeekISO = useMemo(()=>{
    const anchor = new Date(projSelectedDateISO + 'T00:00:00');
    const day = anchor.getDay(); // 0 Sun
    const mondayOffset = (day === 0 ? -6 : 1 - day);
    const start = new Date(anchor);
    start.setDate(anchor.getDate() + mondayOffset);
    const arr: string[] = [];
    for(let i=0;i<7;i++){
      const d = new Date(start);
      d.setDate(start.getDate()+i);
      arr.push(toLocalISODate(d));
    }
    return arr;
  }, [projSelectedDateISO]);
  const [projMonthDate, setProjMonthDate] = useState<Date>(new Date());
  const projMonthTitle = useMemo(()=>{
    const m = projMonthDate.getMonth()+1; const y = projMonthDate.getFullYear();
    return `${m.toString().padStart(2,'0')}/${y}`;
  }, [projMonthDate]);
  const projPrevWeek = () => setProjSelectedDateISO(prev => addDaysISO(prev, -7));
  const projNextWeek = () => setProjSelectedDateISO(prev => addDaysISO(prev, 7));
  const projPrevMonth = () => setProjMonthDate(d => new Date(d.getFullYear(), d.getMonth()-1, 1));
  const projNextMonth = () => setProjMonthDate(d => new Date(d.getFullYear(), d.getMonth()+1, 1));
  const projMonthDays = useMemo(()=>{
    const first = new Date(projMonthDate.getFullYear(), projMonthDate.getMonth(), 1);
    const last = new Date(projMonthDate.getFullYear(), projMonthDate.getMonth()+1, 0);
    const startOffset = (first.getDay()+6)%7; // Mon=0
    const total = startOffset + last.getDate();
    const rows = Math.ceil(total/7);
    const days: string[] = [];
    for(let r=0;r<rows;r++){
      for(let c=0;c<7;c++){
        const idx = r*7 + c - startOffset + 1;
        if(idx>=1 && idx<=last.getDate()){
          const iso = `${projMonthDate.getFullYear()}-${String(projMonthDate.getMonth()+1).padStart(2,'0')}-${String(idx).padStart(2,'0')}`;
          days.push(iso);
        } else {
          days.push('');
        }
      }
    }
    return days;
  }, [projMonthDate]);
  const [celebrateId, setCelebrateId] = useState<string|null>(null);
  // Notifications (global)
  const { addNotification, addMany, upsertById, unreadCount, removeById } = useNotifications() as any;
  // Show a one-time summary notification right after login
  const loginSummaryShownRef = React.useRef<string | null>(null);
  const lastSummaryAtRef = React.useRef<number | null>(null);
  const upcomingSkippedOnceRef = React.useRef<boolean>(false);
  // Track timing to avoid double notifications with the upcoming builder

  // Local push simulator for Expo Go: show lock-screen-like notifications for key events
  const lastNotiRef = React.useRef<Record<string, number>>({});
  const isExpoGo = Constants.appOwnership === 'expo';
  const ensurePermission = async () => {
    try {
      const st = await Notifications.getPermissionsAsync();
      if (!st.granted) {
        const req = await Notifications.requestPermissionsAsync();
        if (!req.granted) return false;
      }
      return true;
    } catch { return false; }
  };
  const localNotify = async (title: string, body?: string, data?: any, throttleKey?: string) => {
    if (Platform.OS === 'web') return; // skip web
    // Only simulate when explicitly allowed by auth context (no valid remote push token)
    if (!shouldSimulatePush) return;
    const now = Date.now();
    const key = throttleKey || `${title}|${body||''}`;
    const last = lastNotiRef.current[key] || 0;
    if (now - last < 6000) return; // throttle
    try {
      await Notifications.scheduleNotificationAsync({
        content: { title, body: body || '', sound: 'default', data },
        trigger: null
      });
      lastNotiRef.current[key] = now;
    } catch {}
  };

  // Immediate local OS notification (bypass simulate flag) as a fallback for critical notices
  const fireLocalImmediate = async (title: string, body?: string, data?: any) => {
    if (Platform.OS === 'web') return;
    try {
      const st = await Notifications.getPermissionsAsync();
      if (!st.granted) {
        const req = await Notifications.requestPermissionsAsync();
        if (!req.granted) return;
      }
      await Notifications.scheduleNotificationAsync({
        content: { title, body: body || '', sound: 'default', data },
        trigger: null
      });
    } catch {}
  };

  // Auto-dismiss toast
  useEffect(()=>{
    if(!toast) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  // Deleted tasks cache and timers for undo
  const pendingDeletes = React.useRef<{[k:string]:ReturnType<typeof setTimeout>}>({});
  const cacheDeleted = React.useRef<Record<string, Task>>({});

  function performDelete(id: string) {
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
  }

  const handleDelete = (id:string) => {
    setShowActions(false);
    Alert.alert('Xác nhận','Bạn chắc chắn muốn xóa tác vụ này?',[
      { text:'Hủy', style:'cancel' },
      { text:'Xóa', style:'destructive', onPress:()=> performDelete(id) }
    ]);
  };

  const undoLastDelete = () => {
    const ids = Object.keys(cacheDeleted.current);
    if(!ids.length) return;
    const lastId = ids[ids.length-1];
    const task = cacheDeleted.current[lastId];
    if(pendingDeletes.current[lastId]){ clearTimeout(pendingDeletes.current[lastId]); delete pendingDeletes.current[lastId]; }
    delete cacheDeleted.current[lastId];
    setTasks(prev => [task, ...prev]);
    setToast('Đã hoàn tác');
  };

  // Enhanced task chip for project mini-dashboard (shows richer metadata than global small chip)
  // Fields: importance color dot, title, time range or 'Cả ngày', importance badge, progress %, due badge if soon or multi-day.
  const EnhancedProjectTaskChip = ({ t, occDate, onPress }: { t: Task; occDate: string; onPress?: () => void }) => {
    const dueSoonDays = (() => {
      if(!t.endDate) return null;
      const today = toLocalISODate(new Date());
      if(t.status==='completed') return null;
      const diff = diffDays(today, t.endDate);
      if(diff < 0) return null; // past
      if(diff <= 7) return diff; // within a week
      return null;
    })();
    const timeText = (t.startTime && t.endTime) ? `${t.startTime}-${t.endTime}` : (t.startTime ? t.startTime : (t.time || ''));
    const isAllDay = !timeText;
    const hasSubs = (t.subTasks||[]).length>0;
    const progressPct = hasSubs ? (t.completionPercent||0) : null;
    // Overdue label: show hours if <24h, days if >=24h since endDate/endTime passed
    const overdueLabel = (() => {
      if(!t.endDate) return null;
      if(t.completed) return null;
      let endTime = t.endTime || (t.time && t.time.includes('-') ? t.time.split('-')[1] : undefined);
      if(!endTime && t.startTime && !t.endDate) endTime = t.startTime; // fallback (single time?)
      const deadline = endTime ? new Date(`${t.endDate}T${endTime}:00`) : new Date(`${t.endDate}T23:59:59`);
      const now = new Date();
      if(now <= deadline) return null;
      const diffMs = now.getTime() - deadline.getTime();
      const diffHours = diffMs / 3600000;
      if(diffHours < 24) return `Quá hạn: ${Math.floor(diffHours)}h`;
      return `Quá hạn: ${Math.floor(diffHours/24)} ngày`;
    })();
    return (
      <Pressable onPress={onPress} style={[styles.taskChipEnhanced, t.completed && { opacity:0.55 }]}>        
        <View style={[styles.taskChipDot,{ backgroundColor: t.importance==='high'? '#dc2626' : t.importance==='medium'? '#f59e0b':'#3a7ca5' }]} />
        <View style={{ flex:1 }}>
          <Text style={[styles.taskChipEnhancedTitle, t.completed && styles.taskTitleDone]} numberOfLines={2}>{t.title}</Text>
          <View style={{ flexDirection:'row', alignItems:'center', flexWrap:'wrap', gap:6, marginTop:4 }}>
            {overdueLabel && (
              <View style={styles.overduePill}><Text style={styles.overduePillText}>{overdueLabel}</Text></View>
            )}
            {timeText ? (
              <View style={styles.metaSmallRow}>
                <Ionicons name='time-outline' size={11} color='#2f6690' />
                <Text style={styles.taskChipEnhancedMeta}>{timeText}</Text>
              </View>
            ) : (
              <View style={styles.metaSmallRow}><Ionicons name='sunny-outline' size={11} color='#2f6690' /><Text style={styles.taskChipEnhancedMeta}>Cả ngày</Text></View>
            )}
            {t.importance && (
              <Text style={[styles.importanceBadge, t.importance==='high' && styles.importanceHigh, t.importance==='medium' && styles.importanceMed]}>{t.importance==='high'?'Quan trọng': t.importance==='medium'?'Trung bình':'Thấp'}</Text>
            )}
            {progressPct !== null && (
              <View style={styles.metaSmallRow}>
                <Ionicons name='list-outline' size={11} color='#2f6690' />
                <Text style={styles.taskChipEnhancedMeta}>{progressPct}%</Text>
              </View>
            )}
            {dueSoonDays !== null && (
              !overdueLabel && <View style={styles.dueSoonPill}><Text style={styles.dueSoonPillText}>{dueSoonDays===0? 'Hôm nay' : `Còn ${dueSoonDays}d`}</Text></View>
            )}
            {t.endDate && t.date && t.endDate !== t.date && (
              <View style={styles.metaSmallRow}>
                <Ionicons name='calendar-outline' size={11} color='#607d8b' />
                <Text style={styles.taskChipEnhancedMeta}>{fmtDM(t.date!)}–{fmtDM(t.endDate!)}</Text>
              </View>
            )}
          </View>
        </View>
        <Pressable onPress={()=> toggleTask(t.id)} hitSlop={6} style={[styles.checkCircleSmall, t.completed && styles.checkCircleSmallDone]}>
          {t.completed && <Ionicons name='checkmark' size={12} color='#fff' />}
        </Pressable>
      </Pressable>
    );
  };
  const [selectedTab, setSelectedTab] = useState<'Hôm nay' | 'Tuần' | 'Tháng'>('Hôm nay');
  // Today view: no all-day toggle (per updated requirement)
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

  // Search & filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  // Weekday filter: 1=Mon..7=Sun (null=all)
  const [filterWeekday, setFilterWeekday] = useState<number | null>(null);
  const [filterFromISO, setFilterFromISO] = useState<string | null>(null);
  const [filterToISO, setFilterToISO] = useState<string | null>(null);
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);
  const [fromDraft, setFromDraft] = useState<Date | null>(null);
  const [toDraft, setToDraft] = useState<Date | null>(null);
  const dayNumFromISO = (iso:string) => {
    if(!iso) return 0;
    const [y,m,d] = iso.split('-').map(Number);
    const dt = new Date(y, (m||1)-1, d||1);
    const js = dt.getDay(); // 0 Sun..6 Sat
    return js === 0 ? 7 : js; // Sun -> 7
  };
  const isISOInRange = (iso:string) => {
    if(!iso) return false;
    if(filterFromISO && iso < filterFromISO) return false;
    if(filterToISO && iso > filterToISO) return false;
    return true;
  };
  const fmtDM = (iso?: string | null) => {
    if(!iso) return '';
    const [y,m,d] = iso.split('-');
    return `${d}/${m}`;
  };

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

  // Local notification scheduler for Expo Go fallback (lock-screen alerts without remote push)
  const scheduleLocalTaskNotifications = async (list: Task[]) => {
    // Only schedule local notifications if we are simulating push
    if (!shouldSimulatePush) return;
    if (typeof Notifications?.setNotificationChannelAsync === 'function' && Platform.OS === 'android') {
      try { await Notifications.setNotificationChannelAsync('default', { name: 'default', importance: Notifications.AndroidImportance.MAX }); } catch {}
    }
    // Cancel previous schedules from this screen (simple approach: cancel all)
    try { await Notifications.cancelAllScheduledNotificationsAsync(); } catch {}
    const now = new Date();
    const todayISO = toLocalISODate(now);
    const toDate = (iso:string, hm?:string) => {
      const [y,m,d] = iso.split('-').map(n=>parseInt(n,10));
      const [hh,mm] = (hm||'09:00').split(':').map(n=>parseInt(n,10));
      return new Date(y, (m||1)-1, d||1, hh||9, mm||0, 0);
    };
    const todays = list.filter(t => !t.completed && occursTaskOnDate(t, todayISO));
    for(const t of todays){
      // pick the earliest available time to schedule; fall back to 09:00 if none
      const hm = t.startTime || (t.time && t.time.includes('-') ? t.time.split('-')[0] : undefined) || '09:00';
      const when = toDate(todayISO, hm);
      if(when.getTime() <= Date.now()) continue; // don't schedule past events
      try{
        await Notifications.scheduleNotificationAsync({
          content: { title: 'Tác vụ hôm nay', body: t.title, sound: 'default', data: { id: t.id, type:'local-task' } },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when }
        });
      }catch{}
    }
  };

  // If simulation gets disabled (e.g., after registering a remote push token), cancel any previously scheduled local notifications
  useEffect(() => {
    if (!shouldSimulatePush && Platform.OS !== 'web') {
      try { Notifications.cancelAllScheduledNotificationsAsync(); } catch {}
    }
  }, [shouldSimulatePush]);

  // Determine if the OCCURRENCE of a task (considering repeat and multi-day span) ends exactly on iso
  const occurrenceEndsOn = (t: Task, iso: string): boolean => {
    // span in days for each occurrence (>=1)
    const span = t.endDate ? (diffDays(t.date, t.endDate) + 1) : 1;
    const occEndFromStart = (occStart: string) => {
      if (span <= 1) return occStart; // single-day occurrence
      return addDaysISO(occStart, span - 1);
    };
    // Non-repeating: ends on iso if either single day equals date, or endDate equals iso
    if (!t.repeat) {
      if (span <= 1) return t.date === iso;
      return t.endDate === iso;
    }
    const r = t.repeat;
    const start = t.date;
    if (iso < start) return false;
    const endMode = r?.endMode || 'never';

    // Daily recurrence
    if (r?.frequency === 'daily') {
      const k = diffDays(start, iso);
      if (k < 0) return false;
      const occStart = addDaysISO(start, k);
      const n = k + 1;
      if (endMode === 'after' && r.count && n > r.count) return false;
      if (endMode === 'onDate' && r.endDate && occStart > r.endDate) return false;
      return occEndFromStart(occStart) === iso;
    }
    // Weekly recurrence (every 7 days from start)
    if (r?.frequency === 'weekly') {
      const k = Math.floor(diffDays(start, iso) / 7);
      if (k < 0) return false;
      const occStart = addDaysISO(start, k * 7);
      if (occStart > iso) return false;
      const n = k + 1;
      if (endMode === 'after' && r.count && n > r.count) return false;
      if (endMode === 'onDate' && r.endDate && occStart > r.endDate) return false;
      return occEndFromStart(occStart) === iso;
    }
    // Monthly recurrence (same day-of-month when valid)
    if (r?.frequency === 'monthly') {
      const m = diffMonths(start, iso);
      if (m < 0) return false;
      const occStart = addMonthsISO(start, m);
      if (!occStart || occStart > iso) return false;
      const n = m + 1;
      if (endMode === 'after' && r.count && n > r.count) return false;
      if (endMode === 'onDate' && r.endDate && occStart > r.endDate) return false;
      return occEndFromStart(occStart) === iso;
    }
    // Yearly recurrence (same month/day when valid)
    if (r?.frequency === 'yearly') {
      const a = isoToDate(start), b = isoToDate(iso);
      const years = b.getFullYear() - a.getFullYear();
      if (years < 0) return false;
      const occStart = toLocalISODate(new Date(a.getFullYear() + years, a.getMonth(), a.getDate()));
      if (occStart > iso) return false;
      const n = years + 1;
      if (endMode === 'after' && r.count && n > r.count) return false;
      if (endMode === 'onDate' && r.endDate && occStart > r.endDate) return false;
      return occEndFromStart(occStart) === iso;
    }
    return false;
  };

  // Filter tasks based on tab + selected date (include recurring)
  const [aiOrdering, setAiOrdering] = React.useState<string[] | null>(null);
  const [aiLoading, setAiLoading] = React.useState(false);
  const filteredTasks = React.useMemo(()=>{
    const today = todayISO;
    const applySort = (list:Task[]) => {
      if(aiMode && aiOrdering && aiOrdering.length){
        const byId: Record<string, Task> = Object.fromEntries(list.map(t=> [t.id, t]));
        const ord = aiOrdering.filter(id=> byId[id]).map(id=> byId[id]);
        const remainder = list.filter(t=> !aiOrdering.includes(t.id));
        return [...ord, ...aiOrderedTasks(remainder, today)]; // put AI first, fill rest by heuristic
      }
      return aiMode ? aiOrderedTasks(list, today) : list;
    };
    if(selectedTab === 'Hôm nay'){
      const getDeadline = (t:Task) => {
        const dueIso = t.endDate || t.date; if(!dueIso) return null;
        const endTime = t.endTime || (t.time && t.time.includes('-') ? t.time.split('-')[1] : undefined);
        return endTime ? new Date(`${dueIso}T${endTime}:00`) : new Date(`${dueIso}T23:59:59`);
      };
      const baseAll = tasks.filter(t => !t.completed && occursTaskOnDate(t, today));
      const overdue = tasks.filter(t => {
        if(t.completed) return false; const dl = getDeadline(t); if(!dl) return false; return Date.now() > dl.getTime();
      });
      // Merge overdue tasks even if recurrence occurrence ended before now
      const merged = [...new Set([...baseAll, ...overdue])];
      const nowHM = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
      const notEnded = merged.filter(t => {
        const et = t.endTime || (t.time && t.time.includes('-') ? t.time.split('-')[1] : undefined);
        if(!et) return true;
        const dueIso = t.endDate || t.date;
        if(!dueIso) return true;
        if(dueIso === today) return et > nowHM || overdue.includes(t); // keep overdue regardless of time
        if(today < dueIso) return true;
        return overdue.includes(t); // if overdue allow it
      });
      const inRange = isISOInRange(today);
      const base = notEnded.filter(t => inRange && matchesQueryTask(t));
      return applySort(base);
    }
    if(selectedTab === 'Tuần'){
      const inRange = isISOInRange(selectedDateISO);
      const weekdayOk = !filterWeekday || dayNumFromISO(selectedDateISO)===filterWeekday;
      const base = tasks.filter(t=> !t.completed && occursTaskOnDate(t, selectedDateISO) && inRange && weekdayOk && matchesQueryTask(t));
      return applySort(base);
    }
    if(selectedTab === 'Tháng'){
      const inRange = isISOInRange(selectedDateISO);
      const weekdayOk = !filterWeekday || dayNumFromISO(selectedDateISO)===filterWeekday;
      const base = tasks.filter(t=> !t.completed && occursTaskOnDate(t, selectedDateISO) && inRange && weekdayOk && matchesQueryTask(t));
      return applySort(base);
    }
    const base = tasks.filter(t=>!t.completed && matchesQueryTask(t));
    return applySort(base);
  }, [tasks, selectedTab, selectedDateISO, weekISO, currentMonth, aiMode, searchQuery, filterFromISO, filterToISO]);

  // Call backend AI when toggled on or when tasks change significantly
  useEffect(()=>{
    (async()=>{
      if(!aiMode){ setAiOrdering(null); return; }
      if(!token) return;
      try{
        setAiLoading(true);
        const body = { tasks: tasks.map(t => ({ id: t.id, title: t.title, importance: t.importance, priority: t.priority, urgency: (t as any).urgency, date: t.date, endDate: t.endDate, estimatedHours: (t as any).estimatedHours })) };
        const res = await axios.post(`${API_BASE}/api/tasks/ai-sort`, body, { headers:{ Authorization:`Bearer ${token}` } });
        if(Array.isArray(res.data?.ordered)) setAiOrdering(res.data.ordered);
      }catch(_){ setAiOrdering(null); }
      finally{ setAiLoading(false); }
    })();
  }, [aiMode, tasks.length]);

  // Completed tasks (still show below) - you could scope per view if wanted
  const completedTasks = React.useMemo(()=> tasks.filter(t=> t.completed), [tasks]);

  // Handlers
  const selectDay = (iso:string) => { if(!iso) return; setSelectedDateISO(iso); if(selectedTab==='Hôm nay') {/* no-op */} };
  const goPrevMonth = () => { const d = new Date(currentMonth); d.setMonth(d.getMonth()-1); setCurrentMonth(d); };
  const goNextMonth = () => { const d = new Date(currentMonth); d.setMonth(d.getMonth()+1); setCurrentMonth(d); };
  // Week navigation: shift anchor date by 7 days
  const goPrevWeek = () => { setSelectedDateISO(prev => addDaysISO(prev, -7)); };
  const goNextWeek = () => { setSelectedDateISO(prev => addDaysISO(prev, 7)); };
  const goThisWeek = () => { setSelectedDateISO(todayISO); };

  const toggleTask = (id: string) => {
    const nowISO = new Date().toISOString();
    const before = tasks.find(t=> t.id===id);
    const willCompleteFlag = before ? !before.completed : false;
    setTasks(prev => prev.map(t => {
      if(t.id !== id) return t;
      const willComplete = !t.completed;
      return { ...t, completed: willComplete, status: willComplete? 'completed':'todo', completedAt: willComplete? nowISO: undefined };
    }));
    if(willCompleteFlag){
      setCelebrateId(id);
      setTimeout(()=> setCelebrateId(null), 1200);
    }
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
      const params: any = {};
      if(searchQuery.trim()) params.q = searchQuery.trim();
      if(filterFromISO) params.from = filterFromISO;
      if(filterToISO) params.to = filterToISO;
      const res = await axios.get(`${API_BASE}/api/tasks`, { params, headers: { Authorization: token ? `Bearer ${token}` : '' } });
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
        projectId: t.projectId,
  } as any));
  setTasks(mapped);
  // Schedule local notifications for today's tasks (Expo Go fallback)
  try { if(Platform.OS !== 'web'){ await scheduleLocalTaskNotifications(mapped); } } catch(_){}
    } catch(e:any){
      setError(e?.response?.data?.message || 'Không tải được tasks');
    } finally { setLoading(false); }
  };

  useEffect(()=>{ fetchTasks(); },[token]);
  // Refetch on search/range change (lightweight debounce)
  useEffect(()=>{
    if(!token) return;
    const id = setTimeout(()=> { fetchTasks(); fetchEvents(); }, 250);
    return () => clearTimeout(id);
  }, [searchQuery, filterFromISO, filterToISO]);

  // After tasks are loaded post-login, notify how many tasks remain today
  useEffect(() => {
    if(!token) return;
    if(loading) return; // wait until initial fetch completes
    if(loginSummaryShownRef.current === token) return; // only once per login session
    const countToday = tasks.filter(t => !t.completed && occursTaskOnDate(t as any, todayISO)).length;
    const title = countToday > 0
      ? `Hôm nay còn ${countToday} tác vụ`
      : 'Hôm nay bạn đã hoàn thành hết các tác vụ, hãy lên kế hoạch cho ngày mai nhé';
    const now = Date.now();
  upsertById?.({ id:`login-summary-${todayISO}`, type:'upcoming-task', title, at: now } as NotiItemCtx);
    loginSummaryShownRef.current = token;
    lastSummaryAtRef.current = now;
    // reset skip flag so the next upcoming-notifications pass will skip once
    upcomingSkippedOnceRef.current = false;
    // Tránh double OS notification khi đăng nhập:
    // - Nếu đã có pushToken (sẽ nhận thông báo từ backend), không gửi OS notification từ client.
    // - Nếu không có pushToken và đang giả lập (Expo Go), chỉ khi đó mới gửi local notification.
    (async () => {
      try {
        if (!pushToken && shouldSimulatePush) {
          await fireLocalImmediate('Tác vụ hôm nay', countToday > 0 ? `${countToday} tác vụ còn lại` : 'Không còn tác vụ nào', { type: 'today-summary', count: countToday });
        }
      } catch(_) { /* ignore */ }
    })();
  }, [token, loading, tasks]);
  // Fetch projects
  const fetchProjects = async () => {
    if(!token) return;
    try {
      const res = await axios.get(`${API_BASE}/api/projects`, { headers:{ Authorization:`Bearer ${token}` } });
      setProjects(res.data || []);
    } catch(e){ /* silent */ }
  };
  const fetchProjectDetail = async (id:string) => {
    if(!token) return;
    try{
      const res = await axios.get(`${API_BASE}/api/projects/${id}`, { headers:{ Authorization:`Bearer ${token}` } });
      const proj = res.data;
      setProjects(prev => prev.map(p=> p._id===proj._id? proj : p));
      setActiveProject(proj);
      // Prefill edit fields in DD/MM/YYYY for better UX
      const toDDMMYYYY = (iso?: string) => {
        if(!iso) return '';
        const [y,m,d] = String(iso).split('-');
        if(!y||!m||!d) return '';
        return `${d}/${m}/${y}`;
      };
      setProjStart(toDDMMYYYY((proj as any).startDate));
      setProjDue(toDDMMYYYY((proj as any).dueDate));
    }catch(e){ /* silent */ }
  };
  useEffect(()=>{ fetchProjects(); },[token]);
  // Reset modal animation to fade when opening the list sheet (avoid overriding 'none' for direct detail open)
  useEffect(()=>{ if(showProjectsModal && !activeProject) setProjectModalAnim('fade'); },[showProjectsModal, activeProject]);
  // Quick lookup: projectId -> name
  const projectNameById = React.useMemo(() => {
    const m: Record<string,string> = {};
    (projects||[]).forEach(p => { if(p && p._id) m[p._id] = p.name; });
    return m;
  }, [projects]);
  useEffect(()=> {
    const sub = DeviceEventEmitter.addListener('projectsUpdated', () => { fetchProjects(); });
    return () => sub.remove();
  }, [token]);
  // Helper: open project detail without flashing the list
  const openProjectDirect = (p: any) => {
    if(!p) return;
    setProjectModalAnim('none');
    setActiveProject(p);
    // ensure first render sees activeProject truthy
    requestAnimationFrame(() => {
      setShowProjectsModal(true);
      fetchProjectDetail(p._id);
    });
  };

  // Allow returning from members screen to open project detail directly
  useEffect(()=> {
    const sub = DeviceEventEmitter.addListener('openProjectDetail', (payload:any) => {
      const pid = payload?.id || payload;
      if(!pid) return;
      const existing = projects.find(p=> p._id===pid) || { _id: pid, name: 'Dự án' } as any;
      openProjectDirect(existing);
    });
    return () => sub.remove();
  }, [projects]);

  // Realtime socket connection
  useEffect(()=>{
    if(!token) return; // wait for auth
    const API_BASE = process.env.EXPO_PUBLIC_API_BASE || '';
    const endpoint = API_BASE.replace(/\/api$/,'');
  const s = io(endpoint, { auth:{ token }, transports:['websocket'] });
    setSocket(s as any);
    s.on('connect', () => {
      // join all project rooms user has
      projects.forEach(p => s.emit('joinProject', p._id));
    });
    s.on('project:updated', (payload:any) => {
      setProjects(prev => prev.map(p=> p._id===payload.projectId ? (payload.project ? payload.project : { ...p, invites: payload.invites ?? p.invites }) : p));
      if(activeProject && activeProject._id===payload.projectId){
        setActiveProject((p:any)=> payload.project ? payload.project : (p? { ...p, invites: payload.invites ?? p.invites } : p));
      }
      // Do not add generic project update notifications to reduce noise
    });
    s.on('project:invited', (payload:any) => {
      const myEmail = (user as any)?.email?.toLowerCase?.();
      const isMe = myEmail && myEmail === payload.email;
      if(isMe){
        fetchProjects();
        // Stable id per project invite to avoid duplicates when reinvited
        upsertById({ id: `pinv_${payload.projectId}`, type:'project-invite', title:`Lời mời tham gia dự án`, meta: payload.email, at: Date.now(), projectId: payload.projectId } as NotiItemCtx);
        // Local simulate invite for Expo Go
        localNotify('Lời mời tham gia dự án', 'Bạn được mời tham gia một dự án mới', { type:'project-invite', projectId: payload.projectId }, `pinv_${payload.projectId}`);
      }
      // Do not notify others (including sender) to reduce noise and avoid duplicates
    });
    // When the inviter revokes, remove the invite for that email and drop the notification
    s.on('project:inviteRevoked', (payload:any) => {
      const myEmail = (user as any)?.email?.toLowerCase?.();
      if(myEmail && myEmail === payload.email){
        setProjects(prev => prev.map(p => p._id===payload.projectId ? { ...p, invites: (p.invites||[]).filter((i:any)=> i.email!==myEmail) } : p));
        removeById?.(`pinv_${payload.projectId}`);
      }
    });
    // Inform admins when an invite is declined
    s.on('project:inviteDeclined', (payload:any) => {
      const pid = payload?.projectId;
      if(!pid) return;
      const proj = projects.find(p=> p._id===pid);
      const userId = (user as any)?._id || (user as any)?.id;
      const isAdmin = proj && (proj.owner === userId || (proj.members||[]).some((m:any)=> m.user===userId && m.role==='admin'));
      if(isAdmin){
        const title = 'Lời mời bị từ chối';
        upsertById({ id:`pdecl_${pid}_${payload.email}`, type:'project-update', title, meta: payload.email, at: Date.now(), projectId: pid } as NotiItemCtx);
        localNotify(title, `${payload.email} đã từ chối`, { type:'project-invite-declined', projectId: pid }, `pdecl_${pid}_${payload.email}`);
      }
    });
    s.on('project:memberJoined', (payload:any) => {
      setProjects(prev => prev.map(p=> p._id===payload.projectId ? { ...p, members: payload.project.members, invites: payload.project.invites } : p));
      if(activeProject && activeProject._id===payload.projectId){
        setActiveProject(payload.project);
      }
      // Notify admins/owner that a member joined
      const pid = payload?.projectId;
      const proj = projects.find(p=> p._id===pid);
      const userId = (user as any)?._id || (user as any)?.id;
      const isAdmin = proj && (proj.owner === userId || (proj.members||[]).some((m:any)=> m.user===userId && m.role==='admin'));
      if(isAdmin){
        const title = 'Thành viên đã tham gia dự án';
        upsertById({ id:`pjoin_${pid}_${payload.memberId}`, type:'project-update', title, at: Date.now(), projectId: pid } as NotiItemCtx);
        localNotify(title, 'Một thành viên vừa tham gia', { type:'project-member-joined', projectId: pid, memberId: payload.memberId }, `pjoin_${pid}_${payload.memberId}`);
      }
    });
    // Do not generate client-side in-app notifications for invite accepted/declined
    // to avoid duplication with remote push. UI updates rely on project:updated/memberJoined.
    s.on('project:deleted', (payload:any) => {
      setProjects(prev => prev.filter(p=> p._id!==payload.projectId));
      if(activeProject && activeProject._id===payload.projectId){
        setActiveProject(null); setShowProjectsModal(false);
      }
    });
    // If current user is removed from a project, inform and clean up UI
    s.on('project:memberRemoved', (payload:any) => {
      const myId = String((user as any)?._id || (user as any)?.id || '');
      if(String(payload?.userId||'') !== myId) return;
      const pid = payload?.projectId;
      if(!pid) return;
      upsertById({ id:`prem_${pid}_${myId}`, type:'project-update', title:'Bạn đã bị xóa khỏi dự án', at: Date.now(), projectId: pid } as NotiItemCtx);
      localNotify('Bạn đã bị xóa khỏi dự án', '', { type:'project-removed', projectId: pid }, `prem_${pid}_${myId}`);
      setProjects(prev => prev.filter(p=> p._id !== pid));
      if(activeProject && activeProject._id===pid){ setActiveProject(null); setShowProjectsModal(false); }
    });
    // If someone leaves the project, inform admins/owner
    s.on('project:memberLeft', (payload:any) => {
      const pid = payload?.projectId;
      if(!pid) return;
      // update project members list if provided
      if(payload?.project){
        setProjects(prev => prev.map(p=> p._id===pid ? payload.project : p));
        if(activeProject && activeProject._id===pid){ setActiveProject(payload.project); }
      }
      const proj = projects.find(p=> p._id===pid);
      const userId = (user as any)?._id || (user as any)?.id;
      const isAdmin = proj && (proj.owner === userId || (proj.members||[]).some((m:any)=> m.user===userId && m.role==='admin'));
      if(isAdmin){
        const title = 'Thành viên đã rời dự án';
        upsertById({ id:`pleft_${pid}_${payload.userId}`, type:'project-update', title, at: Date.now(), projectId: pid } as NotiItemCtx);
        localNotify(title, 'Một thành viên vừa rời dự án', { type:'project-member-left', projectId: pid, userId: payload.userId }, `pleft_${pid}_${payload.userId}`);
      }
    });
    // Task notifications in project rooms
    s.on('task:created', (t:any) => {
      if(!t) return;
      const mine = String((user as any)?.id || (user as any)?._id || '') === String(t.assignedTo || '');
      const meta = t.startTime && t.date ? `${t.startTime} • ${t.date}` : (t.date||'');
      if(mine){
        addNotification({ id:`tcrt_${t._id||Date.now()}`, type:'task-assigned', title:`Bạn được giao: ${t.title}`, meta, at: Date.now(), projectId: String(t.projectId||''), taskId: String(t._id||'') } as NotiItemCtx);
      }
      // Local simulate when it's assigned to me
      if(mine){
        localNotify('Bạn được giao tác vụ', t.title, { type:'task-assigned', id: String(t._id||'') }, `tcrt_${t._id||''}`);
      }
    });
    s.on('task:updated', (t:any) => {
      if(!t) return;
      const meta = t.status ? `Trạng thái: ${t.status}` : undefined;
      const myId = String((user as any)?.id || (user as any)?._id || '');
      if(myId && String(t.assignedTo||'') === myId){
        addNotification({ id:`tupd_${t._id||Date.now()}`, type:'task-updated', title:`Cập nhật tác vụ: ${t.title}`, meta, at: Date.now(), projectId: String(t.projectId||''), taskId: String(t._id||'') } as NotiItemCtx);
        // Local simulate update only for assignee
        localNotify('Cập nhật tác vụ', t.title, { type:'task-updated', id: String(t._id||'') }, `tupd_${t._id||''}`);
      }
    });
    s.on('task:deleted', (p:any) => {
      addNotification({ id:`tdel_${Date.now()}`, type:'task-updated', title:`Đã xóa một tác vụ`, at: Date.now(), projectId: String(p?.projectId||'') } as NotiItemCtx);
      // No local notify for deletions to reduce noise
    });
    return () => { s.disconnect(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // When projects list changes after socket connect, (re)join rooms
  useEffect(()=>{
    if(socket){
      projects.forEach(p => socket.emit('joinProject', p._id));
    }
  },[projects, socket]);
  // Listen for new project creation
  useEffect(()=>{
    const sub = DeviceEventEmitter.addListener('projectCreated', (p:any)=>{
      setProjects(prev => [p, ...prev]);
    });
    return () => sub.remove();
  },[]);

  // Fetch events from API
  const fetchEvents = async () => {
    if(!token) return;
    try {
      const params: any = {};
      if(searchQuery.trim()) params.q = searchQuery.trim();
      if(filterFromISO) params.from = filterFromISO;
      if(filterToISO) params.to = filterToISO;
      const res = await axios.get(`${API_BASE}/api/events`, { params, headers: { Authorization: token ? `Bearer ${token}` : '' } });
      const mapped: EventItem[] = res.data.map((e:any)=>({
        id: e._id,
        title: e.title,
        date: e.date?.split('T')[0] || e.date,
        endDate: e.endDate,
        startTime: e.startTime,
        endTime: e.endTime,
        location: e.location,
        repeat: e.repeat,
        projectId: e.projectId,
        notes: e.notes
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
        // ensure project scoping is carried over for immediate UI
        projectId: (ev as any).projectId,
        notes: (ev as any).notes,
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
        projectId: (ev as any).projectId,
        notes: (ev as any).notes,
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
        // @ts-ignore add projectId for project badge lookup
        projectId: (newTask as any).projectId,
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
        // @ts-ignore add projectId for project badge lookup
        projectId: (uTask as any).projectId,
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

  // Remaining tasks modal
  const [showRemainingModal, setShowRemainingModal] = useState(false);
  const uncompletedTasksAll = React.useMemo(()=> tasks.filter(t=> !t.completed), [tasks]);
  const closeRemainingModal = () => setShowRemainingModal(false);

  // FAB pulse
  const fabScale = useSharedValue(1);
  useEffect(() => {
    fabScale.value = withRepeat(withSequence(
      withTiming(1.06, { duration: 900 }),
      withTiming(1.0, { duration: 900 })
    ), -1, false);
  }, []);
  const fabStyle = useAnimatedStyle(()=>({ transform:[{ scale: fabScale.value }] }));

  // Build upcoming notifications from local data (tasks/events)
  const upcomingLastRunAtRef = React.useRef<number | null>(null);
  useEffect(()=>{
    // If we just posted login summary, skip this first upcoming batch to avoid two notifications at once
    if (loginSummaryShownRef.current === token && !upcomingSkippedOnceRef.current) {
      upcomingSkippedOnceRef.current = true;
      return;
    }
    // Additionally, suppress upcoming notifications within 60s after summary to avoid clutter on login
    if (lastSummaryAtRef.current && Date.now() - lastSummaryAtRef.current < 60000) {
      return;
    }
    // Cooldown upcoming generator itself to at most once per 60s
    if (upcomingLastRunAtRef.current && Date.now() - upcomingLastRunAtRef.current < 60000) {
      return;
    }
    // today upcoming in next 2 hours
    const nowD = new Date();
    const cutoff = new Date(nowD.getTime() + 2*60*60*1000);
    const nlist: NotiItemCtx[] = [];
    const toHM = (h:number,m:number)=> `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    const nowHM = toHM(nowD.getHours(), nowD.getMinutes());
    // tasks occurring today with startTime after now
    tasks.forEach(t => {
      if(!t.date) return;
      if(t.completed) return;
      if(t.date === toLocalISODate(nowD) && t.startTime && t.startTime > nowHM){
        nlist.push({ id:`up_t_${t.id}`, type:'upcoming-task', title:`Sắp tới: ${t.title}`, meta: t.startTime, at: Date.now(), projectId: (t as any).projectId } as NotiItemCtx);
      }
    });
    // events starting today after now
    events.forEach(e => {
      if(e.date === toLocalISODate(nowD) && e.startTime && e.startTime > nowHM){
        nlist.push({ id:`up_e_${e.id}`, type:'upcoming-event', title:`Lịch sắp diễn ra: ${e.title}`, meta: e.startTime, at: Date.now() } as NotiItemCtx);
      }
    });
    if(nlist.length){
      // De-dupe: upsert by id so repeated runs don't create duplicates
      nlist.forEach(n => upsertById?.(n));
    }
    upcomingLastRunAtRef.current = Date.now();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks.length, events.length]);

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

  // Optimize ordering using deterministic Eisenhower matrix (no AI)
  const onOptimizePress = async () => {
    try{
      setAiLoading(true);
      // Consider today's, overdue, and due-soon tasks as candidates
      const nowD = new Date();
      const todayIso = toLocalISODate(nowD);
      const getDeadline = (t: Task) => {
        const dueIso = t.endDate || t.date;
        if(!dueIso) return null;
        const endTime = t.endTime || (t.time && t.time.includes('-') ? t.time.split('-')[1] : undefined);
        return endTime ? new Date(`${dueIso}T${endTime}:00`) : new Date(`${dueIso}T23:59:59`);
      };
      const occToday = tasks.filter(t => !t.completed && occursTaskOnDate(t, todayIso));
      const overdue = tasks.filter(t => {
        if(t.completed) return false; const dl = getDeadline(t); if(!dl) return false; return nowD.getTime() > dl.getTime();
      });
      const dueSoon = tasks.filter(t => {
        if(t.completed) return false; const dl = getDeadline(t); if(!dl) return false; if(nowD.getTime() > dl.getTime()) return false; const iso = t.endDate || t.date; if(!iso) return false; const d = diffDays(todayIso, iso); return d>=0 && d<=7;
      });
      const byId: Record<string, Task> = {};
      [...occToday, ...overdue, ...dueSoon].forEach(t => { byId[t.id] = t; });
      const candidates = Object.values(byId);
      // Use local matrix-based sorter
  // Import sorter lazily to avoid circular deps; type-safe mapping
  const { aiOrderedTasks } = await import('@/utils/aiTaskSort');
  const ordered = aiOrderedTasks(candidates, todayIso).map((t: Task) => t.id);
      setAiOrdering(ordered);
      setToast('Đã sắp xếp theo ma trận');
    } catch(e){
      setAiOrdering(null);
      setToast('Không thể sắp xếp');
    } finally { setAiLoading(false); }
  };

  // Remove animation helpers for debug simple menu
  // const menuAnim = useSharedValue(0);
  // useEffect(()=>{ menuAnim.value = withTiming(showFabMenu?1:0,{ duration:280 }); },[showFabMenu]);
  // const fabRotateStyle = useAnimatedStyle(()=> ({ transform:[{ rotate: `${interpolate(menuAnim.value,[0,1],[0,45])}deg` }] }));
  // const buildItemStyle = (i:number)=> useAnimatedStyle(()=>({ opacity: menuAnim.value }));
  // const action1Style = buildItemStyle(0); const action2Style = buildItemStyle(1); const action3Style = buildItemStyle(2);
  // const menuStyle = useAnimatedStyle(()=> ({ opacity: menuAnim.value }));

  const bottomPad = showFabMenu ? 260 : 140;

  const userEmailLower = (user as any)?.email?.toLowerCase?.() || '';
  const pendingInviteProjects = projects.filter(p => (p.invites||[]).some((inv:any)=> inv.email===userEmailLower && inv.status==='pending'));

  const acceptInvite = async (projectId:string) => {
    if(!token) return;
    const proj = projects.find(p=> p._id===projectId);
    if(!proj) return;
    const myInvite = (proj.invites||[]).find((inv:any)=> inv.email===userEmailLower && inv.status==='pending');
    if(!myInvite) return;
    try {
      setAcceptingInvite(projectId);
      const res = await axios.post(`${API_BASE}/api/projects/${projectId}/accept`, { token: myInvite.token }, { headers:{ Authorization:`Bearer ${token}` } });
      const updated = res.data.project;
      setProjects(prev => prev.map(p=> p._id===projectId ? updated : p));
      if(activeProject && activeProject._id===projectId){ setActiveProject(updated); }
      // join realtime room immediately
      if(socket){ socket.emit('joinProject', projectId); }
      DeviceEventEmitter.emit('projectsUpdated');
      setToast('Đã tham gia dự án');
      // Remove invite notification
      removeById?.(`pinv_${projectId}`);
    } catch(e:any){
      Alert.alert('Lỗi', e?.response?.data?.message || 'Không thể tham gia');
    } finally { setAcceptingInvite(null); }
  };

  const declineInvite = async (projectId:string) => {
    if(!token) return;
    const proj = projects.find(p=> p._id===projectId);
    if(!proj) return;
    const myInvite = (proj.invites||[]).find((inv:any)=> inv.email===userEmailLower && inv.status==='pending');
    if(!myInvite) return;
    try{
      setAcceptingInvite(projectId);
      const res = await axios.post(`${API_BASE}/api/projects/${projectId}/decline`, { token: myInvite.token }, { headers:{ Authorization:`Bearer ${token}` } });
      const updated = res.data.project;
      setProjects(prev => prev.map(p=> p._id===projectId ? updated : p));
      if(activeProject && activeProject._id===projectId){ setActiveProject(updated); }
      removeById?.(`pinv_${projectId}`);
      setToast('Đã từ chối lời mời');
    }catch(e:any){
      Alert.alert('Lỗi', e?.response?.data?.message || 'Không thể từ chối');
    } finally { setAcceptingInvite(null); }
  };

  const leaveProject = async () => {
    if(!activeProject || !token) return;
    Alert.alert('Rời dự án','Bạn chắc chắn muốn rời dự án này?',[
      { text:'Hủy', style:'cancel' },
      { text:'Rời', style:'destructive', onPress: async ()=>{
        try{
          await axios.post(`${API_BASE}/api/projects/${activeProject._id}/leave`, {}, { headers:{ Authorization:`Bearer ${token}` } });
          // Sau khi xác nhận rời dự án mới xóa khỏi danh sách
          setProjects(prev => prev.filter(p=> p._id!==activeProject._id));
          setActiveProject(null);
          setShowProjectsModal(false);
          // Đồng bộ lại danh sách từ server để chắc chắn không còn dự án vừa rời
          fetchProjects();
          DeviceEventEmitter.emit('projectsUpdated');
          setToast('Đã rời dự án');
        }catch(e:any){
          Alert.alert('Lỗi', e?.response?.data?.message || 'Không thể rời dự án');
        }
      } }
    ]);
  };

  // INSIGHTS POPUP STATE
  type InsightsPopupKind = 'overdue' | 'upcomingEvents' | 'remaining' | 'completed' | 'dueSoon3' | 'dueSoon7' | null;
  const [insightsPopup, setInsightsPopup] = useState<InsightsPopupKind>(null);
  const closeInsightsPopup = () => setInsightsPopup(null);
  // Derive project-scoped tasks & events for insights
  const activeProjectTasks = useMemo(()=> activeProject ? tasks.filter(t=> (t as any).projectId === activeProject._id) : [], [activeProject, tasks]);
  const activeProjectEvents = useMemo(()=> activeProject ? events.filter(e=> e.projectId === activeProject._id) : [], [activeProject, events]);
  const nowISO = toLocalISODate(new Date());
  const projectOverdueTasks = useMemo(()=> activeProjectTasks.filter(t=> {
    if(t.completed) return false;
    const dueIso = t.endDate || t.date; if(!dueIso) return false;
    let endTime = t.endTime || (t.time && t.time.includes('-') ? t.time.split('-')[1] : undefined);
    const deadline = endTime ? new Date(`${dueIso}T${endTime}:00`) : new Date(`${dueIso}T23:59:59`);
    return Date.now() > deadline.getTime();
  }), [activeProjectTasks]);
  const projectUpcomingEvents = useMemo(()=> activeProjectEvents.filter(ev => {
    // upcoming next 14 days
    if(!ev.date) return false;
    const occDates: string[] = [];
    // Expand simple repeat occurrences window (naive: iterate next 30 days)
    const horizon = 14;
    for(let i=0;i<=horizon;i++){
      const iso = addDaysISO(nowISO, i);
      if(occursOnDate(ev as any, iso)) occDates.push(iso);
    }
    return occDates.length>0;
  }), [activeProjectEvents]);
  // Remaining now includes ALL not completed (including overdue) so the KPI card matches popup list expectation
  const projectRemainingTasks = useMemo(()=> activeProjectTasks.filter(t=> !t.completed), [activeProjectTasks]);
  const projectCompletedTasks = useMemo(()=> activeProjectTasks.filter(t=> t.completed), [activeProjectTasks]);
  // Due soon (3 days and 7 days) using endDate to match ProjectInsights counts; exclude overdue and completed
  const projectDueSoon3Tasks = useMemo(()=> activeProjectTasks.filter(t=> {
    if(t.completed) return false;
    const dueIso = (t as any).endDate; if(!dueIso) return false;
    // not overdue
    let endTime = (t as any).endTime || ((t as any).time && (t as any).time.includes('-') ? (t as any).time.split('-')[1] : undefined);
    const deadline = endTime ? new Date(`${dueIso}T${endTime}:00`) : new Date(`${dueIso}T23:59:59`);
    if(Date.now() > deadline.getTime()) return false;
    const d = diffDays(nowISO, dueIso);
    return d >= 0 && d <= 3;
  }), [activeProjectTasks, nowISO]);
  const projectDueSoon7Tasks = useMemo(()=> activeProjectTasks.filter(t=> {
    if(t.completed) return false;
    const dueIso = (t as any).endDate; if(!dueIso) return false;
    let endTime = (t as any).endTime || ((t as any).time && (t as any).time.includes('-') ? (t as any).time.split('-')[1] : undefined);
    const deadline = endTime ? new Date(`${dueIso}T${endTime}:00`) : new Date(`${dueIso}T23:59:59`);
    if(Date.now() > deadline.getTime()) return false;
    const d = diffDays(nowISO, dueIso);
    return d >= 0 && d <= 7;
  }), [activeProjectTasks, nowISO]);

  // Callback handlers passed into ProjectInsights (will open popup lists)
  const handleOverduePress = () => setInsightsPopup('overdue');
  const handleUpcomingEventsPress = () => setInsightsPopup('upcomingEvents');
  const handleRemainingPress = () => setInsightsPopup('remaining');
  const handleCompletedPress = () => setInsightsPopup('completed');
  const handleDueSoon3Press = () => setInsightsPopup('dueSoon3');
  const handleDueSoon7Press = () => setInsightsPopup('dueSoon7');

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
              <View style={{ flexDirection:'row', alignItems:'center', gap:10 }}>
                <Pressable onPress={()=> router.push('/notifications')} style={styles.notifBtn}>
                  <Ionicons name='notifications-outline' size={18} color='#2f6690' />
                  {unreadCount>0 && <View style={styles.notifDot}><Text style={styles.notifDotText}>{Math.min(unreadCount,9)}</Text></View>}
                </Pressable>
              </View>
            </View>

            {/* Top search now navigates to full-screen search */}
            <Pressable onPress={()=> router.push('/search')} style={[styles.searchRow,{ marginBottom:14 }]}
            >
              <Ionicons name='search' size={16} color='#607d8b' />
              <Text style={[styles.searchInput,{ color:'#94a3b8' }]}>Tìm kiếm tác vụ, lịch...</Text>
            </Pressable>

            <Pressable style={styles.progressCard} onPress={()=> setShowRemainingModal(true)}>
              <View style={styles.progressRow}>
                <Text style={styles.progressTitle}>Tiến độ hôm nay</Text>
                <Text style={styles.progressCounter}>{completed}/{total}</Text>
              </View>
              <View style={styles.progressBarBg}>
                <Animated.View style={[styles.progressBarFill, progressStyle]} />
              </View>
              <Text style={styles.progressHint}>
                {completed === total && total > 0 ? '🎉 Hoàn thành tất cả!' : `Còn ${total - completed} tác vụ`}
              </Text>
            </Pressable>

            {pendingInviteProjects.length > 0 && (
              <View style={styles.inviteBanner}>
                <Text style={styles.inviteBannerTitle}>Lời mời dự án</Text>
                {pendingInviteProjects.map(p => {
                  const myInv = (p.invites||[]).find((inv:any)=> inv.email===userEmailLower && inv.status==='pending');
                  return (
                    <View key={p._id} style={styles.inviteBannerRow}>
                      <View style={{ flex:1 }}>
                        <Text style={styles.inviteBannerName}>{p.name}</Text>
                        <Text style={styles.inviteBannerMeta}>Bạn được mời tham gia</Text>
                      </View>
                      <View style={{ flexDirection:'row', gap:8 }}>
                        <Pressable disabled={acceptingInvite===p._id} onPress={()=> declineInvite(p._id)} style={[styles.inviteDeclineBtn, acceptingInvite===p._id && { opacity:0.5 }]}>
                          <Ionicons name='close-circle-outline' size={16} color='#fff' />
                          <Text style={styles.inviteAcceptText}>{acceptingInvite===p._id? '...' : 'Từ chối'}</Text>
                        </Pressable>
                        <Pressable disabled={acceptingInvite===p._id} onPress={()=> acceptInvite(p._id)} style={[styles.inviteAcceptBtn, acceptingInvite===p._id && { opacity:0.5 }]}>
                          <Ionicons name='checkmark-circle-outline' size={16} color='#fff' />
                          <Text style={styles.inviteAcceptText}>{acceptingInvite===p._id? '...' : 'Tham gia'}</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            <View style={styles.tabs}>
              {(['Hôm nay','Tuần','Tháng'] as const).map(tab => (
                <Pressable key={tab} onPress={() => setSelectedTab(tab)} style={[styles.tabBtn, selectedTab === tab && styles.tabBtnActive]}>
                  <Text style={[styles.tabText, selectedTab === tab && styles.tabTextActive]}>{tab}</Text>
                </Pressable>
              ))}
            </View>
            {/* moved search+filters into dedicated screen; dashboard remains clean */}
            {/* Dynamic date pickers */}
            {selectedTab === 'Hôm nay' && (
              <View style={{ marginBottom:16 }}> 
                {/* bỏ chú thích header theo yêu cầu */}
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
                    .filter(ev => matchesQueryEvent(ev) && (!filterWeekday || dayNumFromISO(todayISO)===filterWeekday) && isISOInRange(todayISO))
                    .sort((a,b) => (a.startTime||'99:99').localeCompare(b.startTime||'99:99'));
                  // Build overdue and due-today task groups
                  const getDeadline = (t: Task): Date | null => {
                    const dueIso = t.endDate || t.date;
                    if(!dueIso) return null;
                    const endTime = t.endTime || (t.time && t.time.includes('-') ? t.time.split('-')[1] : undefined);
                    return endTime ? new Date(`${dueIso}T${endTime}:00`) : new Date(`${dueIso}T23:59:59`);
                  };
                  const todaysTasksAll = tasks.filter(t => !t.completed && matchesQueryTask(t));
                  const overdueTasks = todaysTasksAll.filter(t => {
                    const dl = getDeadline(t); if(!dl) return false; return new Date() > dl;
                  }).sort((a,b)=>{
                    const da = getDeadline(a)!.getTime();
                    const db = getDeadline(b)!.getTime();
                    return da - db; // older first
                  });
                  const dueTodayTasks = todaysTasksAll.filter(t => {
                    const dl = getDeadline(t); if(!dl) return false;
                    const dlIso = toLocalISODate(dl);
                    if(dlIso !== todayISO) return false;
                    return new Date() <= dl; // not yet overdue today
                  }).sort((a,b)=>{
                    const da = getDeadline(a)!.getTime();
                    const db = getDeadline(b)!.getTime();
                    return da - db;
                  });
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
                          <View style={[styles.countPill, styles.tasksCountPill]}>
                            <Ionicons name='checkmark-done-outline' size={12} color='#16425b' />
                            <Text style={[styles.countText, styles.tasksCountText]}>{overdueTasks.length + dueTodayTasks.length}</Text>
                          </View>
                        </View>
                      </View>
                      {/* All-day toggle removed by request */}
                      {todaysEvents.length>0 ? (
                        <View style={styles.eventList}>
                          {todaysEvents.map((ev, idx) => {
                            const time = ev.startTime && (ev.endTime ? `${ev.startTime}–${ev.endTime}` : ev.startTime);
                            return (
                              <Pressable key={ev.id+idx} style={styles.eventChip} onPress={()=> router.push({ pathname:'/create-calendar', params:{ editId: ev.id, occDate: todayISO } })}>
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
                                  {ev.projectId && (
                                    <View style={styles.eventMetaRow}>
                                      <Ionicons name='briefcase-outline' size={14} color='#2f6690' />
                                      <Text style={styles.groupBadge}>{projectNameById[ev.projectId] || 'Dự án'}</Text>
                                    </View>
                                  )}
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
                        <Text style={styles.emptyHint}>Không có lịch còn lại trong hôm nay</Text>
                      )}
                      {/* Overdue & due today merged into main task list now */}
                    </Animated.View>
                  );
                })()}
              </View>
            )}
            {/* Ẩn hàng ô số (ngày) ở chế độ tuần để tập trung phần thẻ bên dưới */}
            {selectedTab === 'Tuần' && (
              <View style={{ marginTop: 8 }}>
                {/* Week navigation header */}
                <View style={styles.monthHeader}>
                  <Pressable onPress={goPrevWeek} style={styles.monthNav}><Ionicons name='chevron-back' size={18} color='#16425b' /></Pressable>
                  {(() => {
                    const start = weekISO[0];
                    const end = weekISO[6];
                    const fmt = (iso:string) => { const [y,m,d]=iso.split('-'); return `${d}/${m}/${y}`; };
                    return <Text style={styles.monthTitle}>Tuần {fmt(start)} – {fmt(end)}</Text>;
                  })()}
                  <Pressable onPress={goNextWeek} style={styles.monthNav}><Ionicons name='chevron-forward' size={18} color='#16425b' /></Pressable>
                </View>
                <View style={{ alignItems:'center', marginBottom:6 }}>
                  <Pressable onPress={goThisWeek} style={{ paddingHorizontal:10, paddingVertical:6, borderRadius:12, backgroundColor:'rgba(58,124,165,0.1)' }}>
                    <Text style={{ color:'#2f6690', fontWeight:'600', fontSize:12 }}>Về tuần hiện tại</Text>
                  </Pressable>
                </View>
                {weekISO.map((iso, i) => {
                  const [y,m,d] = iso.split('-');
                  const display = `${d}/${m}`;
                  const w = weekdayVNFromISO(iso);
                  const dayEvents = events.filter(ev => occursOnDate(ev, iso) && matchesQueryEvent(ev) && (!filterWeekday || dayNumFromISO(iso)===filterWeekday) && isISOInRange(iso));
                  const dayTasks = tasks.filter(t => !t.completed && occursTaskOnDate(t, iso) && matchesQueryTask(t) && (!filterWeekday || dayNumFromISO(iso)===filterWeekday) && isISOInRange(iso));
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
                              <Pressable key={ev.id+idx} style={styles.eventChip} onPress={()=> router.push({ pathname:'/create-calendar', params:{ editId: ev.id, occDate: iso } })}>
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
                                  {ev.projectId && (
                                    <View style={styles.eventMetaRow}>
                                      <Ionicons name='briefcase-outline' size={14} color='#2f6690' />
                                      <Text style={styles.groupBadge}>{projectNameById[ev.projectId] || 'Dự án'}</Text>
                                    </View>
                                  )}
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
                        <Text style={styles.emptyHint}>Không có lịch</Text>
                      )}
                      {dayTasks.length>0 ? (
                        <View style={styles.dayTaskChips}>
                          {dayTasks.map((t, idx) => {
                            const timeText = (t.startTime && t.endTime) ? `${t.startTime}-${t.endTime}` : (t.time || '');
                            return (
                              <Pressable key={t.id+idx} style={styles.taskChip} onPress={()=> router.push({ pathname:'/create-task', params:{ editId: t.id, occDate: iso } })}>
                                <View style={[styles.taskChipDot,{ backgroundColor: t.importance==='high'? '#dc2626' : t.importance==='medium'? '#f59e0b':'#3a7ca5' }]} />
                                <Text style={styles.taskChipText} numberOfLines={1}>{t.title}</Text>
                                {!!timeText && <Text style={styles.taskChipTime}>{timeText}</Text>}
                                {(t as any).projectId && (
                                  <Text style={[styles.groupBadge, { marginLeft:6 }]} numberOfLines={1}>{projectNameById[(t as any).projectId] || 'Dự án'}</Text>
                                )}
                              </Pressable>
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
                      // Build dot info: show dot only if at least one occurrence ends on this day (supports repeats)
                      const occTasks = tasks.filter(t => occurrenceEndsOn(t, iso));
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
                      const dayEvents = events.filter(ev => occursOnDate(ev, iso) && matchesQueryEvent(ev) && (!filterWeekday || dayNumFromISO(iso)===filterWeekday) && isISOInRange(iso));
                      const dayTasks = tasks.filter(t => !t.completed && occursTaskOnDate(t, iso) && matchesQueryTask(t) && (!filterWeekday || dayNumFromISO(iso)===filterWeekday) && isISOInRange(iso));
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
                                <Pressable key={ev.id+idx} style={styles.eventChip} onPress={()=> router.push({ pathname:'/create-calendar', params:{ editId: ev.id, occDate: iso } })}>
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
                                    {ev.projectId && (
                                      <View style={styles.eventMetaRow}>
                                        <Ionicons name='briefcase-outline' size={14} color='#2f6690' />
                                        <Text style={styles.groupBadge}>{projectNameById[ev.projectId] || 'Dự án'}</Text>
                                      </View>
                                    )}
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
                          <Text style={styles.emptyHint}>Không có lịch</Text>
                        )}
                        {dayTasks.length>0 ? (
                          <View style={styles.dayTaskChips}>
                            {dayTasks.map((t, idx) => { 
                              const ttime = (t.startTime && t.endTime) ? `${t.startTime}-${t.endTime}` : (t.time || null);
                              return (
                                <Pressable key={t.id+idx} style={styles.taskChip} onPress={()=> router.push({ pathname:'/create-task', params:{ editId: t.id, occDate: iso } })}>
                                  <View style={[styles.taskChipDot,{ backgroundColor: t.importance==='high'? '#dc2626' : t.importance==='medium'? '#f59e0b':'#3a7ca5' }]} />
                                  <Text style={styles.taskChipText} numberOfLines={1}>{t.title}</Text>
                                  {!!ttime && <Text style={styles.taskChipTime}>{ttime}</Text>}
                                    {(t as any).projectId && (
                                      <Text style={[styles.groupBadge, { marginLeft:6 }]} numberOfLines={1}>{projectNameById[(t as any).projectId] || 'Dự án'}</Text>
                                    )}
                                </Pressable>
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
              </View>
              <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
                <Pressable onPress={onOptimizePress} style={{ borderRadius:12, overflow:'hidden' }}>
                  <LinearGradient colors={['#3a7ca5','#2f6690']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingHorizontal:10, paddingVertical:6 }}>
                    <Text style={{ color:'#fff', fontWeight:'700', fontSize:12 }}>{aiLoading? 'Đang sắp xếp...' : 'Sắp xếp'}</Text>
                  </LinearGradient>
                </Pressable>
                <Text style={styles.sectionSub}>{filteredTasks.length} hiển thị</Text>
              </View>
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
              // Overdue textual indicator replaces prior colored border styles
              let overdueLabel: string | null = null;
              if(item.endDate && !item.completed){
                let endTime: string | undefined = item.endTime || (item.time && item.time.includes('-') ? item.time.split('-')[1] : undefined);
                const deadline = endTime ? new Date(`${item.endDate}T${endTime}:00`) : new Date(`${item.endDate}T23:59:59`);
                const now = new Date();
                if(now > deadline){
                  const diffMs = now.getTime() - deadline.getTime();
                  const diffHours = diffMs/3600000;
                  overdueLabel = diffHours < 24 ? `Quá hạn: ${Math.floor(diffHours)}h` : `Quá hạn: ${Math.floor(diffHours/24)} ngày`;
                }
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
                  <View style={[styles.taskCard, item.completed && styles.taskDone, { position:'relative' }]}>          
                    {celebrateId === item.id && <ConfettiBurst />}
                    <Pressable
                      style={{ flex:1, minWidth:0 }}
                      hitSlop={4}
                      delayLongPress={350}
                      onLongPress={()=>{ setActionTask(item); setShowActions(true); }}
                      onPress={()=> { if(item.subTasks && item.subTasks.length>0){ openSubModal(item); } else { const occ = selectedTab==='Hôm nay' ? todayISO : selectedDateISO; router.push({ pathname:'/create-task', params:{ editId: item.id, occDate: occ } }); } }}
                    >
                      <View style={{ flexDirection:'row', alignItems:'flex-start', gap:8 }}>
                        <View style={[styles.priorityDot,{ backgroundColor: priorityColor(item.priority)}]} />
                        <Text style={[styles.taskTitle, item.completed && styles.taskTitleDone, { flex:1 }]} numberOfLines={2}>{item.title}</Text>
                      </View>
                      <View style={[styles.metaRow,{ flexWrap:'wrap', marginTop:6 }]}>                        
                        {overdueLabel && (
                          <View style={styles.overduePill}><Text style={styles.overduePillText}>{overdueLabel}</Text></View>
                        )}
                        {/* Priority badge with explicit label */}
                        {item.priority && (
                          <View style={styles.metaSmallRow}>
                            <Ionicons name="alert-circle-outline" size={12} color="#ef4444" />
                            <Text style={styles.metaText}>{`Mức độ ưu tiên: ${getPriorityLabel(item.priority)}`}</Text>
                          </View>
                        )}
                        {/* Time range */}
                        {!!item.time && (
                          <View style={styles.metaSmallRow}>
                            <Ionicons name="time-outline" size={12} color="#2f6690" />
                            <Text style={styles.metaText}>{item.time}</Text>
                          </View>
                        )}
                        {!!item.startTime && !item.time && (
                          <View style={styles.metaSmallRow}>
                            <Ionicons name="time-outline" size={12} color="#2f6690" />
                            <Text style={styles.metaText}>{item.startTime}{item.endTime? `-${item.endTime}`:''}</Text>
                          </View>
                        )}
                        {/* Multi-day span */}
                        {item.endDate && item.date && item.endDate !== item.date && (
                          <View style={styles.metaSmallRow}>
                            <Ionicons name="calendar-outline" size={12} color="#2563eb" />
                            <Text style={[styles.metaText,{ color:'#2563eb' }]}>{fmtDM(item.date!)}–{fmtDM(item.endDate!)}</Text>
                          </View>
                        )}
                        {/* Deadline label */}
                        {(() => {
                          const dueIso = item.endDate || item.date;
                          const endTime = item.endTime || (item.time && item.time.includes('-') ? item.time.split('-')[1] : undefined);
                          if(!dueIso) return null;
                          const deadline = endTime ? new Date(`${dueIso}T${endTime}:00`) : new Date(`${dueIso}T23:59:59`);
                          const label = endTime ? `${fmtDM(dueIso)} ${endTime}` : fmtDM(dueIso);
                          return (
                            <View style={styles.metaSmallRow}>
                              <Ionicons name="calendar-outline" size={12} color="#374151" />
                              <Text style={styles.metaText}>{`Hạn chót: ${label}`}</Text>
                            </View>
                          );
                        })()}
                        {/* Importance */}
                        {item.importance && (
                          <Text style={[styles.importanceBadge, item.importance==='high' && styles.importanceHigh, item.importance==='medium' && styles.importanceMed]}>{item.importance==='high'?'Quan trọng': item.importance==='medium'?'Trung bình':'Thấp'}</Text>
                        )}
                        {/* Project badge */}
                        {item.type === 'group' && (() => {
                          const pid = (item as any).projectId as string | undefined;
                          const name = pid ? projectNameById[pid] : undefined;
                          return <Text style={styles.groupBadge}>{name || 'Nhóm'}</Text>;
                        })()}
                        {/* Due soon pill (<=7d and not overdue) */}
                        {(() => {
                          if(item.completed) return null;
                          const dueIso = item.endDate || item.date;
                          if(!dueIso) return null;
                          const endTime = item.endTime || (item.time && item.time.includes('-') ? item.time.split('-')[1] : undefined);
                          const deadline = endTime ? new Date(`${dueIso}T${endTime}:00`) : new Date(`${dueIso}T23:59:59`);
                          if(Date.now() > deadline.getTime()) return null;
                          const diffMs = deadline.getTime() - Date.now();
                          if(diffMs <= 0) return null;
                          const minutes = Math.floor(diffMs / 60000);
                          const hours = Math.floor(diffMs / 3600000);
                          const days = Math.floor(diffMs / 86400000);
                          let text = '';
                          if(days >= 1) text = `Hết hạn trong: ${days} ngày`;
                          else if(hours >= 1) text = `Hết hạn trong: ${hours} giờ`;
                          else text = `Hết hạn trong: ${minutes} phút`;
                          return <View style={styles.dueSoonPill}><Text style={styles.dueSoonPillText}>{text}</Text></View>;
                        })()}
                      </View>
                    </Pressable>
                    <Pressable onPress={()=> toggleTask(item.id)} hitSlop={10} style={[item.completed ? styles.completeBtn : styles.completeBtnOutline, { marginLeft:'auto' }]}>
                      <Text style={item.completed ? styles.completeBtnText : styles.completeBtnTextOutline}>{item.completed ? 'Đã hoàn thành' : 'Hoàn thành'}</Text>
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
          {/* Projects (show leader/admin projects) */}
          {(() => {
            const userId = (user as any)?._id || (user as any)?.id;
            const managed = projects.filter(p => p.owner === userId || (p.members||[]).some((m:any)=> m.user === userId && m.role==='admin'));
            if(!managed.length) return null;
            return (
              <View style={{ marginTop: 8 }}>
                <View style={styles.projectsHeaderRow}>
                  <View style={styles.headerLeftRow}>
                    <Text style={styles.projectsTitle}>Dự án đang quản lý</Text>
                  </View>
                  <View style={styles.countPillSmall}><Text style={styles.countPillSmallText}>{managed.length}</Text></View>
                </View>
                {managed.map(p => {
                  // Backend already includes owner in members as admin on creation
                  const membersCount = (p.members?.length || 0);
                  const myId = (user as any)?._id || (user as any)?.id;
                  const myMember = (p.members||[]).find((m:any)=> String(m.user)===String(myId));
                  const myRole = p.owner === myId ? 'owner' : (myMember?.role || 'member');
                  return (
                    <Pressable key={p._id} style={[styles.projectCard, styles.projectCardOwner]} onPress={()=> openProjectDirect(p)}>
                      <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                        <View style={{ flex:1, paddingRight:8 }}>
                          <Text style={styles.projectName} numberOfLines={1}>{p.name}</Text>
                        </View>
                        <Text style={myRole==='owner' ? styles.leaderBadge : styles.coLeaderBadge}>
                          {myRole==='owner' ? 'Trưởng nhóm' : 'Phó nhóm'}
                        </Text>
                      </View>
                      <View style={{ flexDirection:'row', justifyContent:'space-between' }}>
                        <Text style={styles.projectMeta}>{membersCount} thành viên</Text>
                        <Text style={styles.projectMeta}>{p.status==='archived' ? 'Đã lưu trữ' : 'Đang hoạt động'}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            );
          })()}

          {/* Projects (show participating but not admin) */}
          {(() => {
            const userId = (user as any)?._id || (user as any)?.id;
            const participating = projects.filter(p => p.owner !== userId && (p.members||[]).some((m:any)=> m.user === userId && m.role !== 'admin'));
            if(!participating.length) return null;
            return (
              <View style={{ marginTop: 16 }}>
                <View style={styles.projectsHeaderRow}>
                  <View style={styles.headerLeftRow}>
                    <Text style={styles.projectsTitle}>Dự án tham gia</Text>
                  </View>
                  <View style={[styles.countPillSmall,{ backgroundColor:'rgba(47,102,144,0.12)' }]}><Text style={[styles.countPillSmallText,{ color:'#2f6690' }]}>{participating.length}</Text></View>
                </View>
                {participating.map(p => {
                  const membersCount = (p.members?.length || 0);
                  return (
                    <Pressable key={p._id} style={[styles.projectCard, styles.projectCardMember]} onPress={()=> openProjectDirect(p)}>
                      <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                        <View style={{ flex:1, paddingRight:8 }}>
                          <Text style={styles.projectName} numberOfLines={1}>{p.name}</Text>
                        </View>
                        <Text style={styles.memberBadge}>Thành viên</Text>
                      </View>
                      <View style={{ flexDirection:'row', justifyContent:'space-between' }}>
                        <Text style={styles.projectMeta}>{membersCount} thành viên</Text>
                        <Text style={styles.projectMeta}>{p.status==='archived' ? 'Đã lưu trữ' : 'Đang hoạt động'}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            );
          })()}

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
          <Pressable style={[styles.fabAction,{ backgroundColor:'#2f6690' }]} onPress={()=>{ setShowFabMenu(false); router.push('/create-calendar'); }}>
            <Ionicons name='calendar-outline' size={22} color='#fff' />
            <Text style={styles.fabActionText}>Lịch mới</Text>
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
    {/* Remaining tasks modal */}
    <Modal visible={showRemainingModal} transparent animationType='fade' onRequestClose={closeRemainingModal}>
      <Pressable style={styles.insightsPopupOverlay} onPress={closeRemainingModal}>
        <Pressable style={[styles.insightsPopupCard,{ maxHeight:480 }]} onPress={(e)=> e.stopPropagation()}>
          <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
            <Text style={styles.insightsPopupTitle}>Tác vụ chưa hoàn thành ({uncompletedTasksAll.length})</Text>
            <Pressable onPress={closeRemainingModal} style={styles.popupCloseBtn}><Ionicons name='close' size={18} color='#334155' /></Pressable>
          </View>
          <ScrollView style={{ maxHeight:420 }}>
            {uncompletedTasksAll.map(t => {
              const endTime = t.endTime || (t.time && t.time.includes('-') ? t.time.split('-')[1] : undefined);
              const dueIso = t.endDate || t.date;
              const dl = dueIso ? (endTime ? new Date(`${dueIso}T${endTime}:00`) : new Date(`${dueIso}T23:59:59`)) : null;
              const overdue = dl ? Date.now() > dl.getTime() : false;
              return (
                <Pressable key={t.id} style={styles.popupItem} onPress={()=> { const occ = selectedTab==='Hôm nay' ? todayISO : selectedDateISO; router.push({ pathname:'/create-task', params:{ editId: t.id, occDate: occ } }); }}>
                  <Ionicons name={overdue? 'alert-circle-outline':'checkbox-outline'} size={16} color={overdue? '#dc2626':'#2563eb'} style={{ marginRight:8 }} />
                  <View style={{ flex:1 }}>
                    <Text style={styles.popupItemText} numberOfLines={1}>{t.title}</Text>
                    <View style={{ flexDirection:'row', flexWrap:'wrap', gap:6, marginTop:4 }}>
                      {t.time && <Text style={{ fontSize:11, color:'#2f6690' }}>{t.time}</Text>}
                      {t.startTime && !t.time && <Text style={{ fontSize:11, color:'#2f6690' }}>{t.startTime}{t.endTime? `-${t.endTime}`:''}</Text>}
                      {t.endDate && t.date && t.endDate!==t.date && <Text style={{ fontSize:11, color:'#2563eb' }}>{fmtDM(t.date!)}–{fmtDM(t.endDate!)}</Text>}
                      {overdue && <Text style={{ fontSize:11, color:'#dc2626', fontWeight:'700' }}>Quá hạn</Text>}
                      {t.importance && <Text style={[styles.importanceBadge, t.importance==='high' && styles.importanceHigh, t.importance==='medium' && styles.importanceMed]}>{t.importance==='high'?'Quan trọng': t.importance==='medium'?'Trung bình':'Thấp'}</Text>}
                      {(t as any).projectId && <Text style={styles.groupBadge}>{projectNameById[(t as any).projectId] || 'Dự án'}</Text>}
                    </View>
                  </View>
                </Pressable>
              );
            })}
            {uncompletedTasksAll.length===0 && <Text style={styles.popupEmpty}>Không có tác vụ</Text>}
          </ScrollView>
        </Pressable>
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
    {/* Projects list (sheet) & full-screen detail */}
  <Modal visible={showProjectsModal} transparent animationType={projectModalAnim} onRequestClose={()=>{ if(activeProject){ closeProjectFull(); } else { setShowProjectsModal(false); setActiveProject(null); } }}>
      {!activeProject && (
        <Pressable style={styles.modalBackdrop} onPress={()=> { setShowProjectsModal(false); setActiveProject(null); }}>
          <View style={styles.projectsSheet}>
            <View style={{ maxHeight:420 }}>
              <Text style={styles.sheetTitle}>Dự án của bạn</Text>
              <ScrollView style={{ maxHeight:360 }}>
                {projects.length === 0 && (
                  <Text style={{ color:'#607d8b', fontSize:12 }}>Chưa có dự án nào.</Text>
                )}
                {projects.map(p => {
                  const membersCount = (p.members?.length || 0);
                  return (
                    <Pressable key={p._id} style={styles.projectRow} onPress={()=> setActiveProject(p)}>
                      <View style={{ flex:1 }}>
                        <Text style={styles.projectRowName}>{p.name}</Text>
                        <Text style={styles.projectRowMeta}>{membersCount} thành viên • {p.status==='archived'?'Đã lưu trữ':'Hoạt động'}</Text>
                      </View>
                      <Ionicons name='chevron-forward' size={18} color='#2f6690' />
                    </Pressable>
                  );
                })}
              </ScrollView>
              <Pressable style={styles.createProjectBtn} onPress={()=> { setShowProjectsModal(false); router.push('/create-project'); }}>
                <Ionicons name='add-circle-outline' size={18} color='#fff' />
                <Text style={styles.createProjectText}>Tạo dự án mới</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      )}
      {activeProject && (
        <Animated.View style={[styles.projectFullContainer, projectSlideStyle]}>
          <SafeAreaView style={{ flex:1 }} edges={['left','right','bottom']}>
          <View style={[styles.projectFullHeader, { paddingTop: insets.top + 4 }]}>
            <Pressable onPress={closeProjectFull} style={styles.projectFullBack} hitSlop={10}>
              <Ionicons name='chevron-back' size={22} color='#16425b' />
            </Pressable>
            <Text style={styles.projectFullTitle} numberOfLines={1}>{activeProject.name}</Text>
            <View style={{ flexDirection:'row', alignItems:'center' }}>
              <Pressable onPress={()=> { const pid = activeProject?._id; if(pid){ setProjectModalAnim('none'); setShowProjectsModal(false); setActiveProject(null); router.push({ pathname:'/project-settings/[id]', params:{ id: pid } }); } }} style={styles.projectFullClose} hitSlop={10}>
                <Ionicons name='settings-outline' size={20} color='#16425b' />
              </Pressable>
              <Pressable onPress={closeProjectFull} style={styles.projectFullClose} hitSlop={10}>
                <Ionicons name='close' size={22} color='#16425b' />
              </Pressable>
            </View>
          </View>
          <KeyboardAwareScrollView
            enableOnAndroid
            extraScrollHeight={100}
            keyboardShouldPersistTaps='handled'
            contentContainerStyle={styles.projectFullBody}
          >
            {/* Project scoped mini-dashboard */}
            {(() => {
              const projId = activeProject?._id;
              const projTasksAll = tasks.filter(t => (t as any).projectId === projId || t.type === 'group');
              const projEventsAll = events.filter(e => e.projectId === projId);
              const projCompleted = projTasksAll.filter(t=> t.completed).length;
              const projTotal = projTasksAll.length;
              const projProgress = projTotal ? Math.round(projCompleted / projTotal * 100) : 0;
              return (
                <View style={{ marginBottom:16 }}>
                  <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                    <Text style={{ fontSize:14, fontWeight:'700', color:'#16425b' }}>Tổng quan dự án</Text>
                    <Text style={{ fontSize:12, color:'#2f6690' }}>{projCompleted}/{projTotal} • {projProgress}%</Text>
                  </View>
                  <View style={[styles.progressBarBg,{ height:10 }]}> 
                    <View style={[styles.progressBarFill,{ width: `${projProgress}%`, height:10 }]} />
                  </View>
                  <View style={[styles.tabs,{ marginTop:12 }]}>
                    {(['Hôm nay','Tuần','Tháng'] as const).map(tab => (
                      <Pressable key={tab} onPress={()=> setProjectSelectedTab(tab)} style={[styles.tabBtn, projectSelectedTab===tab && styles.tabBtnActive]}>
                        <Text style={[styles.tabText, projectSelectedTab===tab && styles.tabTextActive]}>{tab}</Text>
                      </Pressable>
                    ))}
                  </View>
                  {/* Quick actions in project */}
                  <View style={{ flexDirection:'row', gap:10, marginTop:10 }}>
                    <Pressable style={[styles.inviteAcceptBtn,{ backgroundColor:'#2f6690' }]} onPress={()=> { setProjectModalAnim('none'); setShowProjectsModal(false); router.push({ pathname:'/create-task', params:{ projectId: projId, refProjectModal:'1' } }); }}>
                      <Ionicons name='add-circle-outline' size={16} color='#fff' />
                      <Text style={styles.inviteAcceptText}>Tác vụ mới</Text>
                    </Pressable>
                    <Pressable style={[styles.inviteAcceptBtn,{ backgroundColor:'#3a7ca5' }]} onPress={()=> { setProjectModalAnim('none'); setShowProjectsModal(false); router.push({ pathname:'/create-calendar', params:{ projectId: projId, refProjectModal:'1' } }); }}>
                      <Ionicons name='calendar-outline' size={16} color='#fff' />
                      <Text style={styles.inviteAcceptText}>Lịch mới</Text>
                    </Pressable>
                  </View>
                  {projectSelectedTab === 'Hôm nay' && (()=>{
                    const iso = todayISO;
                    const dayEvents = events.filter(ev => (ev.projectId===projId) && occursOnDate(ev as any, iso) && matchesQueryEvent(ev));
                    const dayTasks = tasks.filter(t => ((t as any).projectId===projId || (t as any).type==='group') && !t.completed && occursTaskOnDate(t, iso) && matchesQueryTask(t));
                    return (
                      <View style={{ marginTop:12 }}>
                        <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                          <Text style={{ fontSize:13, fontWeight:'700', color:'#16425b' }}>Hôm nay</Text>
                          <Text style={{ fontSize:11, color:'#607d8b' }}>{dayEvents.length} lịch • {dayTasks.length} tác vụ</Text>
                        </View>
                        {dayEvents.length>0 && (
                          <View style={styles.eventList}>
                            {dayEvents.map((ev, idx)=> (
                              <Pressable key={ev.id+idx} style={styles.eventChip} onPress={()=> { setProjectModalAnim('none'); setShowProjectsModal(false); router.push({ pathname:'/create-calendar', params:{ editId: ev.id, occDate: iso } }); }}>
                                <View style={styles.eventColorBar} />
                                <View style={{ flex:1 }}>
                                  <Text style={styles.eventChipTitle} numberOfLines={1}>{ev.title}</Text>
                                  {!!ev.startTime && <Text style={styles.eventChipTime}>{ev.startTime}{ev.endTime? `–${ev.endTime}`:''}</Text>}
                                </View>
                              </Pressable>
                            ))}
                          </View>
                        )}
                        {dayTasks.length>0 && (
                          <View style={{ gap:8, marginTop:10 }}>
                            {dayTasks.map(t => (
                              <EnhancedProjectTaskChip key={t.id} t={t} occDate={iso} onPress={()=> { setProjectModalAnim('none'); setShowProjectsModal(false); router.push({ pathname:'/create-task', params:{ editId: t.id, occDate: iso, refProjectModal:'1', projectId: projId } }); }} />
                            ))}
                          </View>
                        )}
                        {dayEvents.length===0 && dayTasks.length===0 && <Text style={styles.emptyHint}>Không có mục trong hôm nay</Text>}
                      </View>
                    );
                  })()}
                  {projectSelectedTab === 'Tuần' && (()=>{
                    const fmt = (iso:string) => { const [y,m,d]=iso.split('-'); return `${d}/${m}`; };
                    const title = `${fmt(projWeekISO[0])} – ${fmt(projWeekISO[6])}`;
                    return (
                      <View style={{ marginTop:8 }}>
                        <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                          <Pressable onPress={projPrevWeek} style={styles.monthNav}><Ionicons name='chevron-back' size={18} color='#16425b' /></Pressable>
                          <Text style={styles.monthTitle}>{title}</Text>
                          <Pressable onPress={projNextWeek} style={styles.monthNav}><Ionicons name='chevron-forward' size={18} color='#16425b' /></Pressable>
                        </View>
                        {projWeekISO.map((iso)=>{
                          const dayEvents = projEventsAll.filter(ev => occursOnDate(ev as any, iso) && matchesQueryEvent(ev) && (!filterWeekday || dayNumFromISO(iso)===filterWeekday) && isISOInRange(iso));
                          const dayTasks = projTasksAll.filter(t => !t.completed && occursTaskOnDate(t, iso) && matchesQueryTask(t) && (!filterWeekday || dayNumFromISO(iso)===filterWeekday) && isISOInRange(iso));
                          const w = weekdayVNFromISO(iso);
                          const [y,m,d] = iso.split('-');
                          return (
                            <View key={iso} style={[styles.weekDayCard,{ marginBottom:8 }]}> 
                              <View style={styles.weekDayHeader}>
                                <Text style={styles.weekDayTitle}>{w}, {d}/{m}</Text>
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
                                  {dayEvents.map((ev, idx)=> (
                                    <View key={ev.id+idx} style={styles.eventChip}>
                                      <View style={styles.eventColorBar} />
                                      <View style={{ flex:1 }}>
                                        <Text style={styles.eventChipTitle} numberOfLines={1}>{ev.title}</Text>
                                        {ev.projectId && (
                                          <View style={styles.eventMetaRow}>
                                            <Ionicons name='briefcase-outline' size={14} color='#2f6690' />
                                            <Text style={styles.groupBadge}>{projectNameById[ev.projectId] || 'Dự án'}</Text>
                                          </View>
                                        )}
                                        {!!ev.startTime && <Text style={styles.eventChipTime}>{ev.startTime}{ev.endTime? `–${ev.endTime}`:''}</Text>}
                                      </View>
                                    </View>
                                  ))}
                                </View>
                              ) : (
                                <Text style={styles.emptyHint}>Không có lịch</Text>
                              )}
                              {dayTasks.length>0 ? (
                                <View style={styles.dayTaskChips}>
                                  {dayTasks.map((t, idx)=> (
                                    <Pressable key={t.id+idx} style={styles.taskChip} onPress={()=> { setProjectModalAnim('none'); setShowProjectsModal(false); router.push({ pathname:'/create-task', params:{ editId: t.id, occDate: iso, refProjectModal:'1', projectId: projId } }); }}>
                                      <View style={[styles.taskChipDot,{ backgroundColor: t.importance==='high'? '#dc2626' : t.importance==='medium'? '#f59e0b':'#3a7ca5' }]} />
                                      <Text style={styles.taskChipText} numberOfLines={1}>{t.title}</Text>
                                    </Pressable>
                                  ))}
                                </View>
                              ) : (
                                <Text style={styles.emptyHint}>Không có tác vụ</Text>
                              )}
                            </View>
                          );
                        })}
                      </View>
                    );
                  })()}

                  {projectSelectedTab === 'Tháng' && (()=>{
                    const weekLabels = ['T2','T3','T4','T5','T6','T7','CN'];
                    const days = projMonthDays;
                    const rows: string[][] = [];
                    for(let i=0;i<days.length;i+=7){ rows.push(days.slice(i,i+7)); }
                    return (
                      <View style={{ marginTop:8 }}>
                        <View style={styles.monthHeader}>
                          <Pressable onPress={projPrevMonth} style={styles.monthNav}><Ionicons name='chevron-back' size={18} color='#16425b' /></Pressable>
                          <Text style={styles.monthTitle}>{projMonthTitle}</Text>
                          <Pressable onPress={projNextMonth} style={styles.monthNav}><Ionicons name='chevron-forward' size={18} color='#16425b' /></Pressable>
                        </View>
                        <View style={styles.weekLabels}>
                          {weekLabels.map(w => (<Text key={w} style={styles.weekLabel}>{w}</Text>))}
                        </View>
                        {rows.map((row, rIdx) => (
                          <View key={`r${rIdx}`} style={styles.monthRow}>
                            {row.map((iso, cIdx) => {
                              if(!iso) return <View key={`e${rIdx}_${cIdx}`} style={styles.monthCellEmpty} />;
                              const isActive = iso === projSelectedDateISO;
                              const [y,m,d] = iso.split('-');
                              const dayEvents = projEventsAll.filter(ev => occursOnDate(ev as any, iso) && matchesQueryEvent(ev));
                              const hasItems = dayEvents.length > 0 || projTasksAll.some(t => !t.completed && occursTaskOnDate(t, iso) && matchesQueryTask(t));
                              return (
                                <Pressable key={iso} onPress={()=> setProjSelectedDateISO(iso)} style={[styles.monthCell, isActive && styles.monthCellActive]}>
                                  <Text style={[styles.monthCellText, isActive && styles.monthCellTextActive]}>{d}</Text>
                                  <View style={styles.dotSmallWrapper}>
                                    {hasItems && <View style={[styles.dotSmall, isActive && styles.dotSmallActive]} />}
                                  </View>
                                </Pressable>
                              );
                            })}
                          </View>
                        ))}
                        {/* Day details for selected date inside month view */}
                        <View style={{ marginTop:12 }}>
                          {(() => {
                            const iso = projSelectedDateISO;
                            const dayEvents = events.filter(ev => (ev.projectId===projId) && occursOnDate(ev as any, iso) && matchesQueryEvent(ev));
                            const dayTasks = tasks.filter(t => ((t as any).projectId===projId || (t as any).type==='group') && !t.completed && occursTaskOnDate(t, iso) && matchesQueryTask(t));
                            const w = weekdayVNFromISO(iso); const [y,m,d] = iso.split('-');
                            return (
                              <View style={[styles.weekDayCard,{ marginBottom:8 }]}>                              
                                <View style={styles.weekDayHeader}>
                                  <Text style={styles.weekDayTitle}>{w}, {d}/{m}</Text>
                                  <Text style={{ fontSize:11, color:'#607d8b' }}>{dayEvents.length} lịch • {dayTasks.length} tác vụ</Text>
                                </View>
                                {dayEvents.length>0 && (
                                  <View style={styles.eventList}>
                                    {dayEvents.map((ev, idx)=> (
                                      <Pressable key={ev.id+idx} style={styles.eventChip} onPress={()=> { setProjectModalAnim('none'); setShowProjectsModal(false); router.push({ pathname:'/create-calendar', params:{ editId: ev.id, occDate: iso } }); }}>
                                        <View style={styles.eventColorBar} />
                                        <View style={{ flex:1 }}>
                                          <Text style={styles.eventChipTitle} numberOfLines={1}>{ev.title}</Text>
                                          {!!ev.startTime && <Text style={styles.eventChipTime}>{ev.startTime}{ev.endTime? `–${ev.endTime}`:''}</Text>}
                                        </View>
                                      </Pressable>
                                    ))}
                                  </View>
                                )}
                                {dayTasks.length>0 && (
                                  <View style={{ gap:8, marginTop:10 }}>
                                    {dayTasks.map(t => (
                                      <EnhancedProjectTaskChip key={t.id} t={t} occDate={iso} onPress={()=> { setProjectModalAnim('none'); setShowProjectsModal(false); router.push({ pathname:'/create-task', params:{ editId: t.id, occDate: iso, refProjectModal:'1', projectId: projId } }); }} />
                                    ))}
                                  </View>
                                )}
                                {dayEvents.length===0 && dayTasks.length===0 && <Text style={styles.emptyHint}>Không có mục</Text>}
                              </View>
                            );
                          })()}
                        </View>
                      </View>
                    );
                  })()}

                  {/* Insights charts moved below Today/Week/Month as requested */}
                  <View style={{ marginTop:16 }}>
                    <ProjectInsights
                      project={activeProject as any}
                      tasks={activeProjectTasks as any}
                      events={activeProjectEvents as any}
                      onOverduePress={handleOverduePress}
                      onUpcomingEventsPress={handleUpcomingEventsPress}
                      onRemainingPress={handleRemainingPress}
                      onCompletedPress={handleCompletedPress}
                      onDueSoon3Press={handleDueSoon3Press}
                      onDueSoon7Press={handleDueSoon7Press}
                      visibleSections={['overview','gantt']}
                      overviewSimple
                      hideTabs
                    />
                  </View>

                  {/* Edit box (project settings inline when editing) */}
                  {editingProject && (
                    <View style={styles.editBox}>
                      <Text style={styles.editLabel}>Tên dự án</Text>
                      <TextInput style={styles.editInput} value={projName} onChangeText={setProjName} placeholder='Nhập tên dự án' />
                      <Text style={styles.editLabel}>Mô tả</Text>
                      <TextInput style={[styles.editInput,{ minHeight:70, textAlignVertical:'top' }]} value={projDescr} onChangeText={setProjDescr} placeholder='Mô tả...' multiline />
                      <View style={{ flexDirection:'row', gap:12 }}>
                        <View style={{ flex:1 }}>
                          <Text style={styles.editLabel}>Ngày bắt đầu</Text>
                          <TextInput style={styles.editInput} value={projStart} onChangeText={setProjStart} placeholder='DD/MM/YYYY' keyboardType='numbers-and-punctuation' />
                        </View>
                        <View style={{ flex:1 }}>
                          <Text style={styles.editLabel}>Kết thúc dự kiến</Text>
                          <TextInput style={styles.editInput} value={projDue} onChangeText={setProjDue} placeholder='DD/MM/YYYY' keyboardType='numbers-and-punctuation' />
                        </View>
                      </View>
                      <View style={{ flexDirection:'row', gap:10, marginTop:12 }}>
                        <Pressable disabled={savingProject} onPress={()=>{ setEditingProject(false); }} style={[styles.bottomBtn, { backgroundColor:'#e5e7eb', height:44 }]}>
                          <Text style={[styles.cancelText,{ color:'#111827' }]}>Hủy</Text>
                        </Pressable>
                        <Pressable disabled={savingProject} onPress={async()=>{
                          if(!token || !activeProject) return;
                          const body:any = { name: projName.trim(), description: projDescr };
                          const parseToISO = (v?: string) => {
                            if(!v) return '';
                            const s = v.trim();
                            const m = s.match(/^([0-3]?\d)\/(0?\d|1[0-2])\/(\d{4})$/);
                            if(!m) return 'INVALID';
                            const dd = m[1].padStart(2,'0');
                            const mm = m[2].padStart(2,'0');
                            const yyyy = m[3];
                            return `${yyyy}-${mm}-${dd}`;
                          };
                          const sISO = parseToISO(projStart);
                          const dISO = parseToISO(projDue);
                          if(projStart !== undefined){
                            if(sISO==='INVALID') { Alert.alert('Lỗi','Ngày bắt đầu không đúng định dạng DD/MM/YYYY'); return; }
                            body.startDate = sISO || undefined;
                          }
                          if(projDue !== undefined){
                            if(dISO==='INVALID') { Alert.alert('Lỗi','Ngày kết thúc dự kiến không đúng định dạng DD/MM/YYYY'); return; }
                            body.dueDate = dISO || undefined;
                          }
                          try{
                            setSavingProject(true);
                            const res = await axios.put(`${API_BASE}/api/projects/${activeProject._id}`, body, { headers:{ Authorization:`Bearer ${token}` } });
                            const updated = res.data.project;
                            setProjects(prev => prev.map(p=> p._id===updated._id? updated : p));
                            setActiveProject(updated);
                            setEditingProject(false);
                            setToast('Đã cập nhật dự án');
                          } catch(e:any){
                            Alert.alert('Lỗi', e?.response?.data?.message || 'Không thể cập nhật dự án');
                          } finally { setSavingProject(false); }
                        }} style={[styles.bottomBtn, { backgroundColor:'#3a7ca5', height:44 }]}>
                          <Text style={styles.saveText}>{savingProject? 'Đang lưu...' : 'Lưu'}</Text>
                        </Pressable>
                      </View>
                    </View>
                  )}
                </View>
              );
            })()}
            {/* INSIGHTS POPUP (Modal to stick center) */}
            <Modal
              visible={!!insightsPopup}
              transparent
              animationType='fade'
              onRequestClose={closeInsightsPopup}
            >
              <Pressable style={[styles.insightsPopupOverlay, { zIndex: 999 }]} onPress={closeInsightsPopup}>
                <Pressable style={styles.insightsPopupCard} onPress={(e)=> e.stopPropagation()}>
                  <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
                    <Text style={styles.insightsPopupTitle}>
                      {insightsPopup==='overdue' && 'Tác vụ quá hạn'}
                      {insightsPopup==='upcomingEvents' && 'Lịch sắp diễn ra (14 ngày)'}
                      {insightsPopup==='remaining' && 'Tác vụ còn lại'}
                      {insightsPopup==='completed' && 'Đã hoàn thành'}
                      {insightsPopup==='dueSoon3' && 'Sắp tới hạn (3 ngày)'}
                      {insightsPopup==='dueSoon7' && 'Sắp tới hạn (7 ngày)'}
                    </Text>
                    <Pressable onPress={closeInsightsPopup} style={styles.popupCloseBtn}>
                      <Ionicons name='close' size={18} color='#334155' />
                    </Pressable>
                  </View>
                  <ScrollView style={{ maxHeight:400 }}>
                    {insightsPopup==='overdue' && projectOverdueTasks.map(t => (
                      <View key={t.id} style={styles.popupItem}>
                        <Ionicons name='alert-circle-outline' size={16} color='#dc2626' style={{ marginRight:8 }} />
                        <Pressable style={{ flex:1 }} onPress={()=> router.push({ pathname:'/create-task', params:{ editId: t.id, refProjectModal:'1' } })}>
                          <Text style={styles.popupItemText} numberOfLines={1}>{t.title}</Text>
                        </Pressable>
                        <Pressable onPress={()=> handleDelete(t.id)} hitSlop={8}>
                          <Ionicons name='trash-outline' size={18} color='#dc2626' />
                        </Pressable>
                      </View>
                    ))}
                    {insightsPopup==='upcomingEvents' && projectUpcomingEvents.map(ev => (
                      <Pressable key={ev.id} style={styles.popupItem} onPress={()=> router.push({ pathname:'/create-calendar', params:{ editId: ev.id, refProjectModal:'1' } })}>
                        <Ionicons name='calendar-outline' size={16} color='#0f766e' style={{ marginRight:8 }} />
                        <Text style={styles.popupItemText} numberOfLines={1}>{ev.title}</Text>
                      </Pressable>
                    ))}
                    {insightsPopup==='remaining' && projectRemainingTasks.map(t => (
                      <View key={t.id} style={styles.popupItem}>
                        <Ionicons name='checkbox-outline' size={16} color='#2563eb' style={{ marginRight:8 }} />
                        <Pressable style={{ flex:1 }} onPress={()=> router.push({ pathname:'/create-task', params:{ editId: t.id, refProjectModal:'1' } })}>
                          <Text style={styles.popupItemText} numberOfLines={1}>{t.title}</Text>
                        </Pressable>
                        <Pressable onPress={()=> handleDelete(t.id)} hitSlop={8}>
                          <Ionicons name='trash-outline' size={18} color='#dc2626' />
                        </Pressable>
                      </View>
                    ))}
                    {insightsPopup==='completed' && projectCompletedTasks.map(t => (
                      <View key={t.id} style={styles.popupItem}>
                        <Ionicons name='checkmark-circle-outline' size={16} color='#16a34a' style={{ marginRight:8 }} />
                        <Pressable style={{ flex:1 }} onPress={()=> router.push({ pathname:'/create-task', params:{ editId: t.id, refProjectModal:'1' } })}>
                          <Text style={[styles.popupItemText, { textDecorationLine:'line-through', color:'#64748b' }]} numberOfLines={1}>{t.title}</Text>
                        </Pressable>
                        <Pressable onPress={()=> handleDelete(t.id)} hitSlop={8}>
                          <Ionicons name='trash-outline' size={18} color='#dc2626' />
                        </Pressable>
                      </View>
                    ))}
                    {insightsPopup==='dueSoon3' && projectDueSoon3Tasks.map(t => (
                      <View key={t.id} style={styles.popupItem}>
                        <Ionicons name='time-outline' size={16} color='#2563eb' style={{ marginRight:8 }} />
                        <Pressable style={{ flex:1 }} onPress={()=> router.push({ pathname:'/create-task', params:{ editId: t.id, refProjectModal:'1' } })}>
                          <Text style={styles.popupItemText} numberOfLines={1}>{t.title}</Text>
                        </Pressable>
                        <Pressable onPress={()=> handleDelete(t.id)} hitSlop={8}>
                          <Ionicons name='trash-outline' size={18} color='#dc2626' />
                        </Pressable>
                      </View>
                    ))}
                    {insightsPopup==='dueSoon7' && projectDueSoon7Tasks.map(t => (
                      <View key={t.id} style={styles.popupItem}>
                        <Ionicons name='time-outline' size={16} color='#2563eb' style={{ marginRight:8 }} />
                        <Pressable style={{ flex:1 }} onPress={()=> router.push({ pathname:'/create-task', params:{ editId: t.id, refProjectModal:'1' } })}>
                          <Text style={styles.popupItemText} numberOfLines={1}>{t.title}</Text>
                        </Pressable>
                        <Pressable onPress={()=> handleDelete(t.id)} hitSlop={8}>
                          <Ionicons name='trash-outline' size={18} color='#dc2626' />
                        </Pressable>
                      </View>
                    ))}
                    {insightsPopup && (
                      ((insightsPopup==='overdue' && projectOverdueTasks.length===0) ||
                       (insightsPopup==='upcomingEvents' && projectUpcomingEvents.length===0) ||
                       (insightsPopup==='remaining' && projectRemainingTasks.length===0) ||
                       (insightsPopup==='completed' && projectCompletedTasks.length===0) ||
                       (insightsPopup==='dueSoon3' && projectDueSoon3Tasks.length===0) ||
                       (insightsPopup==='dueSoon7' && projectDueSoon7Tasks.length===0)) && (
                        <Text style={styles.popupEmpty}>Không có mục</Text>
                      )
                    )}
                  </ScrollView>
                </Pressable>
              </Pressable>
            </Modal>
            <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center' }}>
              <Text style={styles.membersHeader}>Thành viên</Text>
              <Pressable onPress={()=> { setShowProjectsModal(false); if(activeProject?._id){ router.push({ pathname:'/project-members/[id]', params:{ id: activeProject._id } }); } }} style={[styles.inviteAcceptBtn,{ backgroundColor:'#16425b' }]}> 
                <Ionicons name='person-add-outline' size={16} color='#fff' />
                <Text style={styles.inviteAcceptText}>Quản lý</Text>
              </Pressable>
            </View>
            <View style={{ marginBottom:12 }}>
              <View style={styles.memberRow}>
                <Ionicons name='person-circle-outline' size={22} color='#3a7ca5' />
                <Text style={styles.memberName}>Chủ dự án (Bạn hoặc Owner)</Text>
              </View>
              {(activeProject.members||[]).map((m:any, idx:number) => {
                const uid = (m.user?._id) || m.user;
                const display = typeof m.user === 'object' ? (m.user.name || m.user.email || String(uid).slice(0,6)) : (String(m.user).slice(0,6));
                const isOwner = String(activeProject.owner) === String(uid);
                return (
                  <View key={idx} style={styles.memberRow}>
                    <Ionicons name='person-outline' size={20} color='#2f6690' />
                    <Text style={styles.memberName}>{display}</Text>
                    <Text style={styles.memberRole}>{isOwner? 'Chủ dự án' : (m.role==='admin'?'Quản trị': m.role==='member'?'Thành viên': m.role)}</Text>
                  </View>
                );
              })}
            </View>
            {/* Đã bỏ phần "Lời mời" và "Mời thêm" tại đây; hãy dùng trang Quản lý để thao tác */}
            {(() => {
              const userId = (user as any)?._id || (user as any)?.id;
              const isOwner = String(activeProject.owner) === String(userId);
              const isMember = (activeProject.members||[]).some((m:any)=> String(m.user?._id || m.user)===String(userId));
              if(isMember && !isOwner){
                return (
                  <View style={{ marginTop:32 }}>
                    <Text style={{ fontSize:13, fontWeight:'700', color:'#b91c1c', marginBottom:8 }}>Rời dự án</Text>
                    <Text style={{ fontSize:11, color:'#7f1d1d', marginBottom:10 }}>Bạn sẽ không còn thấy nhiệm vụ/sự kiện của dự án này.</Text>
                    <Pressable onPress={leaveProject} style={[styles.deleteProjectBtn,{ backgroundColor:'#ef4444' }]}> 
                      <Ionicons name='log-out-outline' size={16} color='#fff' />
                      <Text style={styles.deleteProjectText}>Rời dự án</Text>
                    </Pressable>
                  </View>
                );
              }
              return null;
            })()}
            <View style={{ height: Platform.OS==='ios'? 40: 20 }} />
          </KeyboardAwareScrollView>
          </SafeAreaView>
        </Animated.View>
      )}
    </Modal>
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


// Hiệu ứng confetti đơn giản khi hoàn thành task
const ConfettiBurst = () => {
  const pieces = Array.from({ length: 12 });
  const colors = ['#ef4444','#f59e0b','#10b981','#3b82f6','#a855f7','#ec4899'];
  return (
    <View pointerEvents="none" style={{ position:'absolute', left:0, top:0, right:0, bottom:0 }}>
      {pieces.map((_, i) => {
        const theta = (Math.PI * 2) * (i / pieces.length);
        const dist = 42 + (i%3)*12;
        const x = Math.cos(theta) * dist;
        const y = Math.sin(theta) * dist * -1; // bay lên trên
        const delay = i * 18;
        return (
          <Animated.View
            key={i}
            entering={FadeInDown.delay(delay)}
            style={{ position:'absolute', left:'50%', top:'50%', width:6, height:6, borderRadius:3, backgroundColor: colors[i % colors.length], transform:[{ translateX: x }, { translateY: y }] }}
          />
        );
      })}
    </View>
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
  // Search & Filters
  searchRow:{ flexDirection:'row', alignItems:'center', gap:8, backgroundColor:'#fff', borderRadius:14, paddingHorizontal:12, paddingVertical:8, borderWidth:1, borderColor:'rgba(0,0,0,0.06)', marginTop:10 },
  searchInput:{ flex:1, fontSize:13, color:'#16425b', paddingVertical:2 },
  filterChipsRow:{ marginTop:8 },
  // Increase contrast for chips for better readability
  filterChip:{ flexDirection:'row', alignItems:'center', gap:6, backgroundColor:'#f7fbff', borderWidth:1, borderColor:'#a3c4dc', paddingHorizontal:12, paddingVertical:8, borderRadius:999, marginRight:8, shadowColor:'#000', shadowOpacity:0.05, shadowRadius:2, elevation:1 },
  filterChipActive:{ backgroundColor:'#3a7ca5', borderColor:'#3a7ca5' },
  filterChipText:{ color:'#0b2545', fontSize:12, fontWeight:'700' },
  filterChipTextActive:{ color:'#fff' },
  // Modal picker styles for date range
  pickerModalBackdrop:{ flex:1, backgroundColor:'rgba(0,0,0,0.35)', justifyContent:'center', padding:24 },
  pickerModal:{ backgroundColor:'#fff', borderRadius:16, paddingVertical:12, paddingHorizontal:12 },
  pickerTitle:{ fontSize:16, fontWeight:'700', color:'#0b2545', textAlign:'center', marginBottom:8 },
  pickerActions:{ flexDirection:'row', justifyContent:'flex-end', gap:12, paddingTop:8 },
  pickerBtn:{ paddingHorizontal:14, paddingVertical:10, borderRadius:10 },
  pickerCancelBtn:{ backgroundColor:'#e6f1f8', borderWidth:1, borderColor:'#bcd4e6' },
  pickerOkBtn:{ backgroundColor:'#2f6690' },
  pickerBtnText:{ fontSize:14, fontWeight:'700' },
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
  completeBtn:{ paddingHorizontal:10, paddingVertical:6, borderRadius:12, backgroundColor:'#3a7ca5', marginRight:0 },
  completeBtnText:{ color:'#fff', fontSize:11, fontWeight:'700' },
  completeBtnOutline:{ paddingHorizontal:10, paddingVertical:6, borderRadius:12, borderWidth:1, borderColor:'#3a7ca5', backgroundColor:'transparent' },
  completeBtnTextOutline:{ color:'#3a7ca5', fontSize:11, fontWeight:'700' },
  checkCircle: { width:22, height:22, borderRadius:11, borderWidth:2, borderColor:'#2f6690', alignItems:'center', justifyContent:'center', marginRight: 12 },
  checkCircleDone: { backgroundColor:'#3a7ca5', borderColor:'#3a7ca5' },
  priorityDot: { width:10, height:10, borderRadius:5, marginRight: 12 },
  taskTitle: { fontSize:15, fontWeight:'500', color:'#16425b', marginBottom:4 },
  taskTitleDone: { textDecorationLine:'line-through', color:'#2f6690' },
  metaRow: { flexDirection:'row', alignItems:'center', gap:6, flexWrap:'wrap' },
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
  projectsHeaderRow: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:10 },
  headerLeftRow: { flexDirection:'row', alignItems:'center', gap:8 },
  countPillSmall: { paddingHorizontal:8, paddingVertical:2, backgroundColor:'rgba(22,66,91,0.12)', borderRadius:10 },
  countPillSmallText: { fontSize:11, color:'#16425b', fontWeight:'700' },
  headerIcon:{ marginTop:1 },
  projectCard: { backgroundColor:'rgba(58,124,165,0.08)', borderRadius:18, padding:14, marginBottom:12 },
  projectCardOwner: { backgroundColor:'rgba(22,66,91,0.05)', borderWidth:1, borderColor:'rgba(22,66,91,0.12)' },
  projectCardMember: { backgroundColor:'rgba(47,102,144,0.05)', borderWidth:1, borderColor:'rgba(47,102,144,0.12)' },
  projectName: { fontSize:14, fontWeight:'600', color:'#16425b', lineHeight:18 },
  leaderBadge: { fontSize:10, backgroundColor:'#dc2626', color:'#fff', paddingHorizontal:8, paddingVertical:3, borderRadius:12, lineHeight:12 },
  coLeaderBadge: { fontSize:10, backgroundColor:'#f59e0b', color:'#fff', paddingHorizontal:8, paddingVertical:3, borderRadius:12, lineHeight:12 },
  memberBadge: { fontSize:10, backgroundColor:'#2563eb', color:'#fff', paddingHorizontal:8, paddingVertical:3, borderRadius:12 },
  projectMeta: { fontSize:12, color:'#2f6690', lineHeight:16 },
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
  // Notifications UI
  notifBtn:{ width:32, height:32, borderRadius:16, backgroundColor:'rgba(58,124,165,0.12)', alignItems:'center', justifyContent:'center', position:'relative' },
  notifDot:{ position:'absolute', top:-4, right:-4, minWidth:16, height:16, paddingHorizontal:3, borderRadius:8, backgroundColor:'#dc2626', alignItems:'center', justifyContent:'center' },
  notifDotText:{ color:'#fff', fontSize:10, fontWeight:'700' },
  notifSheet:{ backgroundColor:'#fff', padding:16, borderTopLeftRadius:24, borderTopRightRadius:24, maxHeight:'70%' },
  notifRow:{ flexDirection:'row', alignItems:'center', gap:10, paddingVertical:10 },
  notifTitle:{ color:'#16425b', fontSize:13, fontWeight:'600' },
  notifMeta:{ color:'#607d8b', fontSize:11, marginTop:2 },
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
  projectsSheet:{ backgroundColor:'#fff', padding:20, borderTopLeftRadius:28, borderTopRightRadius:28, maxHeight:'80%' },
  projectRow:{ flexDirection:'row', alignItems:'center', backgroundColor:'rgba(58,124,165,0.06)', padding:12, borderRadius:14, marginBottom:10 },
  projectRowName:{ fontSize:14, fontWeight:'600', color:'#16425b' },
  projectRowMeta:{ fontSize:11, color:'#607d8b', marginTop:2 },
  createProjectBtn:{ flexDirection:'row', alignItems:'center', gap:8, backgroundColor:'#3a7ca5', paddingVertical:12, borderRadius:16, justifyContent:'center', marginTop:8 },
  createProjectText:{ color:'#fff', fontWeight:'600', fontSize:14 },
  projectDescr:{ fontSize:12, color:'#2f6690', marginBottom:12 },
  membersHeader:{ fontSize:13, fontWeight:'700', color:'#16425b', marginBottom:8, marginTop:4 },
  memberRow:{ flexDirection:'row', alignItems:'center', gap:8, backgroundColor:'rgba(217,220,214,0.35)', padding:10, borderRadius:12, marginBottom:8 },
  memberName:{ fontSize:12, color:'#16425b', flex:1 },
  memberRole:{ fontSize:11, color:'#2f6690', fontWeight:'600' },
  // styles cho lời mời đã được loại bỏ tại modal chi tiết dự án
  inviteBanner:{ backgroundColor:'#fff', borderRadius:18, padding:14, marginBottom:18, shadowColor:'#000', shadowOpacity:0.04, shadowRadius:6, elevation:1, borderWidth:1, borderColor:'rgba(0,0,0,0.04)' },
  inviteBannerTitle:{ fontSize:14, fontWeight:'700', color:'#16425b', marginBottom:10 },
  inviteBannerRow:{ flexDirection:'row', alignItems:'center', marginBottom:10 },
  inviteBannerName:{ fontSize:13, fontWeight:'600', color:'#16425b' },
  inviteBannerMeta:{ fontSize:11, color:'#607d8b', marginTop:2 },
  inviteAcceptBtn:{ flexDirection:'row', alignItems:'center', gap:6, backgroundColor:'#3a7ca5', paddingHorizontal:14, paddingVertical:8, borderRadius:14 },
  inviteDeclineBtn:{ flexDirection:'row', alignItems:'center', gap:6, backgroundColor:'#dc2626', paddingHorizontal:14, paddingVertical:8, borderRadius:14 },
  inviteAcceptText:{ color:'#fff', fontSize:12, fontWeight:'600' },
  deleteProjectBtn:{ marginTop:4, backgroundColor:'#dc2626', flexDirection:'row', alignItems:'center', gap:8, paddingVertical:12, borderRadius:14, justifyContent:'center' },
  deleteProjectText:{ color:'#fff', fontSize:13, fontWeight:'600' },
  // Full-screen project detail styles
  projectFullContainer:{ flex:1, backgroundColor:'#fff' },
  projectFullHeader:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingTop: Platform.OS==='ios'? 4: 8, paddingBottom:10, borderBottomWidth:1, borderBottomColor:'rgba(0,0,0,0.05)' },
  projectFullBack:{ padding:8, borderRadius:14, backgroundColor:'rgba(58,124,165,0.08)' },
  projectFullClose:{ padding:8, borderRadius:14, backgroundColor:'rgba(58,124,165,0.08)' },
  projectFullTitle:{ flex:1, textAlign:'center', fontSize:16, fontWeight:'700', color:'#16425b', paddingHorizontal:8 },
  projectFullBody:{ paddingHorizontal:20, paddingTop:16, paddingBottom:40 },
  // Edit project form styles
  editBox:{ backgroundColor:'#f8fafc', borderWidth:1, borderColor:'#e2e8f0', borderRadius:14, padding:12, marginBottom:12 },
  editLabel:{ fontSize:12, color:'#2f6690', marginTop:8, marginBottom:6, fontWeight:'600' },
  editInput:{ backgroundColor:'#fff', borderWidth:1, borderColor:'#e2e8f0', borderRadius:12, paddingHorizontal:10, paddingVertical:10, fontSize:13, color:'#16425b' },
  bottomBtn:{ flex:1, height:48, borderRadius:14, alignItems:'center', justifyContent:'center' },
  cancelText:{ fontSize:14, fontWeight:'600', color:'#2f6690' },
  saveText:{ color:'#fff', fontWeight:'600', fontSize:14 },
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
  // Enhanced project task chip styles
  taskChipEnhanced:{ flexDirection:'row', alignItems:'flex-start', gap:10, backgroundColor:'rgba(217,220,214,0.55)', paddingHorizontal:12, paddingVertical:10, borderRadius:14 },
  taskChipEnhancedTitle:{ color:'#16425b', fontSize:13, fontWeight:'600', lineHeight:18 },
  taskChipEnhancedMeta:{ color:'#607d8b', fontSize:11 },
  metaSmallRow:{ flexDirection:'row', alignItems:'center', gap:4 },
  dueSoonPill:{ backgroundColor:'#dc2626', paddingHorizontal:8, paddingVertical:2, borderRadius:10 },
  dueSoonPillText:{ color:'#fff', fontSize:10, fontWeight:'700' },
  checkCircleSmall:{ width:20, height:20, borderRadius:10, borderWidth:2, borderColor:'#2f6690', alignItems:'center', justifyContent:'center' },
  checkCircleSmallDone:{ backgroundColor:'#3a7ca5', borderColor:'#3a7ca5' },
  overduePill:{ backgroundColor:'#dc2626', paddingHorizontal:8, paddingVertical:3, borderRadius:10 },
  overduePillText:{ color:'#fff', fontSize:11, fontWeight:'700' },
  // Added project insights modal + popup styles
  projectModalBackdrop:{ flex:1, backgroundColor:'rgba(0,0,0,0.35)' },
  projectModalContainer:{ flex:1, backgroundColor:'#f1f5f9' },
  projectTitle:{ fontSize:18, fontWeight:'700', color:'#16425b' },
  projectCloseBtn:{ padding:8, borderRadius:24, backgroundColor:'#e2e8f0' },
  insightsPopupOverlay:{ position:'absolute', top:0, left:0, right:0, bottom:0, justifyContent:'center', alignItems:'center', backgroundColor:'rgba(0,0,0,0.4)' },
  insightsPopupCard:{ width:'86%', maxWidth:520, backgroundColor:'#ffffff', borderRadius:16, padding:16, borderWidth:1, borderColor:'#e2e8f0' },
  insightsPopupTitle:{ fontSize:16, fontWeight:'700', color:'#0f172a' },
  popupCloseBtn:{ padding:6, borderRadius:24, backgroundColor:'#f1f5f9' },
  popupItem:{ flexDirection:'row', alignItems:'center', paddingVertical:10, paddingHorizontal:12, borderRadius:10, backgroundColor:'#f8fafc', borderWidth:1, borderColor:'#e2e8f0', marginBottom:8 },
  popupItemText:{ flex:1, fontSize:13, color:'#1e293b' },
  popupEmpty:{ textAlign:'center', paddingVertical:24, color:'#64748b', fontSize:12 },
});
