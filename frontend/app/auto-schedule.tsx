import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, Alert, Image, Platform, Linking, ScrollView, KeyboardAvoidingView, Animated, Easing } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import * as DocumentPicker from 'expo-document-picker';
import axios from 'axios';
import { useAuth } from '@/contexts/AuthContext';
import { setOcrScanPayload } from '@/contexts/OcrScanStore';
import useSpeechToText, { STTLanguage } from '@/hooks/useSpeechToText';

// Optional ImageManipulator to normalize picked images
let ImageManipulator: any;
try { ImageManipulator = require('expo-image-manipulator'); } catch { ImageManipulator = null; }

type PickedImage = { uri: string; name: string };
type PickedFile = { uri: string; name: string; mimeType: string };
type Msg = { id: string; role: 'user'|'assistant'; text: string; meta?: { evItems?: any[]; evFormItems?: any[]; tkItems?: any[] } };

export default function AutoScheduleScreen(){
  const router = useRouter();
  const { typeId, projectId } = useLocalSearchParams<{ typeId?: string; projectId?: string }>();
  const { token } = useAuth();
  const API_BASE = process.env.EXPO_PUBLIC_API_BASE;
  const [prompt, setPrompt] = useState('');
  const [images, setImages] = useState<PickedImage[]>([]);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'events'|'tasks'|'both'>('both');
  const [devChat, setDevChat] = useState<boolean>(false);
  const [sttLang, setSttLang] = useState<STTLanguage>('vi-VN');
  const [messages, setMessages] = useState<Msg[]>([
    { id:'m_welcome', role:'assistant', text:'Xin chào! Mình là TASKLY AI. Hãy mô tả thời khóa biểu hoặc công việc bạn muốn sắp xếp, mình sẽ gợi ý lịch (events) và tác vụ (tasks). Bạn có thể đính kèm ảnh/PDF nếu cần.' }
  ]);
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const scrollToBottom = (animated = true) => {
    try { requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated })); } catch {}
  };
  const onInputFocus = () => {
    // Scroll a few times to catch keyboard animation
    scrollToBottom(true);
    setTimeout(()=> scrollToBottom(false), 150);
    setTimeout(()=> scrollToBottom(false), 350);
  };
  const { status: sttStatus, isRecording, partial: sttPartial, finalText: sttFinal, start: sttStart, stop: sttStop, abort: sttAbort } = useSpeechToText({ language: sttLang, interim: true, onFinal: (t)=> setPrompt(prev => (prev ? (prev + (prev.endsWith(' ')?'':' ') + t) : t)) });
  const onCheckOllama = async () => {
    try{
      const [h, p] = await Promise.all([
        axios.get(`${API_BASE}/api/ai/health`, authHeader),
        axios.get(`${API_BASE}/api/ai/ollama-ping`, authHeader)
      ]);
      const provider = h?.data?.provider || 'unknown';
      const base = p?.data?.base;
      const model = p?.data?.model;
      const serverOk = p?.data?.serverOk;
      const hasModel = p?.data?.hasModel;
      Alert.alert('Kiểm tra Ollama', `Provider: ${provider}\nBase: ${base}\nModel: ${model}\nServer: ${serverOk ? 'OK' : 'Không kết nối được'}\nModel sẵn sàng: ${hasModel===undefined? 'Không rõ' : (hasModel? 'Có' : 'Không')}`);
    }catch(e:any){
      const msg = e?.response?.data?.message || e?.message || 'Lỗi không xác định';
      Alert.alert('Kiểm tra Ollama', msg);
    }
  };

  const authHeader = useMemo(() => ({ headers: { Authorization: token ? `Bearer ${token}` : '' } }), [token]);

  const askPhotoPermissions = async (): Promise<'ok'|'cancel'> => {
    let perm = await MediaLibrary.getPermissionsAsync();
    if (!perm.granted) perm = await MediaLibrary.requestPermissionsAsync();
    perm = await MediaLibrary.getPermissionsAsync();
    if (Platform.OS === 'ios' && (perm as any).accessPrivileges === 'limited') {
      const choice = await new Promise<'more'|'continue'|'cancel'>(resolve => {
        Alert.alert(
          'Quyền ảnh bị giới hạn',
          'Bạn đang cho phép truy cập ảnh ở chế độ Giới hạn. Hãy chọn “Chọn thêm ảnh” để thêm ảnh bạn muốn dùng.',
          [
            { text: 'Hủy', style: 'cancel', onPress: () => resolve('cancel') },
            { text: 'Tiếp tục', onPress: () => resolve('continue') },
            { text: 'Chọn thêm ảnh', onPress: () => resolve('more') },
          ]
        );
      });
      if (choice === 'more') {
        try { await (MediaLibrary as any).presentLimitedLibraryPickerAsync?.(); } catch {}
        try { perm = await MediaLibrary.getPermissionsAsync(); } catch {}
      } else if (choice === 'cancel') {
        return 'cancel';
      }
    }
    if (!perm.granted && Platform.OS === 'ios' && (perm as any).canAskAgain === false) {
      Alert.alert(
        'Thiếu quyền truy cập',
        'Ứng dụng cần quyền truy cập thư viện ảnh để thêm ảnh. Mở Cài đặt để cấp quyền.',
        [
          { text: 'Đóng', style: 'cancel' },
          { text: 'Mở Cài đặt', onPress: () => { try { Linking.openSettings(); } catch {} } },
        ]
      );
      return 'cancel';
    }
    return perm.granted ? 'ok' : 'cancel';
  };

  const onAddImages = async () => {
    const perm = await askPhotoPermissions();
    if (perm === 'cancel') return;
    // Try multi-select if supported
    let pick: any = await (ImagePicker as any).launchImageLibraryAsync({ quality: 0.9, allowsEditing: false, allowsMultipleSelection: true });
    if ((pick as any).canceled) return;
    const assets = (pick.assets || []).slice(0, 10);
    for (const a of assets) {
      let uri = a.uri as string;
      if (ImageManipulator?.manipulateAsync) {
        try {
          const manip = await ImageManipulator.manipulateAsync(uri, [], { compress: 0.9, format: ImageManipulator.SaveFormat?.JPEG || 'jpeg' });
          if (manip?.uri) uri = manip.uri;
        } catch {}
      }
      setImages(prev => {
        const next = [ ...prev, { uri, name: (a.fileName || 'image.jpg') } ];
        return next;
      });
    }
  };

  const onAddFile = async () => {
    const pick = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*'],
      multiple: false,
      copyToCacheDirectory: true,
    });
    const anyPick: any = pick as any;
    if (anyPick.canceled) return;
    const asset: any = Array.isArray(anyPick.assets) ? anyPick.assets[0] : anyPick;
    if (!asset?.uri) return;
    const name: string = (asset.name as string) || (String(asset.uri).split('/').pop() || 'upload');
    const mime: string = (asset.mimeType as string) || (name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/*');
    setFiles(prev => [ ...prev, { uri: String(asset.uri), name, mimeType: mime } ]);
  };

  const removeImage = (idx: number) => setImages(prev => prev.filter((_, i) => i !== idx));
  const removeFile = (idx: number) => setFiles(prev => prev.filter((_, i) => i !== idx));

  const appendMsg = (m: Msg) => setMessages(prev => [...prev, m]);

  // Tiny Gemini-like star loader (4-point diamonds pulsing)
  const StarLoader = () => {
    const stars = [0,1,2];
    const anims = stars.map(()=> new Animated.Value(0));
    React.useEffect(()=>{
      anims.forEach((v, i) => {
        const loop = () => {
          Animated.sequence([
            Animated.delay(i*150),
            Animated.timing(v, { toValue: 1, duration: 450, easing: Easing.out(Easing.quad), useNativeDriver: true }),
            Animated.timing(v, { toValue: 0, duration: 450, easing: Easing.in(Easing.quad), useNativeDriver: true }),
          ]).start(() => loop());
        };
        loop();
      });
    }, []);
    return (
      <View style={styles.starRow}>
        {anims.map((v, idx) => (
          <Animated.View key={idx} style={[styles.star, { opacity: v.interpolate({ inputRange:[0,1], outputRange:[0.35,1] }), transform:[ { scale: v.interpolate({ inputRange:[0,1], outputRange:[0.8,1.2] }) }, { rotate: '45deg' } ] }]} />
        ))}
      </View>
    );
  };

  // Core send routine that works with an explicit text (used by composer and quick prompts)
  const performSend = async (text: string) => {
    const trimmed = text.trim();
    if(!trimmed && images.length===0 && files.length===0){
      Alert.alert('Thiếu dữ liệu','Nhập yêu cầu hoặc đính kèm ảnh/tệp.');
      return;
    }
    if(!token){ Alert.alert('Lỗi','Chưa đăng nhập'); return; }
    try { inputRef.current?.blur?.(); } catch {}
    const uid = `u_${Date.now()}`;
    if(trimmed){ appendMsg({ id: uid, role:'user', text: trimmed }); }
    setBusy(true);
    try{
      // Collect events from attachments (if any)
      let combinedRaw = '';
      let evItems: any[] = [];
      if(images.length){
        for(const im of images){
          const form = new FormData();
          // @ts-ignore
          form.append('image', { uri: im.uri, name: im.name || 'image.jpg', type: 'image/jpeg' });
          if(text) form.append('prompt', text);
          const res = await axios.post(`${API_BASE}/api/events/scan-image`, form, authHeader);
          const raw = String(res.data?.raw || '');
          if(raw) combinedRaw += (combinedRaw?'\n\n':'')+raw;
          const st = res.data?.structured;
          if(st?.kind==='progress-table' && Array.isArray(st.items)) evItems = evItems.concat(st.items);
        }
      }
      if(files.length){
        for(const f of files){
          const form = new FormData();
          // @ts-ignore
          form.append('file', { uri: f.uri, name: f.name, type: f.mimeType });
          if(text) form.append('prompt', text);
          const res = await axios.post(`${API_BASE}/api/events/scan-file`, form, authHeader);
          const raw = String(res.data?.raw || '');
          if(raw) combinedRaw += (combinedRaw?'\n\n':'')+raw;
          const st = res.data?.structured;
          if(st?.kind==='progress-table' && Array.isArray(st.items)) evItems = evItems.concat(st.items);
        }
      }
      // If Dev Chat mode: bypass creation pipelines and call general chat
      if(trimmed && devChat){
        try{
          const todayISO = (()=>{ const n=new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`; })();
          const res = await axios.post(`${API_BASE}/api/ai/chat`, { prompt: trimmed, now: todayISO }, { ...authHeader, timeout: 45000 });
          const answer = String(res.data?.answer || '').trim();
          appendMsg({ id:`a_${Date.now()}`, role:'assistant', text: answer || 'Mình chưa có câu trả lời cho câu hỏi này.' });
        }catch(e:any){
          appendMsg({ id:`a_${Date.now()}`, role:'assistant', text: e?.response?.data?.message || 'Không thể gọi Dev Chat' });
        }
        setTimeout(()=> scrollRef.current?.scrollToEnd({ animated: true }), 60);
        return;
      }

      // Prompt-only or prompt+attachments: run AI per selected mode
  let aiEvItems: any[] = [];
  let aiEvFormItems: any[] = [];
      let aiTkItems: any[] = [];
      if(trimmed){
        const doEvents = mode==='events' || mode==='both';
        const doTasks = mode==='tasks' || mode==='both';
    const reqs: Promise<any>[] = [];
  if(doEvents){
  const todayISO = (()=>{ const n=new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`; })();
  reqs.push(axios.post(`${API_BASE}/api/events/ai-generate`, { prompt: trimmed, now: todayISO }, authHeader).catch(e=>({ error:e } as any)));
  reqs.push(axios.post(`${API_BASE}/api/events/ai-generate-form`, { prompt: trimmed, now: todayISO }, authHeader).catch(e=>({ error:e } as any)));
  }
  if(doTasks){ reqs.push(axios.post(`${API_BASE}/api/tasks/ai-generate`, { prompt: trimmed }, authHeader).catch(e=>({ error:e } as any))); }
        const results = await Promise.all(reqs);
        // Map results back according to which were requested
    let idx = 0;
    if(doEvents){ const evRes = results[idx++]; aiEvItems = (evRes as any)?.data?.items || []; const evFormRes = results[idx++]; aiEvFormItems = (evFormRes as any)?.data?.items || []; }
    if(doTasks){ const tkRes = results[idx++]; aiTkItems = (tkRes as any)?.data?.tasks || []; }
      }
      // Merge event candidates: attachments first then AI prompt items
      let mergedEvents = [...evItems, ...aiEvItems];
      // Optional transform when both prompt and events present
      if(trimmed && mergedEvents.length){
        try{
          const todayISO = (()=>{ const n=new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`; })();
          const tr = await axios.post(`${API_BASE}/api/events/ai-transform`, { prompt: trimmed, items: mergedEvents, now: todayISO }, authHeader);
          if(Array.isArray(tr.data?.items) && tr.data.items.length) mergedEvents = tr.data.items;
        }catch{ /* fallback to mergedEvents */ }
      }
  // Respect current mode when presenting results
  if(mode==='tasks'){ mergedEvents = []; }
  if(mode==='events'){ aiTkItems = []; }
  const parts: string[] = [];
  if(mergedEvents.length) parts.push(`• Lịch gợi ý: ${mergedEvents.length}`);
  if(aiTkItems.length) parts.push(`• Tác vụ gợi ý: ${aiTkItems.length}`);
      if(!parts.length){
        const errMsg = 'Mình chưa tạo được mục nào từ yêu cầu này. Hãy mô tả rõ hơn hoặc thử đính kèm ảnh/PDF.';
        appendMsg({ id:`a_${Date.now()}`, role:'assistant', text: errMsg });
      } else {
  const evCount = (aiEvFormItems?.length || 0) || mergedEvents.length;
  appendMsg({ id:`a_${Date.now()}`, role:'assistant', text: ['Đây là gợi ý của mình:', parts.join('\n'), '', 'Chọn để xem trước và xác nhận tạo.'].filter(Boolean).join('\n'), meta:{ evItems: mergedEvents, evFormItems: aiEvFormItems, tkItems: aiTkItems } });
      }
      // Auto-scroll to bottom
      setTimeout(()=> scrollRef.current?.scrollToEnd({ animated: true }), 60);
    }catch(e:any){
      const message = e?.response?.data?.message || e?.message || 'Lỗi không xác định';
      appendMsg({ id:`a_${Date.now()}`, role:'assistant', text:`Có lỗi khi xử lý: ${message}` });
    }finally{
      setBusy(false);
    }
  };

  // Original composer send uses performSend with current input and clears it
  const onSend = async () => {
    const text = prompt;
    setPrompt('');
    await performSend(text);
  };

  const onToggleMic = async () => {
    try{
      if(isRecording){ await sttStop(); return; }
      await sttStart();
    }catch{}
  };

  const onSwitchLang = () => {
    setSttLang(prev => prev === 'vi-VN' ? 'en-US' : 'vi-VN');
  };


  const onPreviewEvents = (items: any[]) => {
    setOcrScanPayload({ raw: '', extracted: {}, structured: items?.length ? { kind:'progress-table', items } as any : undefined, defaultTypeId: typeId? String(typeId): undefined, projectId: projectId? String(projectId): undefined } as any);
    router.push('/scan-preview');
  };
  const onPreviewEventsForm = (items: any[]) => {
    setOcrScanPayload({ raw: '', extracted: {}, structured: items?.length ? { kind:'events-form', items } as any : undefined, defaultTypeId: typeId? String(typeId): undefined, projectId: projectId? String(projectId): undefined } as any);
    router.push('/scan-preview');
  };
  const onPreviewTasks = (items: any[]) => {
    setOcrScanPayload({ raw: '', extracted: {}, structured: items?.length ? { kind:'tasks-list', items } as any : undefined, projectId: projectId? String(projectId): undefined } as any);
    router.push('/tasks-preview');
  };

  return (
    <SafeAreaView style={{ flex:1, backgroundColor:'#f1f5f9' }}>
      <View style={styles.header}>
        <Pressable onPress={()=>router.back()} style={styles.backBtn}><Ionicons name='arrow-back' size={22} color='#16425b' /></Pressable>
        <Text style={styles.headerTitle}>TASKLY AI</Text>
        <Pressable onPress={onCheckOllama} style={styles.healthBtn} accessibilityLabel='Kiểm tra Ollama'>
          <Ionicons name='link-outline' size={20} color='#16425b' />
        </Pressable>
      </View>

  <KeyboardAvoidingView behavior={Platform.OS==='ios' ? 'padding' : undefined} keyboardVerticalOffset={12} style={{ flex:1 }}>
        <View style={{ flex:1 }}>
          <ScrollView ref={scrollRef} contentContainerStyle={{ padding:12, paddingBottom:8 }} keyboardShouldPersistTaps='handled'>
            {/* Mode toggles */}
            <View style={[styles.card, { paddingVertical:10, paddingHorizontal:12 }]}> 
              <Text style={styles.subTitle}>Chế độ tạo</Text>
              <View style={{ flexDirection:'row', gap:6, flexWrap:'wrap' }}>
                <Pressable onPress={()=> setMode('events')} style={[styles.toggleBtn, mode==='events' && styles.toggleOn]} accessibilityLabel='Chỉ tạo lịch'>
                  <Ionicons name='calendar-outline' size={14} color={mode==='events'?'#fff':'#16425b'} />
                  <Text style={[styles.toggleText, mode==='events' && styles.toggleTextOn]}>Lịch</Text>
                </Pressable>
                <Pressable onPress={()=> setMode('tasks')} style={[styles.toggleBtn, mode==='tasks' && styles.toggleOn]} accessibilityLabel='Chỉ tạo tác vụ'>
                  <Ionicons name='checkmark-done-outline' size={14} color={mode==='tasks'?'#fff':'#16425b'} />
                  <Text style={[styles.toggleText, mode==='tasks' && styles.toggleTextOn]}>Tác vụ</Text>
                </Pressable>
                <Pressable onPress={()=> setMode('both')} style={[styles.toggleBtn, mode==='both' && styles.toggleOn]} accessibilityLabel='Tạo cả hai'>
                  <Ionicons name='git-merge-outline' size={14} color={mode==='both'?'#fff':'#16425b'} />
                  <Text style={[styles.toggleText, mode==='both' && styles.toggleTextOn]}>Cả hai</Text>
                </Pressable>
                <Pressable onPress={()=> setDevChat(v=>!v)} style={[styles.toggleBtn, devChat && styles.toggleOn]} accessibilityLabel='Hỏi đáp lập trình'>
                  <Ionicons name='code-slash-outline' size={14} color={devChat?'#fff':'#16425b'} />
                  <Text style={[styles.toggleText, devChat && styles.toggleTextOn]}>Dev Chat</Text>
                </Pressable>
              </View>
            </View>
            {/* Attachments (optional) */}
            {(images.length>0) && (
              <View style={[styles.card, { padding:12 }] }>
                <Text style={styles.subTitle}>Ảnh ({images.length})</Text>
                <View style={styles.grid}>
                  {images.map((im, idx) => (
                    <View key={idx} style={styles.thumbWrap}>
                      <Image source={{ uri: im.uri }} style={styles.thumb} />
                      <Pressable onPress={()=>removeImage(idx)} style={styles.removeBtn}><Text style={styles.removeText}>×</Text></Pressable>
                    </View>
                  ))}
                </View>
              </View>
            )}
            {(files.length>0) && (
              <View style={[styles.card, { padding:12 }] }>
                <Text style={styles.subTitle}>Tệp ({files.length})</Text>
                {files.map((f, idx) => (
                  <View key={idx} style={styles.fileRow}>
                    <Text style={styles.fileName} numberOfLines={1}>{f.name}</Text>
                    <Pressable onPress={()=>removeFile(idx)}><Text style={styles.removeText}>Xoá</Text></Pressable>
                  </View>
                ))}
              </View>
            )}
            {/* Chat messages */}
            {messages.map(m => (
              <View key={m.id} style={[styles.bubble, m.role==='user'? styles.userBubble: styles.aiBubble]}>
                {m.role==='assistant' ? (
                  <Markdown style={markdownStyles}>{m.text}</Markdown>
                ) : (
                  <Text style={[styles.bubbleText]}>{m.text}</Text>
                )}
                {m.role==='assistant' && (m.meta?.evItems?.length || m.meta?.evFormItems?.length || m.meta?.tkItems?.length) ? (
                  <View style={{ flexDirection:'row', gap:8, marginTop:8 }}>
                    {!!m.meta?.evFormItems?.length && (
                      <Pressable style={[styles.actionBtn, styles.primary]} onPress={()=> onPreviewEventsForm(m.meta!.evFormItems!)}>
                        <Ionicons name='calendar-outline' size={16} color='#fff' />
                        <Text style={styles.actionText}>Xem trước lịch</Text>
                      </Pressable>
                    )}
                    {!m.meta?.evFormItems?.length && !!m.meta?.evItems?.length && (
                      <Pressable style={[styles.actionBtn, styles.primary]} onPress={()=> onPreviewEvents(m.meta!.evItems!)}>
                        <Ionicons name='calendar-outline' size={16} color='#fff' />
                        <Text style={styles.actionText}>Xem trước lịch</Text>
                      </Pressable>
                    )}
                    {!!m.meta?.tkItems?.length && (
                      <Pressable style={[styles.actionBtn, styles.secondary]} onPress={()=> onPreviewTasks(m.meta!.tkItems!)}>
                        <Ionicons name='checkmark-done-outline' size={16} color='#16425b' />
                        <Text style={styles.actionTextAlt}>Xem trước tác vụ</Text>
                      </Pressable>
                    )}
                  </View>
                ) : null}
              </View>
            ))}
            {busy && (
              <View style={[styles.bubble, styles.aiBubble]}> 
                <StarLoader />
                <Text style={[styles.bubbleText, { marginTop:4, textAlign:'center', color:'#2f6690' }]}>Đang suy nghĩ…</Text>
              </View>
            )}
          </ScrollView>

          {/* Bottom composer */}
          <View style={styles.composer}>
            <Pressable onPress={onAddImages} style={styles.iconBtn}><Ionicons name='image-outline' size={18} color='#16425b' /></Pressable>
            <Pressable onPress={onAddFile} style={styles.iconBtn}><Ionicons name='document-text-outline' size={18} color='#16425b' /></Pressable>
            <Pressable onPress={onToggleMic} style={[styles.iconBtn, isRecording && { backgroundColor:'rgba(220,38,38,0.1)' }]} accessibilityLabel='Ghi âm'>
              <Ionicons name={isRecording? 'mic' : 'mic-outline'} size={18} color={isRecording? '#b91c1c' : '#16425b'} />
            </Pressable>
            <Pressable onPress={onSwitchLang} style={styles.langBtn} accessibilityLabel='Chuyển ngôn ngữ STT'>
              <Text style={styles.langText}>{sttLang === 'vi-VN' ? 'VI' : 'EN'}</Text>
            </Pressable>
            <TextInput
              ref={inputRef}
              style={[styles.composerInput, Platform.OS==='ios' && { paddingBottom:10 }]}
              placeholder='Nhập yêu cầu…'
              multiline
              value={isRecording && sttPartial ? (prompt ? `${prompt} ${sttPartial}` : sttPartial) : prompt}
              onChangeText={setPrompt}
              onFocus={onInputFocus}
            />
            <Pressable onPress={onSend} style={[styles.sendBtn, (!prompt.trim() && images.length===0 && files.length===0) && { opacity:0.5 }]} disabled={!prompt.trim() && images.length===0 && files.length===0}>
              <Ionicons name='sparkles' size={16} color='#fff' />
            </Pressable>
          </View>

          {/* Quick prompts removed per request */}
        </View>
      </KeyboardAvoidingView>

      {/* No blocking overlay; loader is inline in the chat bubble */}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingTop:4, paddingBottom:8, backgroundColor:'#f1f5f9' },
  backBtn:{ width:40, height:40, borderRadius:20, alignItems:'center', justifyContent:'center' },
  headerTitle:{ fontSize:18, fontWeight:'600', color:'#16425b' },
  healthBtn:{ width:40, height:40, borderRadius:20, alignItems:'center', justifyContent:'center' },
  body:{ padding:16 },
  card:{ backgroundColor:'#fff', borderRadius:20, padding:16, marginBottom:16, shadowColor:'#000', shadowOpacity:0.04, shadowRadius:6, elevation:2 },
  sectionTitle:{ fontSize:16, fontWeight:'700', color:'#16425b', marginBottom:8 },
  input:{ backgroundColor:'#f8fafc', borderWidth:1, borderColor:'#e2e8f0', borderRadius:14, paddingHorizontal:12, paddingVertical:12, fontSize:14, color:'#0f172a' },
  textarea:{ minHeight:90, textAlignVertical:'top' },
  hint:{ marginTop:8, color:'#64748b', fontSize:12 },
  btn:{ paddingHorizontal:12, paddingVertical:10, borderRadius:12 },
  primary:{ backgroundColor:'#3a7ca5' },
  secondary:{ backgroundColor:'#e2e8f0' },
  btnText:{ color:'#fff', fontWeight:'700' },
  btnTextAlt:{ color:'#16425b', fontWeight:'700' },
  subTitle:{ color:'#2f6690', fontWeight:'700', marginBottom:6 },
  grid:{ flexDirection:'row', flexWrap:'wrap', gap:8 },
  thumbWrap:{ width:80, height:80, borderRadius:10, overflow:'hidden', marginRight:8, marginBottom:8, position:'relative', backgroundColor:'#f1f5f9', borderWidth:1, borderColor:'#e2e8f0' },
  thumb:{ width:'100%', height:'100%' },
  removeBtn:{ position:'absolute', top:2, right:2, backgroundColor:'rgba(0,0,0,0.5)', paddingHorizontal:6, borderRadius:10 },
  removeText:{ color:'#ef4444', fontWeight:'800' },
  fileRow:{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingVertical:6, borderBottomWidth:1, borderColor:'#e5e7eb' },
  fileName:{ flex:1, color:'#16425b', marginRight:12 },
  action:{ flexDirection:'row', alignItems:'center', justifyContent:'center', paddingHorizontal:16, paddingVertical:12, borderRadius:14, marginHorizontal:16 },
  actionOn:{ backgroundColor:'#4f46e5' },
  disabled:{ backgroundColor:'#94a3b8' },
  actionText:{ color:'#fff', fontWeight:'800' },
  // Chat bubbles + actions
  bubble:{ padding:10, borderRadius:14, marginBottom:8, maxWidth:'92%' },
  userBubble:{ alignSelf:'flex-end', backgroundColor:'#e0f2fe' },
  aiBubble:{ alignSelf:'flex-start', backgroundColor:'#fff', borderWidth:1, borderColor:'#e2e8f0' },
  bubbleText:{ fontSize:14, lineHeight:19, color:'#0f172a' },
  actionBtn:{ flexDirection:'row', alignItems:'center', gap:6, paddingHorizontal:8, paddingVertical:6, borderRadius:10 },
  actionTextAlt:{ color:'#16425b', fontWeight:'700', fontSize:12 },
  composer:{ flexDirection:'row', alignItems:'flex-end', paddingHorizontal:8, paddingVertical:6, backgroundColor:'#ffffffee', borderTopWidth:1, borderColor:'#e2e8f0', gap:6 },
  iconBtn:{ width:34, height:34, borderRadius:10, alignItems:'center', justifyContent:'center', backgroundColor:'#e2e8f0' },
  composerInput:{ flex:1, maxHeight:120, minHeight:38, backgroundColor:'#f8fafc', borderWidth:1, borderColor:'#e2e8f0', borderRadius:12, paddingHorizontal:10, paddingVertical:8, color:'#0f172a' },
  sendBtn:{ width:38, height:38, borderRadius:12, alignItems:'center', justifyContent:'center', backgroundColor:'#4f46e5' },
   overlay:{},
   overlayCard:{},
   starRow:{ flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8 },
   star:{ width:10, height:10, backgroundColor:'#3a7ca5', borderRadius:2, marginHorizontal:4 },
  // quick prompts removed
  langBtn:{ paddingHorizontal:10, paddingVertical:6, borderRadius:10, backgroundColor:'#e2e8f0', alignItems:'center', justifyContent:'center' },
  langText:{ color:'#16425b', fontWeight:'700', fontSize:11 },
  toggleBtn:{ flexDirection:'row', alignItems:'center', gap:6, paddingHorizontal:12, paddingVertical:8, borderRadius:12, backgroundColor:'#e2e8f0', borderWidth:1, borderColor:'#e5e7eb' },
  toggleOn:{ backgroundColor:'#3a7ca5', borderColor:'#3a7ca5' },
  toggleText:{ color:'#16425b', fontWeight:'700', fontSize:12 },
  toggleTextOn:{ color:'#fff', fontWeight:'700', fontSize:12 },
});

const markdownStyles = {
  body: { color:'#0f172a', fontSize:14, lineHeight:20 },
  paragraph: { marginTop: 0, marginBottom: 6 },
  strong: { fontWeight: '700' },
  bullet_list: { marginBottom: 6 },
  ordered_list: { marginBottom: 6 },
  list_item: { marginBottom: 2 },
  code_inline: { backgroundColor:'#f1f5f9', borderRadius:6, paddingHorizontal:4, paddingVertical:2, color:'#0f172a' },
  code_block: { backgroundColor:'#0b1220', borderRadius:10, padding:10 },
  fence: { backgroundColor:'#0b1220', borderRadius:10, padding:10, color:'#e6edf3' },
  link: { color:'#2563eb' },
} as const;
