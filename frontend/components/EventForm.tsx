import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, Alert, ActivityIndicator, Platform, Modal, Switch } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'expo-router';

type Mode = 'full' | 'compact';

export interface EventFormValues {
  title: string;
  typeId: string;
  date: string;
  endDate?: string;
  startTime: string;
  endTime?: string;
  location?: string;
  notes?: string;
  link?: string;
  isAllDay?: boolean;
  isRepeating?: boolean;
  repeat?: {
    frequency: 'daily'|'weekly'|'monthly'|'yearly';
    endMode?: 'never'|'onDate'|'after';
    endDate?: string;
    count?: number;
  };
}

export default function EventForm({
  mode,
  initialValues,
  projectId,
  onClose,
  onSaved,
}: {
  mode: Mode;
  initialValues: Partial<EventFormValues> & { title: string; date: string; startTime: string };
  projectId?: string;
  onClose?: () => void;
  onSaved?: () => void;
}){
  const { token } = useAuth();
  const router = useRouter();
  const API_BASE = process.env.EXPO_PUBLIC_API_BASE;
  const [saving, setSaving] = useState(false);
  const [types, setTypes] = useState<Array<{ _id:string; name:string; isDefault?:boolean }>>([]);
  const [loadingTypes, setLoadingTypes] = useState(false);
  const [showPicker, setShowPicker] = useState<{ mode:'date'|'time'; field:'date'|'endDate'|'startTime'|'endTime'|'repeatEndDate'|null}>({ mode:'date', field:null });
  const [tempDate, setTempDate] = useState<Date|null>(null);
  const [form, setForm] = useState<EventFormValues>({
    title: initialValues.title || 'Lịch mới',
    typeId: initialValues.typeId || '',
    date: initialValues.date || new Date().toISOString().slice(0,10),
    endDate: initialValues.endDate || '',
    startTime: initialValues.startTime || '09:00',
    endTime: initialValues.endTime || '',
    location: initialValues.location || '',
    notes: initialValues.notes || '',
    link: initialValues.link || '',
    isAllDay: initialValues.isAllDay || false,
    isRepeating: !!initialValues.repeat,
    repeat: initialValues.repeat ? { ...initialValues.repeat } as any : undefined,
  });

  const authHeader = useMemo(()=> ({ headers:{ Authorization: token? `Bearer ${token}`: '' } }), [token]);

  useEffect(()=>{
    const loadTypes = async () => {
      if(!token) return;
      setLoadingTypes(true);
      try{
        const res = await axios.get(`${API_BASE}/api/event-types`, authHeader);
        const list = Array.isArray(res.data)? res.data: [];
        setTypes(list);
        setForm(prev => prev.typeId? prev : (list[0]? { ...prev, typeId: (list.find((t:any)=>t.isDefault)?._id) || list[0]._id } : prev));
      }catch{} finally{ setLoadingTypes(false); }
    };
    loadTypes();
  }, [token]);

  const update = useCallback(<K extends keyof EventFormValues>(k:K, v: EventFormValues[K])=> setForm(p=>({ ...p, [k]: v })), []);

  const toLocalISODate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const openDate = (field:'date'|'endDate'|'repeatEndDate')=>{ setTempDate(new Date(((form as any)[field]||'') + 'T00:00:00')); setShowPicker({ mode:'date', field: field as any }); };
  const openTime = (field:'startTime'|'endTime')=>{ if(form.isAllDay) return; const [hh,mm] = String((form as any)[field]||'09:00').split(':').map((n:string)=>parseInt(n,10)); const d=new Date(); d.setHours(hh||9, mm||0, 0, 0); setTempDate(d); setShowPicker({ mode:'time', field: field as any }); };
  const onNative = (e:DateTimePickerEvent, d?:Date)=>{ if(Platform.OS!=='android') return; if(e.type==='dismissed'){ setShowPicker({mode:'date', field:null}); return; } if(d&&showPicker.field){ if(showPicker.mode==='date'){ const iso = toLocalISODate(d); if(showPicker.field==='endDate'){ update('endDate', iso); if(!form.isAllDay && !form.endTime) update('endTime','23:59'); } else if(showPicker.field==='date'){ update('date', iso); } else { update('repeat', { ...(form.repeat||{ frequency:'weekly' }), endMode:'onDate', endDate: iso }); update('isRepeating', true); } } else { if(form.isAllDay){ /* ignore */ } else { const hh=String(d.getHours()).padStart(2,'0'); const mm=String(d.getMinutes()).padStart(2,'0'); update(showPicker.field as any, `${hh}:${mm}`);} } } setShowPicker({mode:'date', field:null}); };
  const confirmIOS = ()=>{ if(tempDate && showPicker.field){ if(showPicker.mode==='date'){ const iso = toLocalISODate(tempDate); if(showPicker.field==='endDate'){ update('endDate', iso); if(!form.isAllDay && !form.endTime) update('endTime','23:59'); } else if(showPicker.field==='date'){ update('date', iso); } else { update('repeat', { ...(form.repeat||{ frequency:'weekly' }), endMode:'onDate', endDate: iso }); update('isRepeating', true); } } else { if(form.isAllDay){ /* ignore */ } else { const hh=String(tempDate.getHours()).padStart(2,'0'); const mm=String(tempDate.getMinutes()).padStart(2,'0'); update(showPicker.field as any, `${hh}:${mm}`); } } } setShowPicker({mode:'date', field:null}); setTempDate(null); };

  const save = async ()=>{
    if(!token){ Alert.alert('Lỗi','Chưa đăng nhập'); return; }
    if(!form.title.trim()){ Alert.alert('Thiếu thông tin','Nhập tiêu đề'); return; }
    if(!form.typeId){ Alert.alert('Thiếu thông tin','Chọn loại lịch'); return; }
    if(!/^\d{4}-\d{2}-\d{2}$/.test(form.date)){ Alert.alert('Lỗi','Ngày bắt đầu không hợp lệ'); return; }
  if(form.endDate){ if(!/^\d{4}-\d{2}-\d{2}$/.test(form.endDate!)){ Alert.alert('Lỗi','Ngày kết thúc không hợp lệ'); return; } if(form.endDate! < form.date){ Alert.alert('Lỗi','Kết thúc phải >= bắt đầu'); return; } if(!form.isAllDay && form.date===form.endDate && form.endTime && form.endTime <= form.startTime){ Alert.alert('Lỗi','Giờ kết thúc phải sau giờ bắt đầu'); return; } }
  else { if(!form.isAllDay && form.endTime && form.startTime && form.endTime <= form.startTime){ Alert.alert('Lỗi','Giờ kết thúc phải sau giờ bắt đầu'); return; } }
    setSaving(true);
    const body:any = {
      title: form.title.trim(), typeId: form.typeId, date: form.date,
  endDate: form.endDate || undefined, startTime: form.isAllDay? undefined : form.startTime, endTime: form.isAllDay? undefined : (form.endDate? (form.endTime || '23:59') : (form.endTime || undefined)),
      location: form.location || undefined, notes: form.notes || undefined, link: form.link || undefined,
      props: {},
      ...(form.isRepeating && form.repeat? { repeat: form.repeat }: {}),
    };
    if(projectId) body.projectId = projectId;
    try{
      await axios.post(`${API_BASE}/api/events`, body, authHeader);
      onSaved?.();
    }catch(e:any){ Alert.alert('Lỗi', e?.response?.data?.message || 'Không thể tạo lịch'); }
    finally{ setSaving(false); }
  };

  const selectedType = types.find(t=> t._id === form.typeId);

  return (
    <View style={[styles.wrap, mode==='compact' && { padding:12 }] }>
      {/* Header for compact modal */}
      {mode==='compact' && (
        <View style={styles.compactHeader}>
          <Text style={styles.compactTitle}>Tạo lịch mới</Text>
          <Pressable onPress={onClose}><Ionicons name='close' size={20} color='#16425b' /></Pressable>
        </View>
      )}

      <View style={styles.field}><Text style={styles.label}>Tiêu đề *</Text><TextInput style={styles.input} value={form.title} onChangeText={t=>update('title', t)} /></View>
      <View style={styles.field}><Text style={styles.label}>Loại lịch *</Text>
        {loadingTypes ? (
          <ActivityIndicator color='#3a7ca5' />
        ) : (
          <View style={styles.typeList}>
            {types.map(t => {
              const active = t._id === form.typeId;
              return (
                <Pressable key={t._id} onPress={()=>update('typeId', t._id)} style={[styles.typeChip, active && styles.typeChipActive]}>
                  <Text style={[styles.typeChipText, active && styles.typeChipTextActive]}>{t.name}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      <View style={styles.row}>
        <View style={[styles.field, styles.half]}>
          <Text style={styles.label}>Ngày bắt đầu</Text>
          <Pressable onPress={()=> openDate('date')} style={styles.pickerBtn}><Text style={styles.pickerText}>{toDisplayDate(form.date)}</Text></Pressable>
        </View>
        <View style={[styles.field, styles.half]}>
          <Text style={styles.label}>Giờ bắt đầu</Text>
          <Pressable onPress={()=> openTime('startTime')} style={[styles.pickerBtn, !!form.isAllDay && { opacity:0.5 }]} disabled={!!form.isAllDay}><Text style={styles.pickerText}>{form.isAllDay? '--:--' : form.startTime}</Text></Pressable>
        </View>
      </View>
      <View style={styles.row}>
        <View style={[styles.field, styles.half]}>
          <Text style={styles.label}>Ngày kết thúc</Text>
          <Pressable onPress={()=> openDate('endDate')} style={styles.pickerBtn}><Text style={styles.pickerText}>{form.endDate? toDisplayDate(form.endDate): 'Không chọn'}</Text></Pressable>
        </View>
        <View style={[styles.field, styles.half]}>
          <Text style={styles.label}>Giờ kết thúc</Text>
          <Pressable onPress={()=> openTime('endTime')} style={[styles.pickerBtn, (!form.endDate || !!form.isAllDay) && { opacity:0.5 }]} disabled={!form.endDate || !!form.isAllDay}><Text style={styles.pickerText}>{form.isAllDay? '--:--' : (form.endTime || (form.endDate? '23:59':'--:--'))}</Text></Pressable>
        </View>
      </View>

      <View style={[styles.field,{ flexDirection:'row', alignItems:'center', justifyContent:'space-between' }]}>
        <Text style={styles.label}>Sự kiện cả ngày</Text>
        <Switch value={!!form.isAllDay} onValueChange={(v)=> update('isAllDay', v)} />
      </View>

      <View style={styles.field}><Text style={styles.label}>Địa điểm</Text><TextInput style={styles.input} value={form.location} onChangeText={t=>update('location', t)} /></View>
      <View style={styles.field}><Text style={styles.label}>Link</Text><TextInput style={styles.input} value={form.link} onChangeText={t=>update('link', t)} autoCapitalize='none' /></View>
      <View style={styles.field}><Text style={styles.label}>Ghi chú</Text><TextInput style={[styles.input, styles.textarea]} multiline value={form.notes} onChangeText={t=>update('notes', t)} /></View>

      {/* Repeat compact */}
      <View style={styles.field}><Text style={styles.label}>Kết thúc lặp (tùy chọn)</Text>
        <Pressable onPress={()=> openDate('repeatEndDate')} style={styles.pickerBtn}><Text style={styles.pickerText}>{form.repeat?.endDate? toDisplayDate(form.repeat.endDate): 'Không chọn'}</Text></Pressable>
      </View>

      <View style={{ flexDirection:'row', gap:10, marginTop:8 }}>
        {mode==='compact' && (
          <Pressable onPress={onClose} style={[styles.actionBtn, styles.secondary, { flex:1 }]}><Text style={styles.secondaryText}>Đóng</Text></Pressable>
        )}
        <Pressable onPress={save} style={[styles.actionBtn, styles.primary, { flex:1 }]} disabled={saving}><Text style={styles.primaryText}>{saving? 'Đang tạo...' : 'Tạo'}</Text></Pressable>
      </View>

      {showPicker.field && Platform.OS==='android' && (
        <DateTimePicker value={tempDate || new Date()} mode={showPicker.mode} is24Hour display='default' onChange={onNative} />
      )}
      {showPicker.field && Platform.OS==='ios' && (
        <Modal transparent animationType='fade'>
          <View style={styles.pickerBackdrop}>
            <View style={styles.pickerModal}>
              <DateTimePicker value={tempDate || new Date()} mode={showPicker.mode} display='spinner' themeVariant='light' onChange={(e,d)=>{ if(d) setTempDate(d); }} />
              <View style={styles.pickerActions}>
                <Pressable onPress={()=>{ setShowPicker({mode:'date', field:null}); setTempDate(null); }} style={[styles.pickerActionBtn, styles.pickerCancel]}><Text style={styles.pickerActionText}>Hủy</Text></Pressable>
                <Pressable onPress={confirmIOS} style={[styles.pickerActionBtn, styles.pickerOk]}><Text style={[styles.pickerActionText,{color:'#fff'}]}>Chọn</Text></Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

function toDisplayDate(iso: string){ const [y,m,d] = String(iso||'').split('-').map(n=>parseInt(n,10)); if(!y||!m||!d) return '--/--/----'; return `${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`; }

const styles = StyleSheet.create({
  wrap:{ backgroundColor:'#fff', borderRadius:16, padding:16 },
  compactHeader:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginBottom:8 },
  compactTitle:{ fontSize:16, fontWeight:'700', color:'#16425b' },
  field:{ marginBottom:12 },
  label:{ fontSize:12, color:'#2f6690', marginBottom:6 },
  input:{ backgroundColor:'#f8fafc', borderWidth:1, borderColor:'#e2e8f0', borderRadius:12, paddingHorizontal:10, paddingVertical:10, color:'#0f172a' },
  textarea:{ minHeight:80, textAlignVertical:'top' },
  row:{ flexDirection:'row', gap:12 },
  half:{ flex:1 },
  typeList:{ flexDirection:'row', flexWrap:'wrap' },
  typeChip:{ paddingHorizontal:12, paddingVertical:8, backgroundColor:'rgba(58,124,165,0.08)', borderRadius:20, marginRight:8, marginBottom:8 },
  typeChipActive:{ backgroundColor:'#3a7ca5' },
  typeChipText:{ color:'#2f6690', fontWeight:'600' },
  typeChipTextActive:{ color:'#fff' },
  pickerBtn:{ backgroundColor:'#f8fafc', borderWidth:1, borderColor:'#e2e8f0', borderRadius:12, paddingHorizontal:12, height:44, justifyContent:'center' },
  pickerText:{ fontSize:14, color:'#16425b', fontWeight:'500' },
  actionBtn:{ paddingHorizontal:14, paddingVertical:10, borderRadius:12, alignItems:'center', justifyContent:'center' },
  primary:{ backgroundColor:'#3a7ca5' },
  primaryText:{ color:'#fff', fontWeight:'700' },
  secondary:{ backgroundColor:'#e2e8f0' },
  secondaryText:{ color:'#16425b', fontWeight:'700' },
  pickerBackdrop:{ flex:1, backgroundColor:'rgba(0,0,0,0.35)', justifyContent:'flex-end' },
  pickerModal:{ backgroundColor:'#fff', borderTopLeftRadius:24, borderTopRightRadius:24, paddingTop:8, paddingBottom:20 },
  pickerActions:{ flexDirection:'row', justifyContent:'space-between', paddingHorizontal:16, marginTop:4 },
  pickerActionBtn:{ flex:1, height:44, borderRadius:14, alignItems:'center', justifyContent:'center', marginHorizontal:6 },
  pickerCancel:{ backgroundColor:'#e2e8f0' },
  pickerOk:{ backgroundColor:'#3a7ca5' },
  pickerActionText:{ fontSize:15, fontWeight:'600', color:'#16425b' },
});
