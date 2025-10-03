import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, Alert, Switch, ActivityIndicator, Modal } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { DeviceEventEmitter } from 'react-native';
import { useAuth } from '@/contexts/AuthContext';
import axios from 'axios';
import { TaskPriority, TaskType } from '@/utils/dashboard';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Platform } from 'react-native';

interface FormState {
  title: string;
  description: string;
  date: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD (ngày kết thúc)
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  priority: TaskPriority; // sẽ được tính từ importance + urgency
  importance: TaskPriority; // nhập từ người dùng
  urgency: TaskPriority;    // nhập từ người dùng
  type: TaskType;
  estimatedHours: string;
  tags: string[];
  subTasks: { id: string; title: string; completed: boolean }[]; // local id
  isRepeating?: boolean;
  repeat?: { frequency: 'daily'|'weekly'|'monthly'|'yearly'; endMode: 'never'|'onDate'|'after'; endDate?: string; count?: string };
}

type Tag = { _id: string; name: string; slug: string };

export default function CreateTaskScreen() {
  const router = useRouter();
  const { editId, occDate } = useLocalSearchParams<{ editId?: string; occDate?: string }>();
  const { user, token } = useAuth();
  const isLeader = user?.role === 'leader' || user?.role === 'admin';
  const [saving, setSaving] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [showPicker, setShowPicker] = useState<{mode:'date'|'time'; field:'date'|'endDate'|'startTime'|'endTime'|'repeatEndDate'|null}>({mode:'date', field:null});
  const [tempDate, setTempDate] = useState<Date | null>(null);
  // Helper to format Date as local YYYY-MM-DD (avoid UTC shift from toISOString)
  const toLocalISODate = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const today = toLocalISODate(new Date());
  const [form, setForm] = useState<FormState>({
    title: '',
    description: '',
    date: today,
    endDate: '',
    startTime: '09:00',
    endTime: '',
    priority: 'medium',
    importance: 'medium',
    urgency: 'medium',
    type: 'personal',
    estimatedHours: '1',
    tags: [],
    subTasks: [],
    isRepeating: false,
    repeat: undefined
  });
  const [tags, setTags] = useState<Tag[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);
  const [creatingTag, setCreatingTag] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [errors, setErrors] = useState<{start?:string; end?:string; sub?:string}>({});

  const API_BASE = process.env.EXPO_PUBLIC_API_BASE;

  const authHeader = () => ({ headers: { Authorization: token ? `Bearer ${token}` : '' } });

  const fetchTags = async () => {
    if(!token) return;
    setLoadingTags(true);
    try {
      const res = await axios.get(`${API_BASE}/api/tags`, authHeader());
      setTags(res.data);
    } catch(e){
      // silent
    } finally { setLoadingTags(false); }
  };

  useEffect(()=>{ fetchTags(); },[token]);

  const update = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  }, []);

  // Tính mức ưu tiên từ (quan trọng, khẩn cấp)
  const score = (v: TaskPriority) => v === 'high' ? 3 : v === 'medium' ? 2 : 1;
  const computePriority = (importance: TaskPriority, urgency: TaskPriority): TaskPriority => {
    const s = score(importance) + score(urgency);
    if (s >= 5) return 'high';
    if (s >= 3) return 'medium';
    return 'low';
  };

  // Đồng bộ priority mỗi khi importance/urgency thay đổi
  useEffect(() => {
    setForm(prev => ({ ...prev, priority: computePriority(prev.importance, prev.urgency) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.importance, form.urgency]);

  // Format YYYY-MM-DD -> DD/MM/YYYY for display only
  const toDisplayDate = (iso: string) => {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    const [y,m,d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };

  const toggleTag = (tagId: string, name?: string) => {
    setForm(prev => ({
      ...prev,
      tags: prev.tags.includes(tagId) ? prev.tags.filter(t=>t!==tagId) : [...prev.tags, tagId]
    }));
  };

  const createTag = async () => {
    if(!newTag.trim()) return;
    if(!token) { Alert.alert('Lỗi','Chưa có token'); return; }
    setCreatingTag(true);
    try {
      const res = await axios.post(`${API_BASE}/api/tags`, { name: newTag.trim() }, authHeader());
      const tag:Tag = res.data;
      setTags(prev => {
        if(prev.find(t=>t._id===tag._id)) return prev;
        return [...prev, tag];
      });
      setForm(prev => ({ ...prev, tags: [...prev.tags, tag._id] }));
      setNewTag('');
    } catch(e:any){
      Alert.alert('Lỗi','Không tạo được tag');
    } finally { setCreatingTag(false); }
  };

  const save = async () => {
    if (!form.title.trim()) { Alert.alert('Thiếu thông tin','Vui lòng nhập tên tác vụ'); return; }
    if(!token) { Alert.alert('Lỗi','Chưa đăng nhập'); return; }
    // Validate dates & times
    if(!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) { Alert.alert('Lỗi','Ngày bắt đầu không hợp lệ'); return; }
    if(form.endDate){
      if(!/^\d{4}-\d{2}-\d{2}$/.test(form.endDate)) { Alert.alert('Lỗi','Ngày kết thúc không hợp lệ'); return; }
      if(form.endDate < form.date) { Alert.alert('Lỗi','Ngày kết thúc phải >= ngày bắt đầu'); return; }
      if(form.date === form.endDate && form.startTime && form.endTime && form.endTime <= form.startTime){ Alert.alert('Lỗi','Giờ kết thúc phải sau giờ bắt đầu'); return; }
    } else {
      // Không có endDate: nếu có endTime thì phải sau startTime (cùng ngày)
      if(form.endTime && form.startTime && form.endTime <= form.startTime){ Alert.alert('Lỗi','Giờ kết thúc phải sau giờ bắt đầu'); return; }
    }
    if(form.subTasks.some(st=>!st.title.trim())) { Alert.alert('Lỗi','Vui lòng nhập tên cho tất cả tác vụ con'); return; }
    setSaving(true);
    const payload = {
      title: form.title.trim(),
      description: form.description,
      date: form.date,
      endDate: form.endDate || undefined,
      startTime: form.startTime,
      endTime: form.endDate ? (form.endTime || '23:59') : (form.endTime || undefined),
      priority: form.priority,
      importance: form.importance,
      urgency: form.urgency,
      type: form.type,
      estimatedHours: parseFloat(form.estimatedHours)||1,
      tags: form.tags,
      subTasks: form.subTasks.filter(st=>st.title.trim()).map(st=> ({ title: st.title.trim(), completed: st.completed })),
    };
    if(form.isRepeating && form.repeat){
      (payload as any).repeat = {
        frequency: form.repeat.frequency,
        endMode: form.repeat.endMode,
        endDate: form.repeat.endMode==='onDate' ? form.repeat.endDate : undefined,
        count: form.repeat.endMode==='after' ? (parseInt(form.repeat.count||'0',10)||undefined) : undefined,
      };
    }
    try {
      if(editId){
        const res = await axios.put(`${API_BASE}/api/tasks/${editId}`, payload, authHeader());
        DeviceEventEmitter.emit('taskUpdated', res.data);
        DeviceEventEmitter.emit('toast','Đã lưu thay đổi');
      } else {
        const res = await axios.post(`${API_BASE}/api/tasks`, payload, authHeader());
        DeviceEventEmitter.emit('taskCreated', res.data);
        DeviceEventEmitter.emit('toast','Đã tạo tác vụ');
      }
      router.back();
    } catch(e:any){
      Alert.alert('Lỗi', e?.response?.data?.message || (editId? 'Không cập nhật được':'Không thể tạo tác vụ'));
    } finally { setSaving(false); }
  };

  // Delete with scope similar to events
  const onDelete = async () => {
    if(!editId || !token) return;
    const hasRepeat = !!form.repeat;
    if(!hasRepeat){
      Alert.alert('Xóa tác vụ', 'Bạn có chắc muốn xóa tác vụ này?', [
        { text:'Hủy', style:'cancel' },
        { text:'Xóa', style:'destructive', onPress: async ()=>{
          try { await axios.delete(`${API_BASE}/api/tasks/${editId}`, authHeader()); DeviceEventEmitter.emit('taskDeleted', editId); DeviceEventEmitter.emit('toast','Đã xóa tác vụ'); router.back(); }
          catch(e:any){ Alert.alert('Lỗi', e?.response?.data?.message || 'Không thể xóa'); }
        } }
      ]);
      return;
    }
    // Repeating task: choose scope
    Alert.alert(
      'Xóa tác vụ lặp lại',
      'Bạn muốn xóa chỉ lần này hay từ lần này trở đi?\n(Lưu ý: hiện tại chưa hỗ trợ exceptionDates, thao tác sẽ cắt hoặc tách chuỗi lặp.)',
      [
        { text:'Hủy', style:'cancel' },
        { text:'Chỉ lần này', onPress: async ()=>{
          try {
            // If occDate equals series start, shift series start to next occurrence; otherwise split series
            const start = form.date;
            const r = form.repeat!;
            const target = occDate || start;
            // Compute next occurrence similar to dashboard recurrence math
            const isoToDate = (iso:string)=>{ const [y,m,d]=iso.split('-').map(n=>parseInt(String(n),10)); return new Date(y,(m||1)-1,d||1); };
            const toLocalISODate = (d:Date)=>{ const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; };
            const addDays = (iso:string,n:number)=>{ const dt=isoToDate(iso); dt.setDate(dt.getDate()+n); return toLocalISODate(dt); };
            const addMonths = (iso:string,n:number)=>{ const d=isoToDate(iso); const day=d.getDate(); const t=new Date(d.getFullYear(), d.getMonth()+n, day); if(t.getDate()!==day) return null; return toLocalISODate(t); };
            let nextStart: string | null = null;
            if(r.frequency==='daily') nextStart = addDays(target, 1);
            else if(r.frequency==='weekly') nextStart = addDays(target, 7);
            else if(r.frequency==='monthly') nextStart = addMonths(target, 1);
            else if(r.frequency==='yearly') { const a=isoToDate(target); nextStart = toLocalISODate(new Date(a.getFullYear()+1, a.getMonth(), a.getDate())); }
            // Case 1: target is start -> move start to nextStart
            if(target === start){
              const updates:any = { date: nextStart };
              // adjust endDate span if existed
              if(form.endDate){ const spanMs = isoToDate(form.endDate).getTime() - isoToDate(start).getTime(); const newEnd = new Date(isoToDate(nextStart!).getTime()+spanMs); updates.endDate = toLocalISODate(newEnd); }
              const res = await axios.put(`${API_BASE}/api/tasks/${editId}`, { ...updates }, authHeader());
              DeviceEventEmitter.emit('taskUpdated', res.data);
              DeviceEventEmitter.emit('toast','Đã xóa lần đầu tiên của chuỗi');
              router.back();
              return;
            }
            // Case 2: split series at occDate: set current's repeat endDate to day before target
            const prevDay = addDays(target, -1);
            const updates:any = { repeat: { ...r, endMode:'onDate', endDate: prevDay } };
            await axios.put(`${API_BASE}/api/tasks/${editId}`, updates, authHeader());
            // Create a new task for future occurrences starting nextStart with same fields
            const clonePayload:any = {
              title: form.title,
              description: form.description,
              date: nextStart,
              endDate: form.endDate ? addDays(nextStart!, ( (new Date(form.endDate).getTime()-new Date(form.date).getTime())/86400000 )) : undefined,
              startTime: form.startTime,
              endTime: form.endTime,
              priority: form.priority,
              importance: form.importance,
              urgency: form.urgency,
              type: form.type,
              estimatedHours: parseFloat(form.estimatedHours)||1,
              tags: form.tags,
              subTasks: form.subTasks.map(st=> ({ title: st.title, completed: st.completed })),
              repeat: { ...r }
            };
            const created = await axios.post(`${API_BASE}/api/tasks`, clonePayload, authHeader());
            DeviceEventEmitter.emit('taskUpdated', { _id: editId, ...updates });
            DeviceEventEmitter.emit('taskCreated', created.data);
            DeviceEventEmitter.emit('toast','Đã xóa 1 lần và tách chuỗi');
            router.back();
          } catch(e:any){ Alert.alert('Lỗi','Không thể xóa chỉ lần này'); }
        }},
        { text:'Từ lần này trở đi', style:'destructive', onPress: async ()=>{
          try {
            if(!occDate){ // no occDate -> treat as delete whole series from start
              await axios.delete(`${API_BASE}/api/tasks/${editId}`, authHeader());
              DeviceEventEmitter.emit('taskDeleted', editId);
              DeviceEventEmitter.emit('toast','Đã xóa chuỗi');
              router.back();
              return;
            }
            // set repeat endDate to day before occDate
            const [y,m,d] = occDate.split('-').map(Number);
            const dt = new Date(y!, (m||1)-1, d||1); dt.setDate(dt.getDate()-1);
            const prev = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
            const updates:any = { repeat: { ...(form.repeat||{}), endMode:'onDate', endDate: prev } };
            const res = await axios.put(`${API_BASE}/api/tasks/${editId}`, updates, authHeader());
            DeviceEventEmitter.emit('taskUpdated', res.data);
            DeviceEventEmitter.emit('toast','Đã cắt chuỗi từ lần này');
            router.back();
          } catch(e:any){ Alert.alert('Lỗi','Không thể cắt chuỗi'); }
        }}
      ]
    );
  };

  // Load task if edit mode
  useEffect(()=>{
    const load = async () => {
      if(!editId || !token) return;
      try {
        const res = await axios.get(`${API_BASE}/api/tasks/${editId}`, authHeader());
        const t = res.data;
        setForm(prev => ({
          ...prev,
          title: t.title,
          description: t.description||'',
          date: t.date?.split('T')[0] || prev.date,
          endDate: t.endDate || '',
          startTime: t.startTime || prev.startTime,
          endTime: t.endTime || '',
          priority: t.priority || 'medium',
          importance: t.importance || 'medium',
          urgency: (t as any).urgency || 'medium',
          type: t.type || 'personal',
          estimatedHours: String(t.estimatedHours||1),
          tags: (t.tags||[]).map((x:any)=> typeof x === 'string'? x : x._id),
          subTasks: (t.subTasks||[]).map((st:any)=> ({ id: st._id || Math.random().toString(36).slice(2), title: st.title, completed: !!st.completed })),
          isRepeating: !!t.repeat,
          repeat: t.repeat ? {
            frequency: t.repeat.frequency,
            endMode: t.repeat.endMode || 'never',
            endDate: t.repeat.endDate,
            count: t.repeat.count ? String(t.repeat.count) : undefined
          } : undefined
        }));
      } catch(e){
        Alert.alert('Lỗi','Không tải được tác vụ để sửa');
      }
    };
    load();
  },[editId, token]);

  const generateAI = () => {
    setShowAI(true);
    Alert.alert('AI','Đang phân tích và gợi ý...');
    setTimeout(()=>{
      Alert.alert('Gợi ý','Chia nhỏ tác vụ thành các bước, đặt deadline sớm hơn 1 ngày.');
    },1500);
  };

  const onPick = (e:DateTimePickerEvent, selected?:Date) => {
    if(e.type === 'dismissed'){ setShowPicker({mode:'date', field:null}); return; }
    if(selected && showPicker.field){
      if(showPicker.mode==='date'){
        const iso = toLocalISODate(selected);
        if(showPicker.field === 'endDate'){
          setForm(prev => ({
            ...prev,
            endDate: iso,
            endTime: prev.endTime || '23:59'
          }));
        } else if (showPicker.field === 'repeatEndDate') {
          setForm(prev => ({
            ...prev,
            repeat: { ...(prev.repeat || { frequency:'weekly', endMode:'onDate' }), endDate: iso, endMode:'onDate' }
          }));
        } else {
          update(showPicker.field as any, iso);
        }
      } else {
        const hh = selected.getHours().toString().padStart(2,'0');
        const mm = selected.getMinutes().toString().padStart(2,'0');
        update(showPicker.field as any, `${hh}:${mm}`);
      }
    }
    setShowPicker({mode:'date', field:null});
  };
  const openDate = (field:'date'|'endDate') => { setTempDate(parseDateValue(field)); setShowPicker({mode:'date', field}); };
  const openTime = (field:'startTime'|'endTime') => { setTempDate(parseTimeValue(field)); setShowPicker({mode:'time', field}); };
  const onNativeChange = (e:DateTimePickerEvent, selected?:Date) => {
    if(Platform.OS !== 'android') return; // android handled inline event commit
    if(e.type==='dismissed'){ setShowPicker({mode:'date', field:null}); return; }
    if(selected && showPicker.field){
      if(showPicker.mode==='date'){
        const iso = toLocalISODate(selected);
        if(showPicker.field === 'endDate'){
          setForm(prev => ({
            ...prev,
            endDate: iso,
            endTime: prev.endTime || '23:59'
          }));
        } else if (showPicker.field === 'repeatEndDate') {
          setForm(prev => ({
            ...prev,
            repeat: { ...(prev.repeat || { frequency:'weekly', endMode:'onDate' }), endDate: iso, endMode:'onDate' }
          }));
        } else {
          update(showPicker.field as any, iso);
        }
      }
      else {
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
        if(showPicker.field === 'endDate'){
          setForm(prev => ({
            ...prev,
            endDate: iso,
            endTime: prev.endTime || '23:59'
          }));
        } else if (showPicker.field === 'repeatEndDate') {
          setForm(prev => ({
            ...prev,
            repeat: { ...(prev.repeat || { frequency:'weekly', endMode:'onDate' }), endDate: iso, endMode:'onDate' }
          }));
        } else {
          update(showPicker.field as any, iso);
        }
      }
      else {
        const hh = tempDate.getHours().toString().padStart(2,'0');
        const mm = tempDate.getMinutes().toString().padStart(2,'0');
        update(showPicker.field as any, `${hh}:${mm}`);
      }
    }
    setShowPicker({mode:'date', field:null});
    setTempDate(null);
  };
  const cancelIOS = () => { setShowPicker({mode:'date', field:null}); setTempDate(null); };

  const updateRepeat = <K extends keyof NonNullable<FormState['repeat']>>(key: K, value: NonNullable<FormState['repeat']>[K]) => {
    setForm(prev => ({ ...prev, repeat: { ...(prev.repeat || { frequency:'weekly', endMode:'never' }), [key]: value } as any }));
  };
  const openRepeatEndDate = () => {
    const raw = form.repeat?.endDate;
    const base = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(raw+'T00:00:00') : new Date();
    setTempDate(base);
    setShowPicker({ mode:'date', field:'repeatEndDate' });
  };

  const priorityLabel = (p: TaskPriority) => p==='high'?'Cao':p==='medium'?'Trung bình':'Thấp';

  const parseDateValue = (field:'date'|'endDate') => {
    const raw = form[field];
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
    if(form.subTasks.some(st=>!st.title.trim())) newErr.sub = 'Có tác vụ con chưa nhập tên';
    setErrors(newErr);
  },[form.date, form.endDate, form.startTime, form.endTime, form.subTasks]);

  const addSubTask = () => {
    setForm(prev => ({ ...prev, subTasks:[...prev.subTasks, { id: Math.random().toString(36).slice(2), title:'', completed:false }] }));
  };
  const updateSubTaskTitle = (id:string, title:string) => {
    setForm(prev => ({ ...prev, subTasks: prev.subTasks.map(st => st.id===id? { ...st, title } : st) }));
  };
  const removeSubTask = (id:string) => {
    setForm(prev => ({ ...prev, subTasks: prev.subTasks.filter(st=>st.id!==id) }));
  };
  const toggleSubTaskCompleted = (id:string) => {
    setForm(prev => ({ ...prev, subTasks: prev.subTasks.map(st => st.id===id? { ...st, completed: !st.completed }: st) }));
  };

  return (
    <SafeAreaView style={{ flex:1, backgroundColor:'#f1f5f9' }} edges={['top']}>      
      <View style={styles.header}>        
        <Pressable onPress={()=>router.back()} style={styles.backBtn}>
          <Ionicons name='arrow-back' size={22} color='#16425b' />
        </Pressable>
        <Text style={styles.headerTitle}>{editId? 'Chỉnh sửa tác vụ' : 'Tạo tác vụ mới'}</Text>
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
            <Text style={styles.label}>Tên tác vụ *</Text>
            <TextInput
              style={styles.input}
              placeholder='VD: Một công việc bạn cần hoàn thành'
              value={form.title}
              onChangeText={t=>update('title', t)}
            />
          </View>
          <View style={styles.field}>            
            <Text style={styles.label}>Mô tả</Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              multiline
              placeholder='Mô tả chi tiết...'
              value={form.description}
              onChangeText={t=>update('description', t)}
            />
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
              <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
                <Pressable onPress={()=>openDate('endDate')} style={[styles.pickerBtn,{ flex:1 }, errors.end && styles.pickerBtnError]}> 
                  <Text style={[styles.pickerText, errors.end && styles.pickerTextError]}>{toDisplayDate(form.endDate)}</Text>
                </Pressable>
              </View>
            </View>
            <View style={[styles.field, styles.half]}>
              <Text style={styles.label}>Giờ kết thúc</Text>
              <Pressable onPress={()=>openTime('endTime')} style={[styles.pickerBtn, errors.end && styles.pickerBtnError]}> 
                <Text style={[styles.pickerText, errors.end && styles.pickerTextError]}>{form.endTime}</Text>
              </Pressable>
            </View>
          </View>
        </View>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Tầm quan trọng & Khẩn cấp</Text>
            <Text style={styles.sub}>Mức độ quan trọng</Text>
            <View style={styles.priorityRow}>
              {(['low','medium','high'] as TaskPriority[]).map(p => {
                const active = form.importance === p;
                return (
                  <Pressable key={p} onPress={()=>update('importance', p)} style={[styles.priorityBtn, active && styles.priorityBtnActive]}>                  
                    <Text style={[styles.priorityText, active && styles.priorityTextActive]}>{priorityLabel(p)}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[styles.sub,{ marginTop:4 }]}>Mức độ khẩn cấp</Text>
            <View style={styles.priorityRow}>
              {(['low','medium','high'] as TaskPriority[]).map(p => {
                const active = form.urgency === p;
                return (
                  <Pressable key={p} onPress={()=>update('urgency', p)} style={[styles.priorityBtn, active && styles.priorityBtnActive]}>                  
                    <Text style={[styles.priorityText, active && styles.priorityTextActive]}>{priorityLabel(p)}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={{ marginTop: 6 }}>
              <Text style={[styles.sub]}>Mức ưu tiên tính toán: <Text style={{ fontWeight:'700', color:'#16425b' }}>{priorityLabel(form.priority)}</Text></Text>
            </View>
          <View style={[styles.typeRow, { opacity: isLeader ? 1 : 0.65 }]}>            
            <View>
              <Text style={styles.label}>{form.type === 'group' ? 'Tác vụ nhóm' : 'Tác vụ cá nhân'}</Text>
              <Text style={styles.sub}>{form.type==='group'? 'Có thể giao thành viên khác':'Chỉ bạn thực hiện'}</Text>
            </View>
            <Switch
              value={form.type === 'group'}
              disabled={!isLeader}
              onValueChange={(v)=> update('type', v? 'group':'personal')}
            />
          </View>
          
          {isLeader && form.type==='group' && (
            <View style={styles.field}>              
              <Text style={styles.label}>Thời gian ước tính (giờ)</Text>
              <TextInput
                style={styles.input}
                keyboardType='numeric'
                value={form.estimatedHours}
                onChangeText={t=>update('estimatedHours', t)}
              />
            </View>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Tags</Text>
          {loadingTags ? <ActivityIndicator color="#3a7ca5" /> : (
            <View style={styles.tagsWrap}>
              {tags.map(tag => {
                const active = form.tags.includes(tag._id);
                return (
                  <Pressable key={tag._id} onPress={()=>toggleTag(tag._id)} style={[styles.tag, active && styles.tagActive]}>
                    <Text style={[styles.tagText, active && styles.tagTextActive]}>{tag.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
          <View style={styles.newTagRow}>
            <TextInput
              style={[styles.input,{ flex:1, paddingVertical:10 }]} placeholder='Tag mới'
              value={newTag}
              onChangeText={setNewTag}
            />
            <Pressable disabled={creatingTag || !newTag.trim()} onPress={createTag} style={[styles.addTagBtn, (creatingTag || !newTag.trim()) && { opacity:0.5 }]}>
              <Text style={styles.addTagText}>{creatingTag? '...' : 'Thêm'}</Text>
            </Pressable>
          </View>
          {form.tags.length>0 && (
            <Text style={styles.chosenTags}>Đã chọn: {form.tags.length}</Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Tác vụ con (Subtasks)</Text>
          {form.subTasks.map(st => (
            <View key={st.id} style={styles.subTaskRow}>
              <Pressable onPress={()=>toggleSubTaskCompleted(st.id)} style={styles.subChkBtn} hitSlop={8}>
                <View style={[styles.subChkCircle, st.completed && styles.subChkCircleDone]}>
                  {st.completed && <Ionicons name='checkmark' size={14} color='#fff' />}
                </View>
              </Pressable>
              <TextInput
                style={[styles.input, styles.subTaskInput, errors.sub && !st.title.trim() && { borderColor:'#dc2626', backgroundColor:'#fef2f2' }, st.completed && { textDecorationLine:'line-through', opacity:0.6 }]
                }
                placeholder='Tên tác vụ con'
                value={st.title}
                onChangeText={(t)=>updateSubTaskTitle(st.id, t)}
              />
              <Pressable onPress={()=>removeSubTask(st.id)} style={styles.removeSubBtn}>
                <Text style={styles.removeSubText}>✕</Text>
              </Pressable>
            </View>
          ))}
          {!!errors.sub && <Text style={styles.errorText}>{errors.sub}</Text>}
          <Pressable onPress={addSubTask} style={styles.addSubBtn}>
            <Text style={styles.addSubText}>+ Thêm tác vụ con</Text>
          </Pressable>
        </View>

        {/* Repeat rule (aligned with create-event) */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Lặp lại</Text>
          <View style={[styles.typeRow,{ paddingVertical:0, marginBottom:6 }]}>            
            <Text style={styles.label}>Lặp lại tác vụ</Text>
            <Switch
              value={!!form.isRepeating}
              onValueChange={(v)=> setForm(prev => ({ ...prev, isRepeating: v, repeat: v? (prev.repeat || { frequency:'weekly', endMode:'never' }) : undefined }))}
            />
          </View>
          {!!form.isRepeating && (
            <View>
              <Text style={styles.label}>Tần suất</Text>
              <View style={styles.typeList}>
                {(['daily','weekly','monthly','yearly'] as const).map(freq => {
                  const active = form.repeat?.frequency === freq;
                  return (
                    <Pressable key={freq} onPress={()=> updateRepeat('frequency', freq)} style={[styles.typeChip, active && styles.typeChipActive]}>
                      <Text style={[styles.typeChipText, active && styles.typeChipTextActive]}>{freq==='daily'?'Hàng ngày': freq==='weekly'?'Hàng tuần': freq==='monthly'?'Hàng tháng':'Hàng năm'}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={[styles.label,{ marginTop:6 }]}>Kết thúc</Text>
              <View style={styles.typeList}>
                {(['never','onDate','after'] as const).map(mode => {
                  const active = (form.repeat?.endMode || 'never') === mode;
                  return (
                    <Pressable key={mode} onPress={()=> updateRepeat('endMode', mode)} style={[styles.typeChip, active && styles.typeChipActive]}>
                      <Text style={[styles.typeChipText, active && styles.typeChipTextActive]}>{mode==='never'?'Không bao giờ': mode==='onDate'?'Vào ngày':'Sau số lần'}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {(form.repeat?.endMode === 'after') && (
                <View style={styles.field}>
                  <Text style={styles.label}>Số lần lặp</Text>
                  <TextInput style={styles.input} keyboardType='number-pad' placeholder='VD: 10' value={String(form.repeat?.count||'')} onChangeText={(t)=> updateRepeat('count', t)} />
                </View>
              )}
              {(form.repeat?.endMode === 'onDate') && (
                <View style={styles.field}>
                  <Text style={styles.label}>Ngày kết thúc lặp</Text>
                  <Pressable onPress={openRepeatEndDate} style={styles.pickerBtn}>
                    <Text style={styles.pickerText}>{form.repeat?.endDate? toDisplayDate(form.repeat.endDate): 'Không chọn'}</Text>
                  </Pressable>
                </View>
              )}
            </View>
          )}
        </View>

        {showAI && (
          <View style={styles.aiBox}>
            <Text style={styles.aiTitle}>Gợi ý từ AI</Text>
            <Text style={styles.aiLine}>• Chia nhỏ task thành các bước rõ ràng</Text>
            <Text style={styles.aiLine}>• Đặt deadline sớm hơn 1 ngày để có buffer</Text>
            <Text style={styles.aiLine}>• Thêm thời gian nghỉ hợp lý</Text>
          </View>
        )}

        <View style={styles.card}>          
          <Text style={styles.sectionTitle}>Tóm tắt</Text>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Ưu tiên (tính):</Text><Text style={styles.summaryValue}>{priorityLabel(form.priority)}</Text></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Loại:</Text><Text style={styles.summaryValue}>{form.type==='group'?'Nhóm':'Cá nhân'}</Text></View>
          {(() => {
            const startDate = form.date; const endDate = form.endDate; const sameDay = endDate && (startDate === endDate);
            const fmt = (d:string) => { if(!/^\d{4}-\d{2}-\d{2}$/.test(d)) return d; const [y,m,dd]=d.split('-'); return `${dd}/${m}/${y}`; };
            let display = '';
            if(!endDate){
              // Không có ngày kết thúc: hiển thị 1 ngày, có thể kèm khoảng giờ nếu có endTime
              display = `${fmt(startDate)} ${form.startTime || ''}${form.endTime ? '–' + form.endTime : ''}`;
            } else if(sameDay) {
              display = `${fmt(startDate)} ${form.startTime || ''}${form.startTime && form.endTime ? '–' : ''}${form.endTime || ''}`;
            } else {
              display = `${fmt(startDate)} ${form.startTime || ''} → ${fmt(endDate)} ${form.endTime || ''}`;
            }
            const todayISO = toLocalISODate(new Date());
            const endDeadline = (endDate && form.endTime) ? new Date(`${endDate}T${form.endTime}:00`) : (endDate ? new Date(`${endDate}T23:59:59`) : undefined);
            const now = new Date();
            const isEndToday = endDate === todayISO;
            const isOverdue = endDeadline ? now > endDeadline : false;
            const dyn = isOverdue ? styles.rangeOverdue : (isEndToday ? styles.rangeToday : undefined);
            return (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Thời gian:</Text>
                <Text style={[styles.summaryValue, dyn]}>{display}</Text>
              </View>
            );
          })()}
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Quan trọng:</Text><Text style={styles.summaryValue}>{priorityLabel(form.importance)}</Text></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Khẩn cấp:</Text><Text style={styles.summaryValue}>{priorityLabel(form.urgency)}</Text></View>
          {form.tags.length>0 && <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Tags:</Text><Text style={styles.summaryValue}>{form.tags.join(', ')}</Text></View>}
        </View>
        <View style={{ height: 40 }} />
  </KeyboardAwareScrollView>
      <View style={styles.bottomBar}>        
        <Pressable style={[styles.bottomBtn, styles.cancelBtn]} onPress={()=>router.back()}>
          <Text style={styles.cancelText}>Hủy</Text>
        </Pressable>
        <Pressable style={[styles.bottomBtn, !form.title.trim()||saving ? styles.disabledBtn: styles.saveBtn]} disabled={!form.title.trim()||saving} onPress={save}>
            <Text style={styles.saveText}>{saving? (editId? 'Đang lưu...' : 'Đang lưu...') : (editId? 'Lưu thay đổi':'Tạo tác vụ')}</Text>
        </Pressable>
      </View>
      {showPicker.field && Platform.OS==='android' && (
            <DateTimePicker
              value={tempDate || new Date()}
              mode={showPicker.mode}
              is24Hour
              display='default'
              onChange={onNativeChange}
            />
          )}
          {showPicker.field && Platform.OS==='ios' && (
            <Modal transparent animationType='fade'>
              <View style={styles.pickerBackdrop}>
                <View style={styles.pickerModal}>                  
                  <DateTimePicker
                    value={tempDate || new Date()}
                    mode={showPicker.mode}
                    display='spinner'
                    themeVariant='light'
                    onChange={(e, d)=>{ if(d) setTempDate(d); }}
                    {...(showPicker.mode==='time'? { minuteInterval:5 } : {})}
                  />
                  <View style={styles.pickerActions}>
                    <Pressable onPress={cancelIOS} style={[styles.pickerActionBtn, styles.pickerCancel]}><Text style={styles.pickerActionText}>Hủy</Text></Pressable>
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
  aiBtn:{ flexDirection:'row', alignItems:'center', backgroundColor:'rgba(47,102,144,0.1)', paddingHorizontal:12, height:36, borderRadius:18 },
  aiText:{ marginLeft:4, color:'#2f6690', fontWeight:'500', fontSize:13 },
  body:{ padding:16, paddingBottom:24 },
  card:{ backgroundColor:'#fff', borderRadius:20, padding:16, marginBottom:16, shadowColor:'#000', shadowOpacity:0.04, shadowRadius:6, elevation:2 },
  sectionTitle:{ fontSize:16, fontWeight:'600', color:'#16425b', marginBottom:12 },
  field:{ marginBottom:14 },
  label:{ fontSize:13, fontWeight:'500', color:'#2f6690', marginBottom:6 },
  input:{ backgroundColor:'#f8fafc', borderWidth:1, borderColor:'#e2e8f0', borderRadius:14, paddingHorizontal:12, paddingVertical:12, fontSize:14, color:'#16425b' },
  textarea:{ minHeight:90, textAlignVertical:'top' },
  row:{ flexDirection:'row', justifyContent:'space-between', gap:12 },
  half:{ flex:1 },
  priorityRow:{ flexDirection:'row', justifyContent:'space-between', marginBottom:10, marginTop:4 },
  priorityBtn:{ flex:1, marginHorizontal:4, backgroundColor:'rgba(217,220,214,0.6)', paddingVertical:10, borderRadius:14, alignItems:'center' },
  priorityBtnActive:{ backgroundColor:'#3a7ca5' },
  priorityText:{ fontSize:13, color:'#2f6690', fontWeight:'500' },
  priorityTextActive:{ color:'#fff' },
  typeRow:{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingVertical:10 },
  // chips layout (match event screen)
  typeList:{ flexDirection:'row', flexWrap:'wrap' },
  typeChip:{ paddingHorizontal:12, paddingVertical:8, backgroundColor:'rgba(58,124,165,0.08)', borderRadius:20, marginRight:8, marginBottom:8 },
  typeChipActive:{ backgroundColor:'#3a7ca5' },
  typeChipText:{ color:'#2f6690', fontWeight:'600' },
  typeChipTextActive:{ color:'#fff' },
  sub:{ fontSize:11, color:'#607d8b', marginTop:2 },
  tagsWrap:{ flexDirection:'row', flexWrap:'wrap' },
  tag:{ paddingHorizontal:12, paddingVertical:6, backgroundColor:'rgba(58,124,165,0.08)', borderRadius:20, marginRight:8, marginBottom:8 },
  tagActive:{ backgroundColor:'#3a7ca5' },
  tagText:{ fontSize:12, color:'#2f6690', fontWeight:'500' },
  tagTextActive:{ color:'#fff' },
  chosenTags:{ fontSize:12, color:'#2f6690', marginTop:4 },
  newTagRow:{ flexDirection:'row', alignItems:'center', gap:12, marginTop:8 },
  addTagBtn:{ backgroundColor:'#3a7ca5', paddingHorizontal:16, paddingVertical:12, borderRadius:14 },
  addTagText:{ color:'#fff', fontWeight:'600', fontSize:13 },
  aiBox:{ backgroundColor:'rgba(58,124,165,0.08)', borderRadius:18, padding:14, marginBottom:16 },
  aiTitle:{ fontSize:14, fontWeight:'600', color:'#16425b', marginBottom:6 },
  aiLine:{ fontSize:12, color:'#2f6690', marginBottom:2 },
  summaryRow:{ flexDirection:'row', justifyContent:'space-between', marginBottom:6 },
  summaryLabel:{ fontSize:12, color:'#2f6690' },
  summaryValue:{ fontSize:12, color:'#16425b', fontWeight:'500' },
  rangeToday:{ color:'#6d28d9' },
  rangeOverdue:{ color:'#dc2626' },
  bottomBar:{ position:'absolute', left:0, right:0, bottom:0, flexDirection:'row', padding:16, backgroundColor:'#ffffffee', gap:12, borderTopWidth:1, borderColor:'#e2e8f0' },
  bottomBtn:{ flex:1, height:52, borderRadius:16, alignItems:'center', justifyContent:'center' },
  cancelBtn:{ backgroundColor:'rgba(217,220,214,0.55)' },
  cancelText:{ color:'#2f6690', fontWeight:'600', fontSize:14 },
  saveBtn:{ backgroundColor:'#3a7ca5' },
  disabledBtn:{ backgroundColor:'#94a3b8' },
  saveText:{ color:'#fff', fontWeight:'600', fontSize:15 },
  pickerBtn:{ backgroundColor:'#f8fafc', borderWidth:1, borderColor:'#e2e8f0', borderRadius:14, paddingHorizontal:12, height:48, justifyContent:'center' },
  pickerBtnError:{ borderColor:'#dc2626', backgroundColor:'#fef2f2' },
  pickerText:{ fontSize:14, color:'#16425b', fontWeight:'500' },
  pickerTextError:{ color:'#b91c1c' },
  pickerBackdrop:{ flex:1, backgroundColor:'rgba(0,0,0,0.35)', justifyContent:'flex-end' },
  pickerModal:{ backgroundColor:'#fff', borderTopLeftRadius:24, borderTopRightRadius:24, paddingTop:8, paddingBottom:20 },
  pickerActions:{ flexDirection:'row', justifyContent:'space-between', paddingHorizontal:16, marginTop:4 },
  pickerActionBtn:{ flex:1, height:44, borderRadius:14, alignItems:'center', justifyContent:'center', marginHorizontal:6 },
  pickerCancel:{ backgroundColor:'#e2e8f0' },
  pickerOk:{ backgroundColor:'#3a7ca5' },
  pickerActionText:{ fontSize:15, fontWeight:'600', color:'#16425b' },
  errorText:{ fontSize:11, color:'#dc2626', marginTop:2, fontWeight:'500' },
  subTaskRow:{ flexDirection:'row', alignItems:'center', marginBottom:10 },
  subTaskInput:{ flex:1, marginRight:8, paddingVertical:10 },
  removeSubBtn:{ width:40, height:48, borderRadius:14, backgroundColor:'#fee2e2', alignItems:'center', justifyContent:'center' },
  removeSubText:{ color:'#b91c1c', fontWeight:'700' },
  addSubBtn:{ marginTop:4, backgroundColor:'rgba(58,124,165,0.1)', paddingVertical:12, borderRadius:14, alignItems:'center' },
  addSubText:{ color:'#2f6690', fontWeight:'600', fontSize:13 },
  subChkBtn:{ width:40, height:48, justifyContent:'center', alignItems:'center', marginRight:4 },
  subChkCircle:{ width:22, height:22, borderRadius:11, borderWidth:2, borderColor:'#3a7ca5', alignItems:'center', justifyContent:'center', backgroundColor:'#fff' },
  subChkCircleDone:{ backgroundColor:'#3a7ca5', borderColor:'#3a7ca5' },
});
