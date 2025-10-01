import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView, Pressable, Alert, ActivityIndicator, Modal, Switch, DeviceEventEmitter } from 'react-native';
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
}

export default function CreateEventScreen(){
  const router = useRouter();
  const { editId } = useLocalSearchParams<{ editId?: string }>();
  const { token } = useAuth();
  const API_BASE = process.env.EXPO_PUBLIC_API_BASE;

  const today = new Date().toISOString().split('T')[0];
  const [saving, setSaving] = useState(false);
  const [types, setTypes] = useState<EventTypeDoc[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(false);
  const [showPicker, setShowPicker] = useState<{mode:'date'|'time'; field:'date'|'endDate'|'startTime'|'endTime'|null}>({mode:'date', field:null});
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
    props: {}
  });

  const authHeader = () => ({ headers: { Authorization: token ? `Bearer ${token}` : '' } });

  const fetchTypes = async () => {
    if(!token) return;
    setLoadingTypes(true);
    try {
      const res = await axios.get(`${API_BASE}/api/event-types`, authHeader());
      setTypes(res.data);
    } catch(e) { /* silent */ } finally { setLoadingTypes(false); }
  };

  useEffect(()=>{ fetchTypes(); }, [token]);

  const update = useCallback(<K extends keyof FormState>(key:K, value: FormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  }, []);

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
        const iso = selected.toISOString().split('T')[0];
        if(showPicker.field === 'endDate'){
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
        const iso = tempDate.toISOString().split('T')[0];
        if(showPicker.field === 'endDate'){
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
    if(!form.typeId){ Alert.alert('Thiếu thông tin','Vui lòng chọn loại sự kiện'); return; }
    if(!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) { Alert.alert('Lỗi','Ngày bắt đầu không hợp lệ'); return; }
    if(form.endDate){
      if(!/^\d{4}-\d{2}-\d{2}$/.test(form.endDate)) { Alert.alert('Lỗi','Ngày kết thúc không hợp lệ'); return; }
      if(form.endDate < form.date) { Alert.alert('Lỗi','Ngày kết thúc phải >= ngày bắt đầu'); return; }
      if(form.date === form.endDate && form.startTime && form.endTime && form.endTime <= form.startTime){ Alert.alert('Lỗi','Giờ kết thúc phải sau giờ bắt đầu'); return; }
    } else {
      if(form.endTime && form.startTime && form.endTime <= form.startTime){ Alert.alert('Lỗi','Giờ kết thúc phải sau giờ bắt đầu'); return; }
    }
    setSaving(true);
    const payload = {
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
    try {
      if(editId){
        const res = await axios.put(`${API_BASE}/api/events/${editId}`, payload, authHeader());
        // Notify listeners
        // @ts-ignore
        DeviceEventEmitter.emit('eventUpdated', res.data);
        Alert.alert('Thành công','Đã lưu sự kiện');
      } else {
        const res = await axios.post(`${API_BASE}/api/events`, payload, authHeader());
        // Notify listeners
        // @ts-ignore
        DeviceEventEmitter.emit('eventCreated', res.data);
        Alert.alert('Thành công','Đã tạo sự kiện');
      }
      router.back();
    } catch(e:any){
      Alert.alert('Lỗi', e?.response?.data?.message || 'Không thể lưu sự kiện');
    } finally { setSaving(false); }
  };

  const selectedType = types.find(t => t._id === form.typeId);

  return (
    <SafeAreaView style={{ flex:1, backgroundColor:'#f1f5f9' }} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={()=>router.back()} style={styles.backBtn}><Ionicons name='arrow-back' size={22} color='#16425b' /></Pressable>
        <Text style={styles.headerTitle}>{editId? 'Chỉnh sửa sự kiện':'Tạo sự kiện mới'}</Text>
        <View style={{ width:40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Thông tin cơ bản</Text>
          <View style={styles.field}>
            <Text style={styles.label}>Tiêu đề *</Text>
            <TextInput style={styles.input} placeholder='VD: Học Toán (Đại số)' value={form.title} onChangeText={t=>update('title', t)} />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Loại sự kiện *</Text>
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
                <Pressable onPress={()=>router.push('/create-event-type')} style={[styles.typeChip, { borderWidth:1, borderColor:'#3a7ca5', backgroundColor:'transparent' }]}>
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
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      <View style={styles.bottomBar}>
        <Pressable style={[styles.bottomBtn, styles.cancelBtn]} onPress={()=>router.back()}><Text style={styles.cancelText}>Hủy</Text></Pressable>
        <Pressable style={[styles.bottomBtn, !form.title.trim()||!form.typeId||saving ? styles.disabledBtn: styles.saveBtn]} disabled={!form.title.trim()||!form.typeId||saving} onPress={save}>
          <Text style={styles.saveText}>{saving? (editId? 'Đang lưu...' : 'Đang lưu...') : (editId? 'Lưu thay đổi':'Tạo sự kiện')}</Text>
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
