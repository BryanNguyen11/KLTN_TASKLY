import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, Alert, ActivityIndicator, Modal, Switch, DeviceEventEmitter, FlatList } from 'react-native';
import { useDeviceCalendarEvents } from '@/hooks/useDeviceCalendarEvents';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import axios from 'axios';
import { useAuth } from '@/contexts/AuthContext';
import { EventTypeDoc, EventTypeField, EventDoc, toDisplayDate } from '@/utils/events';
import { Platform, Linking } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import * as DocumentPicker from 'expo-document-picker';
import { setOcrScanPayload } from '@/contexts/OcrScanStore';
import { parseWeeklyFromRaw } from '@/utils/ocrTimetable';
// Optional: image conversion. If not installed, we'll skip conversion.
let ImageManipulator: any;
try { ImageManipulator = require('expo-image-manipulator'); } catch { ImageManipulator = null; }

interface FormState {
  title: string;
  typeId: string;
  date: string;
  endDate: string;
  startTime: string;
  endTime: string;
  location: string;
  notes: string;
  link: string;
  props: Record<string, string>;
  // All-day event: when true, omit startTime/endTime and disable time pickers
  isAllDay?: boolean;
  isRepeating?: boolean;
  repeat?: {
    frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
    endMode?: 'never' | 'onDate' | 'after';
    endDate?: string;
    count?: number;
  };
  reminders?: Array<{ type:'relative'; minutes:number } | { type:'absolute'; at:string }>;
}

export default function CreateEventScreen(){
  const router = useRouter();
  const { editId, occDate, projectId } = useLocalSearchParams<{ editId?: string; occDate?: string; projectId?: string }>();
  const { token } = useAuth();
  const API_BASE = process.env.EXPO_PUBLIC_API_BASE;

  const toLocalISODate = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const today = toLocalISODate(new Date());
  const weekdayVN = (iso: string) => {
    try {
      if(!/^\d{4}-\d{2}-\d{2}$/.test(String(iso||''))) return '';
      const d = new Date(String(iso)+'T00:00:00');
      const w = d.getDay();
      return w === 0 ? 'Chủ nhật' : `Thứ ${w + 1}`;
    } catch { return ''; }
  };
  const [saving, setSaving] = useState(false);
  const [types, setTypes] = useState<EventTypeDoc[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(false);
  const [showPicker, setShowPicker] = useState<{mode:'date'|'time'; field:'date'|'endDate'|'startTime'|'endTime'|'repeatEndDate'|null}>({mode:'date', field:null});
  const [tempDate, setTempDate] = useState<Date | null>(null);
  const [errors, setErrors] = useState<{start?:string; end?:string}>({});
  const [scanning, setScanning] = useState(false);
  const [form, setForm] = useState<FormState>({
    title: '',
    typeId: '',
    date: today,
    endDate: '',
    startTime: '09:00',
    endTime: '',
    location: '',
    notes: '',
    link: '',
    props: {},
    isAllDay: false, // Default value for all-day event
    isRepeating: false,
    repeat: undefined,
    reminders: [],
  });

  const authHeader = () => ({ headers: { Authorization: token ? `Bearer ${token}` : '' } });

  // Device calendar import
  const [importOpen, setImportOpen] = useState(false);
  const { events: deviceEvents, loading: devLoading, error: devError, permission: devPerm, requestPermission: reqDevPerm, refresh: refreshDev, mapToFormValues, setLookAheadDays, refreshRange } = useDeviceCalendarEvents({ lookAheadDays: 30 });
  useEffect(()=>{ if(importOpen && devPerm==='granted'){ refreshDev(); } }, [importOpen, devPerm]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [ ...prev, id ]);
  };
  const allSelectedImport = deviceEvents.length>0 && selectedIds.length === deviceEvents.length;
  const clearSelection = () => setSelectedIds([]);
  const selectAll = () => setSelectedIds(deviceEvents.map(e=> e.id));
  const previewSelected = () => {
    if(selectedIds.length === 0){ Alert.alert('Chưa chọn','Chọn ít nhất một sự kiện để xem trước'); return; }
    const items = deviceEvents.filter(ev => selectedIds.includes(ev.id)).map(ev => {
      const mapped = mapToFormValues(ev);
      return {
        title: mapped.title,
        date: mapped.date,
        startTime: mapped.startTime,
        endDate: mapped.endDate,
        endTime: mapped.endTime,
        location: mapped.location,
        notes: mapped.notes,
        repeat: mapped.repeat,
      };
    });
    // Set into OcrScanStore as events-form structured flow
    setOcrScanPayload({ raw: '', structured: { kind: 'events-form', items }, defaultTypeId: '', projectId: projectId? String(projectId): undefined });
    setImportOpen(false);
    router.push('/scan-preview');
  };

  const fetchTypes = async () => {
    if(!token) return;
    setLoadingTypes(true);
    try {
      const res = await axios.get(`${API_BASE}/api/event-types`, authHeader());
      const list: EventTypeDoc[] = res.data;
      setTypes(list);
      setForm(prev => {
        if(prev.typeId) return prev;
        const preferred = list.find(t=> t.isDefault) || list[0];
        return preferred ? { ...prev, typeId: preferred._id } : prev;
      });
    } catch(e) { /* silent */ } finally { setLoadingTypes(false); }
  };

  useEffect(()=>{ fetchTypes(); }, [token]);

  const update = useCallback(<K extends keyof FormState>(key:K, value: FormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  }, []);

  useEffect(() => {
    const load = async () => {
      if(!editId || !token) return;
      try {
        const res = await axios.get(`${API_BASE}/api/events/${editId}`, authHeader());
        const e = res.data;
        const typeId = typeof e.typeId === 'string' ? e.typeId : (e.typeId? e.typeId._id : '');
        setForm(prev => ({
          ...prev,
          title: e.title || '',
          typeId,
          date: (e.date?.split?.('T')?.[0]) || e.date || prev.date,
          endDate: e.endDate || '',
          startTime: e.startTime || prev.startTime,
          endTime: e.endTime || '',
          location: e.location || '',
          notes: e.notes || '',
          link: e.link || '',
          props: e.props || {},
          isAllDay: (!e.startTime && !e.endTime) ? true : false,
          isRepeating: !!e.repeat,
          repeat: e.repeat || undefined,
        }));
      } catch(err){
        Alert.alert('Lỗi','Không tải được lịch để sửa');
      }
    };
    load();
  }, [editId, token]);

  useEffect(() => {
    const t = types.find(tt=> tt._id === form.typeId);
    if(!t) return;
    setForm(prev => {
      const allowed = new Set(t.fields.map(f=> f.key));
      const nextProps: Record<string,string> = {};
      for(const k of Object.keys(prev.props||{})){
        if(allowed.has(k)) nextProps[k] = prev.props[k];
      }
      return { ...prev, props: nextProps };
    });
  }, [form.typeId, types]);

  const parseDateValue = (field:'date'|'endDate') => {
    const raw = (form as any)[field];
    if(/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(raw + 'T00:00:00');
    return new Date();
  };
  const parseTimeValue = (field:'startTime'|'endTime') => {
    const raw = (form as any)[field];
    if(/^[0-2]\d:[0-5]\d$/.test(raw)){
      const [h,m] = raw.split(':').map((n:string)=>parseInt(n,10));
      const d = new Date(); d.setHours(h,m,0,0); return d;
    }
    return new Date();
  };

  const openDate = (field:'date'|'endDate') => { setTempDate(parseDateValue(field)); setShowPicker({mode:'date', field}); };
  const openTime = (field:'startTime'|'endTime') => { setTempDate(parseTimeValue(field)); setShowPicker({mode:'time', field}); };

  const onNativeChange = (e:DateTimePickerEvent, selected?:Date) => {
    if(Platform.OS !== 'android') return;
    if(e.type==='dismissed'){ setShowPicker({mode:'date', field:null}); return; }
    if(selected && showPicker.field){
      if(showPicker.mode==='date'){
        const iso = toLocalISODate(selected);
        if(showPicker.field === 'repeatEndDate'){
          setForm(prev => ({ ...prev, repeat: { ...(prev.repeat||{ frequency:'weekly' }), endMode: 'onDate', endDate: iso } }));
        } else if(showPicker.field === 'endDate'){
          setForm(prev => ({ ...prev, endDate: iso, ...(prev.isAllDay ? {} : { endTime: prev.endTime || '23:59' }) }));
        } else setForm(prev => ({ ...prev, date: iso }));
      } else {
        const hh = selected.getHours().toString().padStart(2,'0');
        const mm = selected.getMinutes().toString().padStart(2,'0');
        update(showPicker.field as any, `${hh}:${mm}`);
      }
    }
    setShowPicker({mode:'date', field:null});
  };
  const confirmIOS = () => {
    if(tempDate && showPicker.field){
      if(showPicker.mode==='date'){
        const iso = toLocalISODate(tempDate);
        if(showPicker.field === 'repeatEndDate'){
          setForm(prev => ({ ...prev, repeat: { ...(prev.repeat||{ frequency:'weekly' }), endMode: 'onDate', endDate: iso } }));
        } else if(showPicker.field === 'endDate'){
          setForm(prev => ({ ...prev, endDate: iso, ...(prev.isAllDay ? {} : { endTime: prev.endTime || '23:59' }) }));
        } else setForm(prev => ({ ...prev, date: iso }));
      } else {
        const hh = tempDate.getHours().toString().padStart(2,'0');
        const mm = tempDate.getMinutes().toString().padStart(2,'0');
        update(showPicker.field as any, `${hh}:${mm}`);
      }
    }
    setShowPicker({mode:'date', field:null}); setTempDate(null);
  };
  const cancelIOS = () => { setShowPicker({mode:'date', field:null}); setTempDate(null); };

  useEffect(()=>{
    const newErr: typeof errors = {} as any;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) newErr.start = 'Ngày bắt đầu sai định dạng';
    if(form.endDate){
      if(!/^\d{4}-\d{2}-\d{2}$/.test(form.endDate)) newErr.end = 'Ngày kết thúc sai định dạng';
      else {
        if(form.endDate < form.date) newErr.end = 'Kết thúc phải sau hoặc bằng ngày bắt đầu';
        if(!form.isAllDay && form.date === form.endDate && form.endTime && form.endTime <= form.startTime) newErr.end = 'Giờ kết thúc phải sau giờ bắt đầu';
      }
    } else {
      if(!form.isAllDay && form.endTime && form.startTime && form.endTime <= form.startTime) newErr.end = 'Giờ kết thúc phải sau giờ bắt đầu';
    }
    setErrors(newErr);
  }, [form.date, form.endDate, form.startTime, form.endTime]);

  const save = async () => {
    if(!token){ Alert.alert('Lỗi','Chưa đăng nhập'); return; }
  if(!form.title.trim()){ Alert.alert('Thiếu thông tin','Vui lòng nhập tiêu đề'); return; }
  if(!form.typeId){ Alert.alert('Thiếu thông tin','Vui lòng chọn loại lịch'); return; }
    if(!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) { Alert.alert('Lỗi','Ngày bắt đầu không hợp lệ'); return; }
    if(form.endDate){
      if(!/^\d{4}-\d{2}-\d{2}$/.test(form.endDate)) { Alert.alert('Lỗi','Ngày kết thúc không hợp lệ'); return; }
      if(form.endDate < form.date) { Alert.alert('Lỗi','Ngày kết thúc phải >= ngày bắt đầu'); return; }
      if(!form.isAllDay && form.date === form.endDate && form.startTime && form.endTime && form.endTime <= form.startTime){ Alert.alert('Lỗi','Giờ kết thúc phải sau giờ bắt đầu'); return; }
    } else {
      if(!form.isAllDay && form.endTime && form.startTime && form.endTime <= form.startTime){ Alert.alert('Lỗi','Giờ kết thúc phải sau giờ bắt đầu'); return; }
    }
    setSaving(true);
    const payload: any = {
      title: form.title.trim(),
      typeId: form.typeId,
      date: form.date,
      endDate: form.endDate || undefined,
      startTime: form.isAllDay ? undefined : form.startTime,
      endTime: form.isAllDay ? undefined : (form.endDate ? (form.endTime || '23:59') : (form.endTime || undefined)),
      location: form.location || undefined,
      notes: form.notes || undefined,
      link: form.link || undefined,
      props: form.props,
      reminders: form.reminders,
    };
    if(projectId) payload.projectId = String(projectId);
    if(form.isRepeating && form.repeat){ payload.repeat = form.repeat; }
    try {
      if(editId){
        const res = await axios.put(`${API_BASE}/api/events/${editId}`, payload, authHeader());
        DeviceEventEmitter.emit('eventUpdated', res.data);
        Alert.alert('Thành công','Đã lưu lịch');
      } else {
        const res = await axios.post(`${API_BASE}/api/events`, payload, authHeader());
        DeviceEventEmitter.emit('eventCreated', res.data);
        Alert.alert('Thành công','Đã tạo lịch');
      }
      router.back();
    } catch(e:any){
      Alert.alert('Lỗi', e?.response?.data?.message || 'Không thể lưu lịch');
    } finally { setSaving(false); }
  };

  // Pick an image and call backend OCR to extract fields
  const scanFromImage = async () => {
    // 1) Permission flow (do not show generic OCR error here)
    let perm = await MediaLibrary.getPermissionsAsync();
    if (!perm.granted) {
      perm = await MediaLibrary.requestPermissionsAsync();
    }
    // Re-check after request
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
        return;
      }
    }
    if (!perm.granted && Platform.OS === 'ios' && (perm as any).canAskAgain === false) {
      Alert.alert(
        'Thiếu quyền truy cập',
        'Ứng dụng cần quyền truy cập thư viện ảnh để quét từ ảnh. Mở Cài đặt để cấp quyền.',
        [
          { text: 'Đóng', style: 'cancel' },
          { text: 'Mở Cài đặt', onPress: () => { try { Linking.openSettings(); } catch {} } },
        ]
      );
      return;
    }
    if (!perm.granted) {
      Alert.alert('Quyền truy cập', 'Cần quyền truy cập thư viện ảnh để quét');
      return;
    }

    // 2) Open image picker (user may cancel — just return quietly)
    let pick = await ImagePicker.launchImageLibraryAsync({
      quality: 0.8,
      allowsEditing: false,
      base64: true,
    });
    if (pick.canceled && Platform.OS === 'ios' && (perm as any).accessPrivileges === 'limited') {
      pick = await ImagePicker.launchImageLibraryAsync({
        quality: 0.8,
        allowsEditing: false,
        base64: true,
      });
    }
    if (pick.canceled) return;

    const asset = pick.assets?.[0];
    if (!asset?.uri) return;

  // 3) Upload and OCR (now show error if fails)
  setScanning(true);
    try {
      // Normalize to JPEG to improve OCR
      let normalizedUri = asset.uri;
      if (ImageManipulator && ImageManipulator.manipulateAsync) {
        try {
          const manip = await ImageManipulator.manipulateAsync(asset.uri, [], { compress: 0.9, format: ImageManipulator.SaveFormat?.JPEG || 'jpeg' });
          if (manip?.uri) normalizedUri = manip.uri;
        } catch {}
      }
      const formData = new FormData();
      const filename = (asset.fileName && asset.fileName.endsWith('.jpg')) ? asset.fileName : 'image.jpg';
      const uri = normalizedUri;
      // @ts-ignore React Native FormData file
      formData.append('image', { uri, name: filename, type: 'image/jpeg' });
      let res;
      try {
        res = await axios.post(`${API_BASE}/api/events/scan-image`, formData, { headers: { Authorization: token ? `Bearer ${token}` : '' } });
      } catch(_e:any) {
        const imageBase64 = asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : undefined;
        if (!imageBase64) {
          Alert.alert('Lỗi', 'Thiếu base64 ảnh để quét, vui lòng chọn lại ảnh từ thư viện.');
          return;
        }
        res = await axios.post(`${API_BASE}/api/events/scan-image`, { imageBase64 }, { headers: { Authorization: token ? `Bearer ${token}` : '' } });
      }
    const extracted = res.data?.extracted || {};
    const structured = res.data?.structured;
    const raw = res.data?.raw || '';
      // Always go to preview screen for confirmation
  setOcrScanPayload({ raw, extracted, structured, defaultTypeId: form.typeId, projectId: projectId? String(projectId): undefined } as any);
      router.push('/scan-preview');
    } catch (e:any) {
      const reason = e?.response?.data?.reason;
      const message = e?.response?.data?.message || 'Không quét được thông tin từ ảnh';
      Alert.alert('Lỗi', reason ? `${message}
Lý do: ${reason}` : message);
    } finally {
      setScanning(false);
    }
  };

  // Pick a PDF or image via DocumentPicker and send to unified /scan-file endpoint
  const scanFromPdf = async () => {
    try {
      const pick = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        multiple: false,
        copyToCacheDirectory: true,
      });
      // Support both legacy and v12 result shapes safely
      const anyPick: any = pick as any;
      if (anyPick.canceled) return;
      const asset: any = Array.isArray(anyPick.assets) ? anyPick.assets[0] : anyPick;
      const uri: string | undefined = asset?.uri as string | undefined;
      if (!uri) return;
      const name: string = (asset?.name as string) || (uri.split('/').pop() || 'upload');
      const mime: string = (asset?.mimeType as string) || (name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/*');
      setScanning(true);
      const formData = new FormData();
      // @ts-ignore React Native FormData file
      formData.append('file', { uri, name, type: mime });
      const res = await axios.post(`${API_BASE}/api/events/scan-file`, formData, { headers: { Authorization: token ? `Bearer ${token}` : '' } });
    const raw = res.data?.raw || '';
    const extracted = res.data?.extracted || {};
    const structured = res.data?.structured;
  setOcrScanPayload({ raw, extracted, structured, defaultTypeId: form.typeId, projectId: projectId? String(projectId): undefined } as any);
      router.push('/scan-preview');
    } catch (e:any) {
      const reason = e?.response?.data?.reason;
      const message = e?.response?.data?.message || 'Không xử lý được tệp';
      Alert.alert('Lỗi', reason ? `${message}\nLý do: ${reason}` : message);
    } finally {
      setScanning(false);
    }
  };

  // Navigate to new AI auto-schedule screen
  const startAutoCreate = async () => {
    const q = new URLSearchParams();
    if (form.typeId) q.set('typeId', form.typeId);
    if (projectId) q.set('projectId', String(projectId));
    router.push(`/auto-schedule?${q.toString()}`);
  };

  const selectedType = types.find(t => t._id === form.typeId);

  const onDelete = async () => {
    if(!editId || !token){ Alert.alert('Lỗi','Không thể xóa'); return; }
    const hasRepeat = !!form.repeat;
    if(!hasRepeat){
      Alert.alert('Xóa lịch','Bạn có chắc muốn xóa lịch này?',[
        { text:'Hủy', style:'cancel' },
        { text:'Xóa', style:'destructive', onPress: async ()=>{
          try { await axios.delete(`${API_BASE}/api/events/${editId}`, authHeader()); DeviceEventEmitter.emit('eventDeleted', editId); DeviceEventEmitter.emit('toast','Đã xóa lịch'); router.back(); }
          catch(e:any){ Alert.alert('Lỗi', e?.response?.data?.message || 'Không thể xóa'); }
        } }
      ]);
      return;
    }
    const delMsg = [
      'Bạn muốn xóa:',
      '• Chỉ lần xuất hiện này',
      '• Hay lịch này và tất cả các lịch trong tương lai?'
    ].join('\n');
    Alert.alert('Xóa lịch lặp', delMsg, [
      { text:'Hủy', style:'cancel' },
      { text:'Chỉ lần này', onPress: async ()=>{
          try {
            if(!occDate){
              await axios.delete(`${API_BASE}/api/events/${editId}`, authHeader());
              DeviceEventEmitter.emit('eventDeleted', editId);
              DeviceEventEmitter.emit('toast','Đã xóa lịch');
              router.back();
              return;
            }
            const freq = form.repeat?.frequency || 'weekly';
            const [y,m,d] = occDate.split('-').map(n=>parseInt(String(n),10));
            const base = new Date(y, (m||1)-1, d||1);
            const next = new Date(base);
            if(freq==='daily') next.setDate(next.getDate()+1);
            else if(freq==='weekly') next.setDate(next.getDate()+7);
            else if(freq==='monthly') next.setMonth(next.getMonth()+1);
            else if(freq==='yearly') next.setFullYear(next.getFullYear()+1);
            const nextStartISO = toLocalISODate(next);
            const seriesStart = form.date;
            if(occDate === seriesStart){
              const res = await axios.put(`${API_BASE}/api/events/${editId}`, { date: nextStartISO }, authHeader());
              DeviceEventEmitter.emit('eventUpdated', res.data);
              DeviceEventEmitter.emit('toast','Đã bỏ lần xuất hiện đầu tiên');
              router.back();
              return;
            }
            const dayBefore = (()=>{ const d0 = new Date(base); d0.setDate(d0.getDate()-1); return toLocalISODate(d0); })();
            await axios.put(`${API_BASE}/api/events/${editId}`, { repeat: { ...(form.repeat||{}), endMode: 'onDate', endDate: dayBefore } }, authHeader());
            const newPayload: any = {
              title: form.title.trim(),
              typeId: form.typeId,
              date: nextStartISO,
              endDate: form.endDate || undefined,
              startTime: form.startTime,
              endTime: form.endTime || undefined,
              location: form.location || undefined,
              notes: form.notes || undefined,
              link: form.link || undefined,
              props: form.props || {},
              repeat: form.repeat || undefined,
            };
            if(projectId) newPayload.projectId = String(projectId);
            const created = await axios.post(`${API_BASE}/api/events`, newPayload, authHeader());
            DeviceEventEmitter.emit('eventCreated', created.data);
            DeviceEventEmitter.emit('toast','Đã xóa lần này và giữ các lần khác');
            router.back();
          } catch(e:any){ Alert.alert('Lỗi', e?.response?.data?.message || 'Không thể xóa'); }
        } },
      { text:'Từ lần này trở đi', style:'destructive', onPress: async ()=>{
          try {
            if(occDate){
              const dayBefore = (()=>{ const [y,m,d] = occDate.split('-').map(n=>parseInt(n,10)); const dt = new Date(y,(m||1)-1,d||1); dt.setDate(dt.getDate()-1); return toLocalISODate(dt); })();
              const res = await axios.put(`${API_BASE}/api/events/${editId}`, { repeat: { ...(form.repeat||{}), endMode: 'onDate', endDate: dayBefore } }, authHeader());
              DeviceEventEmitter.emit('eventUpdated', res.data);
              DeviceEventEmitter.emit('toast','Đã xóa các lần trong tương lai');
              router.back();
            } else {
              await axios.delete(`${API_BASE}/api/events/${editId}`, authHeader());
              DeviceEventEmitter.emit('toast','Đã xóa lịch');
              router.back();
            }
          } catch(e:any){ Alert.alert('Lỗi', e?.response?.data?.message || 'Không thể xóa'); }
        }
      },
    ]);
  };

  return (
    <SafeAreaView style={{ flex:1, backgroundColor:'#f1f5f9' }} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={()=>router.back()} style={styles.backBtn}><Ionicons name='arrow-back' size={22} color='#16425b' /></Pressable>
  <Text style={styles.headerTitle}>{editId? 'Chỉnh sửa lịch':'Tạo lịch mới'}</Text>
        <View style={{ flexDirection:'row', alignItems:'center', gap:10 }}>
          <Pressable onPress={onDelete} style={{ width:40, alignItems:'flex-end' }}>
            {editId ? <Ionicons name='trash-outline' size={20} color='#dc2626' /> : <View style={{ width:20 }} />}
          </Pressable>
        </View>
      </View>

      {/* Nút Tạo lịch tự động nằm ngay dưới tiêu đề màn hình */}
      {!editId && (
        <View style={{ alignItems:'center', paddingBottom:8, flexDirection:'row', justifyContent:'center', gap:14 }}>
          <Pressable onPress={startAutoCreate} style={[styles.autoBtn]} hitSlop={8}>
            <Ionicons name='sparkles' size={16} color='#fff' style={{ marginRight:8 }} />
            <Text style={styles.autoBtnText}>Tạo lịch tự động</Text>
          </Pressable>
          <Pressable onPress={()=> setImportOpen(true)} style={[styles.importBtn, { backgroundColor:'#e2e8f0' }]} hitSlop={6}>
            <Ionicons name='download-outline' size={18} color='#16425b' style={{ marginRight:6 }} />
            <Text style={styles.importText}>Import</Text>
          </Pressable>
        </View>
      )}

      <KeyboardAwareScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        enableOnAndroid
        extraScrollHeight={100}
        keyboardShouldPersistTaps='handled'
      >
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Thông tin cơ bản</Text>
          <View style={styles.field}>
            <Text style={styles.label}>Tiêu đề *</Text>
            <TextInput style={styles.input} placeholder='VD: Học Toán (Đại số)' value={form.title} onChangeText={t=>update('title', t)} />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Loại lịch *</Text>
            {loadingTypes ? (
              <ActivityIndicator color='#3a7ca5' />
            ) : (
              <View style={styles.typeList}>
                {types.map(t => {
                  const active = t._id === form.typeId;
                  return (
                    <Pressable key={t._id} onPress={()=>update('typeId', t._id)} style={[styles.typeChip, active && styles.typeChipActive]}>
                      <Text style={[styles.typeChipText, active && styles.typeChipTextActive]}>{t.name}</Text>
                    </Pressable>
                  );
                })}
                <Pressable onPress={()=>router.push('/create-calendar-type')} style={[styles.typeChip, { borderWidth:1, borderColor:'#3a7ca5', backgroundColor:'transparent' }]}> 
                  <Text style={[styles.typeChipText, { color:'#3a7ca5' }]}>+ Tạo loại mới</Text>
                </Pressable>
              </View>
            )}
          </View>

          <View style={styles.row}>
            <View style={[styles.field, styles.half]}>
              <Text style={styles.label}>Ngày bắt đầu</Text>
              <Pressable onPress={()=>openDate('date')} style={[styles.pickerBtn, errors.start && styles.pickerBtnError]}>
                <Text style={[styles.pickerText, errors.start && styles.pickerTextError]}>{toDisplayDate(form.date)}</Text>
              </Pressable>
            </View>
            <View style={[styles.field, styles.half]}>
              <Text style={styles.label}>Giờ bắt đầu</Text>
              <Pressable onPress={()=>!form.isAllDay && openTime('startTime')} disabled={!!form.isAllDay} style={[styles.pickerBtn, (errors.start && !form.isAllDay) && styles.pickerBtnError, !!form.isAllDay && { opacity:0.5 }]}>
                <Text style={[styles.pickerText, (errors.start && !form.isAllDay) && styles.pickerTextError]}>{form.isAllDay? '--:--' : form.startTime}</Text>
              </Pressable>
            </View>
        </View>

          <View style={styles.row}>
            <View style={[styles.field, styles.half]}>
              <Text style={styles.label}>Ngày kết thúc</Text>
              <Pressable onPress={()=>openDate('endDate')} style={[styles.pickerBtn, errors.end && styles.pickerBtnError]}>
                <Text style={[styles.pickerText, errors.end && styles.pickerTextError]}>{form.endDate? toDisplayDate(form.endDate): 'Không chọn'}</Text>
              </Pressable>
            </View>
            <View style={[styles.field, styles.half]}>
              <Text style={styles.label}>Giờ kết thúc</Text>
              <Pressable onPress={()=> !form.isAllDay && openTime('endTime')} disabled={!form.endDate || !!form.isAllDay} style={[styles.pickerBtn, ((!form.endDate || errors.end) && !form.isAllDay) && styles.pickerBtnError, (!form.endDate || !!form.isAllDay) && { opacity:0.5 }]}>
                <Text style={[styles.pickerText, (errors.end && !form.isAllDay) && styles.pickerTextError]}>{form.isAllDay? '--:--' : (form.endTime || (form.endDate? '23:59' : '--:--'))}</Text>
              </Pressable>
            </View>
          </View>

          <View style={[styles.field, { flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginTop: -4 }]}> 
            <Text style={styles.label}>Sự kiện cả ngày</Text>
            <Switch value={!!form.isAllDay} onValueChange={(v)=> setForm(prev => ({ ...prev, isAllDay: v }))} />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Địa điểm</Text>
            <TextInput style={styles.input} placeholder='VD: Phòng B302' value={form.location} onChangeText={t=>update('location', t)} />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Ghi chú</Text>
            <TextInput style={[styles.input, styles.textarea]} placeholder='Ghi chú...' multiline value={form.notes} onChangeText={t=>update('notes', t)} />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Link</Text>
            <TextInput style={styles.input} placeholder='https://' value={form.link} onChangeText={t=>update('link', t)} autoCapitalize='none' />
          </View>
          </View>

        {/* Repeat rule */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Lặp lại</Text>
          <View style={[styles.field, { flexDirection:'row', alignItems:'center', justifyContent:'space-between' }]}>
            <Text style={styles.label}>Lặp lại lịch</Text>
            <Switch value={!!form.isRepeating} onValueChange={(v)=> setForm(prev => ({ ...prev, isRepeating: v, repeat: v? (prev.repeat || { frequency:'weekly', endMode:'never' }): undefined }))} />
          </View>
          {!!form.isRepeating && (
            <>
              <View style={styles.field}>
                <Text style={styles.label}>Tần suất</Text>
                <View style={styles.typeList}>
                  {(['daily','weekly','monthly','yearly'] as const).map(freq => {
                    const active = form.repeat?.frequency === freq;
                    const label = freq==='daily'
                      ? 'Hàng ngày'
                      : freq==='weekly'
                        ? `Hàng tuần (${weekdayVN(form.date)})`
                        : freq==='monthly'
                          ? 'Hàng tháng'
                          : 'Hàng năm';
                    return (
                      <Pressable key={freq} onPress={()=> setForm(prev => ({ ...prev, repeat: { ...(prev.repeat||{}), frequency: freq } }))} style={[styles.typeChip, active && styles.typeChipActive]}>
                        <Text style={[styles.typeChipText, active && styles.typeChipTextActive]}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Kết thúc</Text>
                <View style={styles.typeList}>
                  {(['never','after','onDate'] as const).map(mode => {
                    const active = (form.repeat?.endMode || 'never') === mode;
                    const label = mode==='never'? 'Không bao giờ' : mode==='after'? 'Sau số lần' : 'Vào ngày';
                    return (
                      <Pressable key={mode} onPress={()=> setForm(prev => ({ ...prev, repeat: { ...(prev.repeat||{ frequency:'weekly' }), endMode: mode } }))} style={[styles.typeChip, active && styles.typeChipActive]}>
                        <Text style={[styles.typeChipText, active && styles.typeChipTextActive]}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {(form.repeat?.endMode === 'after') && (
                  <View style={[styles.field, { marginTop:8 }]}>
                    <Text style={styles.label}>Số lần</Text>
                    <TextInput style={styles.input} keyboardType='number-pad' placeholder='VD: 10' value={String(form.repeat?.count||'')} onChangeText={(t)=> setForm(prev => ({ ...prev, repeat: { ...(prev.repeat||{ frequency:'weekly' }), endMode:'after', count: parseInt(t||'0',10) || undefined } }))} />
                  </View>
                )}
                {(form.repeat?.endMode === 'onDate') && (
                  <View style={[styles.field, { marginTop:8 }]}>
                    <Text style={styles.label}>Ngày kết thúc lặp</Text>
                    <Pressable onPress={()=>{ setTempDate(form.repeat?.endDate? new Date(form.repeat.endDate+'T00:00:00'): new Date()); setShowPicker({ mode:'date', field:'repeatEndDate' }); }} style={styles.pickerBtn}>
                      <Text style={styles.pickerText}>{form.repeat?.endDate? toDisplayDate(form.repeat.endDate): 'Không chọn'}</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            </>
          )}
        </View>

        {/* Reminders moved near the end, before summary */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Nhắc nhở</Text>
          <View style={styles.typeList}>
            {[
              { label:'Trước 1 ngày', minutes: 24*60 },
              { label:'Trước 1 giờ', minutes: 60 },
              { label:'Trước 30 phút', minutes: 30 },
            ].map(p => {
              const exists = (form.reminders||[]).some(r => r.type==='relative' && r.minutes===p.minutes);
              return (
                <Pressable key={p.minutes} onPress={()=> setForm(prev => ({ ...prev, reminders: exists ? (prev.reminders||[]).filter(r => !(r.type==='relative' && r.minutes===p.minutes)) : [ ...(prev.reminders||[]), { type:'relative', minutes:p.minutes } ] }))} style={[styles.typeChip, exists && styles.typeChipActive]}>
                  <Text style={[styles.typeChipText, exists && styles.typeChipTextActive]}>{p.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Thời điểm nhắc cụ thể</Text>
            <Pressable onPress={()=> openTime('startTime')} style={styles.pickerBtn}><Text style={styles.pickerText}>{form.startTime}</Text></Pressable>
            <Pressable onPress={()=>{
              const at = `${form.date}T${form.startTime||'09:00'}:00`;
              const exists = (form.reminders||[]).some(r => r.type==='absolute' && r.at===at);
              if(!exists){ setForm(prev => ({ ...prev, reminders: [ ...(prev.reminders||[]), { type:'absolute', at } ] })); }
            }} style={[styles.typeChip, { alignSelf:'flex-start', marginTop:8 }]}>
              <Text style={[styles.typeChipText]}>+ Thêm thời điểm cụ thể</Text>
            </Pressable>
            {(form.reminders||[]).filter(r => r.type==='absolute').length>0 && (
              <View style={{ marginTop:8 }}>
                {form.reminders!.filter(r=> r.type==='absolute').map((r:any, idx:number)=> (
                  <View key={idx} style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                    <Text style={styles.sub}>{r.at.replace('T',' ')}</Text>
                    <Pressable onPress={()=> setForm(prev => ({ ...prev, reminders: (prev.reminders||[]).filter((_,i)=> i!==idx) }))}><Text style={[styles.sub,{ color:'#b91c1c' }]}>Xóa</Text></Pressable>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Tóm tắt</Text>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Loại:</Text><Text style={styles.summaryValue}>{selectedType? selectedType.name : 'Chưa chọn'}</Text></View>
          {(() => {
            const startDate = form.date; const endDate = form.endDate; const sameDay = endDate && (startDate === endDate);
            let display = '';
            if(form.isAllDay){
              if(!endDate){ display = `${toDisplayDate(startDate)} • Cả ngày`; }
              else if(sameDay){ display = `${toDisplayDate(startDate)} • Cả ngày`; }
              else display = `${toDisplayDate(startDate)} → ${toDisplayDate(endDate)} • Cả ngày`;
            } else {
              if(!endDate){ display = `${toDisplayDate(startDate)} ${form.startTime || ''}${form.endTime? '–'+form.endTime:''}`; }
              else if(sameDay){ display = `${toDisplayDate(startDate)} ${form.startTime || ''}${form.startTime && form.endTime ? '–' : ''}${form.endTime || ''}`; }
              else display = `${toDisplayDate(startDate)} ${form.startTime || ''} → ${toDisplayDate(endDate)} ${form.endTime || ''}`;
            }
            return <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Thời gian:</Text><Text style={styles.summaryValue}>{display}</Text></View>;
          })()}
          {!!form.isRepeating && form.repeat && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Lặp lại:</Text>
              <Text style={styles.summaryValue}>
                {form.repeat.frequency==='daily'
                  ? 'Hàng ngày'
                  : form.repeat.frequency==='weekly'
                    ? `Hàng tuần (${weekdayVN(form.date)})`
                    : form.repeat.frequency==='monthly'
                      ? 'Hàng tháng'
                      : 'Hàng năm'}
                {form.repeat.endMode==='never'? '' : form.repeat.endMode==='after'? ` • Sau ${form.repeat.count||0} lần` : form.repeat.endDate? ` • đến ${toDisplayDate(form.repeat.endDate)}` : ''}
              </Text>
            </View>
          )}
        </View>

        <View style={{ height: 40 }} />
  </KeyboardAwareScrollView>

      <View style={styles.bottomBar}>
        <Pressable style={[styles.bottomBtn, styles.cancelBtn]} onPress={()=>router.back()}><Text style={styles.cancelText}>Hủy</Text></Pressable>
        <Pressable style={[styles.bottomBtn, !form.title.trim()||!form.typeId||saving ? styles.disabledBtn: styles.saveBtn]} disabled={!form.title.trim()||!form.typeId||saving} onPress={save}>
          <Text style={styles.saveText}>{saving? (editId? 'Đang lưu...' : 'Đang lưu...') : (editId? 'Lưu thay đổi':'Tạo lịch')}</Text>
        </Pressable>
      </View>

      {/* Import modal */}
      <Modal visible={importOpen} animationType='slide' onRequestClose={()=> setImportOpen(false)}>
        <SafeAreaView style={{ flex:1, backgroundColor:'#fff' }}>
          <View style={styles.importHeader}>
            <Text style={styles.importTitle}>Chọn sự kiện từ lịch thiết bị</Text>
            <Pressable onPress={()=> setImportOpen(false)} style={styles.closeBtn}><Ionicons name='close' size={22} color='#16425b' /></Pressable>
          </View>
          <View style={{ paddingHorizontal:16, paddingBottom:8 }}>
            {devPerm==='undetermined' && (
              <Pressable onPress={reqDevPerm} style={styles.permBtn}><Text style={styles.permBtnText}>Cấp quyền truy cập lịch</Text></Pressable>
            )}
            {devPerm==='denied' && (
              <View style={styles.infoBox}>
                <Text style={styles.infoText}>Quyền lịch bị từ chối. Vào cài đặt cho phép hoặc thử lại.</Text>
                <Pressable onPress={reqDevPerm} style={styles.retryBtn}><Text style={styles.retryText}>Thử lại</Text></Pressable>
              </View>
            )}
            {devPerm==='granted' && (
              <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                <Text style={styles.smallLabel}>Khoảng thời gian</Text>
                <View style={{ flexDirection:'row', gap:8, alignItems:'center' }}>
                  <Pressable onPress={()=> { setLookAheadDays(7); refreshDev(); }} style={styles.rangeBtn}><Text style={styles.rangeText}>7 ngày</Text></Pressable>
                  <Pressable onPress={()=> { setLookAheadDays(30); refreshDev(); }} style={styles.rangeBtn}><Text style={styles.rangeText}>30 ngày</Text></Pressable>
                  <Pressable onPress={()=> { const from=new Date(); const to=new Date(); to.setMonth(to.getMonth()+3); refreshRange(from,to); }} style={styles.rangeBtn}><Text style={styles.rangeText}>3 tháng</Text></Pressable>
                  <Pressable onPress={refreshDev} style={styles.refreshBtn}><Ionicons name='refresh' size={18} color='#16425b' /></Pressable>
                </View>
              </View>
            )}
            {devLoading && <ActivityIndicator color='#16425b' style={{ marginTop:20 }} />}
            {!devLoading && devPerm==='granted' && deviceEvents.length===0 && (
              <Text style={styles.infoText}>Không có sự kiện nào trong khoảng thời gian này.</Text>
            )}
            {devError && <Text style={[styles.infoText,{ color:'#b91c1c' }]}>{devError}</Text>}
          </View>
          {devPerm==='granted' && deviceEvents.length>0 && (()=>{
            // Group events by YYYY-MM-DD for section headers
            const pad = (n:number)=> String(n).padStart(2,'0');
            const groups: { key:string; label:string; items: typeof deviceEvents }[] = [];
            const map = new Map<string, { key:string; label:string; items: typeof deviceEvents }>();
            for(const ev of deviceEvents){
              const y = ev.startDate.getFullYear();
              const m = pad(ev.startDate.getMonth()+1);
              const d = pad(ev.startDate.getDate());
              const key = `${y}-${m}-${d}`;
              if(!map.has(key)){
                const label = `${d}/${m}/${y}`;
                map.set(key, { key, label, items: [] as any });
                groups.push(map.get(key)!);
              }
              map.get(key)!.items.push(ev);
            }
            return (
              <FlatList
                data={groups}
                keyExtractor={(g)=> g.key}
                contentContainerStyle={{ padding:16, paddingBottom:40, gap:6 }}
                renderItem={({ item: group }) => (
                  <View style={{ marginBottom:6 }}>
                    <View style={styles.sectionHeader}><Text style={styles.sectionHeaderText}>{group.label}</Text></View>
                    {group.items.map((item)=>{
                      const start = item.startDate; const end = item.endDate;
                      const tpad = (n:number)=> String(n).padStart(2,'0');
                      const time = item.allDay? 'Cả ngày' : `${tpad(start.getHours())}:${tpad(start.getMinutes())}${(end && end.getTime()!==start.getTime())? ' - '+tpad(end.getHours())+':'+tpad(end.getMinutes()):''}`;
                      const checked = selectedIds.includes(item.id);
                      // Recurrence badge text
                      const rr = (item as any).recurrenceRule;
                      const freq = rr?.frequency ? String(rr.frequency).toLowerCase() : undefined;
                      const freqText = freq==='daily'? 'Hàng ngày' : freq==='weekly'? 'Hàng tuần' : freq==='monthly'? 'Hàng tháng' : freq==='yearly'? 'Hàng năm' : undefined;
                      let endText: string | undefined;
                      if(rr?.endDate){ const ed = new Date(rr.endDate); endText = `đến ${tpad(ed.getDate())}/${tpad(ed.getMonth()+1)}/${ed.getFullYear()}`; }
                      else if(rr?.occurrence){ endText = `sau ${rr.occurrence} lần`; }
                      return (
                        <Pressable key={item.id} onPress={()=> toggleSelect(item.id)} style={[styles.eventRow, checked && { backgroundColor:'#eef2ff' }]}>
                          <View style={{ flexDirection:'row', alignItems:'center', gap:10, flex:1 }}>
                            <View style={[styles.checkbox, checked && styles.checkboxOn]}>{checked && <Ionicons name='checkmark' size={14} color='#fff' />}</View>
                            <View style={{ flex:1 }}>
                              <Text style={styles.eventTitle} numberOfLines={1}>{item.title}</Text>
                              <View style={{ flexDirection:'row', alignItems:'center', gap:8, marginTop:2 }}>
                                <Text style={styles.eventMeta}>{time}</Text>
                                {!!freqText && (
                                  <View style={styles.badge}><Text style={styles.badgeText}>Lặp: {freqText}{endText? ' • '+endText:''}</Text></View>
                                )}
                                {!!item.calendarTitle && (
                                  <View style={[styles.badge, { backgroundColor:'#e0e7ff' }]}><Text style={[styles.badgeText,{ color:'#3730a3' }]}>{item.calendarTitle}</Text></View>
                                )}
                              </View>
                            </View>
                          </View>
                          <Pressable onPress={()=>{
                            const mapped = mapToFormValues(item);
                            setForm(prev => ({
                              ...prev,
                              title: mapped.title || prev.title,
                              date: mapped.date || prev.date,
                              endDate: mapped.endDate || '',
                              startTime: (item.allDay ? prev.startTime : (mapped.startTime || prev.startTime)),
                              endTime: (item.allDay ? '' : (mapped.endTime || '')),
                              isAllDay: !!item.allDay,
                              location: mapped.location || prev.location,
                              notes: mapped.notes || prev.notes,
                            }));
                            setImportOpen(false);
                          }} style={styles.quickImportBtn}>
                            <Ionicons name='arrow-forward' size={18} color='#64748b' />
                          </Pressable>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              />
            );
          })()}
          {devPerm==='granted' && deviceEvents.length>0 && (
            <View style={styles.selectionBar}>
              <Text style={styles.selectionText}>Đã chọn: {selectedIds.length}</Text>
              <View style={{ flexDirection:'row', gap:10 }}>
                <Pressable onPress={allSelectedImport? clearSelection: selectAll} style={[styles.selBtn, allSelectedImport? styles.selSecondary: styles.selPrimary]}>
                  <Text style={allSelectedImport? styles.selSecondaryText: styles.selPrimaryText}>{allSelectedImport? 'Bỏ chọn tất cả':'Chọn tất cả'}</Text>
                </Pressable>
                <Pressable onPress={previewSelected} style={[styles.selBtn, styles.selPrimary]} disabled={selectedIds.length===0}>
                  <Text style={[styles.selPrimaryText, selectedIds.length===0 && { opacity:0.5 }]}>Xem trước nhiều</Text>
                </Pressable>
              </View>
            </View>
          )}
        </SafeAreaView>
      </Modal>

      {showPicker.field && Platform.OS==='android' && (
        <DateTimePicker value={tempDate || new Date()} mode={showPicker.mode} is24Hour display='default' onChange={onNativeChange} />
      )}
      {showPicker.field && Platform.OS==='ios' && (
        <Modal transparent animationType='fade'>
          <View style={styles.pickerBackdrop}>
            <View style={styles.pickerModal}>
              <DateTimePicker value={tempDate || new Date()} mode={showPicker.mode} display='spinner' themeVariant='light' onChange={(e, d)=>{ if(d) setTempDate(d); }} {...(showPicker.mode==='time'? { minuteInterval:5 } : {})} />
              <View style={styles.pickerActions}>
                <Pressable onPress={()=>{ setShowPicker({mode:'date', field:null}); setTempDate(null); }} style={[styles.pickerActionBtn, styles.pickerCancel]}><Text style={styles.pickerActionText}>Hủy</Text></Pressable>
                <Pressable onPress={confirmIOS} style={[styles.pickerActionBtn, styles.pickerOk]}><Text style={[styles.pickerActionText,{color:'#fff'}]}>Chọn</Text></Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}
      {/* Scanning overlay */}
      {scanning && (
        <Modal transparent animationType='fade'>
          <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.35)', alignItems:'center', justifyContent:'center' }}>
            <View style={{ backgroundColor:'#fff', borderRadius:16, padding:20, alignItems:'center' }}>
              <ActivityIndicator size='large' color='#3a7ca5' />
              <Text style={{ marginTop:10, color:'#16425b', fontWeight:'600' }}>Đang xử lý…</Text>
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingTop:4, paddingBottom:8, backgroundColor:'#f1f5f9' },
  backBtn:{ width:40, height:40, borderRadius:20, alignItems:'center', justifyContent:'center' },
  headerTitle:{ fontSize:18, fontWeight:'600', color:'#16425b' },
  importBtn:{ flexDirection:'row', alignItems:'center', gap:4, paddingHorizontal:10, paddingVertical:6, borderRadius:20, backgroundColor:'#e2e8f0' },
  importText:{ fontSize:12, fontWeight:'600', color:'#16425b' },
  importHeader:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingTop:8, paddingBottom:12, backgroundColor:'#f1f5f9' },
  importTitle:{ fontSize:16, fontWeight:'700', color:'#16425b' },
  closeBtn:{ width:40, height:40, borderRadius:20, alignItems:'center', justifyContent:'center' },
  permBtn:{ backgroundColor:'#3a7ca5', paddingHorizontal:16, paddingVertical:12, borderRadius:12, alignSelf:'flex-start' },
  permBtnText:{ color:'#fff', fontWeight:'600' },
  infoBox:{ backgroundColor:'#f1f5f9', padding:12, borderRadius:12 },
  infoText:{ fontSize:13, color:'#475569', lineHeight:18 },
  retryBtn:{ marginTop:8, backgroundColor:'#e2e8f0', paddingHorizontal:12, paddingVertical:8, borderRadius:10, alignSelf:'flex-start' },
  retryText:{ color:'#16425b', fontWeight:'600', fontSize:12 },
  smallLabel:{ fontSize:12, color:'#64748b', fontWeight:'600' },
  refreshBtn:{ padding:8, borderRadius:12, backgroundColor:'#e2e8f0' },
  rangeBtn:{ backgroundColor:'#f1f5f9', paddingHorizontal:10, paddingVertical:6, borderRadius:10 },
  rangeText:{ fontSize:12, color:'#0f172a', fontWeight:'600' },
  eventRow:{ flexDirection:'row', alignItems:'center', paddingVertical:14, borderBottomWidth:1, borderColor:'#e2e8f0', gap:12 },
  eventTitle:{ fontSize:14, fontWeight:'600', color:'#0f172a', marginBottom:2 },
  eventMeta:{ fontSize:12, color:'#475569' },
  eventCalendar:{ fontSize:11, color:'#64748b', marginTop:2 },
  checkbox:{ width:18, height:18, borderRadius:4, borderWidth:1, borderColor:'#c7d2fe', backgroundColor:'#fff', alignItems:'center', justifyContent:'center' },
  checkboxOn:{ backgroundColor:'#4f46e5', borderColor:'#4f46e5' },
  quickImportBtn:{ padding:6, borderRadius:10 },
  sectionHeader:{ backgroundColor:'#f8fafc', paddingVertical:6, paddingHorizontal:12, borderRadius:10, marginBottom:4 },
  sectionHeaderText:{ fontSize:12, fontWeight:'700', color:'#334155' },
  badge:{ backgroundColor:'#e2e8f0', paddingHorizontal:8, paddingVertical:4, borderRadius:12 },
  badgeText:{ fontSize:10, fontWeight:'600', color:'#475569' },
  selectionBar:{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingHorizontal:16, paddingVertical:10, borderTopWidth:1, borderColor:'#e5e7eb' },
  selectionText:{ fontSize:12, color:'#475569', fontWeight:'600' },
  selBtn:{ paddingHorizontal:12, paddingVertical:8, borderRadius:10, alignItems:'center', justifyContent:'center' },
  selPrimary:{ backgroundColor:'#3a7ca5' },
  selPrimaryText:{ color:'#fff', fontWeight:'700', fontSize:12 },
  selSecondary:{ backgroundColor:'#e2e8f0' },
  selSecondaryText:{ color:'#16425b', fontWeight:'700', fontSize:12 },
  body:{ padding:16, paddingBottom:24 },
  card:{ backgroundColor:'#fff', borderRadius:20, padding:16, marginBottom:16, shadowColor:'#000', shadowOpacity:0.04, shadowRadius:6, elevation:2 },
  sectionTitle:{ fontSize:16, fontWeight:'600', color:'#16425b', marginBottom:12 },
  field:{ marginBottom:14 },
  sub:{ fontSize:12, color:'#16425b' },
  label:{ fontSize:13, fontWeight:'500', color:'#2f6690', marginBottom:6 },
  input:{ backgroundColor:'#f8fafc', borderWidth:1, borderColor:'#e2e8f0', borderRadius:14, paddingHorizontal:12, paddingVertical:12, fontSize:14, color:'#16425b' },
  textarea:{ minHeight:90, textAlignVertical:'top' },
  row:{ flexDirection:'row', justifyContent:'space-between', gap:12 },
  half:{ flex:1 },
  typeList:{ flexDirection:'row', flexWrap:'wrap' },
  typeChip:{ paddingHorizontal:12, paddingVertical:8, backgroundColor:'rgba(58,124,165,0.08)', borderRadius:20, marginRight:8, marginBottom:8 },
  typeChipActive:{ backgroundColor:'#3a7ca5' },
  typeChipText:{ color:'#2f6690', fontWeight:'600' },
  typeChipTextActive:{ color:'#fff' },
  summaryRow:{ flexDirection:'row', justifyContent:'space-between', marginBottom:6 },
  summaryLabel:{ fontSize:12, color:'#2f6690' },
  summaryValue:{ fontSize:12, color:'#16425b', fontWeight:'500' },
  bottomBar:{ position:'absolute', left:0, right:0, bottom:0, flexDirection:'row', padding:16, backgroundColor:'#ffffffee', gap:12, borderTopWidth:1, borderColor:'#e2e8f0' },
  bottomBtn:{ flex:1, height:52, borderRadius:16, alignItems:'center', justifyContent:'center' },
  cancelBtn:{ backgroundColor:'rgba(217,220,214,0.55)' },
  cancelText:{ color:'#2f6690', fontWeight:'600', fontSize:14 },
  saveBtn:{ backgroundColor:'#3a7ca5' },
  disabledBtn:{ backgroundColor:'#94a3b8' },
  saveText:{ color:'#fff', fontWeight:'600', fontSize:15 },
  pickerBtn:{ backgroundColor:'#f8fafc', borderWidth:1, borderColor:'#e2e8f0', borderRadius:14, paddingHorizontal:12, height:48, justifyContent:'center' },
  pickerBtnError:{ borderColor:'#e2e8f0' },
  pickerText:{ fontSize:14, color:'#16425b', fontWeight:'500' },
  pickerTextError:{ color:'#b91c1c' },
  pickerBackdrop:{ flex:1, backgroundColor:'rgba(0,0,0,0.35)', justifyContent:'flex-end' },
  pickerModal:{ backgroundColor:'#fff', borderTopLeftRadius:24, borderTopRightRadius:24, paddingTop:8, paddingBottom:20 },
  pickerActions:{ flexDirection:'row', justifyContent:'space-between', paddingHorizontal:16, marginTop:4 },
  pickerActionBtn:{ flex:1, height:44, borderRadius:14, alignItems:'center', justifyContent:'center', marginHorizontal:6 },
  pickerCancel:{ backgroundColor:'#e2e8f0' },
  pickerOk:{ backgroundColor:'#3a7ca5' },
  pickerActionText:{ fontSize:15, fontWeight:'600', color:'#16425b' },
  autoBtn:{ flexDirection:'row', alignItems:'center', paddingHorizontal:16, paddingVertical:10, backgroundColor:'#4f46e5', borderRadius:16, borderWidth:1, borderColor:'#a78bfa', shadowColor:'#000', shadowOpacity:0.12, shadowRadius:6, elevation:3 },
  autoBtnText:{ color:'#fff', fontWeight:'800', fontSize:13, letterSpacing:0.3 },
});
