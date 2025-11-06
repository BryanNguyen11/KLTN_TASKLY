import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import EventForm from '@/components/EventForm';

export default function CreateEventScreen(){
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  return (
    <SafeAreaView style={{ flex:1, backgroundColor:'#f1f5f9' }}>
      <View style={styles.header}>
        <Pressable onPress={()=>router.back()} style={styles.backBtn}><Ionicons name='arrow-back' size={22} color='#16425b' /></Pressable>
        <Text style={styles.headerTitle}>Tạo lịch mới</Text>
        <View style={{ width:40 }} />
      </View>
      <View style={{ padding:16 }}>
        <EventForm mode='full' initialValues={{ title:'', date: new Date().toISOString().slice(0,10), startTime: '09:00' }} projectId={projectId? String(projectId): undefined} onSaved={()=> router.back()} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingTop:4, paddingBottom:8, backgroundColor:'#f1f5f9' },
  backBtn:{ width:40, height:40, borderRadius:20, alignItems:'center', justifyContent:'center' },
  headerTitle:{ fontSize:18, fontWeight:'600', color:'#16425b' },
});
