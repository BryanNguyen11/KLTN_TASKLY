import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, ScrollView, Platform } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { useAuth } from '@/contexts/AuthContext';

export default function ProjectSettingsScreen(){
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const API_BASE = process.env.EXPO_PUBLIC_API_BASE;
  const [project, setProject] = useState<any|null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchDetail = async () => {
    if(!token || !id) return;
    try{
      setLoading(true);
      const res = await axios.get(`${API_BASE}/api/projects/${id}`, { headers:{ Authorization:`Bearer ${token}` } });
      setProject(res.data);
    }catch{ /* silent */ } finally { setLoading(false); }
  };
  useEffect(()=>{ fetchDetail(); },[id, token]);

  const confirmDelete = () => {
    if(!token || !id) return;
    if(Platform.OS === 'ios' && (Alert as any).prompt){
      (Alert as any).prompt('Xóa dự án','Nhập mật khẩu tài khoản admin để xác nhận', [
        { text:'Hủy', style:'cancel' },
        { text:'Xóa', style:'destructive', onPress: async (pwd?: string) => { if(!pwd) return; await actuallyDelete(pwd); } }
      ], 'secure-text');
    } else {
      Alert.alert('Xóa dự án','Bạn chắc chắn muốn xóa? Hãy xác nhận trên màn hình kế tiếp.', [
        { text:'Hủy', style:'cancel' },
        { text:'Tiếp tục', style:'destructive', onPress: async () => { await actuallyDelete(''); } }
      ]);
    }
  };
  const actuallyDelete = async (password: string) => {
    try{
      setDeleting(true);
      await axios.delete(`${API_BASE}/api/projects/${id}`, { data:{ password }, headers:{ Authorization:`Bearer ${token}` } });
      Alert.alert('Đã xóa','Dự án đã được xóa.');
      router.back();
    }catch(e:any){
      Alert.alert('Lỗi', e?.response?.data?.message || 'Không thể xóa dự án');
    }finally{ setDeleting(false); }
  };

  return (
    <SafeAreaView style={{ flex:1, backgroundColor:'#f1f5f9' }} edges={['top','left','right']}>      
      <View style={[styles.header,{ paddingTop: insets.top+4 }]}>        
        <Pressable onPress={()=> router.back()} style={styles.backBtn} hitSlop={10}>
          <Ionicons name='chevron-back' size={22} color='#16425b' />
        </Pressable>
        <Text style={styles.headerTitle}>Cài đặt dự án</Text>
        <View style={{ width:40 }} />
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Cài đặt chung</Text>
          <View style={styles.rowBetween}>
            <Text style={styles.label}>Tên dự án</Text>
            <Text style={styles.value}>{project?.name || '...'}</Text>
          </View>
          <View style={styles.rowBetween}>
            <Text style={styles.label}>Trạng thái</Text>
            <Text style={styles.value}>{project?.status==='archived'?'Đã lưu trữ':'Hoạt động'}</Text>
          </View>
        </View>
        <View style={styles.card}>
          <Text style={[styles.sectionTitle,{ color:'#b91c1c' }]}>Nguy hiểm</Text>
          <Text style={styles.warning}>Xóa dự án là thao tác vĩnh viễn và không thể hoàn tác.</Text>
          <Pressable style={[styles.deleteBtn, deleting && { opacity:0.5 }]} disabled={deleting} onPress={confirmDelete}>
            <Ionicons name='trash-outline' size={18} color='#fff' />
            <Text style={styles.deleteText}>{deleting? 'Đang xóa...' : 'Xóa dự án'}</Text>
          </Pressable>
        </View>
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingTop:4, paddingBottom:8, backgroundColor:'#f1f5f9' },
  backBtn:{ width:40, height:40, borderRadius:20, alignItems:'center', justifyContent:'center' },
  headerTitle:{ fontSize:18, fontWeight:'600', color:'#16425b' },
  body:{ padding:16 },
  card:{ backgroundColor:'#fff', borderRadius:20, padding:16, marginBottom:16, shadowColor:'#000', shadowOpacity:0.04, shadowRadius:6, elevation:2 },
  sectionTitle:{ fontSize:16, fontWeight:'700', color:'#16425b', marginBottom:10 },
  rowBetween:{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingVertical:8 },
  label:{ fontSize:13, color:'#2f6690' },
  value:{ fontSize:13, color:'#16425b', fontWeight:'600' },
  warning:{ fontSize:12, color:'#7f1d1d', marginBottom:10 },
  deleteBtn:{ marginTop:4, backgroundColor:'#dc2626', flexDirection:'row', alignItems:'center', gap:8, paddingVertical:12, borderRadius:14, justifyContent:'center' },
  deleteText:{ color:'#fff', fontSize:13, fontWeight:'600' },
});
