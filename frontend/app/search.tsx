import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, Platform, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import axios from 'axios';
import { useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';

type RepeatRule = { frequency: 'daily'|'weekly'|'monthly'|'yearly'; endMode?: 'never'|'onDate'|'after'; endDate?: string; count?: number };
type EventItem = { id:string; title:string; date:string; endDate?:string; startTime?:string; endTime?:string; location?:string; repeat?: RepeatRule; projectId?: string; notes?: string };
type Task = { id:string; title:string; date:string; endDate?:string; startTime?:string; endTime?:string; time?: string; priority?: string; importance?: string; completed?: boolean; type?: 'personal'|'group'; projectId?: string };

const toLocalISODate = (d?: Date) => {
  const dt = d || new Date();
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const dayNumFromISO = (iso:string) => {
  if(!iso) return 0; const [y,m,d] = iso.split('-').map(Number); const dt = new Date(y,(m||1)-1,d||1); const js = dt.getDay(); return js===0?7:js;
};

export default function SearchScreen(){
  const router = useRouter();
  const { token } = useAuth();
  const API_BASE = process.env.EXPO_PUBLIC_API_BASE;
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all'|'tasks'|'events'>('all');
  const [filterWeekday, setFilterWeekday] = useState<number|null>(null);
  const [filterFromISO, setFilterFromISO] = useState<string|null>(null);
  const [filterToISO, setFilterToISO] = useState<string|null>(null);
  const [showFilters, setShowFilters] = useState(true);
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);
  const [fromDraft, setFromDraft] = useState<Date | null>(null);
  const [toDraft, setToDraft] = useState<Date | null>(null);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(false);

  const matchesWeekday = (iso?:string) => {
    if(!iso) return false; if(!filterWeekday) return true; return dayNumFromISO(iso)===filterWeekday;
  };
  const inRange = (iso?:string) => {
    if(!iso) return false; if(filterFromISO && iso < filterFromISO) return false; if(filterToISO && iso > filterToISO) return false; return true;
  };
  const filteredTasks = useMemo(()=> tasks.filter(t => matchesWeekday(t.date) && inRange(t.date)), [tasks, filterWeekday, filterFromISO, filterToISO]);
  const filteredEvents = useMemo(()=> events.filter(e => matchesWeekday(e.date) && inRange(e.date)), [events, filterWeekday, filterFromISO, filterToISO]);

  const fetchAll = async () => {
    if(!token) return; setLoading(true);
    try{
      const params:any = {}; if(query.trim()) params.q=query.trim(); if(filterFromISO) params.from=filterFromISO; if(filterToISO) params.to=filterToISO;
      if(typeFilter !== 'events'){
        const tr = await axios.get(`${API_BASE}/api/tasks`, { params, headers:{ Authorization:`Bearer ${token}` } });
        const mapped: Task[] = tr.data.map((t:any)=> ({ id:t._id, title:t.title, date:t.date?.split('T')[0]||'', endDate:t.endDate, startTime:t.startTime, endTime:t.endTime, time: t.startTime&&t.endTime?`${t.startTime}-${t.endTime}`:t.time, priority:t.priority, importance:t.importance, completed: t.status==='completed', type: t.type, projectId: t.projectId }));
        setTasks(mapped);
      } else { setTasks([]); }
      if(typeFilter !== 'tasks'){
        const er = await axios.get(`${API_BASE}/api/events`, { params, headers:{ Authorization:`Bearer ${token}` } });
        const mappedE: EventItem[] = er.data.map((e:any)=> ({ id:e._id, title:e.title, date:e.date?.split('T')[0]||e.date, endDate:e.endDate, startTime:e.startTime, endTime:e.endTime, location:e.location, repeat:e.repeat, projectId:e.projectId, notes:e.notes }));
        setEvents(mappedE);
      } else { setEvents([]); }
    } finally { setLoading(false); }
  };

  useEffect(()=>{ if(!token) return; const id = setTimeout(fetchAll, 250); return () => clearTimeout(id); }, [query, filterFromISO, filterToISO, typeFilter, token]);

  const fmtDMY = (iso?:string|null) => { if(!iso) return ''; const [y,m,d]=iso.split('-'); return `${d}/${m}/${y}`; };

  return (
    <SafeAreaView style={{ flex:1, backgroundColor:'#fff' }}>
      {/* Header with back and input */}
      <View style={styles.header}>
        <Pressable onPress={()=> router.back()} style={styles.backBtn}><Ionicons name='chevron-back' size={22} color='#16425b' /></Pressable>
        <View style={styles.inputWrap}>
          <Ionicons name='search' size={16} color='#607d8b' />
          <TextInput
            style={styles.input}
            placeholder='Tìm kiếm tác vụ, lịch...'
            placeholderTextColor={'#94a3b8'}
            value={query}
            onChangeText={setQuery}
            autoFocus
            returnKeyType='search'
          />
        </View>
        <Pressable onPress={()=> setShowFilters(s=>!s)} style={styles.filterToggle}>
          <Ionicons name='options-outline' size={18} color='#2f6690' />
        </Pressable>
      </View>

      {showFilters && (
        <View style={styles.filtersBox}>
          {/* Type filter */}
          <View style={styles.filterRow}>
            <Text style={styles.filterLabel}>Loại</Text>
            <View style={styles.segment}>
              {([['all','Tất cả'],['tasks','Tác vụ'],['events','Lịch']] as const).map(([val,label])=>{
                const active = typeFilter===val; return (
                  <Pressable key={val} onPress={()=> setTypeFilter(val)} style={[styles.segmentBtn, active && styles.segmentActive]}>
                    <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          {/* Weekday */}
          <View style={styles.filterRow}>
            <Text style={styles.filterLabel}>Thứ</Text>
            <View style={{ flexDirection:'row', flexWrap:'wrap', gap:8 }}>
              {['T2','T3','T4','T5','T6','T7','CN'].map((l,idx)=>{
                const val = idx+1; const active = filterWeekday===val;
                return (
                  <Pressable key={l} onPress={()=> setFilterWeekday(active? null: val)} style={[styles.chip, active && styles.chipActive]}>
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{l}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          {/* Date range */}
          <View style={styles.filterRow}>
            <Text style={styles.filterLabel}>Khoảng ngày</Text>
            <View style={{ flexDirection:'row', gap:8 }}>
              <Pressable onPress={()=> {
                const base = filterFromISO? new Date(filterFromISO+'T00:00:00') : new Date();
                if(Platform.OS==='android'){
                  DateTimePickerAndroid.open({
                    mode:'date', value: base,
                    onChange: (_e, dt)=>{ if(dt){ const iso = toLocalISODate(dt); setFilterFromISO(iso); if(filterToISO && iso > filterToISO){ setFilterToISO(null); } } },
                  });
                } else { setFromDraft(base); setShowFromPicker(true); }
              }} style={styles.rangeBtn}>
                <Ionicons name='calendar-outline' size={14} color='#2f6690' />
                <Text style={styles.rangeBtnText}>{filterFromISO? fmtDMY(filterFromISO) : 'Từ ngày'}</Text>
              </Pressable>
              <Pressable onPress={()=> {
                const base = filterToISO? new Date(filterToISO+'T00:00:00') : new Date();
                if(Platform.OS==='android'){
                  DateTimePickerAndroid.open({
                    mode:'date', value: base,
                    onChange: (_e, dt)=>{ if(dt){ const iso = toLocalISODate(dt); if(filterFromISO && iso < filterFromISO){ setFilterFromISO(iso); setFilterToISO(null); } else { setFilterToISO(iso); } } },
                  });
                } else { setToDraft(base); setShowToPicker(true); }
              }} style={styles.rangeBtn}>
                <Ionicons name='calendar-number-outline' size={14} color='#2f6690' />
                <Text style={styles.rangeBtnText}>{filterToISO? fmtDMY(filterToISO) : 'Đến ngày'}</Text>
              </Pressable>
              {(filterFromISO || filterToISO || filterWeekday) && (
                <Pressable onPress={()=> { setFilterFromISO(null); setFilterToISO(null); setFilterWeekday(null); }} style={[styles.rangeBtn,{ backgroundColor:'rgba(220,38,38,0.08)', borderColor:'rgba(220,38,38,0.2)' }]}>
                  <Ionicons name='close-circle-outline' size={14} color='#dc2626' />
                  <Text style={{ color:'#dc2626', fontSize:12, fontWeight:'700' }}>Xóa</Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>
      )}

      {/* Date pickers modals */}
      {Platform.OS==='ios' && (
      <Modal visible={showFromPicker} transparent animationType='fade' onRequestClose={()=> setShowFromPicker(false)}>
        <Pressable style={styles.pickerModalBackdrop} onPress={()=> setShowFromPicker(false)}>
          <View style={styles.pickerModal}>
            <Text style={styles.pickerTitle}>Chọn ngày bắt đầu</Text>
            <DateTimePicker
              value={fromDraft || (filterFromISO? new Date(filterFromISO+'T00:00:00') : new Date())}
              mode='date'
              display={(Platform.OS==='ios' && (Number(Platform.Version)||0) >= 14) ? 'inline' : 'spinner'}
              locale='vi-VN'
              themeVariant='light'
              textColor={'#0b2545'}
              onChange={(e:any, dt?:Date)=>{ if(dt){ setFromDraft(dt); } }}
            />
            <View style={styles.pickerActions}>
              <Pressable onPress={()=> setShowFromPicker(false)} style={[styles.pickerBtn, styles.pickerCancelBtn]}><Text style={[styles.pickerBtnText,{ color:'#16425b' }]}>Hủy</Text></Pressable>
              <Pressable onPress={()=> { const d = fromDraft || (filterFromISO? new Date(filterFromISO+'T00:00:00') : new Date()); const iso = toLocalISODate(d); setFilterFromISO(iso); if(filterToISO && iso > filterToISO){ setFilterToISO(null); } setShowFromPicker(false); }} style={[styles.pickerBtn, styles.pickerOkBtn]}><Text style={[styles.pickerBtnText,{ color:'#fff' }]}>Xong</Text></Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>
      )}
      {Platform.OS==='ios' && (
      <Modal visible={showToPicker} transparent animationType='fade' onRequestClose={()=> setShowToPicker(false)}>
        <Pressable style={styles.pickerModalBackdrop} onPress={()=> setShowToPicker(false)}>
          <View style={styles.pickerModal}>
            <Text style={styles.pickerTitle}>Chọn ngày kết thúc</Text>
            <DateTimePicker
              value={toDraft || (filterToISO? new Date(filterToISO+'T00:00:00') : new Date())}
              mode='date'
              display={(Platform.OS==='ios' && (Number(Platform.Version)||0) >= 14) ? 'inline' : 'spinner'}
              locale='vi-VN'
              themeVariant='light'
              textColor={'#0b2545'}
              onChange={(e:any, dt?:Date)=>{ if(dt){ setToDraft(dt); } }}
            />
            <View style={styles.pickerActions}>
              <Pressable onPress={()=> setShowToPicker(false)} style={[styles.pickerBtn, styles.pickerCancelBtn]}><Text style={[styles.pickerBtnText,{ color:'#16425b' }]}>Hủy</Text></Pressable>
              <Pressable onPress={()=> { const d = toDraft || (filterToISO? new Date(filterToISO+'T00:00:00') : new Date()); const iso = toLocalISODate(d); if(filterFromISO && iso < filterFromISO){ setFilterFromISO(iso); setFilterToISO(null); } else { setFilterToISO(iso); } setShowToPicker(false); }} style={[styles.pickerBtn, styles.pickerOkBtn]}><Text style={[styles.pickerBtnText,{ color:'#fff' }]}>Xong</Text></Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>
      )}

      {/* Results */}
      <ScrollView style={{ flex:1, backgroundColor:'#f8fafc' }} contentContainerStyle={{ padding:16 }}>
        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Kết quả</Text><Text style={styles.sectionSub}>{(typeFilter!=='events'? filteredTasks.length:0) + (typeFilter!=='tasks'? filteredEvents.length:0)} mục</Text></View>
        {(typeFilter!=='events') && (
          <View style={styles.card}>
            <View style={styles.cardHeader}><Text style={styles.cardTitle}>Tác vụ</Text><Text style={styles.cardCount}>{filteredTasks.length}</Text></View>
            {filteredTasks.length===0 ? <Text style={styles.emptyText}>Không có tác vụ phù hợp</Text> : (
              filteredTasks.map((t)=> (
                <Pressable key={t.id} style={styles.row} onPress={()=> router.push({ pathname:'/create-task', params:{ editId: t.id, occDate: t.date } })}>
                  <Ionicons name='checkbox-outline' size={16} color='#2f6690' />
                  <View style={{ flex:1 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{t.title}</Text>
                    <Text style={styles.rowMeta}>{t.date}{t.time? ` • ${t.time}`: ''}</Text>
                  </View>
                </Pressable>
              ))
            )}
          </View>
        )}
        {(typeFilter!=='tasks') && (
          <View style={styles.card}>
            <View style={styles.cardHeader}><Text style={styles.cardTitle}>Lịch</Text><Text style={styles.cardCount}>{filteredEvents.length}</Text></View>
            {filteredEvents.length===0 ? <Text style={styles.emptyText}>Không có lịch phù hợp</Text> : (
              filteredEvents.map((e)=> (
                <Pressable key={e.id} style={styles.row} onPress={()=> router.push({ pathname:'/create-calendar', params:{ editId: e.id, occDate: e.date } })}>
                  <Ionicons name='calendar-outline' size={16} color='#2f6690' />
                  <View style={{ flex:1 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{e.title}</Text>
                    <Text style={styles.rowMeta}>{e.date}{e.startTime? ` • ${e.startTime}${e.endTime? `–${e.endTime}`:''}`: ''}</Text>
                  </View>
                </Pressable>
              ))
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header:{ flexDirection:'row', alignItems:'center', paddingHorizontal:16, paddingTop:4, paddingBottom:10, backgroundColor:'#fff', borderBottomWidth:1, borderBottomColor:'rgba(0,0,0,0.05)' },
  backBtn:{ padding:8, borderRadius:12, backgroundColor:'#f1f5f9', marginRight:8 },
  inputWrap:{ flex:1, flexDirection:'row', alignItems:'center', gap:8, backgroundColor:'#f8fafc', borderWidth:1, borderColor:'#e2e8f0', borderRadius:14, paddingHorizontal:12, paddingVertical:8 },
  input:{ flex:1, fontSize:14, color:'#0b2545', paddingVertical:0 },
  filterToggle:{ padding:8, borderRadius:12, backgroundColor:'rgba(47,102,144,0.12)', marginLeft:8 },
  filtersBox:{ paddingHorizontal:16, paddingTop:12, paddingBottom:6, backgroundColor:'#fff', borderBottomWidth:1, borderBottomColor:'rgba(0,0,0,0.05)' },
  filterRow:{ marginBottom:12 },
  filterLabel:{ color:'#16425b', fontSize:12, fontWeight:'700', marginBottom:8 },
  segment:{ flexDirection:'row', backgroundColor:'#e2e8f0', borderRadius:12, padding:4, gap:6, alignSelf:'flex-start' },
  segmentBtn:{ paddingHorizontal:10, paddingVertical:6, borderRadius:10, backgroundColor:'transparent' },
  segmentActive:{ backgroundColor:'#fff', shadowColor:'#000', shadowOpacity:0.06, shadowRadius:3, elevation:1 },
  segmentText:{ fontSize:12, fontWeight:'700', color:'#0b2545' },
  segmentTextActive:{ color:'#0b2545' },
  chip:{ paddingHorizontal:10, paddingVertical:6, borderRadius:999, backgroundColor:'#f7fbff', borderWidth:1, borderColor:'#a3c4dc' },
  chipActive:{ backgroundColor:'#3a7ca5', borderColor:'#3a7ca5' },
  chipText:{ color:'#0b2545', fontSize:12, fontWeight:'700' },
  chipTextActive:{ color:'#fff' },
  rangeBtn:{ flexDirection:'row', alignItems:'center', gap:6, backgroundColor:'#f7fbff', borderWidth:1, borderColor:'#a3c4dc', paddingHorizontal:10, paddingVertical:8, borderRadius:12 },
  rangeBtnText:{ color:'#0b2545', fontSize:12, fontWeight:'700' },
  sectionHeader:{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:8 },
  sectionTitle:{ color:'#16425b', fontWeight:'700', fontSize:16 },
  sectionSub:{ color:'#607d8b', fontSize:12 },
  card:{ backgroundColor:'#fff', borderRadius:14, padding:12, marginBottom:12, borderWidth:1, borderColor:'rgba(0,0,0,0.04)' },
  cardHeader:{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:8 },
  cardTitle:{ color:'#16425b', fontWeight:'700' },
  cardCount:{ color:'#2f6690', fontSize:12, fontWeight:'700' },
  row:{ flexDirection:'row', alignItems:'center', gap:10, paddingVertical:10, borderBottomWidth:1, borderBottomColor:'rgba(0,0,0,0.04)' },
  rowTitle:{ color:'#0b2545', fontWeight:'600' },
  rowMeta:{ color:'#607d8b', fontSize:12 },
  emptyText:{ color:'#94a3b8', fontSize:12 },
  // pickers
  pickerModalBackdrop:{ flex:1, backgroundColor:'rgba(0,0,0,0.35)', justifyContent:'center', padding:24 },
  pickerModal:{ backgroundColor:'#fff', borderRadius:16, paddingVertical:12, paddingHorizontal:12 },
  pickerTitle:{ fontSize:16, fontWeight:'700', color:'#0b2545', textAlign:'center', marginBottom:8 },
  pickerActions:{ flexDirection:'row', justifyContent:'flex-end', gap:12, paddingTop:8 },
  pickerBtn:{ paddingHorizontal:14, paddingVertical:10, borderRadius:10 },
  pickerCancelBtn:{ backgroundColor:'#e6f1f8', borderWidth:1, borderColor:'#bcd4e6' },
  pickerOkBtn:{ backgroundColor:'#2f6690' },
  pickerBtnText:{ fontSize:14, fontWeight:'700' },
});
