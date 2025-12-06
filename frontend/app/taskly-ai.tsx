import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Link } from 'expo-router';

export default function TasklyAI(){
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Taskly AI</Text>
      <Text style={styles.desc}>Trò chuyện với AI để đánh giá thời gian biểu. Các chức năng tạo từ ảnh/PDF đã được gỡ bỏ.</Text>
      <Link href="/ai-chat" style={styles.chatBtn}>Mở màn hình Chat AI</Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex:1, padding:16, alignItems:'flex-start', justifyContent:'flex-start' },
  title: { fontSize:20, fontWeight:'700', marginBottom:12 },
  desc: { fontSize:14, color:'#475569', marginBottom:16 },
  chatBtn: { color:'#2563eb', fontWeight:'600' }
});
