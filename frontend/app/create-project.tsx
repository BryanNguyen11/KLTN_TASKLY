import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet } from 'react-native';
export default function CreateProject(){
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Tạo dự án mới (placeholder)</Text>
      <Text style={styles.subtitle}>Sẽ phát triển sau.</Text>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  container:{ flex:1, padding:24, backgroundColor:'#f1f5f9' },
  title:{ fontSize:20, fontWeight:'700', color:'#16425b', marginBottom:8 },
  subtitle:{ fontSize:14, color:'#2f6690' }
});
