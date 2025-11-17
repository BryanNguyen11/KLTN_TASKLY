import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

export default function ScheduleReviewDeprecated(){
  const router = useRouter();
  return (
    <SafeAreaView style={{ flex:1, backgroundColor:'#f8fafc' }}>
      <View style={styles.header}>
        <Pressable onPress={()=>router.back()} style={styles.iconBtn}><Ionicons name='arrow-back' size={20} color='#16425b' /></Pressable>
        <Text style={styles.title}>Đánh giá thời gian biểu</Text>
        <View style={styles.iconBtn} />
      </View>
      <View style={styles.card}>
        <Ionicons name='information-circle-outline' size={28} color='#2563eb' />
        <Text style={styles.headline}>Tính năng đã được gỡ bỏ</Text>
        <Text style={styles.desc}>
          AI sẽ không đề xuất và áp dụng thay đổi lịch/tác vụ nữa. Bạn vẫn có thể sử dụng AI để trả lời câu hỏi và tạo nội dung khi cần.
        </Text>
        <Pressable onPress={()=> router.back()} style={styles.primaryBtn}>
          <Text style={styles.primaryText}>Quay lại</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:12, paddingVertical:10, backgroundColor:'#f8fafc' },
  iconBtn:{ width:36, height:36, borderRadius:12, alignItems:'center', justifyContent:'center', backgroundColor:'#e2e8f0' },
  title:{ fontSize:16, fontWeight:'700', color:'#16425b' },
  card:{ margin:16, padding:16, borderRadius:16, backgroundColor:'#ffffff', borderWidth:1, borderColor:'#e5e7eb', alignItems:'center', gap:8 },
  headline:{ fontSize:16, fontWeight:'800', color:'#0f172a' },
  desc:{ textAlign:'center', color:'#475569' },
  primaryBtn:{ marginTop:8, paddingHorizontal:14, paddingVertical:10, borderRadius:12, backgroundColor:'#2563eb' },
  primaryText:{ color:'#fff', fontWeight:'800' },
});
