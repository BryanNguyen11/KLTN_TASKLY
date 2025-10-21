import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, Alert, ActivityIndicator, Modal, Switch, DeviceEventEmitter } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import axios from 'axios';
import { useAuth } from '@/contexts/AuthContext';
import { EventTypeDoc, EventTypeField, EventDoc, toDisplayDate } from '@/utils/events';
import { Platform } from 'react-native';

interface FormState {
  title: string;
  typeId: string;
  date: string;
  endDate: string;
  startTime: string;
  endTime: string;
  location: string;
  notes: string;
  link: string;
  props: Record<string, string>;
  // repeat rule (optional)
  isRepeating?: boolean;
  repeat?: {
    frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
    endMode?: 'never' | 'onDate' | 'after';
    endDate?: string;
    count?: number;
  };
}

export default function CreateEventScreen(){
  const router = useRouter();
  const { editId, occDate, projectId } = useLocalSearchParams<{ editId?: string; occDate?: string; projectId?: string }>();
  const { token } = useAuth();
  const API_BASE = process.env.EXPO_PUBLIC_API_BASE;

  // Helper: format Date -> local YYYY-MM-DD to avoid UTC shift from toISOString
  const toLocalISODate = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const today = toLocalISODate(new Date());
  const [saving, setSaving] = useState(false);
  const [types, setTypes] = useState<EventTypeDoc[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(false);
  const [showPicker, setShowPicker] = useState<{mode:'date'|'time'; field:'date'|'endDate'|'startTime'|'endTime'|'repeatEndDate'|null}>({mode:'date', field:null});
  const [tempDate, setTempDate] = useState<Date | null>(null);
  const [errors, setErrors] = useState<{start?:string; end?:string}>({});
  const [form, setForm] = useState<FormState>({
    title: '',
    typeId: '',
    date: today,
    endDate: '',
    startTime: '09:00',
    endTime: '',
    location: '',
    notes: '',
    link: '',
    props: {},
    isRepeating: false,
    repeat: undefined,
  });

  const authHeader = () => ({ headers: { Authorization: token ? `Bearer ${token}` : '' } });

  const fetchTypes = async () => {
    if(!token) return;
    setLoadingTypes(true);
    try {
      const res = await axios.get(`${API_BASE}/api/event-types`, authHeader());
      const list: EventTypeDoc[] = res.data;
      setTypes(list);
      // Default select a type similar to Google Calendar (first default type if exists)
      setForm(prev => {
        if(prev.typeId) return prev;
        const preferred = list.find(t=> t.isDefault) || list[0];
        return preferred ? { ...prev, typeId: preferred._id } : prev;
      });
    } catch(e) { /* silent */ } finally { setLoadingTypes(false); }
  };

  useEffect(()=>{ fetchTypes(); }, [token]);

  const update = useCallback(<K extends keyof FormState>(key:K, value: FormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  }, []);

  // Load event details when editing
  useEffect(() => {
    const load = async () => {
      if(!editId || !token) return;
      try {
        const res = await axios.get(`${API_BASE}/api/events/${editId}`, authHeader());
        const e = res.data;
        const typeId = typeof e.typeId === 'string' ? e.typeId : (e.typeId? e.typeId._id : '');
        setForm(prev => ({
          ...prev,
          title: e.title || '',
          typeId,
          date: (e.date?.split?.('T')?.[0]) || e.date || prev.date,
          endDate: e.endDate || '',
          startTime: e.startTime || prev.startTime,
          endTime: e.endTime || '',
          location: e.location || '',
          notes: e.notes || '',
          link: e.link || '',
          props: e.props || {},
          isRepeating: !!e.repeat,
          repeat: e.repeat || undefined,
        }));
      } catch(err){
        Alert.alert('Lỗi','Không tải được lịch để sửa');
      }
    };
    load();
  }, [editId, token]);

  // When event type changes, prune props to only fields of that type to avoid duplicates
  useEffect(() => {
  const t = types.find((tt: EventTypeDoc)=> tt._id === form.typeId);
    if(!t) return;
    setForm(prev => {
  const allowed = new Set(t.fields.map((f: EventTypeField)=> f.key));
      const nextProps: Record<string,string> = {};
      for(const k of Object.keys(prev.props||{})){
        if(allowed.has(k)) nextProps[k] = prev.props[k];
      }
      return { ...prev, props: nextProps };
    });
  }, [form.typeId, types]);

  const parseDateValue = (field:'date'|'endDate') => {
    const raw = (form as any)[field];
    if(/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(raw + 'T00:00:00');
    return new Date();
  };
  const parseTimeValue = (field:'startTime'|'endTime') => {
    const raw = (form as any)[field];
    if(/^[0-2]\d:[0-5]\d$/.test(raw)){
      const [h,m] = raw.split(':').map((n:string)=>parseInt(n,10));
      const d = new Date(); d.setHours(h,m,0,0); return d;
    }
    return new Date();
  };

  const openDate = (field:'date'|'endDate') => { setTempDate(parseDateValue(field)); setShowPicker({mode:'date', field}); };
  const openTime = (field:'startTime'|'endTime') => { setTempDate(parseTimeValue(field)); setShowPicker({mode:'time', field}); };

  const onNativeChange = (e:DateTimePickerEvent, selected?:Date) => {
    if(Platform.OS !== 'android') return;
    if(e.type==='dismissed'){ setShowPicker({mode:'date', field:null}); return; }
    if(selected && showPicker.field){
      if(showPicker.mode==='date'){
        const iso = toLocalISODate(selected);
        if(showPicker.field === 'repeatEndDate'){
          setForm(prev => ({ ...prev, repeat: { ...(prev.repeat||{ frequency:'weekly' }), endMode: 'onDate', endDate: iso } }));
        } else if(showPicker.field === 'endDate'){
          setForm(prev => ({ ...prev, endDate: iso, endTime: prev.endTime || '23:59' }));
        } else setForm(prev => ({ ...prev, date: iso }));
      } else {
        const hh = selected.getHours().toString().padStart(2,'0');
        const mm = selected.getMinutes().toString().padStart(2,'0');
        update(showPicker.field as any, `${hh}:${mm}`);
      }
    }
    setShowPicker({mode:'date', field:null});
  };
  const confirmIOS = () => {
    if(tempDate && showPicker.field){
      if(showPicker.mode==='date'){
        const iso = toLocalISODate(tempDate);
        if(showPicker.field === 'repeatEndDate'){
          setForm(prev => ({ ...prev, repeat: { ...(prev.repeat||{ frequency:'weekly' }), endMode: 'onDate', endDate: iso } }));
        } else if(showPicker.field === 'endDate'){
          setForm(prev => ({ ...prev, endDate: iso, endTime: prev.endTime || '23:59' }));
        } else setForm(prev => ({ ...prev, date: iso }));
      } else {
        const hh = tempDate.getHours().toString().padStart(2,'0');
        const mm = tempDate.getMinutes().toString().padStart(2,'0');
        update(showPicker.field as any, `${hh}:${mm}`);
      }
    }
    setShowPicker({mode:'date', field:null}); setTempDate(null);
  };
  const cancelIOS = () => { setShowPicker({mode:'date', field:null}); setTempDate(null); };

  useEffect(()=>{
    const newErr: typeof errors = {} as any;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) newErr.start = 'Ngày bắt đầu sai định dạng';
    if(form.endDate){
      if(!/^\d{4}-\d{2}-\d{2}$/.test(form.endDate)) newErr.end = 'Ngày kết thúc sai định dạng';
      else {
        if(form.endDate < form.date) newErr.end = 'Kết thúc phải sau hoặc bằng ngày bắt đầu';
        if(form.date === form.endDate && form.endTime && form.endTime <= form.startTime) newErr.end = 'Giờ kết thúc phải sau giờ bắt đầu';
      }
    } else {
      if(form.endTime && form.startTime && form.endTime <= form.startTime) newErr.end = 'Giờ kết thúc phải sau giờ bắt đầu';
    }
    setErrors(newErr);
  }, [form.date, form.endDate, form.startTime, form.endTime]);

  const save = async () => {
    if(!token){ Alert.alert('Lỗi','Chưa đăng nhập'); return; }
  if(!form.title.trim()){ Alert.alert('Thiếu thông tin','Vui lòng nhập tiêu đề'); return; }
  if(!form.typeId){ Alert.alert('Thiếu thông tin','Vui lòng chọn loại lịch'); return; }
    if(!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) { Alert.alert('Lỗi','Ngày bắt đầu không hợp lệ'); return; }
    if(form.endDate){
      if(!/^\d{4}-\d{2}-\d{2}$/.test(form.endDate)) { Alert.alert('Lỗi','Ngày kết thúc không hợp lệ'); return; }
      if(form.endDate < form.date) { Alert.alert('Lỗi','Ngày kết thúc phải >= ngày bắt đầu'); return; }
      if(form.date === form.endDate && form.startTime && form.endTime && form.endTime <= form.startTime){ Alert.alert('Lỗi','Giờ kết thúc phải sau giờ bắt đầu'); return; }
    } else {
      if(form.endTime && form.startTime && form.endTime <= form.startTime){ Alert.alert('Lỗi','Giờ kết thúc phải sau giờ bắt đầu'); return; }
    }
    setSaving(true);
    const payload: any = {
      title: form.title.trim(),
      typeId: form.typeId,
      date: form.date,
      endDate: form.endDate || undefined,
      startTime: form.startTime,
      endTime: form.endDate ? (form.endTime || '23:59') : (form.endTime || undefined),
      location: form.location || undefined,
      notes: form.notes || undefined,
      link: form.link || undefined,
      props: form.props
    };
    if(projectId) payload.projectId = String(projectId);
    if(form.isRepeating && form.repeat){ payload.repeat = form.repeat; }
    try {
      if(editId){
        const res = await axios.put(`${API_BASE}/api/events/${editId}`, payload, authHeader());
        // Notify listeners
        // @ts-ignore
        DeviceEventEmitter.emit('eventUpdated', res.data);
        Alert.alert('Thành công','Đã lưu lịch');
      } else {
        const res = await axios.post(`${API_BASE}/api/events`, payload, authHeader());
        // Notify listeners
        // @ts-ignore
        DeviceEventEmitter.emit('eventCreated', res.data);
        Alert.alert('Thành công','Đã tạo lịch');
      }
      router.back();
    } catch(e:any){
      Alert.alert('Lỗi', e?.response?.data?.message || 'Không thể lưu lịch');
    } finally { setSaving(false); }
  };

  const selectedType = types.find(t => t._id === form.typeId);

  const onDelete = async () => {
    if(!editId || !token){ Alert.alert('Lỗi','Không thể xóa'); return; }
    const hasRepeat = !!form.repeat;
    if(!hasRepeat){
      Alert.alert('Xóa lịch','Bạn có chắc muốn xóa lịch này?',[
        { text:'Hủy', style:'cancel' },
        { text:'Xóa', style:'destructive', onPress: async ()=>{
          try { await axios.delete(`${API_BASE}/api/events/${editId}`, authHeader()); DeviceEventEmitter.emit('eventDeleted', editId); DeviceEventEmitter.emit('toast','Đã xóa lịch'); router.back(); }
          catch(e:any){ Alert.alert('Lỗi', e?.response?.data?.message || 'Không thể xóa'); }
        } }
      ]);
      return;
    }
    // Repeating event: ask scope (avoid multiline single-quote string issues)
    const delMsg = [
      'Bạn muốn xóa:',
      '• Chỉ lần xuất hiện này',
      '• Hay lịch này và tất cả các lịch trong tương lai?'
    ].join('\n');
    Alert.alert('Xóa lịch lặp', delMsg, [
      { text:'Hủy', style:'cancel' },
      { text:'Chỉ lần này', onPress: async ()=>{
          try {
            if(!occDate){
              await axios.delete(`${API_BASE}/api/events/${editId}`, authHeader());
              DeviceEventEmitter.emit('eventDeleted', editId);
              DeviceEventEmitter.emit('toast','Đã xóa lịch');
              router.back();
              return;
            }
            const freq = form.repeat?.frequency || 'weekly';
            const [y,m,d] = occDate.split('-').map(n=>parseInt(String(n),10));
            const base = new Date(y, (m||1)-1, d||1);
            const next = new Date(base);
            if(freq==='daily') next.setDate(next.getDate()+1);
            else if(freq==='weekly') next.setDate(next.getDate()+7);
            else if(freq==='monthly') next.setMonth(next.getMonth()+1);
            else if(freq==='yearly') next.setFullYear(next.getFullYear()+1);
            const nextStartISO = toLocalISODate(next);
            const seriesStart = form.date;
            if(occDate === seriesStart){
              // Xóa occurrence đầu tiên: dời ngày bắt đầu chuỗi sang lần kế tiếp
              const res = await axios.put(`${API_BASE}/api/events/${editId}`, { date: nextStartISO }, authHeader());
              DeviceEventEmitter.emit('eventUpdated', res.data);
              DeviceEventEmitter.emit('toast','Đã bỏ lần xuất hiện đầu tiên');
              router.back();
              return;
            }
            // Cắt chuỗi hiện tại đến trước occDate
            const dayBefore = (()=>{ const d0 = new Date(base); d0.setDate(d0.getDate()-1); return toLocalISODate(d0); })();
            await axios.put(`${API_BASE}/api/events/${editId}`, { repeat: { ...(form.repeat||{}), endMode: 'onDate', endDate: dayBefore } }, authHeader());
            // Tạo chuỗi mới bắt đầu từ lần kế tiếp, giữ nguyên repeat rule
            const newPayload: any = {
              title: form.title.trim(),
              typeId: form.typeId,
              date: nextStartISO,
              endDate: form.endDate || undefined,
              startTime: form.startTime,
              endTime: form.endTime || undefined,
              location: form.location || undefined,
              notes: form.notes || undefined,
              link: form.link || undefined,
              props: form.props || {},
              repeat: form.repeat || undefined,
            };
            if(projectId) newPayload.projectId = String(projectId);
            const created = await axios.post(`${API_BASE}/api/events`, newPayload, authHeader());
            // Notify
            DeviceEventEmitter.emit('eventCreated', created.data);
            DeviceEventEmitter.emit('toast','Đã xóa lần này và giữ các lần khác');
            router.back();
          } catch(e:any){ Alert.alert('Lỗi', e?.response?.data?.message || 'Không thể xóa'); }
        } },
      { text:'Từ lần này trở đi', style:'destructive', onPress: async ()=>{
          try {
            // If backend supported, we'd call a special endpoint. Fallback: update repeat endDate to day before occDate
            if(occDate){
              // set repeat end before occDate
              const dayBefore = (()=>{ const [y,m,d] = occDate.split('-').map(n=>parseInt(n,10)); const dt = new Date(y,(m||1)-1,d||1); dt.setDate(dt.getDate()-1); return toLocalISODate(dt); })();
              const res = await axios.put(`${API_BASE}/api/events/${editId}`, { repeat: { ...(form.repeat||{}), endMode: 'onDate', endDate: dayBefore } }, authHeader());
              DeviceEventEmitter.emit('eventUpdated', res.data);
              DeviceEventEmitter.emit('toast','Đã xóa các lần trong tương lai');
              router.back();
            } else {
              await axios.delete(`${API_BASE}/api/events/${editId}`, authHeader());
              DeviceEventEmitter.emit('toast','Đã xóa lịch');
              router.back();
            }
          } catch(e:any){ Alert.alert('Lỗi', e?.response?.data?.message || 'Không thể xóa'); }
        }
      },
    ]);
  };

  return (
    <SafeAreaView style={{ flex:1, backgroundColor:'#f1f5f9' }} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={()=>router.back()} style={styles.backBtn}><Ionicons name='arrow-back' size={22} color='#16425b' /></Pressable>
  <Text style={styles.headerTitle}>{editId? 'Chỉnh sửa lịch':'Tạo lịch mới'}</Text>
        <Pressable onPress={onDelete} style={{ width:40, alignItems:'flex-end' }}>
          {editId ? <Ionicons name='trash-outline' size={20} color='#dc2626' /> : <View style={{ width:20 }} />}
        </Pressable>
      </View>

      <KeyboardAwareScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        enableOnAndroid
        extraScrollHeight={100}
        keyboardShouldPersistTaps='handled'
      >
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Thông tin cơ bản</Text>
          <View style={styles.field}>
            <Text style={styles.label}>Tiêu đề *</Text>
            <TextInput style={styles.input} placeholder='VD: Học Toán (Đại số)' value={form.title} onChangeText={t=>update('title', t)} />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Loại lịch *</Text>
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
                <Pressable onPress={()=>router.push('/create-calendar-type')} style={[styles.typeChip, { borderWidth:1, borderColor:'#3a7ca5', backgroundColor:'transparent' }]}>
                  <Text style={[styles.typeChipText, { color:'#3a7ca5' }]}>+ Tạo loại mới</Text>
                </Pressable>
              </View>
            )}
          </View>

          <View style={styles.row}>
            <View style={[styles.field, styles.half]}>
              <Text style={styles.label}>Ngày bắt đầu</Text>
              <Pressable onPress={()=>openDate('date')} style={[styles.pickerBtn, errors.start && styles.pickerBtnError]}>
                <Text style={[styles.pickerText, errors.start && styles.pickerTextError]}>{toDisplayDate(form.date)}</Text>
              </Pressable>
            </View>
            <View style={[styles.field, styles.half]}>
              <Text style={styles.label}>Giờ bắt đầu</Text>
              <Pressable onPress={()=>openTime('startTime')} style={[styles.pickerBtn, errors.start && styles.pickerBtnError]}>
                <Text style={[styles.pickerText, errors.start && styles.pickerTextError]}>{form.startTime}</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.row}>
            <View style={[styles.field, styles.half]}>
              <Text style={styles.label}>Ngày kết thúc</Text>
              <Pressable onPress={()=>openDate('endDate')} style={[styles.pickerBtn, errors.end && styles.pickerBtnError]}>
                <Text style={[styles.pickerText, errors.end && styles.pickerTextError]}>{form.endDate? toDisplayDate(form.endDate): 'Không chọn'}</Text>
              </Pressable>
            </View>
            <View style={[styles.field, styles.half]}>
              <Text style={styles.label}>Giờ kết thúc</Text>
              <Pressable onPress={()=> openTime('endTime')} disabled={!form.endDate} style={[styles.pickerBtn, (!form.endDate || errors.end) && styles.pickerBtnError, !form.endDate && { opacity:0.5 }]}>
                <Text style={[styles.pickerText, errors.end && styles.pickerTextError]}>{form.endTime || (form.endDate? '23:59' : '--:--')}</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Địa điểm</Text>
            <TextInput style={styles.input} placeholder='VD: Phòng B302' value={form.location} onChangeText={t=>update('location', t)} />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Ghi chú</Text>
            <TextInput style={[styles.input, styles.textarea]} placeholder='Ghi chú...' multiline value={form.notes} onChangeText={t=>update('notes', t)} />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Link</Text>
            <TextInput style={styles.input} placeholder='https://' value={form.link} onChangeText={t=>update('link', t)} autoCapitalize='none' />
          </View>
        </View>

        {/* Repeat rule */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Lặp lại</Text>
          <View style={[styles.field, { flexDirection:'row', alignItems:'center', justifyContent:'space-between' }]}>
            <Text style={styles.label}>Lặp lại lịch</Text>
            <Switch value={!!form.isRepeating} onValueChange={(v)=> setForm(prev => ({ ...prev, isRepeating: v, repeat: v? (prev.repeat || { frequency:'weekly', endMode:'never' }): undefined }))} />
          </View>
          {!!form.isRepeating && (
            <>
              <View style={styles.field}>
                <Text style={styles.label}>Tần suất</Text>
                <View style={styles.typeList}>
                  {(['daily','weekly','monthly','yearly'] as const).map(freq => {
                    const active = form.repeat?.frequency === freq;
                    const label = freq==='daily'? 'Hàng ngày' : freq==='weekly'? 'Hàng tuần' : freq==='monthly'? 'Hàng tháng' : 'Hàng năm';
                    return (
                      <Pressable key={freq} onPress={()=> setForm(prev => ({ ...prev, repeat: { ...(prev.repeat||{}), frequency: freq } }))} style={[styles.typeChip, active && styles.typeChipActive]}>
                        <Text style={[styles.typeChipText, active && styles.typeChipTextActive]}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Kết thúc</Text>
                <View style={styles.typeList}>
                  {(['never','after','onDate'] as const).map(mode => {
                    const active = (form.repeat?.endMode || 'never') === mode;
                    const label = mode==='never'? 'Không bao giờ' : mode==='after'? 'Sau số lần' : 'Vào ngày';
                    return (
                      <Pressable key={mode} onPress={()=> setForm(prev => ({ ...prev, repeat: { ...(prev.repeat||{ frequency:'weekly' }), endMode: mode } }))} style={[styles.typeChip, active && styles.typeChipActive]}>
                        <Text style={[styles.typeChipText, active && styles.typeChipTextActive]}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {(form.repeat?.endMode === 'after') && (
                  <View style={[styles.field, { marginTop:8 }]}>
                    <Text style={styles.label}>Số lần</Text>
                    <TextInput style={styles.input} keyboardType='number-pad' placeholder='VD: 10' value={String(form.repeat?.count||'')} onChangeText={(t)=> setForm(prev => ({ ...prev, repeat: { ...(prev.repeat||{ frequency:'weekly' }), endMode:'after', count: parseInt(t||'0',10) || undefined } }))} />
                  </View>
                )}
                {(form.repeat?.endMode === 'onDate') && (
                  <View style={[styles.field, { marginTop:8 }]}>
                    <Text style={styles.label}>Ngày kết thúc lặp</Text>
                    <Pressable onPress={()=>{ setTempDate(form.repeat?.endDate? new Date(form.repeat.endDate+'T00:00:00'): new Date()); setShowPicker({ mode:'date', field:'repeatEndDate' }); }} style={styles.pickerBtn}>
                      <Text style={styles.pickerText}>{form.repeat?.endDate? toDisplayDate(form.repeat.endDate): 'Không chọn'}</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            </>
          )}
        </View>

        {selectedType && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Thuộc tính ({selectedType.name})</Text>
            {selectedType.fields.map((f:EventTypeField)=>{
              const v = form.props[f.key] ?? '';
              return (
                <View key={f.key} style={styles.field}>
                  <Text style={styles.label}>{f.label}{f.required? ' *':''}</Text>
                  <TextInput
                    style={styles.input}
                    placeholder={f.label}
                    value={v}
                    onChangeText={(t)=> setForm(prev => ({ ...prev, props: { ...prev.props, [f.key]: t } }))}
                    keyboardType={f.type==='url'? 'url':'default'}
                    autoCapitalize='none'
                  />
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Tóm tắt</Text>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Loại:</Text><Text style={styles.summaryValue}>{selectedType? selectedType.name : 'Chưa chọn'}</Text></View>
          {(() => {
            const startDate = form.date; const endDate = form.endDate; const sameDay = endDate && (startDate === endDate);
            let display = '';
            if(!endDate){ display = `${toDisplayDate(startDate)} ${form.startTime || ''}${form.endTime? '–'+form.endTime:''}`; }
            else if(sameDay){ display = `${toDisplayDate(startDate)} ${form.startTime || ''}${form.startTime && form.endTime ? '–' : ''}${form.endTime || ''}`; }
            else display = `${toDisplayDate(startDate)} ${form.startTime || ''} → ${toDisplayDate(endDate)} ${form.endTime || ''}`;
            return <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Thời gian:</Text><Text style={styles.summaryValue}>{display}</Text></View>;
          })()}
          {!!form.isRepeating && form.repeat && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Lặp lại:</Text>
              <Text style={styles.summaryValue}>
                {form.repeat.frequency==='daily'? 'Hàng ngày' : form.repeat.frequency==='weekly'? 'Hàng tuần' : form.repeat.frequency==='monthly'? 'Hàng tháng' : 'Hàng năm'}
                {form.repeat.endMode==='never'? '' : form.repeat.endMode==='after'? ` • Sau ${form.repeat.count||0} lần` : form.repeat.endDate? ` • đến ${toDisplayDate(form.repeat.endDate)}` : ''}
              </Text>
            </View>
          )}
        </View>

        <View style={{ height: 40 }} />
  </KeyboardAwareScrollView>

      <View style={styles.bottomBar}>
        <Pressable style={[styles.bottomBtn, styles.cancelBtn]} onPress={()=>router.back()}><Text style={styles.cancelText}>Hủy</Text></Pressable>
        <Pressable style={[styles.bottomBtn, !form.title.trim()||!form.typeId||saving ? styles.disabledBtn: styles.saveBtn]} disabled={!form.title.trim()||!form.typeId||saving} onPress={save}>
          <Text style={styles.saveText}>{saving? (editId? 'Đang lưu...' : 'Đang lưu...') : (editId? 'Lưu thay đổi':'Tạo lịch')}</Text>
        </Pressable>
      </View>

      {showPicker.field && Platform.OS==='android' && (
        <DateTimePicker value={tempDate || new Date()} mode={showPicker.mode} is24Hour display='default' onChange={onNativeChange} />
      )}
      {showPicker.field && Platform.OS==='ios' && (
        <Modal transparent animationType='fade'>
          <View style={styles.pickerBackdrop}>
            <View style={styles.pickerModal}>
              <DateTimePicker value={tempDate || new Date()} mode={showPicker.mode} display='spinner' themeVariant='light' onChange={(e, d)=>{ if(d) setTempDate(d); }} {...(showPicker.mode==='time'? { minuteInterval:5 } : {})} />
              <View style={styles.pickerActions}>
                <Pressable onPress={()=>{ setShowPicker({mode:'date', field:null}); setTempDate(null); }} style={[styles.pickerActionBtn, styles.pickerCancel]}><Text style={styles.pickerActionText}>Hủy</Text></Pressable>
                <Pressable onPress={confirmIOS} style={[styles.pickerActionBtn, styles.pickerOk]}><Text style={[styles.pickerActionText,{color:'#fff'}]}>Chọn</Text></Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingTop:4, paddingBottom:8, backgroundColor:'#f1f5f9' },
  backBtn:{ width:40, height:40, borderRadius:20, alignItems:'center', justifyContent:'center' },
  headerTitle:{ fontSize:18, fontWeight:'600', color:'#16425b' },
  body:{ padding:16, paddingBottom:24 },
  card:{ backgroundColor:'#fff', borderRadius:20, padding:16, marginBottom:16, shadowColor:'#000', shadowOpacity:0.04, shadowRadius:6, elevation:2 },
  sectionTitle:{ fontSize:16, fontWeight:'600', color:'#16425b', marginBottom:12 },
  field:{ marginBottom:14 },
  label:{ fontSize:13, fontWeight:'500', color:'#2f6690', marginBottom:6 },
  input:{ backgroundColor:'#f8fafc', borderWidth:1, borderColor:'#e2e8f0', borderRadius:14, paddingHorizontal:12, paddingVertical:12, fontSize:14, color:'#16425b' },
  textarea:{ minHeight:90, textAlignVertical:'top' },
  row:{ flexDirection:'row', justifyContent:'space-between', gap:12 },
  half:{ flex:1 },
  typeList:{ flexDirection:'row', flexWrap:'wrap' },
  typeChip:{ paddingHorizontal:12, paddingVertical:8, backgroundColor:'rgba(58,124,165,0.08)', borderRadius:20, marginRight:8, marginBottom:8 },
  typeChipActive:{ backgroundColor:'#3a7ca5' },
  typeChipText:{ color:'#2f6690', fontWeight:'600' },
  typeChipTextActive:{ color:'#fff' },
  summaryRow:{ flexDirection:'row', justifyContent:'space-between', marginBottom:6 },
  summaryLabel:{ fontSize:12, color:'#2f6690' },
  summaryValue:{ fontSize:12, color:'#16425b', fontWeight:'500' },
  bottomBar:{ position:'absolute', left:0, right:0, bottom:0, flexDirection:'row', padding:16, backgroundColor:'#ffffffee', gap:12, borderTopWidth:1, borderColor:'#e2e8f0' },
  bottomBtn:{ flex:1, height:52, borderRadius:16, alignItems:'center', justifyContent:'center' },
  cancelBtn:{ backgroundColor:'rgba(217,220,214,0.55)' },
  cancelText:{ color:'#2f6690', fontWeight:'600', fontSize:14 },
  saveBtn:{ backgroundColor:'#3a7ca5' },
  disabledBtn:{ backgroundColor:'#94a3b8' },
  saveText:{ color:'#fff', fontWeight:'600', fontSize:15 },
  pickerBtn:{ backgroundColor:'#f8fafc', borderWidth:1, borderColor:'#e2e8f0', borderRadius:14, paddingHorizontal:12, height:48, justifyContent:'center' },
  pickerBtnError:{ borderColor:'#e2e8f0' },
  pickerText:{ fontSize:14, color:'#16425b', fontWeight:'500' },
  pickerTextError:{ color:'#b91c1c' },
  pickerBackdrop:{ flex:1, backgroundColor:'rgba(0,0,0,0.35)', justifyContent:'flex-end' },
  pickerModal:{ backgroundColor:'#fff', borderTopLeftRadius:24, borderTopRightRadius:24, paddingTop:8, paddingBottom:20 },
  pickerActions:{ flexDirection:'row', justifyContent:'space-between', paddingHorizontal:16, marginTop:4 },
  pickerActionBtn:{ flex:1, height:44, borderRadius:14, alignItems:'center', justifyContent:'center', marginHorizontal:6 },
  pickerCancel:{ backgroundColor:'#e2e8f0' },
  pickerOk:{ backgroundColor:'#3a7ca5' },
  pickerActionText:{ fontSize:15, fontWeight:'600', color:'#16425b' },
});
