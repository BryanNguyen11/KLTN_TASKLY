import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import axios from 'axios';
import { useAuth } from '@/contexts/AuthContext';
// bỏ tạo từ ảnh/PDF: không cần payload preview

type Msg = { id: string; role: 'user' | 'assistant' | 'system'; text: string; meta?: any };

export default function AiChat() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useAuth();
  const API_BASE = process.env.EXPO_PUBLIC_API_BASE;
  const [msgs, setMsgs] = useState<Msg[]>([
    { id: 'sys', role: 'assistant', text: 'Xin chào! Bạn có thể hỏi/nhờ AI đánh giá thời gian biểu, gợi ý sắp xếp thời gian, hoặc tóm tắt lịch/tác vụ theo khoảng thời gian.' }
  ]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const canSend = useMemo(()=> draft.trim().length>0 && !busy, [draft, busy]);

  const send = async () => {
    if (!canSend) return;
    if (!token) { Alert.alert('Lỗi','Bạn cần đăng nhập'); return; }
    const prompt = draft.trim();
    setDraft('');
    const mid = Date.now().toString();
    setMsgs(prev => [...prev, { id: 'u'+mid, role: 'user', text: prompt }]);
    setBusy(true);
    try {
      const res = await axios.post(`${API_BASE}/api/ai/chat`, { prompt }, { headers:{ Authorization: `Bearer ${token}` } });
      const answer: string = res.data?.answer || '';
      const provider: string = res.data?.provider || '';
      const model: string = res.data?.model || '';
      const text = answer ? answer : 'Xin lỗi, mình chưa có câu trả lời phù hợp. Hãy thử diễn đạt lại câu hỏi.';
      setMsgs(prev => [...prev, { id: 'a'+mid, role: 'assistant', text, meta: { provider, model } }]);
    } catch(e:any) {
      const msg = e?.response?.data?.message || 'Lỗi AI. Vui lòng thử lại.';
      setMsgs(prev => [...prev, { id: 'a'+mid, role: 'assistant', text: msg }]);
    } finally {
      setBusy(false);
    }
  };

  // Không còn preview tạo lịch/tác vụ

  return (
    <SafeAreaView style={{ flex:1, backgroundColor:'#f1f5f9' }} edges={['top']}>      
      <KeyboardAvoidingView style={{ flex:1 }} behavior={Platform.OS==='ios'? 'padding' : undefined} keyboardVerticalOffset={insets.top+8}>
        <View style={styles.header}>
          <Pressable onPress={()=> router.back()} style={styles.headerBtn}><Text style={styles.headerBtnText}>{'‹'}</Text></Pressable>
          <Text style={styles.headerTitle}>Chat AI</Text>
          <View style={{ width:88 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding:16, paddingBottom:20 }}>
          {msgs.map(m => (
            <View key={m.id} style={[styles.msg, m.role==='user'? styles.me : styles.ai]}>
              <Text style={styles.msgText}>{m.text}</Text>
              {m.meta?.provider && (
                <Text style={styles.msgMeta}>Nguồn: {m.meta.provider}{m.meta?.model? ` • ${m.meta.model}`:''}</Text>
              )}
            </View>
          ))}
          {busy && (
            <View style={{ paddingVertical:8, alignItems:'center' }}>
              <ActivityIndicator color={'#3a7ca5'} />
            </View>
          )}
        </ScrollView>
        <View style={styles.composer}>
          <TextInput
            ref={inputRef}
            value={draft}
            onChangeText={setDraft}
            placeholder="Nhập yêu cầu..."
            placeholderTextColor="#607d8b"
            style={styles.input}
            multiline
          />
          <Pressable onPress={send} disabled={!canSend} style={[styles.sendBtn, !canSend && { opacity:0.5 }]}>
            <Text style={styles.sendText}>{busy? '...' : 'Gửi'}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', padding:12 },
  headerBtn:{ paddingHorizontal:12, paddingVertical:8, borderRadius:12, backgroundColor:'#e2e8f0' },
  previewBtn:{ backgroundColor:'#3a7ca5' },
  headerBtnText:{ color:'#16425b', fontSize:16, fontWeight:'700' },
  headerTitle:{ fontSize:18, fontWeight:'700', color:'#16425b' },
  msg:{ padding:12, borderRadius:14, marginBottom:10, maxWidth:'92%' },
  me:{ alignSelf:'flex-end', backgroundColor:'#dbeafe' },
  ai:{ alignSelf:'flex-start', backgroundColor:'#fff', borderWidth:1, borderColor:'rgba(0,0,0,0.06)' },
  msgText:{ color:'#0f172a' },
  msgMeta:{ color:'#2f6690', fontSize:12, marginTop:6, fontWeight:'700' },
  composer:{ flexDirection:'row', alignItems:'flex-end', gap:8, padding:12, borderTopWidth:1, borderColor:'rgba(0,0,0,0.06)', backgroundColor:'#fff' },
  input:{ flex:1, minHeight:44, maxHeight:120, borderWidth:1, borderColor:'#e2e8f0', borderRadius:12, paddingHorizontal:12, paddingVertical:10, color:'#0f172a' },
  sendBtn:{ backgroundColor:'#3a7ca5', paddingHorizontal:16, paddingVertical:10, borderRadius:12 },
  sendText:{ color:'#fff', fontWeight:'700' }
});
