import React, { useEffect, useMemo, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, Pressable, ScrollView, Alert, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import axios from 'axios';
import { useAuth } from '@/contexts/AuthContext';
import { useDeviceCalendarEvents, DeviceCalendarEvent } from '@/hooks/useDeviceCalendarEvents';

type Mode = 'month' | 'year' | 'custom';

function toISO(d: Date){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function addMonths(d: Date, n: number){ const x = new Date(d); x.setMonth(x.getMonth()+n); return x; }

export default function ImportDeviceCalendar(){
  const router = useRouter();
  const { token } = useAuth();
  const API_BASE = process.env.EXPO_PUBLIC_API_BASE;
  const [mode, setMode] = useState<Mode>('month');
  const [anchor, setAnchor] = useState<Date>(new Date()); // month or year anchor
  const [from, setFrom] = useState<Date>(new Date());
  const [to, setTo] = useState<Date>(new Date());
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);
  const range = useMemo(()=>{
    if(mode==='month'){
      const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      const end = new Date(anchor.getFullYear(), anchor.getMonth()+1, 0);
      return { start, end };
    }
    if(mode==='year'){
      const start = new Date(anchor.getFullYear(), 0, 1);
      const end = new Date(anchor.getFullYear(), 11, 31);
      return { start, end };
    }
    return { start: from, end: to };
  }, [mode, anchor, from, to]);

  // Fetch device events within range using existing hook
  const { events, loading, error, refreshRange } = useDeviceCalendarEvents();
  useEffect(()=>{ refreshRange(range.start, range.end); }, [range.start, range.end, refreshRange]);

  // Build a deduped flat list and skip empty calendars
  const { flatEvents, nonEmptyCalendars } = useMemo(() => {
    // Build calendar grouping by calendarTitle
    const byCal: Record<string, DeviceCalendarEvent[]> = {};
    events.forEach(ev => {
      const key = (ev.calendarTitle || 'Lịch');
      byCal[key] = byCal[key] || [];
      byCal[key].push(ev);
    });
    const nonEmpty = Object.keys(byCal).filter(id => (byCal[id]||[]).length>0);
    const all: DeviceCalendarEvent[] = [];
    nonEmpty.forEach(id => { all.push(...(byCal[id]||[])); });
    // Deduplicate by title + start + end + location
    const seen = new Set<string>();
    const dedup: DeviceCalendarEvent[] = [];
    all.forEach(ev => {
      const key = `${(ev.title||'').trim()}|${ev.startDate.toISOString()}|${ev.endDate.toISOString()}|${(ev.location||'').trim()}`;
      if(!seen.has(key)){ seen.add(key); dedup.push(ev); }
    });
    return { flatEvents: dedup, nonEmptyCalendars: nonEmpty };
  }, [events]);

  const goPrevMonth = () => setAnchor(prev => addMonths(prev, -1));
  const goNextMonth = () => setAnchor(prev => addMonths(prev, 1));
  const goPrevYear = () => setAnchor(prev => new Date(prev.getFullYear()-1, prev.getMonth(), prev.getDate()));
  const goNextYear = () => setAnchor(prev => new Date(prev.getFullYear()+1, prev.getMonth(), prev.getDate()));

  const onImport = async () => {
    if(!token){ Alert.alert('Lỗi','Chưa đăng nhập'); return; }
    if(flatEvents.length===0){ Alert.alert('Không có dữ liệu','Không có sự kiện nào trong khoảng đã chọn'); return; }
    try{
      // Post each deduped event to backend; backend should avoid duplicates
      const payloads = flatEvents.map(ev => {
        const pad = (n:number)=> String(n).padStart(2,'0');
        const st = ev.startDate; const et = ev.endDate;
        const startTime = `${pad(st.getHours())}:${pad(st.getMinutes())}`;
        const endTime = `${pad(et.getHours())}:${pad(et.getMinutes())}`;
        return {
          title: ev.title || 'Sự kiện',
          date: toISO(new Date(ev.startDate)),
          endDate: ev.endDate ? toISO(new Date(ev.endDate)) : undefined,
          startTime,
          endTime,
          location: ev.location || '',
          notes: ev.notes || '',
          link: '',
        };
      });
      await Promise.all(payloads.map(p => axios.post(`${API_BASE}/api/events`, p, { headers:{ Authorization: `Bearer ${token}` } })));
      Alert.alert('Thành công', `Đã nhập ${payloads.length} lịch từ thiết bị`);
      router.back();
    }catch(e:any){
      Alert.alert('Lỗi', e?.response?.data?.message || 'Không thể nhập lịch');
    }
  };

  return (
    <SafeAreaView style={{ flex:1, backgroundColor:'#f1f5f9' }}>
      <View style={styles.header}>
        <Pressable onPress={()=>router.back()} style={styles.backBtn}><Ionicons name='chevron-back' size={22} color='#16425b' /></Pressable>
        <Text style={styles.headerTitle}>Nhập lịch từ thiết bị</Text>
        <View style={{ width:40 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding:16 }}>
        <Text style={styles.sectionTitle}>Phạm vi</Text>
        <View style={styles.modeRow}>
          {(['month','year','custom'] as Mode[]).map(m => (
            <Pressable key={m} onPress={()=> setMode(m)} style={[styles.modeBtn, mode===m && styles.modeBtnActive]}>
              <Text style={[styles.modeText, mode===m && styles.modeTextActive]}>{m==='month'?'Tháng': m==='year'?'Năm':'Tùy chọn'}</Text>
            </Pressable>
          ))}
        </View>
        {mode!=='custom' && (
          <View style={styles.navRow}>
            <Pressable onPress={mode==='month'? goPrevMonth : goPrevYear} style={styles.navBtn}><Ionicons name='chevron-back' size={18} color='#16425b' /></Pressable>
            <Text style={styles.navTitle}>
              {mode==='month' ? `${anchor.getFullYear()} - ${String(anchor.getMonth()+1).padStart(2,'0')}` : `${anchor.getFullYear()}`}
            </Text>
            <Pressable onPress={mode==='month'? goNextMonth : goNextYear} style={styles.navBtn}><Ionicons name='chevron-forward' size={18} color='#16425b' /></Pressable>
          </View>
        )}
        {mode==='custom' && (
          <View style={styles.customRow}>
            <Pressable onPress={()=> setShowFromPicker(true)} style={styles.dateBtn}>
              <Ionicons name='calendar-outline' size={16} color='#2f6690' />
              <Text style={styles.dateText}>Từ: {toISO(from)}</Text>
            </Pressable>
            <Pressable onPress={()=> setShowToPicker(true)} style={styles.dateBtn}>
              <Ionicons name='calendar-outline' size={16} color='#2f6690' />
              <Text style={styles.dateText}>Đến: {toISO(to)}</Text>
            </Pressable>
          </View>
        )}
        {showFromPicker && (
          <DateTimePicker value={from} mode='date' display={Platform.OS==='ios'?'inline':'default'} onChange={(e, d)=>{ setShowFromPicker(false); if(d) setFrom(d); }} />
        )}
        {showToPicker && (
          <DateTimePicker value={to} mode='date' display={Platform.OS==='ios'?'inline':'default'} onChange={(e, d)=>{ setShowToPicker(false); if(d) setTo(d); }} />
        )}
        <Text style={[styles.sectionTitle,{ marginTop:16 }]}>Nguồn lịch (tự động bỏ trống)</Text>
        <View style={styles.sourceList}>
          {nonEmptyCalendars.length===0 && !loading && (
            <Text style={styles.empty}>Không có lịch nào trong phạm vi đã chọn</Text>
          )}
          {nonEmptyCalendars.map(id => (
            <View key={id} style={styles.sourceChip}>
              <Ionicons name='calendar-outline' size={14} color='#2f6690' />
              <Text style={styles.sourceText}>{id}</Text>
            </View>
          ))}
        </View>
        <Text style={[styles.sectionTitle,{ marginTop:16 }]}>Sự kiện sẽ nhập</Text>
        {loading && <Text style={styles.subtle}>Đang tải...</Text>}
        {error && <Text style={styles.error}>Lỗi: {error}</Text>}
        {!loading && flatEvents.length>0 ? (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryText}>Tổng: {flatEvents.length} sự kiện (đã loại trùng)</Text>
          </View>
        ) : (
          <Text style={styles.subtle}>Không có sự kiện trong phạm vi</Text>
        )}
      </ScrollView>
      <View style={styles.footer}>
        <Pressable onPress={()=> refreshRange(range.start, range.end)} style={[styles.actionBtn, styles.secondary]}>
          <Text style={styles.secondaryText}>Làm mới</Text>
        </Pressable>
        <Pressable onPress={onImport} style={[styles.actionBtn, styles.primary]}>
          <Text style={styles.primaryText}>Nhập tất cả</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingTop:8, paddingBottom:8, backgroundColor:'#f1f5f9' },
  backBtn:{ width:40, height:40, borderRadius:20, alignItems:'center', justifyContent:'center' },
  headerTitle:{ fontSize:18, fontWeight:'700', color:'#16425b' },
  sectionTitle:{ fontSize:16, fontWeight:'700', color:'#16425b', marginBottom:8 },
  modeRow:{ flexDirection:'row', gap:8 },
  modeBtn:{ paddingHorizontal:12, paddingVertical:8, borderRadius:20, backgroundColor:'rgba(58,124,165,0.08)' },
  modeBtnActive:{ backgroundColor:'#3a7ca5' },
  modeText:{ color:'#2f6690', fontWeight:'600', fontSize:12 },
  modeTextActive:{ color:'#fff' },
  navRow:{ flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8, marginTop:10 },
  navBtn:{ paddingHorizontal:10, paddingVertical:6, borderRadius:12, backgroundColor:'rgba(58,124,165,0.1)' },
  navTitle:{ color:'#2f6690', fontWeight:'700' },
  customRow:{ flexDirection:'row', alignItems:'center', gap:12, marginTop:8 },
  dateBtn:{ flexDirection:'row', alignItems:'center', gap:6, paddingHorizontal:12, paddingVertical:8, borderRadius:12, backgroundColor:'#e2e8f0' },
  dateText:{ color:'#16425b', fontWeight:'600' },
  sourceList:{ marginTop:6 },
  sourceChip:{ flexDirection:'row', alignItems:'center', gap:8, paddingHorizontal:10, paddingVertical:6, borderRadius:12, borderWidth:1, borderColor:'#e2e8f0', backgroundColor:'#fff', marginBottom:6 },
  sourceText:{ color:'#2f6690', flex:1 },
  sourceCount:{ color:'#16425b', fontWeight:'700' },
  summaryCard:{ padding:12, borderRadius:12, backgroundColor:'#fff', borderWidth:1, borderColor:'#e2e8f0' },
  summaryText:{ color:'#16425b', fontWeight:'600' },
  subtle:{ color:'#607d8b' },
  error:{ color:'#ef4444' },
  empty:{ color:'#607d8b' },
  footer:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', padding:12, borderTopWidth:1, borderTopColor:'#e2e8f0', backgroundColor:'#fff' },
  actionBtn:{ paddingHorizontal:14, paddingVertical:10, borderRadius:12, alignItems:'center', justifyContent:'center' },
  primary:{ backgroundColor:'#3a7ca5' },
  primaryText:{ color:'#fff', fontWeight:'700' },
  secondary:{ backgroundColor:'#e2e8f0' },
  secondaryText:{ color:'#16425b', fontWeight:'700' },
});
