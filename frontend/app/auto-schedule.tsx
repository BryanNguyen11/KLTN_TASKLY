import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, Alert, Image, Modal, ActivityIndicator, Platform, Linking, ScrollView, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import * as DocumentPicker from 'expo-document-picker';
import axios from 'axios';
import { useAuth } from '@/contexts/AuthContext';
import { setOcrScanPayload } from '@/contexts/OcrScanStore';

// Optional ImageManipulator to normalize picked images
let ImageManipulator: any;
try { ImageManipulator = require('expo-image-manipulator'); } catch { ImageManipulator = null; }

type PickedImage = { uri: string; name: string };
type PickedFile = { uri: string; name: string; mimeType: string };

export default function AutoScheduleScreen(){
  const router = useRouter();
  const { typeId, projectId } = useLocalSearchParams<{ typeId?: string; projectId?: string }>();
  const { token } = useAuth();
  const API_BASE = process.env.EXPO_PUBLIC_API_BASE;
  const [prompt, setPrompt] = useState('');
  const [images, setImages] = useState<PickedImage[]>([]);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'prompt'|'files'|'mixed'>('prompt');
  const inputRef = useRef<TextInput>(null);

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
        setMode(prompt.trim()? 'mixed' : 'files');
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
    setFiles(prev => {
      const next = [ ...prev, { uri: String(asset.uri), name, mimeType: mime } ];
      setMode(prompt.trim()? 'mixed' : 'files');
      return next;
    });
  };

  const removeImage = (idx: number) => setImages(prev => prev.filter((_, i) => i !== idx));
  const removeFile = (idx: number) => setFiles(prev => prev.filter((_, i) => i !== idx));

  const analyze = async () => {
    if (!token) { Alert.alert('Lỗi','Chưa đăng nhập'); return; }
    if (!prompt.trim() && images.length === 0 && files.length === 0) {
      Alert.alert('Thiếu dữ liệu', 'Nhập yêu cầu hoặc đính kèm ảnh/tệp.');
      return;
    }
    // Blur input to avoid web aria-hidden focus conflicts when showing overlay
    try { inputRef.current?.blur?.(); } catch {}
    setBusy(true);
    try {
      let combinedRaw = '';
      let items: any[] = [];
      // If user wants prompt-only generation
      if (prompt.trim() && images.length === 0 && files.length === 0) {
        try {
          // Quick echo to ensure backend receives prompt
          try {
            const echo = await axios.post(`${API_BASE}/api/events/ai-echo`, { prompt: prompt.trim() }, authHeader);
            if (echo?.data && typeof echo.data.promptLen === 'number' && echo.data.promptLen === 0) {
              Alert.alert('Lỗi', 'Máy chủ nhận prompt rỗng. Vui lòng thử lại hoặc kiểm tra kết nối/backend.');
            }
          } catch {}
          const gen = await axios.post(`${API_BASE}/api/events/ai-generate`, { prompt: prompt.trim() }, authHeader);
          if (Array.isArray(gen.data?.items)) {
            items = gen.data.items;
          }
        } catch (e:any) {
          // Surface backend debug snippet in dev console if available
          try { if (e?.response?.data?.debug) console.warn('[ai-generate debug]', e.response.data.debug); } catch {}
          throw e;
        }
      }
      // Images first
      for (const im of images) {
        const formData = new FormData();
        // @ts-ignore
        formData.append('image', { uri: im.uri, name: im.name || 'image.jpg', type: 'image/jpeg' });
        if (prompt.trim()) formData.append('prompt', prompt.trim());
        const res = await axios.post(`${API_BASE}/api/events/scan-image`, formData, authHeader);
        const raw = String(res.data?.raw || '');
        const structured = res.data?.structured;
        if (raw) combinedRaw += (combinedRaw ? '\n\n' : '') + raw;
        if (structured?.kind === 'progress-table' && Array.isArray(structured.items)) {
          items = items.concat(structured.items);
        }
      }
      // Files next
      for (const f of files) {
        const formData = new FormData();
        // @ts-ignore
        formData.append('file', { uri: f.uri, name: f.name, type: f.mimeType });
        if (prompt.trim()) formData.append('prompt', prompt.trim());
        const res = await axios.post(`${API_BASE}/api/events/scan-file`, formData, authHeader);
        const raw = String(res.data?.raw || '');
        const structured = res.data?.structured;
        if (raw) combinedRaw += (combinedRaw ? '\n\n' : '') + raw;
        if (structured?.kind === 'progress-table' && Array.isArray(structured.items)) {
          items = items.concat(structured.items);
        }
      }
      let finalItems = items;
      if (prompt.trim() && items.length) {
        try {
          const tr = await axios.post(`${API_BASE}/api/events/ai-transform`, { prompt: prompt.trim(), items }, authHeader);
          if (Array.isArray(tr.data?.items) && tr.data.items.length) {
            finalItems = tr.data.items;
          }
        } catch (e) { /* If transform fails, fall back to original items */ }
      }
      const structured = finalItems.length ? { kind: 'progress-table', items: finalItems } : undefined;
      setOcrScanPayload({ raw: combinedRaw, extracted: {}, structured, defaultTypeId: typeId? String(typeId): undefined, projectId: projectId? String(projectId): undefined } as any);
      router.push('/scan-preview');
    } catch (e: any) {
      const reason = e?.response?.data?.reason;
      const message = e?.response?.data?.message || 'Không xử lý được dữ liệu';
      Alert.alert('Lỗi', reason ? `${message}\nLý do: ${reason}` : message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex:1, backgroundColor:'#f1f5f9' }}>
      <View style={styles.header}>
        <Pressable onPress={()=>router.back()} style={styles.backBtn}><Ionicons name='arrow-back' size={22} color='#16425b' /></Pressable>
        <Text style={styles.headerTitle}>Tạo lịch tự động (AI)</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS==='ios' ? 'padding' : undefined} keyboardVerticalOffset={56} style={{ flex:1 }}>
        <View style={{ flex:1 }}>
          <ScrollView contentContainerStyle={{ padding:16, paddingBottom:16 }} keyboardShouldPersistTaps='handled'>
          <View style={{ marginBottom:12 }}>
            <Text style={styles.hint}>Nhập yêu cầu như bạn làm với Gemini. Bạn cũng có thể đính kèm ảnh/PDF, nhưng không bắt buộc.</Text>
          </View>
          {(images.length>0) && (
            <View style={styles.card}>
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
            <View style={styles.card}>
              <Text style={styles.subTitle}>Tệp ({files.length})</Text>
              {files.map((f, idx) => (
                <View key={idx} style={styles.fileRow}>
                  <Text style={styles.fileName} numberOfLines={1}>{f.name}</Text>
                  <Pressable onPress={()=>removeFile(idx)}><Text style={styles.removeText}>Xoá</Text></Pressable>
                </View>
              ))}
            </View>
          )}

          {/* Suggestion chips */}
          <View style={{ flexDirection:'row', flexWrap:'wrap', gap:8, paddingHorizontal:4 }}>
            {[
              'Chỉ giữ buổi sáng',
              'Bỏ lớp trực tuyến',
              'Tiêu đề = tên môn',
              'Thêm phòng vào ghi chú',
            ].map(sug => (
              <Pressable key={sug} onPress={()=> setPrompt(p => (p? p+ (p.endsWith(' ')? '' : ' ') : '') + sug)} style={[styles.typeChip, { backgroundColor:'rgba(58,124,165,0.08)' }]}>
                <Text style={styles.typeChipText}>{sug}</Text>
              </Pressable>
            ))}
          </View>
          </ScrollView>

          {/* Bottom composer */}
          <View style={styles.composer}>
          <Pressable onPress={onAddImages} style={styles.iconBtn}><Ionicons name='image-outline' size={20} color='#16425b' /></Pressable>
          <Pressable onPress={onAddFile} style={styles.iconBtn}><Ionicons name='document-text-outline' size={20} color='#16425b' /></Pressable>
          <TextInput
            style={styles.composerInput}
            placeholder='Nhập yêu cầu…'
            multiline
            value={prompt}
            onChangeText={(t)=> { setPrompt(t); setMode((t.trim()? (images.length||files.length? 'mixed':'prompt'):'files') as any); }}
          />
          <Pressable onPress={analyze} style={[styles.sendBtn, (!prompt.trim() && images.length===0 && files.length===0) && { opacity:0.5 }]} disabled={!prompt.trim() && images.length===0 && files.length===0}>
            <Ionicons name='sparkles' size={18} color='#fff' />
          </Pressable>
          </View>
        </View>
  </KeyboardAvoidingView>

      {busy && (
        Platform.OS === 'web' ? (
          <View style={styles.overlay} pointerEvents='auto' aria-modal={true} accessibilityViewIsModal>
            <View style={styles.overlayCard}>
              <ActivityIndicator size='large' color='#3a7ca5' />
              <Text style={{ marginTop:10, color:'#16425b', fontWeight:'600' }}>Đang xử lý…</Text>
            </View>
          </View>
        ) : (
          <Modal transparent animationType='fade'>
            <View style={styles.overlay}>
              <View style={styles.overlayCard}>
                <ActivityIndicator size='large' color='#3a7ca5' />
                <Text style={{ marginTop:10, color:'#16425b', fontWeight:'600' }}>Đang xử lý…</Text>
              </View>
            </View>
          </Modal>
        )
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingTop:4, paddingBottom:8, backgroundColor:'#f1f5f9' },
  backBtn:{ width:40, height:40, borderRadius:20, alignItems:'center', justifyContent:'center' },
  headerTitle:{ fontSize:18, fontWeight:'600', color:'#16425b' },
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
  // New styles for Gemini-like composer & chips
  typeChip:{ paddingHorizontal:12, paddingVertical:8, borderRadius:20 },
  typeChipText:{ color:'#2f6690', fontWeight:'700', fontSize:12 },
  composer:{ flexDirection:'row', alignItems:'flex-end', padding:10, backgroundColor:'#ffffffee', borderTopWidth:1, borderColor:'#e2e8f0', gap:8 },
  iconBtn:{ width:38, height:38, borderRadius:12, alignItems:'center', justifyContent:'center', backgroundColor:'#e2e8f0' },
  composerInput:{ flex:1, maxHeight:120, minHeight:40, backgroundColor:'#f8fafc', borderWidth:1, borderColor:'#e2e8f0', borderRadius:14, paddingHorizontal:12, paddingVertical:10, color:'#0f172a' },
  sendBtn:{ width:42, height:42, borderRadius:14, alignItems:'center', justifyContent:'center', backgroundColor:'#4f46e5' },
  overlay:{ position:'absolute', top:0, left:0, right:0, bottom:0, backgroundColor:'rgba(0,0,0,0.35)', alignItems:'center', justifyContent:'center' },
  overlayCard:{ backgroundColor:'#fff', borderRadius:16, padding:20, alignItems:'center' },
});
