import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, DeviceEventEmitter } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { mockTasks, mockProjects, calculateProgress, Task, getDaysOfWeek, getCurrentWeek, priorityColor } from '@/utils/dashboard';
import { Ionicons } from '@expo/vector-icons';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withTiming, 
  Easing, 
  FadeInDown, 
  FadeOutUp, 
  Layout, 
  withRepeat,
  withSequence
} from 'react-native-reanimated';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'expo-router';
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export default function DashboardScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>(mockTasks);
  const [selectedTab, setSelectedTab] = useState<'Hôm nay' | 'Tuần' | 'Tháng'>('Hôm nay');
  const [selectedDate, setSelectedDate] = useState<number>(() => new Date().getDate());
  const days = getDaysOfWeek();
  const weekDates = getCurrentWeek();

  const toggleTask = (id: string) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, completed: !t.completed, status: !t.completed ? 'completed' : 'todo' } : t));
  };

  // Listen for new task created from create-task screen
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('taskCreated', (newTask: Task) => {
      setTasks(prev => [newTask, ...prev]);
    });
    return () => sub.remove();
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

  return (
    <SafeAreaView style={{ flex:1, backgroundColor:'#f1f5f9' }} edges={['top']}>
      <FlatList
      data={tasks}
      keyExtractor={item => item.id}
      contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
      ListHeaderComponent={
        <View>
          <View style={styles.headerRow}>            
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={styles.avatar}><Ionicons name="person" size={22} color="#fff" /></View>
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

          <View style={styles.weekRow}>
            {weekDates.map((d,i) => {
              const active = selectedDate === d;
              return (
                <Pressable key={i} onPress={() => setSelectedDate(d)}>
                  <Animated.View
                    entering={FadeInDown.delay(i*30)}
                    style={[styles.dayBtn, active && styles.dayActive]}
                  >
                    <Text style={[styles.dayText, active && styles.dayTextActive]}>{d}</Text>
                  </Animated.View>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.sectionHeader}>            
            <Text style={styles.sectionTitle}>Công việc hôm nay</Text>
            <Text style={styles.sectionSub}>{tasks.filter(t=>!t.completed).length} còn lại</Text>
          </View>
        </View>
      }
      renderItem={({ item, index }) => (
        <Animated.View
          entering={FadeInDown.delay(index*60).springify()}
          exiting={FadeOutUp}
          layout={Layout.springify()}
        >
          <Pressable onPress={() => toggleTask(item.id)} style={[styles.taskCard, item.completed && styles.taskDone]}>          
            <Animated.View style={[styles.checkCircle, item.completed && styles.checkCircleDone]} layout={Layout.springify()}>
              {item.completed && <Ionicons name="checkmark" size={16} color="#fff" />}
            </Animated.View>
            <View style={[styles.priorityDot,{ backgroundColor: priorityColor(item.priority)}]} />
            <View style={{ flex:1 }}>
              <Text style={[styles.taskTitle, item.completed && styles.taskTitleDone]} numberOfLines={1}>{item.title}</Text>
              <View style={styles.metaRow}>
                <Ionicons name="time" size={12} color="#2f6690" />
                <Text style={styles.metaText}>{item.time}</Text>
                {item.type === 'group' && <Text style={styles.groupBadge}>Nhóm</Text>}
              </View>
            </View>
          </Pressable>
        </Animated.View>
      )}
      ListFooterComponent={
        <View style={{ marginTop: 16 }}>
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
              <QuickAction iconName='flag' label='AI Gợi ý' bg='rgba(47,102,144,0.12)' color='#2f6690' />
              <QuickAction iconName='book' label='Ghi chú' bg='rgba(22,66,91,0.1)' color='#16425b' />
            </View>
          </View>
        </View>
      }
    />
    {/* Floating Action Button with pulse */}
  <AnimatedPressable style={[styles.fab, fabStyle]} onPress={()=> router.push('/create-task')}>
      <Ionicons name='add' size={28} color='#fff' />
    </AnimatedPressable>
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
  checkCircle: { width:28, height:28, borderRadius:14, borderWidth:2, borderColor:'#2f6690', alignItems:'center', justifyContent:'center', marginRight: 12 },
  checkCircleDone: { backgroundColor:'#3a7ca5', borderColor:'#3a7ca5' },
  priorityDot: { width:10, height:10, borderRadius:5, marginRight: 12 },
  taskTitle: { fontSize:15, fontWeight:'500', color:'#16425b', marginBottom:4 },
  taskTitleDone: { textDecorationLine:'line-through', color:'#2f6690' },
  metaRow: { flexDirection:'row', alignItems:'center', gap:6 },
  metaText: { fontSize:12, color:'#2f6690', marginLeft:4, marginRight:8 },
  groupBadge: { fontSize:11, backgroundColor:'#81c3d7', color:'#fff', paddingHorizontal:8, paddingVertical:2, borderRadius:12 },
  projectsTitle: { fontSize:16, fontWeight:'600', color:'#16425b', marginBottom:12 },
  projectCard: { backgroundColor:'rgba(58,124,165,0.08)', borderRadius:18, padding:14, marginBottom:12 },
  projectName: { fontSize:14, fontWeight:'600', color:'#16425b' },
  leaderBadge: { fontSize:10, backgroundColor:'#3a7ca5', color:'#fff', paddingHorizontal:8, paddingVertical:3, borderRadius:12 },
  projectMeta: { fontSize:12, color:'#2f6690' },
  quickTitle: { fontSize:16, fontWeight:'600', color:'#16425b', marginBottom:14 },
  quickGrid: { flexDirection:'row', flexWrap:'wrap', justifyContent:'space-between' },
  quickBtn: { width:'48%', borderRadius:18, paddingVertical:18, alignItems:'center', marginBottom:12 },
  quickLabel: { fontSize:12, fontWeight:'500', color:'#3a7ca5' },
  fab: { position:'absolute', bottom:28, right:24, width:64, height:64, borderRadius:32, backgroundColor:'#3a7ca5', alignItems:'center', justifyContent:'center', shadowColor:'#000', shadowOpacity:0.2, shadowRadius:6, elevation:6 },
});
