import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import axios from 'axios';
import { useAuth } from '@/contexts/AuthContext';

interface FieldItem { key: string; label: string; type: 'text'|'url'; required?: boolean; }

export default function CreateEventType(){
  const router = useRouter();
  const { token } = useAuth();
  const API_BASE = process.env.EXPO_PUBLIC_API_BASE;

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [fields, setFields] = useState<FieldItem[]>([{ key: 'diaDiem', label: 'Địa điểm', type: 'text' }]);
  const [saving, setSaving] = useState(false);

  const authHeader = () => ({ headers: { Authorization: token ? `Bearer ${token}` : '' } });

  const addField = () => setFields(prev => ([ ...prev, { key: '', label: '', type: 'text' } ]));
  const updateField = (index:number, patch: Partial<FieldItem>) => setFields(prev => prev.map((f,i)=> i===index? { ...f, ...patch }: f));
  const removeField = (index:number) => setFields(prev => prev.filter((_,i)=> i!==index));

  const save = async () => {
    if(!token){ Alert.alert('Lỗi','Chưa đăng nhập'); return; }
    if(!name.trim() || !slug.trim()) { Alert.alert('Thiếu thông tin','Nhập Tên và Slug'); return; }
    const cleanFields = fields.filter(f => f.key.trim() && f.label.trim());
    if(cleanFields.length === 0){ Alert.alert('Thiếu thông tin','Thêm ít nhất 1 field'); return; }
    setSaving(true);
    try {
      await axios.post(`${API_BASE}/api/event-types`, { name: name.trim(), slug: slug.trim(), fields: cleanFields }, authHeader());
      Alert.alert('Thành công','Đã tạo loại sự kiện');
      router.back();
    } catch(e:any){
      Alert.alert('Lỗi', e?.response?.data?.message || 'Không thể tạo loại sự kiện');
    } finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={{ flex:1, backgroundColor:'#f1f5f9' }} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={()=>router.back()} style={styles.backBtn}><Text style={styles.backText}>{'<'} Quay lại</Text></Pressable>
        <Text style={styles.headerTitle}>Loại sự kiện mới</Text>
        <View style={{ width:40 }} />
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Thông tin</Text>
          <View style={styles.field}><Text style={styles.label}>Tên *</Text><TextInput style={styles.input} value={name} onChangeText={setName} placeholder='VD: Lịch họp nhóm' /></View>
          <View style={styles.field}><Text style={styles.label}>Slug *</Text><TextInput style={styles.input} value={slug} onChangeText={setSlug} autoCapitalize='none' placeholder='vd: lich-hop-nhom' /></View>
        </View>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Các field</Text>
          {fields.map((f, i) => (
            <View key={i} style={styles.fieldGroup}>
              <View style={styles.row}>
                <View style={[styles.field, styles.half]}><Text style={styles.label}>Key *</Text><TextInput style={styles.input} value={f.key} onChangeText={(t)=>updateField(i,{ key:t })} autoCapitalize='none' placeholder='vd: diaDiem' /></View>
                <View style={[styles.field, styles.half]}><Text style={styles.label}>Label *</Text><TextInput style={styles.input} value={f.label} onChangeText={(t)=>updateField(i,{ label:t })} placeholder='vd: Địa điểm' /></View>
              </View>
              <View style={styles.row}>
                <View style={[styles.field, styles.half]}><Text style={styles.label}>Loại</Text><TextInput style={styles.input} value={f.type} onChangeText={(t)=>updateField(i,{ type: (t==='url'?'url':'text') })} placeholder='text hoặc url' /></View>
                <View style={[styles.field, styles.half]}><Text style={styles.label}>Bắt buộc</Text><TextInput style={styles.input} value={f.required? 'true':'false'} onChangeText={(t)=>updateField(i,{ required: t.toLowerCase()==='true' })} placeholder='true/false' /></View>
              </View>
              <Pressable onPress={()=>removeField(i)} style={styles.removeBtn}><Text style={styles.removeText}>Xóa</Text></Pressable>
            </View>
          ))}
          <Pressable onPress={addField} style={styles.addBtn}><Text style={styles.addText}>+ Thêm field</Text></Pressable>
        </View>
        <View style={{ height: 16 }} />
      </ScrollView>
      <View style={styles.bottomBar}>
        <Pressable style={[styles.bottomBtn, styles.cancelBtn]} onPress={()=>router.back()}><Text style={styles.cancelText}>Hủy</Text></Pressable>
        <Pressable style={[styles.bottomBtn, (!name.trim()||!slug.trim()||saving) ? styles.disabledBtn: styles.saveBtn]} disabled={!name.trim()||!slug.trim()||saving} onPress={save}><Text style={styles.saveText}>{saving? 'Đang lưu...':'Tạo loại'}</Text></Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingTop:4, paddingBottom:8, backgroundColor:'#f1f5f9' },
  backBtn:{ paddingVertical:10 },
  backText:{ color:'#16425b', fontWeight:'600' },
  headerTitle:{ fontSize:18, fontWeight:'600', color:'#16425b' },
  body:{ padding:16, paddingBottom:24 },
  card:{ backgroundColor:'#fff', borderRadius:20, padding:16, marginBottom:16, shadowColor:'#000', shadowOpacity:0.04, shadowRadius:6, elevation:2 },
  sectionTitle:{ fontSize:16, fontWeight:'600', color:'#16425b', marginBottom:12 },
  field:{ marginBottom:14 },
  fieldGroup:{ padding:12, borderWidth:1, borderColor:'#e2e8f0', borderRadius:14, marginBottom:12, backgroundColor:'#f8fafc' },
  label:{ fontSize:13, fontWeight:'500', color:'#2f6690', marginBottom:6 },
  input:{ backgroundColor:'#fff', borderWidth:1, borderColor:'#e2e8f0', borderRadius:12, paddingHorizontal:12, paddingVertical:10, fontSize:14, color:'#16425b' },
  row:{ flexDirection:'row', justifyContent:'space-between', gap:12 },
  half:{ flex:1 },
  addBtn:{ backgroundColor:'#3a7ca5', paddingVertical:12, borderRadius:12, alignItems:'center' },
  addText:{ color:'#fff', fontWeight:'600' },
  removeBtn:{ backgroundColor:'#fee2e2', paddingVertical:10, borderRadius:10, alignItems:'center', marginTop:8 },
  removeText:{ color:'#b91c1c', fontWeight:'700' },
  bottomBar:{ position:'absolute', left:0, right:0, bottom:0, flexDirection:'row', padding:16, backgroundColor:'#ffffffee', gap:12, borderTopWidth:1, borderColor:'#e2e8f0' },
  bottomBtn:{ flex:1, height:52, borderRadius:16, alignItems:'center', justifyContent:'center' },
  cancelBtn:{ backgroundColor:'rgba(217,220,214,0.55)' },
  cancelText:{ color:'#2f6690', fontWeight:'600', fontSize:14 },
  saveBtn:{ backgroundColor:'#3a7ca5' },
  disabledBtn:{ backgroundColor:'#94a3b8' },
  saveText:{ color:'#fff', fontWeight:'600', fontSize:15 },
});
