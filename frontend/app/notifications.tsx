import React from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useNotifications } from '@/contexts/NotificationContext';

const NotificationsScreen: React.FC = () => {
  const router = useRouter();
  const { notifications, unreadCount, markAllRead, removeById, markRead, clearAll } = useNotifications();

  const onClearAll = () => {
    Alert.alert('Xóa thông báo', 'Bạn muốn xóa tất cả thông báo?', [
      { text: 'Hủy', style:'cancel' },
      { text: 'Xóa', style:'destructive', onPress: clearAll }
    ]);
  };

  const onOpenFromNotification = (item: any) => {
    markRead(item.id);
    // Navigate based on type
    if(item.type === 'project-invite' || item.type === 'project-update'){
      if(item.projectId){
        // Open project detail modal via dashboard event bridge
        // Using DeviceEventEmitter would be ideal, but here we can route to dashboard and trigger
        router.push('/');
        setTimeout(() => {
          // @ts-ignore rely on dashboard listener if present
          // In our app we already listen DeviceEventEmitter 'openProjectDetail'
          // so emit that event. If not available here, we can navigate directly to members screen
          try { (global as any).DeviceEventEmitter?.emit?.('openProjectDetail', { id: item.projectId }); } catch {}
        }, 250);
      }
      return;
    }
    if((item.type === 'task-assigned' || item.type === 'task-updated') && item.taskId){
      router.push({ pathname: '/create-task', params:{ editId: item.taskId } });
      return;
    }
  };

  const renderItem = ({ item }: any) => (
    <Pressable style={[styles.itemRow, !item.read && styles.itemUnread]} onPress={() => onOpenFromNotification(item)}>
      <Ionicons name={
        item.type==='upcoming-task'? 'time-outline' :
        item.type==='upcoming-event'? 'calendar-outline' :
        item.type==='project-invite'? 'mail-outline' :
        'information-circle-outline'
      } size={20} color={'#2f6690'} />
      <View style={{ flex:1 }}>
        <Text style={styles.itemTitle} numberOfLines={2}>{item.title}</Text>
        {!!item.meta && <Text style={styles.itemMeta}>{item.meta}</Text>}
        <Text style={styles.itemTime}>{new Date(item.at).toLocaleString('vi-VN')}</Text>
      </View>
      <Pressable onPress={() => removeById(item.id)} style={styles.itemDelete}>
        <Ionicons name='close' size={18} color={'#b91c1c'} />
      </Pressable>
    </Pressable>
  );

  return (
    <SafeAreaView style={{ flex:1, backgroundColor:'#fff' }}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name='chevron-back' size={22} color={'#16425b'} />
        </Pressable>
        <Text style={styles.headerTitle}>Thông báo</Text>
        <Pressable onPress={markAllRead} style={styles.headerBtn}>
          <Ionicons name='checkmark-done-outline' size={20} color={'#16425b'} />
        </Pressable>
      </View>
      <View style={styles.subHeader}>
        <Text style={styles.subText}>{unreadCount} chưa đọc</Text>
        <Pressable onPress={onClearAll} style={styles.clearBtn}>
          <Ionicons name='trash-outline' size={16} color={'#dc2626'} />
          <Text style={styles.clearText}>Xóa tất cả</Text>
        </Pressable>
      </View>
      <FlatList
        data={notifications}
        keyExtractor={item => item.id}
        contentContainerStyle={{ padding:16, paddingBottom: 40 }}
        renderItem={renderItem}
        ListEmptyComponent={<Text style={{ color:'#607d8b', textAlign:'center', marginTop:32 }}>Không có thông báo</Text>}
      />
    </SafeAreaView>
  );
};

export default NotificationsScreen;

const styles = StyleSheet.create({
  header:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:12, paddingVertical:10, borderBottomWidth:1, borderBottomColor:'rgba(0,0,0,0.06)' },
  headerBtn:{ padding:8, borderRadius:12, backgroundColor:'rgba(58,124,165,0.08)' },
  headerTitle:{ fontSize:16, fontWeight:'700', color:'#16425b' },
  subHeader:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingVertical:10 },
  subText:{ color:'#2f6690', fontWeight:'600' },
  clearBtn:{ flexDirection:'row', alignItems:'center', gap:6, paddingHorizontal:10, paddingVertical:6, borderRadius:12, backgroundColor:'rgba(220,38,38,0.08)' },
  clearText:{ color:'#dc2626', fontWeight:'700', fontSize:12 },
  itemRow:{ flexDirection:'row', alignItems:'flex-start', gap:10, backgroundColor:'#f8fafc', borderWidth:1, borderColor:'#e2e8f0', padding:12, borderRadius:14, marginBottom:10 },
  itemUnread:{ backgroundColor:'#fff', borderColor:'#3a7ca5' },
  itemTitle:{ color:'#16425b', fontWeight:'600' },
  itemMeta:{ color:'#607d8b', fontSize:12, marginTop:2 },
  itemTime:{ color:'#64748b', fontSize:11, marginTop:4 },
  itemDelete:{ padding:6, borderRadius:10, backgroundColor:'rgba(220,38,38,0.08)' }
});
