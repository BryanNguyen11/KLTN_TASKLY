import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, Alert, ScrollView, DeviceEventEmitter, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import axios from 'axios';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/contexts/AuthContext';
import io from 'socket.io-client';

export default function ProjectMembersScreen(){
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { token, user } = useAuth();
  const API_BASE = process.env.EXPO_PUBLIC_API_BASE;
  const [project, setProject] = useState<any|null>(null);
  const [emails, setEmails] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const auth = () => ({ headers:{ Authorization: token? `Bearer ${token}`:'' } });

  const fetchProject = async () => {
    if(!token || !id) return;
    try{
      const res = await axios.get(`${API_BASE}/api/projects/${id}`, auth());
      setProject(res.data);
    }catch(e:any){ Alert.alert('Lỗi', e?.response?.data?.message || 'Không tải được dự án'); }
  };
  useEffect(()=>{ fetchProject(); },[id, token]);

  // Live updates via socket for invite state changes
  useEffect(() => {
    if(!token || !id) return;
    const API_BASE = process.env.EXPO_PUBLIC_API_BASE || '';
    const endpoint = API_BASE.replace(/\/api$/,'');
    const s = io(endpoint, { auth:{ token }, transports:['websocket'] });
    s.on('connect', () => { s.emit('joinProject', id); });
    s.on('project:updated', (payload:any) => {
      if(String(payload.projectId) === String(id)){
        if(payload.project){ setProject(payload.project); }
        else if(payload.invites){ setProject((p:any)=> p? { ...p, invites: payload.invites }: p); }
      }
    });
    s.on('project:memberJoined', (payload:any) => {
      if(String(payload.projectId) === String(id)) setProject(payload.project);
    });
    s.on('project:inviteDeclined', (payload:any) => {
      if(String(payload.projectId) === String(id)) fetchProject();
    });
    s.on('project:inviteRevoked', (payload:any) => {
      if(String(payload.projectId) === String(id)) fetchProject();
    });
    return () => { s.disconnect(); };
  }, [id, token]);

  const invite = async () => {
    const list = emails.split(/[,;\n]/).map(e=> e.trim()).filter(Boolean);
    if(!list.length) return;
    try{
      const res = await axios.post(`${API_BASE}/api/projects/${id}/invite`, { emails: list }, auth());
      setProject((p:any)=> p? { ...p, invites: res.data.invites } : p);
      setEmails('');
      DeviceEventEmitter.emit('projectsUpdated');
    }catch(e:any){ Alert.alert('Lỗi', e?.response?.data?.message || 'Không thể mời'); }
  };

  const changeRole = async (userId:string, role:'admin'|'member') => {
    try{
      const res = await axios.put(`${API_BASE}/api/projects/${id}/members/${userId}/role`, { role }, auth());
      setProject(res.data.project);
      DeviceEventEmitter.emit('projectsUpdated');
    }catch(e:any){ Alert.alert('Lỗi', e?.response?.data?.message || 'Không thể cập nhật quyền'); }
  };
  const removeMember = async (userId:string) => {
    Alert.alert('Xóa thành viên','Bạn chắc chắn?',[
      { text:'Hủy', style:'cancel' },
      { text:'Xóa', style:'destructive', onPress: async ()=>{
        try{
          const res = await axios.delete(`${API_BASE}/api/projects/${id}/members/${userId}`, auth());
          setProject(res.data.project);
          DeviceEventEmitter.emit('projectsUpdated');
        }catch(e:any){ Alert.alert('Lỗi', e?.response?.data?.message || 'Không thể xóa'); }
      } }
    ]);
  };
  const revokeInvite = async (inviteId:string) => {
    Alert.alert('Hủy lời mời','Bạn chắc chắn?',[
      { text:'Hủy', style:'cancel' },
      { text:'Hủy lời mời', style:'destructive', onPress: async ()=>{
        try{
          const res = await axios.delete(`${API_BASE}/api/projects/${id}/invites/${inviteId}`, auth());
          setProject(res.data.project);
          DeviceEventEmitter.emit('projectsUpdated');
        }catch(e:any){ Alert.alert('Lỗi', e?.response?.data?.message || 'Không thể hủy'); }
      } }
    ]);
  };

  // nút Rời dự án đã được chuyển sang trang chi tiết dự án (dashboard modal)

  return (
    <SafeAreaView style={{ flex:1, backgroundColor:'#f1f5f9' }} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={()=> { DeviceEventEmitter.emit('openProjectDetail', { id }); router.back(); }} style={styles.backBtn}><Ionicons name='chevron-back' size={22} color='#16425b' /></Pressable>
        <Text style={styles.headerTitle}>Thành viên & Lời mời</Text>
        <View style={{ width:40 }} />
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex:1 }}>
      <ScrollView ref={scrollRef} keyboardShouldPersistTaps='handled' contentContainerStyle={styles.body}>
        {project && (
          <>
            <Text style={styles.sectionTitle}>Thành viên ({project.members?.length||0})</Text>
            {(project.members||[]).map((m:any, idx:number)=>{
              const isOwner = String(project.owner) === String(m.user?._id || m.user);
              const name = m.user?.name || m.user?.email || (typeof m.user === 'string'? m.user.slice(0,6): 'Người dùng');
              return (
                <View key={idx} style={styles.memberRow}>
                  <View style={{ flex:1 }}>
                    <Text style={styles.memberName}>{name}</Text>
                    <Text style={styles.memberMeta}>{isOwner? 'owner' : m.role}</Text>
                  </View>
                  {!isOwner && (
                    <View style={{ flexDirection:'row', gap:8 }}>
                      <Pressable onPress={()=> changeRole(m.user?._id || m.user, m.role==='admin'? 'member':'admin')} style={styles.smallBtn}>
                        <Text style={styles.smallBtnText}>{m.role==='admin'? 'Chuyển member':'Chuyển admin'}</Text>
                      </Pressable>
                      <Pressable onPress={()=> removeMember(m.user?._id || m.user)} style={[styles.smallBtn,{ backgroundColor:'#dc2626' }]}>
                        <Text style={[styles.smallBtnText,{ color:'#fff' }]}>Xóa</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })}

            <Text style={[styles.sectionTitle,{ marginTop:16 }]}>Lời mời đang chờ</Text>
            {(() => {
              const myId = (user as any)?._id || (user as any)?.id;
              const isAdmin = String(project.owner) === String(myId) || (project.members||[]).some((mm:any)=> String(mm.user?._id || mm.user)===String(myId) && mm.role==='admin');
              // Only show pending invites; ensure one row per email (pick the most recent pending)
              const pendings = (project.invites||[]).filter((i:any)=> i.status==='pending');
              // Pick the most recent pending per email
              const sorted = [...pendings].sort((a:any,b:any)=> new Date(b.invitedAt||0).getTime() - new Date(a.invitedAt||0).getTime());
              const seen = new Set<string>();
              const list: any[] = [];
              for(const inv of sorted){ if(!seen.has(inv.email)){ seen.add(inv.email); list.push(inv); } }
              if(list.length===0){ return <Text style={styles.empty}>Không có lời mời đang chờ.</Text>; }
              return list.map((inv:any)=> (
                <View key={inv._id} style={styles.inviteRow}>
                  <Text style={styles.inviteEmail}>{inv.email}</Text>
                  <Text style={styles.inviteStatus}>Đang chờ</Text>
                  {isAdmin && (
                    <Pressable accessibilityLabel={`Hủy lời mời ${inv.email}`} onPress={()=> revokeInvite(inv._id)} style={styles.iconBtn}>
                      <Ionicons name='close-outline' size={18} color='#e11d48' />
                    </Pressable>
                  )}
                </View>
              ));
            })()}

            <Text style={[styles.sectionTitle,{ marginTop:16 }]}>Mời thêm</Text>
            <Text style={styles.hint}>Nhập nhiều email, phân tách bằng dấu phẩy.</Text>
            <TextInput
              value={emails}
              onChangeText={(t)=>{ setEmails(t); if(inputFocused){ setTimeout(()=> scrollRef.current?.scrollToEnd({ animated:true }), 0); } }}
              onFocus={()=>{ setInputFocused(true); setTimeout(()=> scrollRef.current?.scrollToEnd({ animated:true }), 0); }}
              onBlur={()=> setInputFocused(false)}
              placeholder='vd: a@gmail.com, b@domain.com'
              style={styles.input}
              autoCapitalize='none'
              multiline
              textAlignVertical='top'
            />
            <Pressable onPress={invite} disabled={!emails.trim()} style={[styles.addBtn, !emails.trim() && { opacity:0.5 }]}> 
              <Ionicons name='send-outline' size={16} color='#fff' />
              <Text style={styles.addBtnText}>Gửi lời mời</Text>
            </Pressable>

            {/* Nút "Rời dự án" được hiển thị trong modal chi tiết dự án (dashboard), không còn ở đây */}
          </>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingTop:4, paddingBottom:8, backgroundColor:'#f1f5f9' },
  backBtn:{ padding:8, borderRadius:12, backgroundColor:'rgba(58,124,165,0.1)' },
  headerTitle:{ fontSize:18, fontWeight:'700', color:'#16425b' },
  body:{ padding:16, paddingBottom:32 },
  sectionTitle:{ fontSize:15, fontWeight:'700', color:'#16425b', marginBottom:8 },
  memberRow:{ flexDirection:'row', alignItems:'center', gap:10, backgroundColor:'#eef2f7', padding:12, borderRadius:12, marginBottom:8 },
  memberName:{ color:'#16425b', fontWeight:'600' },
  memberMeta:{ color:'#2f6690', fontSize:12 },
  smallBtn:{ paddingHorizontal:10, paddingVertical:8, backgroundColor:'#3a7ca5', borderRadius:10 },
  smallBtnText:{ color:'#fff', fontSize:12, fontWeight:'700' },
  inviteRow:{ flexDirection:'row', alignItems:'center', gap:8, backgroundColor:'#f8fafc', padding:10, borderRadius:10, marginBottom:8 },
  inviteEmail:{ flex:1, color:'#16425b' },
  inviteStatus:{ color:'#2f6690', fontSize:12, fontWeight:'700' },
  iconBtn:{ padding:6, borderRadius:8, backgroundColor:'rgba(225,29,72,0.08)' },
  hint:{ fontSize:11, color:'#607d8b', marginBottom:6 },
  input:{ backgroundColor:'#fff', borderWidth:1, borderColor:'#e2e8f0', borderRadius:12, paddingHorizontal:12, paddingVertical:10, fontSize:13, color:'#16425b', minHeight:80 },
  addBtn:{ marginTop:10, backgroundColor:'#3a7ca5', flexDirection:'row', alignItems:'center', gap:8, paddingVertical:12, borderRadius:14, justifyContent:'center' },
  addBtnText:{ color:'#fff', fontSize:13, fontWeight:'700' },
  empty:{ color:'#607d8b', fontStyle:'italic' }
});
