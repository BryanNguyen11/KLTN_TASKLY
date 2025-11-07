import React from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ActivityIndicator, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import EventForm from '@/components/EventForm';
import { useDeviceCalendarEvents } from '@/hooks/useDeviceCalendarEvents';

export default function CreateEventScreen(){
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const [formSeed, setFormSeed] = React.useState({
    title:'', date: new Date().toISOString().slice(0,10), startTime:'09:00'
  });
  const [importOpen, setImportOpen] = React.useState(false);
  const { events, loading, error, permission, requestPermission, refresh, mapToFormValues } = useDeviceCalendarEvents({ lookAheadDays: 30 });

  React.useEffect(()=>{ if(importOpen && permission==='granted'){ refresh(); } }, [importOpen, permission]);

  const handlePick = (ev: any) => {
    const mapped = mapToFormValues(ev);
    setFormSeed({
      title: mapped.title,
      date: mapped.date,
      startTime: mapped.startTime || '09:00',
      // EventForm supports extra optional fields via initialValues
      ...(mapped.endDate? { endDate: mapped.endDate }: {}),
      ...(mapped.endTime? { endTime: mapped.endTime }: {}),
      ...(mapped.location? { location: mapped.location }: {}),
      ...(mapped.notes? { notes: mapped.notes }: {}),
    } as any);
    setImportOpen(false);
  };
  return (
    <SafeAreaView style={{ flex:1, backgroundColor:'#f1f5f9' }}>
      <View style={styles.header}>
        <Pressable onPress={()=>router.back()} style={styles.backBtn}><Ionicons name='arrow-back' size={22} color='#16425b' /></Pressable>
        <Text style={styles.headerTitle}>Tạo lịch mới</Text>
        <Pressable onPress={()=> setImportOpen(true)} style={styles.importBtn}>
          <Ionicons name='download-outline' size={18} color='#16425b' />
          <Text style={styles.importText}>Import</Text>
        </Pressable>
      </View>
      <View style={{ padding:16 }}>
        <EventForm key={formSeed.title + formSeed.date + formSeed.startTime} mode='full' initialValues={formSeed as any} projectId={projectId? String(projectId): undefined} onSaved={()=> router.back()} />
      </View>
      <Modal visible={importOpen} animationType='slide' onRequestClose={()=> setImportOpen(false)}>
        <SafeAreaView style={{ flex:1, backgroundColor:'#fff' }}>
          <View style={styles.importHeader}>
            <Text style={styles.importTitle}>Chọn sự kiện từ lịch thiết bị</Text>
            <Pressable onPress={()=> setImportOpen(false)} style={styles.closeBtn}><Ionicons name='close' size={22} color='#16425b' /></Pressable>
          </View>
          <View style={{ paddingHorizontal:16, paddingBottom:8 }}>
            {permission==='undetermined' && (
              <Pressable onPress={requestPermission} style={styles.permBtn}><Text style={styles.permBtnText}>Cấp quyền truy cập lịch</Text></Pressable>
            )}
            {permission==='denied' && (
              <View style={styles.infoBox}>
                <Text style={styles.infoText}>Quyền lịch bị từ chối. Vào cài đặt cho phép hoặc thử lại.</Text>
                <Pressable onPress={requestPermission} style={styles.retryBtn}><Text style={styles.retryText}>Thử lại</Text></Pressable>
              </View>
            )}
            {permission==='granted' && (
              <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                <Text style={styles.smallLabel}>Sự kiện 30 ngày tới</Text>
                <Pressable onPress={refresh} style={styles.refreshBtn}><Ionicons name='refresh' size={18} color='#16425b' /></Pressable>
              </View>
            )}
            {loading && <ActivityIndicator color='#16425b' style={{ marginTop:20 }} />}
            {!loading && permission==='granted' && events.length===0 && (
              <Text style={styles.infoText}>Không có sự kiện nào trong khoảng thời gian này.</Text>
            )}
            {error && <Text style={[styles.infoText,{ color:'#b91c1c' }]}>{error}</Text>}
          </View>
          {permission==='granted' && events.length>0 && (
            <FlatList
              data={events}
              keyExtractor={(item)=> item.id}
              contentContainerStyle={{ padding:16, paddingBottom:40 }}
              renderItem={({ item }) => {
                const start = item.startDate;
                const end = item.endDate;
                const pad = (n:number)=> String(n).padStart(2,'0');
                const date = `${pad(start.getDate())}/${pad(start.getMonth()+1)}`;
                const time = item.allDay? 'Cả ngày' : `${pad(start.getHours())}:${pad(start.getMinutes())}${(end && end.getTime()!==start.getTime())? ' - '+pad(end.getHours())+':'+pad(end.getMinutes()):''}`;
                return (
                  <Pressable onPress={()=> handlePick(item)} style={styles.eventRow}>
                    <View style={{ flex:1 }}>
                      <Text style={styles.eventTitle} numberOfLines={1}>{item.title}</Text>
                      <Text style={styles.eventMeta}>{date} · {time}</Text>
                      {item.calendarTitle && <Text style={styles.eventCalendar}>{item.calendarTitle}</Text>}
                    </View>
                    <Ionicons name='arrow-forward' size={18} color='#64748b' />
                  </Pressable>
                );
              }}
            />
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingTop:4, paddingBottom:8, backgroundColor:'#f1f5f9' },
  backBtn:{ width:40, height:40, borderRadius:20, alignItems:'center', justifyContent:'center' },
  headerTitle:{ fontSize:18, fontWeight:'600', color:'#16425b' },
  importBtn:{ flexDirection:'row', alignItems:'center', gap:4, paddingHorizontal:10, paddingVertical:6, borderRadius:20, backgroundColor:'#e2e8f0' },
  importText:{ fontSize:12, fontWeight:'600', color:'#16425b' },
  importHeader:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingTop:8, paddingBottom:12, backgroundColor:'#f1f5f9' },
  importTitle:{ fontSize:16, fontWeight:'700', color:'#16425b' },
  closeBtn:{ width:40, height:40, borderRadius:20, alignItems:'center', justifyContent:'center' },
  permBtn:{ backgroundColor:'#3a7ca5', paddingHorizontal:16, paddingVertical:12, borderRadius:12, alignSelf:'flex-start' },
  permBtnText:{ color:'#fff', fontWeight:'600' },
  infoBox:{ backgroundColor:'#f1f5f9', padding:12, borderRadius:12 },
  infoText:{ fontSize:13, color:'#475569', lineHeight:18 },
  retryBtn:{ marginTop:8, backgroundColor:'#e2e8f0', paddingHorizontal:12, paddingVertical:8, borderRadius:10, alignSelf:'flex-start' },
  retryText:{ color:'#16425b', fontWeight:'600', fontSize:12 },
  smallLabel:{ fontSize:12, color:'#64748b', fontWeight:'600' },
  refreshBtn:{ padding:8, borderRadius:12, backgroundColor:'#e2e8f0' },
  eventRow:{ flexDirection:'row', alignItems:'center', paddingVertical:14, borderBottomWidth:1, borderColor:'#e2e8f0', gap:12 },
  eventTitle:{ fontSize:14, fontWeight:'600', color:'#0f172a', marginBottom:2 },
  eventMeta:{ fontSize:12, color:'#475569' },
  eventCalendar:{ fontSize:11, color:'#64748b', marginTop:2 },
});
