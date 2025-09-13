import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ActivityIndicator, Alert, Modal, FlatList, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/contexts/AuthContext';
import axios from 'axios';

interface Stats {
  totalCompleted: number;
  onTime: number;
  late: number;
  onTimeRate: number;
  evaluation: string;
}

export default function ProfileScreen(){
  const { user, updateName, refreshProfile, logout, updateAvatar } = useAuth();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.name || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [avatarModal, setAvatarModal] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);

  // Predefined avatar list (DiceBear + other generators). Using static URLs (no external fetch here).
  const avatarSet = React.useMemo(()=> {
    const seeds = ['alpha','bravo','charlie','delta','echo','foxtrot','golf','hotel','india','juliet'];
    return seeds.map(s => `https://api.dicebear.com/7.x/thumbs/png?seed=${s}&backgroundColor=b6e3f4,c0aede,d1d4f9`);
  }, []);

  const API_BASE = process.env.EXPO_PUBLIC_API_BASE;

  useEffect(()=> { setName(user?.name || ''); }, [user?.name]);

  const loadStats = async () => {
    if(!API_BASE) return;
    setLoadingStats(true);
    try {
      const res = await axios.get(`${API_BASE}/api/users/me/stats`);
      setStats(res.data);
    } catch(e:any){ /* silent */ }
    finally { setLoadingStats(false); }
  };

  useEffect(()=> { loadStats(); }, []);

  const handleSave = async () => {
    setSaving(true); setError(null);
    try {
      await updateName(name);
      setEditing(false);
    } catch(e:any){ setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>        
        <Pressable onPress={()=> setAvatarModal(true)} style={styles.avatar}>
          {user?.avatar ? (
            <Image source={{ uri: user.avatar }} style={{ width:'100%', height:'100%', borderRadius:36 }} />
          ) : (
            <Ionicons name='person' size={34} color='#fff' />
          )}
          <View style={styles.avatarEditBadge}><Ionicons name='camera' size={14} color='#fff' /></View>
        </Pressable>
        <View style={{ flex:1 }}>
          {editing ? (
            <View style={{ flexDirection:'row', alignItems:'center' }}>
              <TextInput value={name} onChangeText={setName} style={styles.nameInput} placeholder='Tên của bạn' />
              <Pressable onPress={handleSave} style={[styles.iconBtn,{ backgroundColor:'#3a7ca5' }]} disabled={saving}>
                {saving? <ActivityIndicator size='small' color='#fff' /> : <Ionicons name='checkmark' size={18} color='#fff' />}
              </Pressable>
              <Pressable onPress={()=>{ setEditing(false); setName(user?.name||''); }} style={[styles.iconBtn,{ backgroundColor:'#dc2626' }]}>                
                <Ionicons name='close' size={18} color='#fff' />
              </Pressable>
            </View>
          ) : (
            <View style={{ flexDirection:'row', alignItems:'center' }}>
              <Text style={styles.name}>{user?.name}</Text>
              <Pressable onPress={()=> setEditing(true)} style={styles.editBadge}>
                <Ionicons name='create-outline' size={16} color='#3a7ca5' />
              </Pressable>
            </View>
          )}
          <Text style={styles.email}>{user?.email}</Text>
          <Text style={styles.role}>{user?.role === 'admin' ? 'Quản trị' : 'Sinh viên'}</Text>
        </View>
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
      <Modal visible={avatarModal} transparent animationType='fade' onRequestClose={()=> setAvatarModal(false)}>
        <Pressable style={styles.modalBackdrop} onPress={()=> setAvatarModal(false)}>
          <View style={styles.avatarSheet}>
            <Text style={styles.sheetTitle}>Chọn avatar</Text>
            <FlatList
              data={avatarSet}
              keyExtractor={i=>i}
              numColumns={5}
              contentContainerStyle={{ gap:12 }}
              columnWrapperStyle={{ justifyContent:'space-between', marginBottom:12 }}
              renderItem={({ item }) => {
                const active = item === user?.avatar;
                return (
                  <Pressable disabled={savingAvatar} onPress={async ()=> {
                    try {
                      setSavingAvatar(true);
                      await updateAvatar(item);
                      setAvatarModal(false);
                    } catch(e:any){ Alert.alert('Lỗi', e.message || 'Không cập nhật được'); }
                    finally { setSavingAvatar(false); }
                  }} style={[styles.avatarOption, active && styles.avatarOptionActive]}>
                    <Image source={{ uri: item }} style={{ width:50, height:50, borderRadius:25 }} />
                  </Pressable>
                );
              }}
            />
            <Pressable style={styles.closeSheetBtn} onPress={()=> setAvatarModal(false)}>
              <Text style={styles.closeSheetText}>Đóng</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Hiệu suất</Text>
        {loadingStats && <ActivityIndicator color='#3a7ca5' style={{ marginTop:8 }} />}
        {!loadingStats && stats && (
          <View>
            <View style={styles.statRow}><Text style={styles.statLabel}>Đã hoàn thành</Text><Text style={styles.statValue}>{stats.totalCompleted}</Text></View>
            <View style={styles.statRow}><Text style={styles.statLabel}>Đúng hạn</Text><Text style={styles.statValue}>{stats.onTime}</Text></View>
            <View style={styles.statRow}><Text style={styles.statLabel}>Trễ hạn</Text><Text style={styles.statValue}>{stats.late}</Text></View>
            <View style={styles.statRow}><Text style={styles.statLabel}>Tỷ lệ đúng hạn</Text><Text style={styles.statValue}>{Math.round(stats.onTimeRate*100)}%</Text></View>
            <View style={[styles.evaluationBox, stats.evaluation==='Trì hoãn' && styles.evalLate, stats.evaluation==='Đúng deadline' && styles.evalGood]}>
              <Text style={styles.evalText}>{stats.evaluation}</Text>
            </View>
          </View>
        )}
        <Pressable style={styles.logoutBtn} onPress={()=> {
          Alert.alert('Đăng xuất','Bạn chắc chắn muốn đăng xuất?',[
            { text:'Hủy', style:'cancel' },
            { text:'Đăng xuất', style:'destructive', onPress:()=> { logout(); router.replace('/auth/login'); } }
          ]);
        }}>
          <Ionicons name='log-out-outline' size={18} color='#fff' />
          <Text style={styles.logoutText}>Đăng xuất</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:{ flex:1, backgroundColor:'#f1f5f9', padding:20 },
  header:{ flexDirection:'row', alignItems:'center', marginBottom:28 },
  avatar:{ width:72, height:72, borderRadius:36, backgroundColor:'#3a7ca5', alignItems:'center', justifyContent:'center', marginRight:18 },
  avatarEditBadge:{ position:'absolute', bottom:0, right:0, backgroundColor:'rgba(0,0,0,0.55)', padding:4, borderRadius:10 },
  name:{ fontSize:22, fontWeight:'700', color:'#16425b', marginRight:8 },
  nameInput:{ flex:1, backgroundColor:'#fff', borderRadius:12, paddingHorizontal:14, paddingVertical:10, fontSize:16, borderWidth:1, borderColor:'#d9dcd6', marginRight:10 },
  email:{ fontSize:14, color:'#2f6690', marginTop:4 },
  role:{ fontSize:12, color:'#2f6690', marginTop:2 },
  editBadge:{ marginLeft:4, backgroundColor:'rgba(58,124,165,0.15)', padding:6, borderRadius:12 },
  iconBtn:{ width:40, height:40, borderRadius:12, alignItems:'center', justifyContent:'center', marginLeft:6 },
  section:{ backgroundColor:'#fff', borderRadius:24, padding:20 },
  sectionTitle:{ fontSize:18, fontWeight:'600', color:'#16425b', marginBottom:14 },
  statRow:{ flexDirection:'row', justifyContent:'space-between', paddingVertical:6 },
  statLabel:{ fontSize:14, color:'#2f6690' },
  statValue:{ fontSize:14, fontWeight:'600', color:'#16425b' },
  evaluationBox:{ marginTop:18, paddingVertical:14, borderRadius:18, backgroundColor:'rgba(245,158,11,0.15)', alignItems:'center' },
  evalText:{ fontSize:15, fontWeight:'600', color:'#16425b' },
  evalGood:{ backgroundColor:'rgba(34,197,94,0.18)' },
  evalLate:{ backgroundColor:'rgba(239,68,68,0.18)' },
  error:{ color:'#dc2626', marginBottom:12 },
  logoutBtn:{ flexDirection:'row', alignItems:'center', justifyContent:'center', marginTop:24, backgroundColor:'#dc2626', paddingVertical:14, borderRadius:18, gap:8 },
  logoutText:{ color:'#fff', fontWeight:'600', fontSize:14 },
  modalBackdrop:{ flex:1, backgroundColor:'rgba(0,0,0,0.4)', justifyContent:'flex-end' },
  avatarSheet:{ backgroundColor:'#fff', padding:20, borderTopLeftRadius:28, borderTopRightRadius:28, maxHeight:'70%' },
  sheetTitle:{ fontSize:16, fontWeight:'600', color:'#16425b', marginBottom:14 },
  avatarOption:{ width:50, height:50, borderRadius:25, overflow:'hidden', borderWidth:2, borderColor:'transparent' },
  avatarOptionActive:{ borderColor:'#3a7ca5' },
  closeSheetBtn:{ marginTop:8, backgroundColor:'#16425b', paddingVertical:12, borderRadius:16, alignItems:'center' },
  closeSheetText:{ color:'#fff', fontWeight:'600' },
});
