import React, { useMemo, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, Pressable, ScrollView, Alert, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import axios from 'axios';
import { useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useDeviceCalendarEvents } from '@/hooks/useDeviceCalendarEvents';

type Mode = 'month' | 'year' | 'custom';

const pad = (n:number)=> String(n).padStart(2,'0');
const toISO = (d:Date)=> `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

export default function ImportDeviceCalendars(){
  const router = useRouter();
  const { token } = useAuth();
  const API_BASE = process.env.EXPO_PUBLIC_API_BASE;
  const [mode, setMode] = useState<Mode>('month');
  const [from, setFrom] = useState<Date>(new Date());
  const [to, setTo] = useState<Date>(()=>{ const d=new Date(); d.setMonth(d.getMonth()+1); return d; });
  const [showFrom, setShowFrom] = useState(false);
  const [showTo, setShowTo] = useState(false);

  const { events, loading, error, permission, requestPermission, refreshRange, mapToFormValues } = useDeviceCalendarEvents({ includeAllDay: true });

  React.useEffect(()=>{ requestPermission(); },[]);

  React.useEffect(()=>{
    // Adjust range based on mode
    const now = new Date();
    if(mode==='month'){
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth()+1, 0);
      setFrom(start); setTo(end);
      refreshRange(start, end);
    } else if(mode==='year'){
      const start = new Date(now.getFullYear(), 0, 1);
      const end = new Date(now.getFullYear(), 11, 31);
      setFrom(start); setTo(end);
      refreshRange(start, end);
    } else {
      refreshRange(from, to);
    }
  }, [mode]);

  const onFromChange = (_:any, d?:Date)=>{ setShowFrom(false); if(d){ setFrom(d); if(mode==='custom') refreshRange(d, to); } };
  const onToChange = (_:any, d?:Date)=>{ setShowTo(false); if(d){ setTo(d); if(mode==='custom') refreshRange(from, d); } };

  // Deduplicate identical events across calendars by key
  const deduped = useMemo(()=>{
    const key = (e:any)=> `${(e.title||'').trim().toLowerCase()}|${new Date(e.startDate).getTime()}|${new Date(e.endDate).getTime()}|${(e.location||'').trim().toLowerCase()}`;
    const seen = new Set<string>();
    const out: typeof events = [] as any;
    for(const ev of events){ const k = key(ev); if(!seen.has(k)){ seen.add(k); out.push(ev); } }
    return out;
  }, [events]);

  const importAll = async () => {
    if(permission!=='granted'){ Alert.alert('Thiếu quyền','Cần cấp quyền truy cập lịch'); return; }
    if(!token){ Alert.alert('Lỗi','Chưa đăng nhập'); return; }
    try{
      const list = deduped;
      if(list.length===0){ Alert.alert('Không có dữ liệu','Không tìm thấy sự kiện trong phạm vi'); return; }
      // Map to backend event payloads
      const payloads = list.map(ev => ({
        ...mapToFormValues(ev),
        typeId: undefined, // backend will assign default type if missing
      }));
      // Post sequentially to avoid rate spikes; skip duplicates on server side by title+date+time heuristic
      let ok=0, fail=0;
      for(const p of payloads){
        try{
          await axios.post(`${API_BASE}/api/events`, p, { headers:{ Authorization: token?`Bearer ${token}`:'' } });
          ok++;
        }catch(_e){ fail++; }
      }
      Alert.alert('Nhập lịch', `Thành công: ${ok} • Lỗi: ${fail}`);
      router.back();
    }catch(e:any){
      Alert.alert('Lỗi', e?.response?.data?.message || e?.message || 'Không thể nhập lịch');
    }
  };

  return (
    <SafeAreaView style={{ flex:1, backgroundColor:'#f1f5f9' }}>
      <View style={styles.header}>
        <Pressable onPress={()=> router.back()} style={styles.backBtn}><Ionicons name='chevron-back' size={22} color='#16425b' /></Pressable>
        <Text style={styles.headerTitle}>Nhập lịch từ hệ thống</Text>
        <View style={{ width:40 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding:16, paddingBottom:24 }}>
        <Text style={styles.sectionTitle}>Phạm vi</Text>
        <View style={styles.modesRow}>
          {(['month','year','custom'] as const).map(m => {
            const label = m==='month'?'Tháng': m==='year'?'Năm':'Tùy chọn';
            const active = mode===m;
            return (
              <Pressable key={m} onPress={()=> setMode(m)} style={[styles.modeChip, active && styles.modeChipActive]}>
                <Text style={[styles.modeChipText, active && styles.modeChipTextActive]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={{ flexDirection:'row', alignItems:'center', gap:10, marginTop:8 }}>
          <Pressable onPress={()=> setShowFrom(true)} style={styles.rangeBtn}>
            <Ionicons name='calendar-outline' size={16} color='#2f6690' />
            <Text style={styles.rangeText}>Từ: {toISO(from)}</Text>
          </Pressable>
          <Pressable onPress={()=> setShowTo(true)} style={styles.rangeBtn}>
            <Ionicons name='calendar-outline' size={16} color='#2f6690' />
            <Text style={styles.rangeText}>Đến: {toISO(to)}</Text>
          </Pressable>
        </View>
        {Platform.OS!=='web' && showFrom && (
          <DateTimePicker value={from} mode='date' onChange={onFromChange} />
        )}
        {Platform.OS!=='web' && showTo && (
          <DateTimePicker value={to} mode='date' onChange={onToChange} />
        )}

        <View style={{ marginTop:16, flexDirection:'row', alignItems:'center', justifyContent:'space-between' }}>
          <Text style={styles.sectionTitle}>Lịch tìm thấy</Text>
          <Pressable disabled={loading} onPress={()=> refreshRange(from, to)} style={[styles.refreshBtn, loading && { opacity:0.5 }]}>
            <Ionicons name='refresh' size={16} color='#fff' />
            <Text style={styles.refreshText}>{loading? 'Đang tải...' : 'Làm mới'}</Text>
          </Pressable>
        </View>

        {!!error && <Text style={styles.errorText}>{error}</Text>}
        {permission!=='granted' && (
          <Text style={styles.warningText}>Chưa có quyền truy cập lịch. Hãy cấp quyền để tiếp tục.</Text>
        )}

        <View style={{ marginTop:8 }}>
          {deduped.length===0 ? (
            <Text style={styles.subtle}>Không có sự kiện trong phạm vi.</Text>
          ) : (
            <Text style={styles.subtle}>Sẽ nhập {deduped.length} sự kiện (đã loại trùng).</Text>
          )}
        </View>

        <View style={{ marginTop:16 }}>
          <Pressable disabled={loading || permission!=='granted'} onPress={importAll} style={[styles.primaryBtn, (loading || permission!=='granted') && { opacity:0.6 }]}>
            <Text style={styles.primaryText}>Nhập tất cả</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingTop:8, paddingBottom:8, backgroundColor:'#f1f5f9' },
  backBtn:{ width:40, height:40, borderRadius:20, alignItems:'center', justifyContent:'center' },
  headerTitle:{ fontSize:18, fontWeight:'700', color:'#16425b' },
  sectionTitle:{ color:'#16425b', fontWeight:'700', fontSize:16 },
  modesRow:{ flexDirection:'row', gap:8, marginTop:8, flexWrap:'wrap' },
  modeChip:{ paddingHorizontal:12, paddingVertical:8, backgroundColor:'rgba(58,124,165,0.08)', borderRadius:20 },
  modeChipActive:{ backgroundColor:'#3a7ca5' },
  modeChipText:{ color:'#2f6690', fontWeight:'600', fontSize:12 },
  modeChipTextActive:{ color:'#fff' },
  rangeBtn:{ flexDirection:'row', alignItems:'center', gap:6, paddingHorizontal:12, paddingVertical:8, borderRadius:12, backgroundColor:'#e2e8f0' },
  rangeText:{ color:'#16425b', fontWeight:'600', fontSize:12 },
  refreshBtn:{ flexDirection:'row', alignItems:'center', gap:6, paddingHorizontal:12, paddingVertical:8, borderRadius:12, backgroundColor:'#3a7ca5' },
  refreshText:{ color:'#fff', fontWeight:'700', fontSize:12 },
  subtle:{ color:'#607d8b' },
  warningText:{ color:'#b91c1c' },
  errorText:{ color:'#b91c1c', marginTop:8 },
  primaryBtn:{ paddingHorizontal:14, paddingVertical:10, borderRadius:12, backgroundColor:'#3a7ca5', alignItems:'center' },
  primaryText:{ color:'#fff', fontWeight:'700' },
});
