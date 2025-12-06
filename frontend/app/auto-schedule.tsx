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
import { mockTasks, todayISO } from '@/utils/dashboard';
import { DeviceEventEmitter } from 'react-native';

// Optional ImageManipulator to normalize picked images
let ImageManipulator: any;
try { ImageManipulator = require('expo-image-manipulator'); } catch { ImageManipulator = null; }

type PickedImage = { uri: string; name: string };
type PickedFile = { uri: string; name: string; mimeType: string };
type AiEditItem = { id: string; date: string; title: string; time?: string };
type Msg = { id: string; role: 'user'|'assistant'; text: string; meta?: { evItems?: any[]; evFormItems?: any[]; tkItems?: any[]; eventsEdit?: AiEditItem[]; tasksEdit?: AiEditItem[]; createdEventId?: string; createdEventDate?: string } };

export default function AutoScheduleScreen(){
  const router = useRouter();
  const { typeId, projectId } = useLocalSearchParams<{ typeId?: string; projectId?: string }>();
  const { token } = useAuth();
  const API_BASE = process.env.EXPO_PUBLIC_API_BASE;
  const [prompt, setPrompt] = useState('');
  const [images, setImages] = useState<PickedImage[]>([]);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [sttLang, setSttLang] = useState<STTLanguage>('vi-VN');
  const [messages, setMessages] = useState<Msg[]>([
    { id:'m_welcome', role:'assistant', text:'Xin chào! Mình là TASKLY AI. Hiện chỉ hỗ trợ trò chuyện và phân tích thời gian biểu. Các chức năng tạo lịch/tác vụ và tạo lịch từ PDF đã được gỡ bỏ.' }
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

  // Helpers: diacritics-insensitive normalization
  const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}+/gu,'').toLowerCase();

  // Detect intent: create a calendar event from prompt (VN + EN variants)
  const isCreateEventIntent = (text: string) => {
    const n = norm(text);
    // Common Vietnamese phrasings and English fallbacks
    const vn = /(tao|them|lap)\s*(lich|su kien)|\btao lich\b|\bthem lich\b|\btao su kien\b|\bthem su kien\b/;
    const en = /(create|add)\s+(an?\s+)?(event|calendar)/;
    return vn.test(n) || en.test(n);
  };

  // Create event from natural language using backend AI form generator
  const createEventFromPrompt = async (text: string) => {
    // 1) Ask AI to convert prompt to a Form-like item (date, startTime, endTime, etc.)
    const todayISO = (()=>{ const n=new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`; })();
    const gen = await axios.post(`${API_BASE}/api/events/ai-generate-form`, { prompt: text, now: todayISO }, authHeader);
    const items = Array.isArray(gen.data?.items) ? gen.data.items : [];
    if(!items.length) throw new Error('AI không suy ra được lịch từ yêu cầu.');
    const it = items[0];
    // If the model set periods, but the prompt contains explicit HH:mm (e.g., 9h/09:00), extract and override startTime
    try{
      const n = norm(text);
      const m = n.match(/\b(\d{1,2}):(\d{2})\b/) || n.match(/\b(\d{1,2})h(\d{2})?\b/);
      if(m){
        const hh = String(m[1]).padStart(2,'0');
        const mm = String((m[2]||'00')).padStart(2,'0');
        it.startTime = `${hh}:${mm}`;
        // If no endTime, keep empty; user can adjust later
      } else {
        // Fallback by time-of-day words
        if(/\bsang\b/.test(n) && !it.startTime) it.startTime = '09:00';
        if(/\btrua\b/.test(n) && !it.startTime) it.startTime = '12:00';
        if(/\bchieu\b/.test(n) && !it.startTime) it.startTime = '15:00';
        if(/\btoi\b/.test(n) && !it.startTime) it.startTime = '19:00';
      }
    }catch{}
    // 2) Resolve typeId (prefer route param; else pick default type)
    let chosenTypeId = typeId ? String(typeId) : '';
    if(!chosenTypeId){
      try{
        const res = await axios.get(`${API_BASE}/api/event-types`, authHeader);
        const list: any[] = Array.isArray(res.data) ? res.data : [];
        const preferred = list.find(t => t.isDefault) || list[0];
        if(preferred) chosenTypeId = String(preferred._id);
      }catch{}
    }
    if(!chosenTypeId) throw new Error('Chưa cấu hình loại lịch mặc định.');
    // 3) Create event
    const payload: any = {
      title: (it.title || 'Lịch mới').slice(0,120),
      typeId: chosenTypeId,
      date: it.date || todayISO,
      endDate: it.endDate || '',
  startTime: it.startTime || '',
      endTime: it.endTime || '',
      location: it.location || '',
      notes: it.notes || '',
      link: it.link || '',
    };
    if(projectId) payload.projectId = String(projectId);
    if(it.repeat) payload.repeat = it.repeat;
    const created = await axios.post(`${API_BASE}/api/events`, payload, authHeader);
    return created.data;
  };

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

  // General chat send: always answer questions and analyze like a chatbot
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
      // Collect text from attachments (if any) to enrich chat context
      let combinedRaw = '';
      if(images.length){
        for(const im of images){
          const form = new FormData();
          // @ts-ignore
          form.append('image', { uri: im.uri, name: im.name || 'image.jpg', type: 'image/jpeg' });
          const res = await axios.post(`${API_BASE}/api/events/scan-image`, form, authHeader);
          const raw = String(res.data?.raw || '');
          if(raw) combinedRaw += (combinedRaw?'\n\n':'')+raw;
        }
      }
      if(files.length){
        for(const f of files){
          const form = new FormData();
          // @ts-ignore
          form.append('file', { uri: f.uri, name: f.name, type: f.mimeType });
          const res = await axios.post(`${API_BASE}/api/events/scan-file`, form, authHeader);
          const raw = String(res.data?.raw || '');
          if(raw) combinedRaw += (combinedRaw?'\n\n':'')+raw;
        }
      }
      // Detect evaluation phrase (case-insensitive, diacritics-insensitive) and build summary automatically
      const isEval = (()=>{
        const n = norm(trimmed);
        return /hay danh gia thoi gian bieu cua toi/.test(n);
      })();
      let evalBlock = '';
      if(isEval){
        try {
          const today = todayISO();
          const [evRes, tkRes] = await Promise.all([
            axios.get(`${API_BASE}/api/events`, authHeader).catch(()=>({ data: [] } as any)),
            axios.get(`${API_BASE}/api/tasks`, authHeader).catch(()=>({ data: [] } as any)),
          ]);
          const events = Array.isArray(evRes.data) ? evRes.data : [];
          const tasks = Array.isArray(tkRes.data) ? tkRes.data : mockTasks;
          const evCount = events.length;
          const tkCount = tasks.length;
          const completed = tasks.filter((t:any)=> t.status==='completed' || t.completed).length;
          const todo = tasks.filter((t:any)=> (t.status||'')==='todo').length;
          const inprog = tasks.filter((t:any)=> (t.status||'')==='in-progress').length;
          const weekAhead = (()=>{ const d=new Date(); const arr:number[]=[]; for(let i=0;i<7;i++){ const dd=new Date(d); dd.setDate(dd.getDate()+i); arr.push(dd.getTime()); } return arr; })();
          const evByDay = new Array(7).fill(0);
          for(const ev of events){
            const sd = new Date(ev.date || ev.startDate || today);
            const idx = weekAhead.findIndex(ts=>{ const dd=new Date(ts); return sd.getFullYear()===dd.getFullYear() && sd.getMonth()===dd.getMonth() && sd.getDate()===dd.getDate(); });
            if(idx>=0) evByDay[idx]++;
          }
          const header = 'Tổng hợp tự động cho đánh giá:';
          const lines = [
            header,
            `- Số lịch: ${evCount}`,
            `- Số tác vụ: ${tkCount} (Todo: ${todo}, Đang làm: ${inprog}, Hoàn thành: ${completed})`,
            `- Phân bố lịch 7 ngày tới: ${evByDay.join(', ')}`,
            '- Mục tiêu: đánh giá cân bằng, quá tải, tồn đọng và đề xuất tối ưu (3-5 gợi ý).'
          ];
          evalBlock = lines.join('\n');
        } catch {
          evalBlock = 'Không thể tự tổng hợp dữ liệu lịch/tác vụ lúc này.';
        }
      }
      // If prompt asks to create an event, do it first (and still chat afterwards)
      let createdEvent: any = null;
      if(isCreateEventIntent(trimmed)){
        try{
          const ev = await createEventFromPrompt(trimmed);
          createdEvent = ev;
          const when = [ev.date, ev.startTime && ` lúc ${ev.startTime}`].filter(Boolean).join('');
          appendMsg({ id:`a_${Date.now()}_created`, role:'assistant', text: `Đã tạo lịch: “${ev.title}”${when ? ` (${when})` : ''}.`, meta: { evItems: undefined, evFormItems: undefined, tkItems: undefined, ...(ev? { createdEventId: String(ev._id||ev.id||'') , createdEventDate: ev.date || '' } : {}) } as any });
        }catch(e:any){
          appendMsg({ id:`a_${Date.now()}_create_fail`, role:'assistant', text: e?.response?.data?.message || e?.message || 'Không thể tạo lịch từ yêu cầu này.' });
        }
      }

      // Always call general chat endpoint with optional OCR context and evaluation block
      try{
        const todayISO = (()=>{ const n=new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`; })();
        const parts: string[] = [trimmed];
        if(evalBlock) parts.push(evalBlock);
        if(createdEvent){ parts.push(`(Hệ thống: Đã tạo lịch “${createdEvent.title}” vào ${createdEvent.date}${createdEvent.startTime? ` lúc ${createdEvent.startTime}`:''}).`); }
        if(combinedRaw) parts.push('(Trích xuất từ ảnh/tệp)\n'+combinedRaw);
        const finalPrompt = parts.join('\n\n');
        const res = await axios.post(`${API_BASE}/api/ai/chat`, { prompt: finalPrompt, now: todayISO }, { ...authHeader, timeout: 45000 });
        const answer = String(res.data?.answer || '').trim();
        const evs = Array.isArray(res.data?.events) ? res.data.events : [];
        const tks = Array.isArray(res.data?.tasks) ? res.data.tasks : [];
        const toItem = (x:any): AiEditItem => ({
          id: String(x.id || x._id || ''),
          date: String(x.date || ''),
          title: String(x.title || ''),
          time: x.startTime ? `${x.startTime}${x.endTime?`-${x.endTime}`:''}` : undefined,
        });
  const eventsEdit: AiEditItem[] = evs.map(toItem).filter((it: AiEditItem)=> !!(it.id && it.date)).slice(0, 8);
  const tasksEdit: AiEditItem[] = tks.map(toItem).filter((it: AiEditItem)=> !!(it.id && it.date)).slice(0, 8);
        appendMsg({ id:`a_${Date.now()}`, role:'assistant', text: answer || 'Mình chưa có câu trả lời cho câu hỏi này.', meta: (eventsEdit.length || tasksEdit.length) ? { eventsEdit, tasksEdit } : undefined });
      }catch(e:any){
        appendMsg({ id:`a_${Date.now()}`, role:'assistant', text: e?.response?.data?.message || 'Không thể gọi Chat' });
      }
      setTimeout(()=> scrollRef.current?.scrollToEnd({ animated: true }), 60);
    }catch(e:any){
      const message = e?.response?.data?.message || e?.message || 'Lỗi không xác định';
      appendMsg({ id:`a_${Date.now()}`, role:'assistant', text:`Có lỗi khi xử lý: ${message}` });
    }finally{
      setBusy(false);
    }
  };

  // Build a local summary for evaluation prompt
  const buildScheduleSummary = async (): Promise<string> => {
    try{
      const today = todayISO();
      const auth = authHeader;
      const [evRes, tkRes] = await Promise.all([
        axios.get(`${API_BASE}/api/events`, auth).catch(()=>({ data: [] } as any)),
        axios.get(`${API_BASE}/api/tasks`, auth).catch(()=>({ data: [] } as any)),
      ]);
      const events = Array.isArray(evRes.data) ? evRes.data : [];
      const tasks = Array.isArray(tkRes.data) ? tkRes.data : mockTasks;
      const evCount = events.length;
      const tkCount = tasks.length;
      const completed = tasks.filter((t:any)=> t.status==='completed' || t.completed).length;
      const todo = tasks.filter((t:any)=> (t.status||'')==='todo').length;
      const inprog = tasks.filter((t:any)=> (t.status||'')==='in-progress').length;
      const weekAhead = (()=>{ const d=new Date(); const arr:number[]=[]; for(let i=0;i<7;i++){ const dd=new Date(d); dd.setDate(d.getDate()+i); arr.push(dd.getTime()); } return arr; })();
      const evByDay = new Array(7).fill(0);
      for(const ev of events){
        const sd = new Date(ev.date || ev.startDate || today);
        const idx = weekAhead.findIndex(ts=>{ const dd=new Date(ts); return sd.getFullYear()===dd.getFullYear() && sd.getMonth()===dd.getMonth() && sd.getDate()===dd.getDate(); });
        if(idx>=0) evByDay[idx]++;
      }
      const lines = [
        `Tổng quan:`,
        `- Số lịch hiện có: ${evCount}`,
        `- Số tác vụ hiện có: ${tkCount} (Todo: ${todo}, Đang làm: ${inprog}, Hoàn thành: ${completed})`,
        `- Phân bố lịch 7 ngày tới: ${evByDay.join(', ')}`,
      ];
      return lines.join('\n');
    }catch{
      return 'Không thể tổng hợp nhanh từ dữ liệu. Hãy đánh giá dựa trên các nguyên tắc tối ưu hoá thời gian chung.';
    }
  };

  const onEvaluateSchedule = async () => {
    const summary = await buildScheduleSummary();
    const instruction = [
      'Đánh giá thời gian biểu của tôi:',
      summary,
      '',
      'Yêu cầu:',
      '- Xác định xem phân bổ có cân bằng (học/làm việc/nghỉ) không.',
      '- Phát hiện quá tải (quá nhiều lịch trong 1 ngày hoặc dồn sát) và đề xuất giãn/đổi lịch.',
      '- Kiểm tra tác vụ tồn đọng: ưu tiên, hạn chót, gợi ý kế hoạch xử lý trong 7 ngày.',
      '- Đưa ra 3-5 đề xuất tối ưu cụ thể và khả thi.',
    ].join('\n');
    await performSend(instruction);
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

  // Bulk-create events with duplicate checks (title + overlapping time)
  const createManyEvents = async (items: any[], defaultTypeId?: string, projectId?: string) => {
    if(!token){ Alert.alert('Lỗi','Chưa đăng nhập'); return; }
    const API = API_BASE;
    const dates = items.map(it=> it.date).filter(Boolean);
    const sample = dates.length? new Date(dates[0]+'T00:00:00') : new Date();
    const from = new Date(sample.getFullYear(), sample.getMonth(), 1);
    const to = new Date(sample.getFullYear(), sample.getMonth()+1, 0, 23,59,59);
    let existing:any[] = [];
    try{
      const res = await axios.get(`${API}/api/events`, { params:{ from: from.toISOString(), to: to.toISOString() }, headers:{ Authorization:`Bearer ${token}` } });
      existing = Array.isArray(res.data)? res.data: [];
    }catch{}
    const overlaps = (aStart:Date, aEnd:Date, bStart:Date, bEnd:Date)=> aStart <= bEnd && bStart <= aEnd;
    let created = 0, skipped = 0;
    for(const m of items){
      const title = String(m.title||'').trim();
      const date = m.date; const endDate = m.endDate || m.date;
      const startTime = m.startTime || '00:00';
      const endTime = m.endTime || (m.startTime||'23:59');
      const start = new Date(date + 'T' + startTime + ':00');
      const end = new Date(endDate + 'T' + endTime + ':00');
      const hasDup = existing.some(ex => {
        const exTitle = String(ex.title||'').trim();
        const exStart = new Date((ex.date||date) + 'T' + (ex.startTime || '00:00') + ':00');
        const exEndIso = ex.endDate || ex.date || date;
        const exEnd = new Date(exEndIso + 'T' + (ex.endTime || (ex.startTime||'23:59')) + ':00');
        return exTitle.localeCompare(title, 'vi', { sensitivity:'base' })===0 && overlaps(start,end,exStart,exEnd);
      });
      if(hasDup){ skipped++; continue; }
      const payload:any = {
        title: title || '(Không tiêu đề)',
        typeId: defaultTypeId || m.typeId,
        date,
        endDate: m.endDate || undefined,
        startTime: m.startTime || undefined,
        endTime: m.endTime || undefined,
        location: m.location || undefined,
        notes: m.notes || undefined,
        repeat: m.repeat || undefined,
        reminders: [],
      };
      if(projectId) payload.projectId = String(projectId);
      try{ await axios.post(`${API}/api/events`, payload, { headers:{ Authorization:`Bearer ${token}` } }); created++; } catch{ /* skip */ }
    }
    DeviceEventEmitter.emit('toast', `Đã tạo ${created} lịch, bỏ qua ${skipped} trùng.`);
  };

  // PDF → events generation removed per request


  // Explicit generation on demand with current prompt and attachments
  const generateFromCurrent = async (mode: 'events'|'tasks'|'both') => {
    const trimmed = (prompt || '').trim();
    if(!trimmed && images.length===0 && files.length===0){
      Alert.alert('Thiếu dữ liệu','Nhập yêu cầu hoặc đính kèm ảnh/tệp để tạo.');
      return;
    }
    if(!token){ Alert.alert('Lỗi','Chưa đăng nhập'); return; }
    setBusy(true);
    try{
      // Gather event candidates from attachments
      let evItems: any[] = [];
      if(images.length){
        for(const im of images){
          const form = new FormData();
          // @ts-ignore
          form.append('image', { uri: im.uri, name: im.name || 'image.jpg', type: 'image/jpeg' });
          const res = await axios.post(`${API_BASE}/api/events/scan-image`, form, authHeader);
          const st = res.data?.structured;
          if(st?.kind==='progress-table' && Array.isArray(st.items)) evItems = evItems.concat(st.items);
        }
      }
      if(files.length){
        for(const f of files){
          const form = new FormData();
          // @ts-ignore
          form.append('file', { uri: f.uri, name: f.name, type: f.mimeType });
          const res = await axios.post(`${API_BASE}/api/events/scan-file`, form, authHeader);
          const st = res.data?.structured;
          if(st?.kind==='progress-table' && Array.isArray(st.items)) evItems = evItems.concat(st.items);
        }
      }
      let aiEvItems: any[] = [];
      let aiEvFormItems: any[] = [];
      let aiTkItems: any[] = [];
      const doEvents = mode==='events' || mode==='both';
      const doTasks = mode==='tasks' || mode==='both';
      const reqs: Promise<any>[] = [];
      if(trimmed && doEvents){
        const todayISO = (()=>{ const n=new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`; })();
        reqs.push(axios.post(`${API_BASE}/api/events/ai-generate`, { prompt: trimmed, now: todayISO }, authHeader).catch(e=>({ error:e } as any)));
        reqs.push(axios.post(`${API_BASE}/api/events/ai-generate-form`, { prompt: trimmed, now: todayISO }, authHeader).catch(e=>({ error:e } as any)));
      }
      if(trimmed && doTasks){
        const todayISO = (()=>{ const n=new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`; })();
        reqs.push(axios.post(`${API_BASE}/api/tasks/ai-generate`, { prompt: trimmed, now: todayISO }, authHeader).catch(e=>({ error:e } as any)));
      }
      const results = await Promise.all(reqs);
      let idx = 0;
      if(doEvents){ const evRes = results[idx++]; aiEvItems = (evRes as any)?.data?.items || []; const evFormRes = results[idx++]; aiEvFormItems = (evFormRes as any)?.data?.items || []; }
      if(doTasks){ const tkRes = results[idx++]; aiTkItems = (tkRes as any)?.data?.tasks || []; }
      let mergedEvents = [...evItems, ...aiEvItems];
      if(trimmed && mergedEvents.length){
        try{
          const todayISO = (()=>{ const n=new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`; })();
          const tr = await axios.post(`${API_BASE}/api/events/ai-transform`, { prompt: trimmed, items: mergedEvents, now: todayISO }, authHeader);
          if(Array.isArray(tr.data?.items) && tr.data.items.length) mergedEvents = tr.data.items;
        }catch{}
      }
      const parts: string[] = [];
      if(doEvents && (aiEvFormItems.length || mergedEvents.length)) parts.push(`• Lịch gợi ý: ${(aiEvFormItems.length || mergedEvents.length)}`);
      if(doTasks && aiTkItems.length) parts.push(`• Tác vụ gợi ý: ${aiTkItems.length}`);
      if(!parts.length){
        appendMsg({ id:`a_${Date.now()}`, role:'assistant', text: 'Mình chưa tạo được mục nào từ yêu cầu này. Hãy mô tả rõ hơn hoặc thử đính kèm ảnh/PDF.' });
      } else {
        appendMsg({ id:`a_${Date.now()}`, role:'assistant', text: ['Đây là gợi ý của mình:', parts.join('\n'), '', 'Chọn để xem trước và xác nhận tạo.'].filter(Boolean).join('\n'), meta:{ evItems: mergedEvents, evFormItems: aiEvFormItems, tkItems: aiTkItems } });
      }
      setTimeout(()=> scrollRef.current?.scrollToEnd({ animated: true }), 60);
    }catch(e:any){
      appendMsg({ id:`a_${Date.now()}`, role:'assistant', text: e?.response?.data?.message || 'Không thể tạo gợi ý' });
    }finally{ setBusy(false); }
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
            {/* Hành động tạo lịch/tác vụ và PDF đã được gỡ bỏ */}
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
                    {/* Schedule-review CTA removed per revert */}
                  </View>
                ) : null}
                {m.role==='assistant' && (m.meta?.eventsEdit?.length || m.meta?.tasksEdit?.length) ? (
                  <View style={{ marginTop:8, gap:6 }}>
                    {!!m.meta?.eventsEdit?.length && (
                      <View style={{ gap:6 }}>
                        <Text style={{ color:'#0f172a', fontWeight:'700', fontSize:12 }}>Lịch sắp tới</Text>
                        <View style={{ flexDirection:'row', flexWrap:'wrap', gap:8 }}>
                          {m.meta.eventsEdit!.map((e, i) => (
                            <Pressable key={`e_${i}_${e.id}`} style={styles.quickChip} onPress={()=> router.push({ pathname:'/create-calendar', params:{ editId: e.id, occDate: e.date } })}>
                              <Ionicons name='calendar-outline' size={14} color='#1d4ed8' />
                              <Text style={styles.quickChipText} numberOfLines={1}>{e.title || 'Lịch'}{e.time? ` (${e.time})`:''}</Text>
                            </Pressable>
                          ))}
                        </View>
                      </View>
                    )}
                    {!!m.meta?.tasksEdit?.length && (
                      <View style={{ gap:6 }}>
                        <Text style={{ color:'#0f172a', fontWeight:'700', fontSize:12 }}>Tác vụ sắp tới</Text>
                        <View style={{ flexDirection:'row', flexWrap:'wrap', gap:8 }}>
                          {m.meta.tasksEdit!.map((t, i) => (
                            <Pressable key={`t_${i}_${t.id}`} style={styles.quickChip} onPress={()=> router.push({ pathname:'/create-task', params:{ editId: t.id, occDate: t.date } })}>
                              <Ionicons name='create-outline' size={14} color='#1d4ed8' />
                              <Text style={styles.quickChipText} numberOfLines={1}>{t.title || 'Tác vụ'}{t.time? ` (${t.time})`:''}</Text>
                            </Pressable>
                          ))}
                        </View>
                      </View>
                    )}
                  </View>
                ) : null}
                {m.role==='assistant' && (m as any)?.meta?.createdEventId ? (
                  <View style={{ flexDirection:'row', gap:8, marginTop:8 }}>
                    <Pressable style={[styles.actionBtn, styles.primary]} onPress={()=> {
                      const id = (m as any).meta.createdEventId as string; const d = (m as any).meta.createdEventDate as string|undefined;
                      router.push({ pathname:'/create-calendar', params:{ editId: id, occDate: d || todayISO() } });
                    }}>
                      <Ionicons name='create-outline' size={16} color='#fff' />
                      <Text style={styles.actionText}>Sửa lịch</Text>
                    </Pressable>
                    <Pressable style={[styles.actionBtn, styles.secondary]} onPress={async ()=>{
                      try{
                        const id = (m as any).meta.createdEventId as string;
                        await axios.delete(`${API_BASE}/api/events/${id}`, authHeader);
                        Alert.alert('Đã xoá','Lịch vừa tạo đã được xoá.');
                      }catch(e:any){ Alert.alert('Không thể xoá', e?.response?.data?.message || e?.message || ''); }
                    }}>
                      <Ionicons name='trash-outline' size={16} color='#16425b' />
                      <Text style={styles.actionTextAlt}>Xoá</Text>
                    </Pressable>
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
            {/* Removed evaluation, image, document, mic, and VI/EN toggle icons per request */}
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
  quickChip:{ flexDirection:'row', alignItems:'center', gap:6, paddingHorizontal:10, paddingVertical:8, borderRadius:20, backgroundColor:'#eff6ff', borderWidth:1, borderColor:'#dbeafe' },
  quickChipText:{ color:'#1d4ed8', fontWeight:'700', fontSize:12 },
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
