import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, DeviceEventEmitter, Modal, Alert, ScrollView } from 'react-native';
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

export default function DashboardScreen() {
  // NEW: date filtering enhancement plan
  // We'll introduce selectedDateISO, and dynamic generators for week and month views.
  const { user, token } = useAuth();
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
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
  const handleDelete = async (id: string) => {
    if(!token) return;
    setShowActions(false);
    const target = tasks.find(t=>t.id===id);
    if(!target) return;
    // remove optimistically
    setTasks(prev => prev.filter(t=>t.id!==id));
    cacheDeleted.current[id] = target;
    setToast('Đã xóa. Hoàn tác?');
    // schedule real delete
  const API_BASE = process.env.EXPO_PUBLIC_API_BASE;
    const timeout = setTimeout(async () => {
      try { await axios.delete(`${API_BASE}/api/tasks/${id}`); }
      catch { /* ignore, maybe show error toast */ }
      finally { delete cacheDeleted.current[id]; delete pendingDeletes.current[id]; }
    }, 2500);
    pendingDeletes.current[id] = timeout;
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
  const todayISO = new Date().toISOString().split('T')[0];
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
      arr.push(d.toISOString().split('T')[0]);
    }
    return arr;
  };
  const weekISO = buildWeek(selectedDateISO);

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
      const iso = new Date(year, month, d).toISOString().split('T')[0];
      cells.push(iso);
    }
    while(cells.length % 7 !== 0) cells.push('');
    if(cells.length < 42){ while(cells.length < 42) cells.push(''); }
    const rows: string[][] = [];
    for(let r=0;r<cells.length;r+=7) rows.push(cells.slice(r,r+7));
    return rows;
  }, [currentMonth]);

  // Filter tasks based on tab + selected date
  const filteredTasks = React.useMemo(()=>{
    const today = todayISO;
    const applySort = (list:Task[]) => aiMode ? aiOrderedTasks(list, today) : list;
    if(selectedTab === 'Hôm nay'){
      const base = tasks.filter(t => !t.completed && (t.date === today || t.date < today));
      return applySort(base);
    }
    if(selectedTab === 'Tuần'){
      const base = tasks.filter(t=> !t.completed && weekISO.includes(t.date) && t.date === selectedDateISO);
      return applySort(base);
    }
    if(selectedTab === 'Tháng'){
      const base = tasks.filter(t=> !t.completed && t.date === selectedDateISO);
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
      const res = await axios.get(`${API_BASE}/api/tasks`);
      // Map API tasks to local Task interface
      const mapped: Task[] = res.data.map((t: any) => ({
        id: t._id,
        title: t.title,
        time: t.startTime && t.endTime ? `${t.startTime}-${t.endTime}` : (t.time || ''),
        date: t.date?.split('T')[0] || '',
  endDate: t.endDate || undefined,
        priority: t.priority || 'medium',
        importance: t.importance,
        completed: t.status === 'completed',
        type: t.type || 'personal',
        status: t.status || 'todo',
        completedAt: t.completedAt,
        subTasks: t.subTasks,
        completionPercent: t.completionPercent
      }));
      setTasks(mapped);
    } catch(e:any){
      setError(e?.response?.data?.message || 'Không tải được tasks');
    } finally { setLoading(false); }
  };

  useEffect(()=>{ fetchTasks(); },[token]);

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
        priority: newTask.priority,
        importance: newTask.importance,
        completed: newTask.status === 'completed',
        type: newTask.type,
        status: newTask.status,
        subTasks: newTask.subTasks,
        completionPercent: newTask.completionPercent
      };
      setTasks(prev => [adapted, ...prev]);
    });
    const upd = DeviceEventEmitter.addListener('taskUpdated', (uTask: any) => {
      const adapted: Task = {
        id: uTask._id || uTask.id,
        title: uTask.title,
        time: uTask.startTime && uTask.endTime ? `${uTask.startTime}-${uTask.endTime}` : (uTask.time || ''),
        date: uTask.date?.split('T')[0] || uTask.date,
  endDate: uTask.endDate,
        priority: uTask.priority,
        importance: uTask.importance,
        completed: uTask.status === 'completed',
        type: uTask.type,
        status: uTask.status,
        completedAt: uTask.completedAt,
        subTasks: uTask.subTasks,
        completionPercent: uTask.completionPercent
      };
      setTasks(prev => prev.map(t=> t.id===adapted.id ? { ...t, ...adapted } : t));
    });
  const toastListener = DeviceEventEmitter.addListener('toast', (msg:string)=> setToast(msg));
  return () => { sub.remove(); upd.remove(); toastListener.remove(); };
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
                <Pressable onPress={()=> router.push('/profile')} style={styles.avatar}><Ionicons name="person" size={22} color="#fff" /></Pressable>
                <View>
                  <Text style={styles.greet}>Xin chào{user?.name ? `, ${user.name}` : ''}</Text>
                  <Text style={styles.role}>
                    {(user?.role === 'admin' && 'Quản trị') || (user?.role === 'leader' && 'Trưởng nhóm') || 'Sinh viên'} • Sẵn sàng học tập?
                  </Text>
                </View>
              </View>
              <Pressable style={styles.targetBtn}>
                <Ionicons name="flag" size={18} color="#fff" />
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
                <Text style={styles.sectionSub}>Chỉ hiển thị tác vụ của hôm nay ({todayISO})</Text>
              </View>
            )}
            {selectedTab === 'Tuần' && (
              <View style={styles.weekRow}>
    {weekISO.map((iso,i)=> {
                  const active = iso === selectedDateISO;
                  const dayNum = parseInt(iso.split('-')[2],10);
                  const info = taskMap[iso];
                  return (
                    <Pressable key={iso} onPress={()=> selectDay(iso)}>
                      <Animated.View entering={FadeInDown.delay(i*25)} style={[styles.dayBtn, active && styles.dayActive]}>                        
                        <Text style={[styles.dayText, active && styles.dayTextActive]}>{dayNum}</Text>
      {info && <View style={[styles.dotBase, { backgroundColor: info.completed === info.total ? '#9ca3af' : info.color }, active && styles.dotActiveOutline]} />}
                      </Animated.View>
                    </Pressable>
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
                      const info = taskMap[iso];
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
              </View>
            )}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Tác vụ</Text>
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
                const todayISO = new Date().toISOString().split('T')[0];
                // Attempt to parse end time from item.time (pattern HH:MM-HH:MM)
                let endTime: string | undefined;
                if(item.time && item.time.includes('-')) endTime = item.time.split('-')[1];
                const endDeadline = endTime ? new Date(`${item.endDate}T${endTime}:00`) : new Date(`${item.endDate}T23:59:59`);
                const now = new Date();
                const isEndToday = item.endDate === todayISO;
                const isOverdue = now > endDeadline;
                if(isOverdue) deadlineStyle = styles.deadlineOverdueCard;
                else if(isEndToday) deadlineStyle = styles.deadlineTodayCard;
              }
              return (
                <Pressable onLongPress={()=>{ setActionTask(item); setShowActions(true); }} delayLongPress={350} onPress={() => toggleTask(item.id)} style={[styles.taskCard, item.completed && styles.taskDone, deadlineStyle]}>          
              <Animated.View style={[styles.checkCircle, item.completed && styles.checkCircleDone]} layout={Layout.springify()}>
                {item.completed && <Ionicons name="checkmark" size={16} color="#fff" />}
              </Animated.View>
              <View style={[styles.priorityDot,{ backgroundColor: priorityColor(item.priority)}]} />
              <View style={{ flex:1 }}>
                <Text style={[styles.taskTitle, item.completed && styles.taskTitleDone]} numberOfLines={1}>{item.title}</Text>
                <View style={styles.metaRow}>
                  {!!item.time && (<>
                    <Ionicons name="time" size={12} color="#2f6690" />
                    <Text style={styles.metaText}>{item.time}</Text>
                  </>)}
                  {item.importance && <Text style={[styles.importanceBadge, item.importance==='high' && styles.importanceHigh, item.importance==='medium' && styles.importanceMed]}>{item.importance==='high'?'Quan trọng': item.importance==='medium'?'Trung bình':'Thấp'}</Text>}
                  {item.type === 'group' && <Text style={styles.groupBadge}>Nhóm</Text>}
                </View>
                {/* Subtask progress removed as requested */}
              </View>
            </Pressable>
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
                            <Text style={styles.completedMeta}>Hoàn thành lúc {new Date(t.completedAt).toLocaleString('vi-VN', { hour:'2-digit', minute:'2-digit', day:'2-digit', month:'2-digit'})}</Text>
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
          <Pressable style={[styles.fabAction,{ backgroundColor:'#2f6690' }]} onPress={()=>{ setShowFabMenu(false); router.push('/create-schedule'); }}>
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
    </SafeAreaView>
  );
}

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
});
