import React, { useState, useMemo } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, TextInput, Pressable, Alert, ScrollView, Platform, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import axios from 'axios';
import { useAuth } from '@/contexts/AuthContext';
import { DeviceEventEmitter } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';

interface InviteRow { id: string; email: string; }

export default function CreateProject(){
  const router = useRouter();
  const { token, user } = useAuth();
  const API_BASE = process.env.EXPO_PUBLIC_API_BASE;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [invites, setInvites] = useState<InviteRow[]>([{ id: Math.random().toString(36).slice(2), email: '' }]);
  const [saving, setSaving] = useState(false);
  // Dates
  const todayISO = useMemo(()=>{
    const d = new Date(); const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0'); const day = String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`;
  },[]);
  const [startDate, setStartDate] = useState<string>(todayISO);
  const [dueDate, setDueDate] = useState<string>('');
  const [showPicker, setShowPicker] = useState<{ mode:'date'; field:'start'|'due'|null }>({ mode:'date', field:null });
  const [tempDate, setTempDate] = useState<Date | null>(null);

  const toDisplay = (iso?:string) => {
    if(!iso) return '';
    if(!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    const [y,m,d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };
  const parseISO = (iso?:string) => {
    if(iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) return new Date(iso+'T00:00:00');
    return new Date();
  };
  const toISO = (d:Date) => {
    const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0'); const day = String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`;
  };
  const openDate = (field:'start'|'due') => { const base = field==='start'? parseISO(startDate): parseISO(dueDate); setTempDate(base); setShowPicker({ mode:'date', field }); };
  const onNativeChange = (e:DateTimePickerEvent, selected?:Date) => {
    if(Platform.OS !== 'android') return;
    if(e.type==='dismissed'){ setShowPicker({ mode:'date', field:null }); return; }
    if(selected && showPicker.field){ const iso = toISO(selected); if(showPicker.field==='start'){ setStartDate(iso);} else { setDueDate(iso);} }
    setShowPicker({ mode:'date', field:null });
  };
  const confirmIOS = () => { if(tempDate && showPicker.field){ const iso = toISO(tempDate); if(showPicker.field==='start'){ setStartDate(iso);} else { setDueDate(iso);} } setShowPicker({ mode:'date', field:null }); setTempDate(null); };
  const cancelIOS = () => { setShowPicker({ mode:'date', field:null }); setTempDate(null); };

  const addInvite = () => setInvites(p=> [...p, { id: Math.random().toString(36).slice(2), email: '' }]);
  const updateInvite = (id:string, email:string) => setInvites(p=> p.map(i=> i.id===id? { ...i, email }: i));
  const removeInvite = (id:string) => setInvites(p=> p.filter(i=> i.id!==id));

  const cleanEmails = () => invites.map(i=> i.email.trim()).filter(e=> e && /^\S+@\S+\.\S+$/.test(e) && e.toLowerCase() !== user?.email?.toLowerCase());

  const save = async () => {
    if(!token){ Alert.alert('Lỗi','Chưa đăng nhập'); return; }
    if(!name.trim()){ Alert.alert('Thiếu thông tin','Tên dự án bắt buộc'); return; }
    // Validate due >= start if due provided
    if(dueDate && startDate && dueDate < startDate){ Alert.alert('Lỗi','Ngày kết thúc dự kiến phải >= ngày bắt đầu'); return; }
    setSaving(true);
    try {
      const res = await axios.post(`${API_BASE}/api/projects`, { name: name.trim(), description: description.trim(), inviteEmails: cleanEmails(), startDate, dueDate: dueDate || undefined }, { headers:{ Authorization: `Bearer ${token}` } });
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
          <View style={{ flexDirection:'row', gap:12, marginTop:12 }}>
            <View style={{ flex:1 }}>
              <Text style={styles.label}>Ngày bắt đầu</Text>
              <Pressable onPress={()=>openDate('start')} style={styles.input}>
                <Text style={{ color:'#16425b', fontWeight:'600' }}>{toDisplay(startDate)}</Text>
              </Pressable>
            </View>
            <View style={{ flex:1 }}>
              <Text style={styles.label}>Kết thúc dự kiến</Text>
              <Pressable onPress={()=>openDate('due')} style={styles.input}>
                <Text style={{ color:'#16425b', fontWeight:'600' }}>{toDisplay(dueDate)}</Text>
              </Pressable>
            </View>
          </View>
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
      {/* Date pickers */}
      {showPicker.field && Platform.OS==='android' && (
        <DateTimePicker value={tempDate || new Date()} mode='date' display='default' onChange={onNativeChange} />
      )}
      {showPicker.field && Platform.OS==='ios' && (
        <Modal transparent animationType='fade'>
          <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.35)', justifyContent:'flex-end' }}>
            <View style={{ backgroundColor:'#fff', borderTopLeftRadius:24, borderTopRightRadius:24, paddingTop:8, paddingBottom:20 }}>
              <DateTimePicker value={tempDate || new Date()} mode='date' display='spinner' themeVariant='light' onChange={(e, d)=>{ if(d) setTempDate(d); }} />
              <View style={{ flexDirection:'row', justifyContent:'space-between', paddingHorizontal:16, marginTop:4 }}>
                <Pressable onPress={cancelIOS} style={{ flex:1, height:44, borderRadius:14, alignItems:'center', justifyContent:'center', marginHorizontal:6, backgroundColor:'#e2e8f0' }}><Text style={{ fontSize:15, fontWeight:'600', color:'#16425b' }}>Hủy</Text></Pressable>
                <Pressable onPress={confirmIOS} style={{ flex:1, height:44, borderRadius:14, alignItems:'center', justifyContent:'center', marginHorizontal:6, backgroundColor:'#3a7ca5' }}><Text style={{ fontSize:15, fontWeight:'600', color:'#fff' }}>Chọn</Text></Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}
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

