import React, { useEffect, useMemo, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Alert, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import axios from 'axios';
import TaskForm from '@/components/TaskForm';
import { useAuth } from '@/contexts/AuthContext';
import { getOcrScanPayload, setOcrScanPayload } from '@/contexts/OcrScanStore';

export default function TasksPreview(){
  const router = useRouter();
  const { token } = useAuth();
  const API_BASE = process.env.EXPO_PUBLIC_API_BASE;
  const payload = getOcrScanPayload();
  const [items, setItems] = useState<Array<any>>([]);
  const [editing, setEditing] = useState<any|null>(null);

  useEffect(()=>{
    const list = (payload?.structured as any)?.kind === 'tasks-list' ? (payload?.structured as any)?.items || [] : [];
    if(!list || !list.length){
      Alert.alert('Thiếu dữ liệu','Không có tác vụ để xem trước');
      router.back();
      return;
    }
    const withSel = list.map((t:any, i:number)=> ({ id: String(i), selected: true, ...t }));
    setItems(withSel);
  },[]);

  const allSelected = useMemo(()=> items.length>0 && items.every(i=> i.selected), [items]);
  const toggleAll = (sel:boolean)=> setItems(prev => prev.map(i=> ({ ...i, selected: sel })));

  const createAll = async () => {
    if(!token){ Alert.alert('Lỗi','Chưa đăng nhập'); return; }
    const chosen = items.filter(i=> i.selected);
    if(!chosen.length){ Alert.alert('Chưa chọn','Hãy chọn ít nhất một tác vụ'); return; }
    try{
      const todayISO = new Date().toISOString().slice(0,10);
      for(const t of chosen){
        const clean = (s:any) => {
          const v = typeof s === 'string' ? s.trim() : '';
          return v || undefined;
        };
        const s = clean(t.startTime);
        const e = clean(t.endTime);
        let startTime = s;
        let endTime = e;
        let time: string | undefined = undefined;
        if(!startTime && !endTime){
          time = '09:00';
        } else if(!startTime && endTime){
          // Backend accepts 'time' as a single HH:MM when start is missing
          time = endTime;
          endTime = undefined;
        }
        const body:any = {
          title: t.title || 'Tác vụ',
          date: clean(t.date) || todayISO,
          startTime,
          endTime,
          time,
          priority: t.priority || 'medium',
          importance: t.importance || 'medium',
          urgency: t.urgency || 'medium',
          type: 'personal',
          estimatedHours: typeof t.estimatedHours === 'number' ? t.estimatedHours : (parseFloat(String(t.estimatedHours||'1'))||1),
          tags: [],
          subTasks: [],
          description: t.notes || '',
        };
        if(payload?.projectId) body.projectId = String(payload.projectId);
        await axios.post(`${API_BASE}/api/tasks`, body, { headers:{ Authorization: token ? `Bearer ${token}` : '' } });
      }
      Alert.alert('Thành công','Đã tạo các tác vụ');
      setOcrScanPayload(null);
      router.back();
    }catch(e:any){
      Alert.alert('Lỗi', e?.response?.data?.message || 'Không thể tạo tác vụ');
    }
  };

  // createOne replaced by TaskForm compact save flow

  return (
    <SafeAreaView style={{ flex:1, backgroundColor:'#f1f5f9' }}>
      <View style={styles.header}>
        <Pressable onPress={()=>router.back()} style={styles.backBtn}><Ionicons name='chevron-back' size={22} color='#16425b' /></Pressable>
        <Text style={styles.headerTitle}>Xem trước tác vụ</Text>
        <View style={{ width:40 }} />
      </View>
      <View style={styles.actions}>
        <View style={{ flex:1 }}>
          <Text style={{ color:'#16425b', fontWeight:'700' }}>Nhận dạng: {items.length} tác vụ</Text>
        </View>
        <Pressable style={[styles.actionBtn, allSelected? styles.secondary: styles.primary]} onPress={()=>toggleAll(!allSelected)}>
          <Text style={allSelected? styles.secondaryText: styles.primaryText}>{allSelected? 'Bỏ chọn tất cả':'Chọn tất cả'}</Text>
        </Pressable>
        <Pressable style={[styles.actionBtn, styles.primary]} onPress={createAll}>
          <Text style={styles.primaryText}>Xác nhận tạo</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding:12, paddingBottom:20 }}>
        {items.map((it, idx)=> (
          <View key={it.id} style={styles.card}>
            <View style={{ flexDirection:'row', justifyContent:'space-between' }}>
              <TextInput style={styles.title} value={it.title} onChangeText={(t)=> setItems(prev => prev.map(p=> p.id===it.id ? { ...p, title: t }: p))} />
              <Pressable onPress={()=> setItems(prev => prev.map(p=> p.id===it.id ? { ...p, selected: !p.selected }: p))}>
                <Text style={[styles.toggle, it.selected? styles.on: styles.off]}>{it.selected? '✓':'✗'}</Text>
              </Pressable>
            </View>
            <View style={{ flexDirection:'row', gap:8 }}>
              <TextInput style={[styles.input, { flex:1 }]} placeholder='YYYY-MM-DD' value={it.date||''} onChangeText={(t)=> setItems(prev => prev.map(p=> p.id===it.id ? { ...p, date: t }: p))} />
              <TextInput style={[styles.input, { flex:1 }]} placeholder='HH:MM' value={it.startTime||''} onChangeText={(t)=> setItems(prev => prev.map(p=> p.id===it.id ? { ...p, startTime: t }: p))} />
              <TextInput style={[styles.input, { flex:1 }]} placeholder='HH:MM' value={it.endTime||''} onChangeText={(t)=> setItems(prev => prev.map(p=> p.id===it.id ? { ...p, endTime: t }: p))} />
            </View>
            <TextInput style={[styles.input, { marginTop:6 }]} placeholder='Ghi chú' value={it.notes||''} onChangeText={(t)=> setItems(prev => prev.map(p=> p.id===it.id ? { ...p, notes: t }: p))} />
            <View style={{ flexDirection:'row', gap:10, marginTop:8 }}>
              <Pressable onPress={()=> setEditing(it)} style={[styles.actionBtn, styles.secondary, { flex:1 }]}>
                <Text style={styles.secondaryText}>Xem & tạo nhanh</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* compact TaskForm modal using official create form */}
      <Modal visible={!!editing} transparent animationType='fade' onRequestClose={()=> setEditing(null)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { maxWidth: 520, padding:0 }] }>
            {editing && (
              <TaskForm
                mode='compact'
                initialValues={{
                  title: editing.title || 'Tác vụ',
                  description: editing.notes || '',
                  date: editing.date || new Date().toISOString().slice(0,10),
                  startTime: editing.startTime || (editing.endTime ? undefined as any : '09:00'),
                  endTime: editing.endTime || '',
                  endDate: editing.endDate || '',
                  importance: editing.importance || 'medium',
                  urgency: editing.urgency || 'medium',
                  priority: editing.priority || 'medium',
                  type: payload?.projectId ? 'group' : 'personal',
                  estimatedHours: String(typeof editing.estimatedHours === 'number' ? editing.estimatedHours : (parseFloat(String(editing.estimatedHours||'1'))||1)),
                  tags: [],
                  subTasks: [],
                  isRepeating: !!editing.isRepeating,
                  repeat: editing.repeat ? {
                    frequency: editing.repeat.frequency || 'weekly',
                    endMode: editing.repeat.endMode || 'onDate',
                    endDate: editing.repeat.endDate || undefined,
                    count: editing.repeat.count ? String(editing.repeat.count) : undefined,
                  } : undefined,
                  reminders: Array.isArray(editing.reminders) ? editing.reminders : [],
                }}
                projectId={payload?.projectId ? String(payload.projectId) : undefined}
                onClose={()=> setEditing(null)}
                onSaved={()=>{
                  Alert.alert('Thành công','Đã tạo tác vụ');
                  setEditing(null);
                }}
              />
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingTop:8, paddingBottom:8, backgroundColor:'#f1f5f9' },
  backBtn:{ width:40, height:40, borderRadius:20, alignItems:'center', justifyContent:'center' },
  headerTitle:{ fontSize:18, fontWeight:'700', color:'#16425b' },
  actions:{ flexDirection:'row', gap:10, paddingHorizontal:12, paddingBottom:8 },
  actionBtn:{ paddingHorizontal:14, paddingVertical:10, borderRadius:12, alignItems:'center', justifyContent:'center' },
  primary:{ backgroundColor:'#3a7ca5' },
  primaryText:{ color:'#fff', fontWeight:'700' },
  secondary:{ backgroundColor:'#e2e8f0' },
  secondaryText:{ color:'#16425b', fontWeight:'700' },
  card:{ backgroundColor:'#fff', borderRadius:12, padding:10, borderWidth:1, borderColor:'#e2e8f0', marginBottom:8 },
  title:{ fontWeight:'700', color:'#16425b', flex:1 },
  toggle:{ width:20, textAlign:'right', fontWeight:'900' },
  on:{ color:'#16a34a' },
  off:{ color:'#b91c1c' },
  input:{ backgroundColor:'#f8fafc', borderWidth:1, borderColor:'#e2e8f0', borderRadius:10, paddingHorizontal:10, paddingVertical:8, color:'#0f172a' },
  modalBackdrop:{ flex:1, backgroundColor:'rgba(0,0,0,0.35)', alignItems:'center', justifyContent:'center' },
  modalCard:{ width:'92%', backgroundColor:'#fff', borderRadius:16, padding:14 },
  modalTitle:{ fontSize:16, fontWeight:'700', color:'#16425b', marginBottom:8 },
  modalLabel:{ fontSize:12, color:'#2f6690', marginTop:8, marginBottom:4 },
  textarea:{ minHeight:80, textAlignVertical:'top' },
  chipsRow:{ flexDirection:'row', flexWrap:'wrap', gap:8, marginTop:6 },
  chip:{ paddingHorizontal:12, paddingVertical:8, backgroundColor:'rgba(58,124,165,0.08)', borderRadius:20 },
  chipActive:{ backgroundColor:'#3a7ca5' },
  chipText:{ color:'#2f6690', fontWeight:'600', fontSize:12 },
  chipTextActive:{ color:'#fff' },
});
