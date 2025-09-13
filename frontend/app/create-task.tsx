import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView, Pressable, Alert, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { DeviceEventEmitter } from 'react-native';
import { useAuth } from '@/contexts/AuthContext';
import { TaskPriority, TaskType } from '@/utils/dashboard';
import { Ionicons } from '@expo/vector-icons';

interface FormState {
  title: string;
  description: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  priority: TaskPriority;
  type: TaskType;
  estimatedHours: string;
  tags: string[];
}

const suggestedTags = ['Học tập','Nghiên cứu','Thuyết trình','Báo cáo','Đọc sách','Làm bài','Ôn thi'];

export default function CreateTaskScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const isLeader = user?.role === 'leader' || user?.role === 'admin';
  const [saving, setSaving] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [form, setForm] = useState<FormState>({
    title: '',
    description: '',
    date: new Date().toISOString().split('T')[0],
    time: '09:00',
    priority: 'medium',
    type: 'personal',
    estimatedHours: '1',
    tags: []
  });

  const update = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  }, []);

  const toggleTag = (tag: string) => {
    setForm(prev => ({
      ...prev,
      tags: prev.tags.includes(tag) ? prev.tags.filter(t=>t!==tag) : [...prev.tags, tag]
    }));
  };

  const save = async () => {
    if (!form.title.trim()) {
      Alert.alert('Thiếu thông tin','Vui lòng nhập tên tác vụ');
      return;
    }
    setSaving(true);
    try {
      // Simulate latency
      await new Promise(r=>setTimeout(r,500));
      const newTask = {
        id: Date.now().toString(),
        title: form.title.trim(),
        time: form.time,
        date: form.date,
        priority: form.priority,
        completed: false,
        type: form.type,
        status: 'todo' as const,
      };
      DeviceEventEmitter.emit('taskCreated', newTask);
      router.back();
    } catch (e:any) {
      Alert.alert('Lỗi','Không thể tạo tác vụ');
    } finally {
      setSaving(false);
    }
  };

  const generateAI = () => {
    setShowAI(true);
    Alert.alert('AI','Đang phân tích và gợi ý...');
    setTimeout(()=>{
      Alert.alert('Gợi ý','Chia nhỏ tác vụ thành các bước, đặt deadline sớm hơn 1 ngày.');
    },1500);
  };

  const priorityLabel = (p: TaskPriority) => p==='high'?'Cao':p==='medium'?'Trung bình':'Thấp';

  return (
    <SafeAreaView style={{ flex:1, backgroundColor:'#f1f5f9' }} edges={['top']}>      
      <View style={styles.header}>        
        <Pressable onPress={()=>router.back()} style={styles.backBtn}>
          <Ionicons name='arrow-back' size={22} color='#16425b' />
        </Pressable>
        <Text style={styles.headerTitle}>Tạo tác vụ mới</Text>
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
              <Text style={styles.label}>Ngày</Text>
              <TextInput
                style={styles.input}
                value={form.date}
                onChangeText={t=>update('date', t)}
                placeholder='YYYY-MM-DD'
              />
            </View>
            <View style={[styles.field, styles.half]}>
              <Text style={styles.label}>Giờ</Text>
              <TextInput
                style={styles.input}
                value={form.time}
                onChangeText={t=>update('time', t)}
                placeholder='HH:mm'
              />
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
          <View style={styles.tagsWrap}>
            {suggestedTags.map(tag => {
              const active = form.tags.includes(tag);
              return (
                <Pressable key={tag} onPress={()=>toggleTag(tag)} style={[styles.tag, active && styles.tagActive]}>
                  <Text style={[styles.tagText, active && styles.tagTextActive]}>{tag}</Text>
                </Pressable>
              );
            })}
          </View>
          {form.tags.length>0 && (
            <Text style={styles.chosenTags}>Đã chọn: {form.tags.join(', ')}</Text>
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
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Ưu tiên:</Text><Text style={styles.summaryValue}>{priorityLabel(form.priority)}</Text></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Loại:</Text><Text style={styles.summaryValue}>{form.type==='group'?'Nhóm':'Cá nhân'}</Text></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Thời gian:</Text><Text style={styles.summaryValue}>{form.date} {form.time}</Text></View>
          {form.tags.length>0 && <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Tags:</Text><Text style={styles.summaryValue}>{form.tags.join(', ')}</Text></View>}
        </View>
        <View style={{ height: 40 }} />
      </ScrollView>
      <View style={styles.bottomBar}>        
        <Pressable style={[styles.bottomBtn, styles.cancelBtn]} onPress={()=>router.back()}>
          <Text style={styles.cancelText}>Hủy</Text>
        </Pressable>
        <Pressable style={[styles.bottomBtn, !form.title.trim()||saving ? styles.disabledBtn: styles.saveBtn]} disabled={!form.title.trim()||saving} onPress={save}>
            <Text style={styles.saveText}>{saving? 'Đang lưu...':'Tạo tác vụ'}</Text>
        </Pressable>
      </View>
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
  aiBox:{ backgroundColor:'rgba(58,124,165,0.08)', borderRadius:18, padding:14, marginBottom:16 },
  aiTitle:{ fontSize:14, fontWeight:'600', color:'#16425b', marginBottom:6 },
  aiLine:{ fontSize:12, color:'#2f6690', marginBottom:2 },
  summaryRow:{ flexDirection:'row', justifyContent:'space-between', marginBottom:6 },
  summaryLabel:{ fontSize:12, color:'#2f6690' },
  summaryValue:{ fontSize:12, color:'#16425b', fontWeight:'500' },
  bottomBar:{ position:'absolute', left:0, right:0, bottom:0, flexDirection:'row', padding:16, backgroundColor:'#ffffffee', gap:12, borderTopWidth:1, borderColor:'#e2e8f0' },
  bottomBtn:{ flex:1, height:52, borderRadius:16, alignItems:'center', justifyContent:'center' },
  cancelBtn:{ backgroundColor:'rgba(217,220,214,0.55)' },
  cancelText:{ color:'#2f6690', fontWeight:'600', fontSize:14 },
  saveBtn:{ backgroundColor:'#3a7ca5' },
  disabledBtn:{ backgroundColor:'#94a3b8' },
  saveText:{ color:'#fff', fontWeight:'600', fontSize:15 }
});
