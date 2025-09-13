import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView, Pressable, Alert, Switch, ActivityIndicator, Modal } from 'react-native';
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
  priority: TaskPriority;
  importance: TaskPriority;
  type: TaskType;
  estimatedHours: string;
  tags: string[];
  subTasks: { id: string; title: string; completed: boolean }[]; // local id
}

type Tag = { _id: string; name: string; slug: string };

export default function CreateTaskScreen() {
  const router = useRouter();
  const { editId } = useLocalSearchParams<{ editId?: string }>();
  const { user, token } = useAuth();
  const isLeader = user?.role === 'leader' || user?.role === 'admin';
  const [saving, setSaving] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [showPicker, setShowPicker] = useState<{mode:'date'|'time'; field:'date'|'endDate'|'startTime'|'endTime'|null}>({mode:'date', field:null});
  const [tempDate, setTempDate] = useState<Date | null>(null);
  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState<FormState>({
    title: '',
    description: '',
    date: today,
    endDate: today,
    startTime: '09:00',
    endTime: '10:00',
    priority: 'medium',
    importance: 'medium',
    type: 'personal',
    estimatedHours: '1',
    tags: [],
    subTasks: []
  });
  const [tags, setTags] = useState<Tag[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);
  const [creatingTag, setCreatingTag] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [errors, setErrors] = useState<{start?:string; end?:string; sub?:string}>({});

  const API_BASE = (process.env.EXPO_PUBLIC_API_BASE || 'http://192.168.1.26:5000');

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
    if(!/^\d{4}-\d{2}-\d{2}$/.test(form.endDate)) { Alert.alert('Lỗi','Ngày kết thúc không hợp lệ'); return; }
    if(form.endDate < form.date) { Alert.alert('Lỗi','Ngày kết thúc phải >= ngày bắt đầu'); return; }
    if(form.date === form.endDate && form.startTime && form.endTime && form.endTime <= form.startTime){ Alert.alert('Lỗi','Giờ kết thúc phải sau giờ bắt đầu'); return; }
    if(form.subTasks.some(st=>!st.title.trim())) { Alert.alert('Lỗi','Vui lòng nhập tên cho tất cả tác vụ con'); return; }
    setSaving(true);
    const payload = {
      title: form.title.trim(),
      description: form.description,
      date: form.date,
      endDate: form.endDate,
      startTime: form.startTime,
      endTime: form.endTime,
      priority: form.priority,
      importance: form.importance,
      type: form.type,
      estimatedHours: parseFloat(form.estimatedHours)||1,
      tags: form.tags,
      subTasks: form.subTasks.filter(st=>st.title.trim()).map(st=> ({ title: st.title.trim(), completed: st.completed }))
    };
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
          endDate: t.endDate || t.date?.split('T')[0] || prev.endDate,
          startTime: t.startTime || prev.startTime,
          endTime: t.endTime || prev.endTime,
          priority: t.priority || 'medium',
          importance: t.importance || 'medium',
          type: t.type || 'personal',
          estimatedHours: String(t.estimatedHours||1),
          tags: (t.tags||[]).map((x:any)=> typeof x === 'string'? x : x._id),
          subTasks: (t.subTasks||[]).map((st:any)=> ({ id: st._id || Math.random().toString(36).slice(2), title: st.title, completed: !!st.completed }))
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
        update(showPicker.field as any, selected.toISOString().split('T')[0]);
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
      if(showPicker.mode==='date') update(showPicker.field as any, selected.toISOString().split('T')[0]);
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
      if(showPicker.mode==='date') update(showPicker.field as any, tempDate.toISOString().split('T')[0]);
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
    if(form.endDate < form.date) newErr.end = 'Kết thúc phải sau hoặc bằng ngày bắt đầu';
    if(form.date === form.endDate && form.endTime <= form.startTime) newErr.end = 'Giờ kết thúc phải sau giờ bắt đầu';
    if(!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) newErr.start = 'Ngày bắt đầu sai định dạng';
    if(!/^\d{4}-\d{2}-\d{2}$/.test(form.endDate)) newErr.end = 'Ngày kết thúc sai định dạng';
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
        <Pressable onPress={generateAI} style={styles.aiBtn}>
          <Ionicons name='sparkles' size={18} color='#2f6690' />
          <Text style={styles.aiText}>AI</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Thông tin cơ bản</Text>
          <View style={styles.field}>            
            <Text style={styles.label}>Tên tác vụ *</Text>
            <TextInput
              style={styles.input}
              placeholder='VD: Hoàn thành bài tập Toán'
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
                <Text style={[styles.pickerText, errors.start && styles.pickerTextError]}>{form.date}</Text>
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
                  <Text style={[styles.pickerText, errors.end && styles.pickerTextError]}>{form.endDate}</Text>
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
          <Text style={styles.sectionTitle}>Ưu tiên & Loại</Text>
          <Text style={styles.sub}>Chọn mức ưu tiên cho tác vụ</Text>
          <View style={styles.priorityRow}>
            {(['low','medium','high'] as TaskPriority[]).map(p => {
              const active = form.priority === p;
              return (
                <Pressable key={p} onPress={()=>update('priority', p)} style={[styles.priorityBtn, active && styles.priorityBtnActive]}>                  
                  <Text style={[styles.priorityText, active && styles.priorityTextActive]}>{priorityLabel(p)}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[styles.sub,{ marginTop:4 }]}>Mức độ quan trọng</Text>
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
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Ưu tiên:</Text><Text style={styles.summaryValue}>{priorityLabel(form.priority)}</Text></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Loại:</Text><Text style={styles.summaryValue}>{form.type==='group'?'Nhóm':'Cá nhân'}</Text></View>
          {(() => {
            const startDate = form.date; const endDate = form.endDate; const sameDay = startDate === endDate;
            const fmt = (d:string) => { if(!/^\d{4}-\d{2}-\d{2}$/.test(d)) return d; const [y,m,dd]=d.split('-'); return `${dd}/${m}`; };
            let display = '';
            if(sameDay) display = `${fmt(startDate)} ${form.startTime || ''}${form.startTime && form.endTime ? '–' : ''}${form.endTime || ''}`;
            else display = `${fmt(startDate)} ${form.startTime || ''} → ${fmt(endDate)} ${form.endTime || ''}`;
            const todayISO = new Date().toISOString().split('T')[0];
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
          {form.tags.length>0 && <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Tags:</Text><Text style={styles.summaryValue}>{form.tags.join(', ')}</Text></View>}
        </View>
        <View style={{ height: 40 }} />
      </ScrollView>
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
  priorityRow:{ flexDirection:'row', justifyContent:'space-between', marginBottom:14 },
  priorityBtn:{ flex:1, marginHorizontal:4, backgroundColor:'rgba(217,220,214,0.6)', paddingVertical:10, borderRadius:14, alignItems:'center' },
  priorityBtnActive:{ backgroundColor:'#3a7ca5' },
  priorityText:{ fontSize:13, color:'#2f6690', fontWeight:'500' },
  priorityTextActive:{ color:'#fff' },
  typeRow:{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingVertical:10 },
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
