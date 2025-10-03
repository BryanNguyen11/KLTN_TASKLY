import React, { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, TextInput, Pressable, Alert, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import axios from 'axios';
import { useAuth } from '@/contexts/AuthContext';
import { DeviceEventEmitter } from 'react-native';

interface InviteRow { id: string; email: string; }

export default function CreateProject(){
  const router = useRouter();
  const { token, user } = useAuth();
  const API_BASE = process.env.EXPO_PUBLIC_API_BASE;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [invites, setInvites] = useState<InviteRow[]>([{ id: Math.random().toString(36).slice(2), email: '' }]);
  const [saving, setSaving] = useState(false);

  const addInvite = () => setInvites(p=> [...p, { id: Math.random().toString(36).slice(2), email: '' }]);
  const updateInvite = (id:string, email:string) => setInvites(p=> p.map(i=> i.id===id? { ...i, email }: i));
  const removeInvite = (id:string) => setInvites(p=> p.filter(i=> i.id!==id));

  const cleanEmails = () => invites.map(i=> i.email.trim()).filter(e=> e && /^\S+@\S+\.\S+$/.test(e) && e.toLowerCase() !== user?.email?.toLowerCase());

  const save = async () => {
    if(!token){ Alert.alert('Lỗi','Chưa đăng nhập'); return; }
    if(!name.trim()){ Alert.alert('Thiếu thông tin','Tên dự án bắt buộc'); return; }
    setSaving(true);
    try {
      const res = await axios.post(`${API_BASE}/api/projects`, { name: name.trim(), description: description.trim(), inviteEmails: cleanEmails() }, { headers:{ Authorization: `Bearer ${token}` } });
      DeviceEventEmitter.emit('projectCreated', res.data);
      Alert.alert('Thành công','Đã tạo dự án');
      router.back();
    } catch(e:any){
      Alert.alert('Lỗi', e?.response?.data?.message || 'Không thể tạo dự án');
    } finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={{ flex:1, backgroundColor:'#f1f5f9' }} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={()=>router.back()} style={styles.backBtn}><Ionicons name='arrow-back' size={22} color='#16425b' /></Pressable>
        <Text style={styles.headerTitle}>Dự án mới</Text>
        <Pressable onPress={save} disabled={saving || !name.trim()} style={[styles.saveBtnTop, (!name.trim()||saving) && { opacity:0.5 }]}>
          <Ionicons name='save-outline' size={20} color='#fff' />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps='handled' showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Thông tin</Text>
          <Text style={styles.label}>Tên dự án *</Text>
          <TextInput style={styles.input} placeholder='VD: Nền tảng học nhóm' value={name} onChangeText={setName} />
          <Text style={[styles.label,{ marginTop:12 }]}>Mô tả</Text>
            <TextInput style={[styles.input, styles.textarea]} multiline placeholder='Mục tiêu, phạm vi...' value={description} onChangeText={setDescription} />
        </View>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Mời thành viên</Text>
          <Text style={styles.sub}>Nhập email để gửi lời mời (tối đa 10 lúc tạo)</Text>
          {invites.map((row, idx)=> (
            <View key={row.id} style={styles.inviteRow}>
              <TextInput
                style={[styles.input, styles.inviteInput]}
                placeholder={`Email #${idx+1}`}
                autoCapitalize='none'
                keyboardType='email-address'
                value={row.email}
                onChangeText={t=> updateInvite(row.id, t)}
              />
              {invites.length>1 && (
                <Pressable onPress={()=> removeInvite(row.id)} style={styles.removeInvite}><Text style={styles.removeInviteText}>✕</Text></Pressable>
              )}
            </View>
          ))}
          {invites.length < 10 && (
            <Pressable onPress={addInvite} style={styles.addInviteBtn}>
              <Text style={styles.addInviteText}>+ Thêm email</Text>
            </Pressable>
          )}
          {!!cleanEmails().length && (
            <Text style={styles.validCount}>{cleanEmails().length} email hợp lệ sẽ được mời</Text>
          )}
        </View>
        <View style={{ height:60 }} />
      </ScrollView>
      <View style={styles.bottomBar}>
        <Pressable onPress={()=>router.back()} style={[styles.bottomBtn, styles.cancelBtn]}><Text style={styles.cancelText}>Hủy</Text></Pressable>
        <Pressable onPress={save} disabled={!name.trim()||saving} style={[styles.bottomBtn, styles.saveBtn, (!name.trim()||saving) && { opacity:0.5 }]}>
          <Text style={styles.saveText}>{saving? 'Đang lưu...' : 'Tạo dự án'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingTop:4, paddingBottom:8 },
  backBtn:{ width:40, height:40, borderRadius:20, alignItems:'center', justifyContent:'center' },
  headerTitle:{ fontSize:18, fontWeight:'600', color:'#16425b' },
  saveBtnTop:{ width:40, height:40, borderRadius:20, backgroundColor:'#3a7ca5', alignItems:'center', justifyContent:'center' },
  body:{ padding:16, paddingBottom:100 },
  card:{ backgroundColor:'#fff', borderRadius:20, padding:16, marginBottom:16, shadowColor:'#000', shadowOpacity:0.05, shadowRadius:6, elevation:2 },
  sectionTitle:{ fontSize:16, fontWeight:'600', color:'#16425b', marginBottom:12 },
  label:{ fontSize:13, fontWeight:'500', color:'#2f6690', marginBottom:6 },
  input:{ backgroundColor:'#f8fafc', borderWidth:1, borderColor:'#e2e8f0', borderRadius:14, paddingHorizontal:12, paddingVertical:12, fontSize:14, color:'#16425b' },
  textarea:{ minHeight:90, textAlignVertical:'top' },
  sub:{ fontSize:11, color:'#607d8b', marginBottom:8 },
  inviteRow:{ flexDirection:'row', alignItems:'center', marginBottom:10 },
  inviteInput:{ flex:1 },
  removeInvite:{ width:40, height:48, backgroundColor:'#fee2e2', borderRadius:14, alignItems:'center', justifyContent:'center', marginLeft:8 },
  removeInviteText:{ color:'#b91c1c', fontWeight:'700' },
  addInviteBtn:{ backgroundColor:'rgba(58,124,165,0.1)', paddingVertical:12, borderRadius:14, alignItems:'center' },
  addInviteText:{ color:'#2f6690', fontWeight:'600', fontSize:13 },
  validCount:{ fontSize:12, color:'#2f6690', marginTop:6 },
  bottomBar:{ position:'absolute', left:0, right:0, bottom:0, flexDirection:'row', padding:16, gap:12, backgroundColor:'#ffffffee', borderTopWidth:1, borderColor:'#e2e8f0' },
  bottomBtn:{ flex:1, height:52, borderRadius:16, alignItems:'center', justifyContent:'center' },
  cancelBtn:{ backgroundColor:'rgba(217,220,214,0.55)' },
  cancelText:{ color:'#2f6690', fontWeight:'600', fontSize:14 },
  saveBtn:{ backgroundColor:'#3a7ca5' },
  saveText:{ color:'#fff', fontWeight:'600', fontSize:15 },
});
