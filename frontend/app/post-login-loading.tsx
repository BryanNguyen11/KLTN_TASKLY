import React, { useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

export default function PostLoginLoading(){
  const router = useRouter();
  useEffect(()=>{
    const t = setTimeout(()=> router.replace('/(tabs)/dashboard'), 900);
    return () => clearTimeout(t);
  },[]);
  return (
    <SafeAreaView style={styles.box}>
      <ActivityIndicator size="large" color="#3a7ca5" />
      <Text style={styles.text}>Đang chuẩn bị dữ liệu...</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  box:{ flex:1, alignItems:'center', justifyContent:'center', backgroundColor:'#f1f5f9' },
  text:{ marginTop:12, color:'#16425b', fontWeight:'700' }
});
