import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import axios from 'axios';
import { useAuth } from '@/contexts/AuthContext';
import { TaskPriority } from '@/utils/dashboard';
import { Ionicons } from '@expo/vector-icons';

export default function EditTaskScreen(){
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { token } = useAuth();
  const [loading,setLoading] = useState(true);
  const [saving,setSaving] = useState(false);
  const [data,setData] = useState<any>(null);
  const [title,setTitle] = useState('');
  const [description,setDescription] = useState('');
  const [date,setDate] = useState('');
  const [startTime,setStartTime] = useState('');
  const [endTime,setEndTime] = useState('');
  const [priority,setPriority] = useState<TaskPriority>('medium');
  const [importance,setImportance] = useState<TaskPriority>('medium');

  const API_BASE = (process.env.EXPO_PUBLIC_API_BASE || 'http://192.168.1.26:5000');

  const load = useCallback(async ()=>{
    if(!token||!id) return;
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/api/tasks/${id}`);
      const t = res.data;
      setData(t);
      setTitle(t.title);
      setDescription(t.description||'');
      setDate(t.date?.split('T')[0]||'');
      setStartTime(t.startTime||'');
      setEndTime(t.endTime||'');
      setPriority(t.priority||'medium');
      setImportance(t.importance||'medium');
    } catch(e:any){
      Alert.alert('Lỗi', e?.response?.data?.message || 'Không tải được task');
      router.back();
    } finally { setLoading(false); }
  },[token,id]);

  useEffect(()=>{ load(); },[load]);

  const save = async () => {
    if(!id) return; if(!title.trim()) { Alert.alert('Thiếu tên'); return; }
    setSaving(true);
    try {
      await axios.put(`${API_BASE}/api/tasks/${id}`, { title, description, date, startTime, endTime, priority, importance });
      router.back();
    } catch(e:any){
      Alert.alert('Lỗi', e?.response?.data?.message || 'Không cập nhật được');
    } finally { setSaving(false); }
  };

  if(loading) return (
    <View style={styles.center}><ActivityIndicator color="#3a7ca5" /><Text style={styles.loading}>Đang tải...</Text></View>
  );

  return (
    <View style={{ flex:1, backgroundColor:'#f1f5f9' }}>
      <View style={styles.header}>
        <Pressable onPress={()=>router.back()} style={styles.backBtn}><Ionicons name='arrow-back' size={22} color='#16425b' /></Pressable>
        <Text style={styles.headerTitle}>Chỉnh sửa</Text>
        <Pressable disabled={saving} onPress={save} style={[styles.saveBtn, saving && { opacity:0.6 }]}>
          <Text style={styles.saveText}>{saving? 'Đang lưu...' : 'Lưu'}</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding:16, paddingBottom:40 }}>
        <Text style={styles.label}>Tên *</Text>
        <TextInput style={styles.input} value={title} onChangeText={setTitle} />
        <Text style={styles.label}>Mô tả</Text>
        <TextInput style={[styles.input, styles.textarea]} multiline value={description} onChangeText={setDescription} />
        <View style={styles.row}>
          <View style={styles.col}>            
            <Text style={styles.label}>Ngày</Text>
            <TextInput style={styles.input} value={date} onChangeText={setDate} placeholder='YYYY-MM-DD' />
          </View>
          <View style={styles.col}>            
            <Text style={styles.label}>Bắt đầu</Text>
            <TextInput style={styles.input} value={startTime} onChangeText={setStartTime} placeholder='HH:mm' />
          </View>
          <View style={styles.col}>            
            <Text style={styles.label}>Kết thúc</Text>
            <TextInput style={styles.input} value={endTime} onChangeText={setEndTime} placeholder='HH:mm' />
          </View>
        </View>
        <Text style={[styles.label,{ marginTop:10 }]}>Ưu tiên</Text>
        <View style={styles.row}>
          {(['low','medium','high'] as TaskPriority[]).map(p => {
            const active = priority === p;
            return (
              <Pressable key={p} onPress={()=>setPriority(p)} style={[styles.pill, active && styles.pillActive]}><Text style={[styles.pillText, active && styles.pillTextActive]}>{p==='high'?'Cao':p==='medium'?'Trung bình':'Thấp'}</Text></Pressable>
            );
          })}
        </View>
        <Text style={[styles.label,{ marginTop:10 }]}>Quan trọng</Text>
        <View style={styles.row}>
          {(['low','medium','high'] as TaskPriority[]).map(p => {
            const active = importance === p;
            return (
              <Pressable key={p} onPress={()=>setImportance(p)} style={[styles.pill, active && styles.pillActive]}><Text style={[styles.pillText, active && styles.pillTextActive]}>{p==='high'?'Cao':p==='medium'?'Trung bình':'Thấp'}</Text></Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center:{ flex:1, justifyContent:'center', alignItems:'center', backgroundColor:'#f1f5f9' },
  loading:{ marginTop:8, color:'#2f6690' },
  header:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingTop:50, paddingBottom:12, backgroundColor:'#f1f5f9' },
  backBtn:{ width:44, height:44, borderRadius:22, alignItems:'center', justifyContent:'center' },
  headerTitle:{ fontSize:18, fontWeight:'600', color:'#16425b' },
  saveBtn:{ backgroundColor:'#3a7ca5', paddingHorizontal:18, height:40, borderRadius:14, alignItems:'center', justifyContent:'center' },
  saveText:{ color:'#fff', fontWeight:'600' },
  label:{ fontSize:13, fontWeight:'500', color:'#2f6690', marginTop:12, marginBottom:6 },
  input:{ backgroundColor:'#fff', borderWidth:1, borderColor:'#e2e8f0', borderRadius:14, paddingHorizontal:12, paddingVertical:12, fontSize:14, color:'#16425b' },
  textarea:{ minHeight:90, textAlignVertical:'top' },
  row:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', gap:8 },
  col:{ flex:1 },
  pill:{ flex:1, backgroundColor:'rgba(217,220,214,0.55)', paddingVertical:10, borderRadius:14, alignItems:'center', marginHorizontal:4 },
  pillActive:{ backgroundColor:'#3a7ca5' },
  pillText:{ fontSize:13, color:'#2f6690', fontWeight:'500' },
  pillTextActive:{ color:'#fff' },
});
