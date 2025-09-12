import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { mockTasks, calculateProgress, Task, getDaysOfWeek, getCurrentWeek, priorityColor } from '@/utils/dashboard';
import { Ionicons } from '@expo/vector-icons';

export default function DashboardScreen() {
  const [tasks, setTasks] = useState<Task[]>(mockTasks);
  const [selectedTab, setSelectedTab] = useState<'Hôm nay' | 'Tuần' | 'Tháng'>('Hôm nay');
  const [selectedDate, setSelectedDate] = useState<number>(() => new Date().getDate());
  const days = getDaysOfWeek();
  const weekDates = getCurrentWeek();

  const toggleTask = (id: string) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, completed: !t.completed } : t));
  };

  const completed = tasks.filter(t => t.completed).length;
  const total = tasks.length;
  const progress = calculateProgress(completed, total);

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
                <Text style={styles.greet}>Xin chào</Text>
                <Text style={styles.role}>Sinh viên • Sẵn sàng học tập?</Text>
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
              <View style={[styles.progressBarFill,{ width: `${progress}%` }]} />
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
            {weekDates.map((d,i) => (
              <Pressable key={i} onPress={() => setSelectedDate(d)} style={[styles.dayBtn, selectedDate === d && styles.dayActive]}>
                <Text style={[styles.dayText, selectedDate === d && styles.dayTextActive]}>{d}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.sectionHeader}>            
            <Text style={styles.sectionTitle}>Công việc hôm nay</Text>
            <Text style={styles.sectionSub}>{tasks.filter(t=>!t.completed).length} còn lại</Text>
          </View>
        </View>
      }
      renderItem={({ item }) => (
        <Pressable onPress={() => toggleTask(item.id)} style={[styles.taskCard, item.completed && styles.taskDone]}>          
          <View style={[styles.checkCircle, item.completed && styles.checkCircleDone]}>
            {item.completed && <Ionicons name="checkmark" size={16} color="#fff" />}
          </View>
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
      )}
    />
    </SafeAreaView>
  );
}

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
});
