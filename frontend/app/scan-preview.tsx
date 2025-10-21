import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, TextInput, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import axios from 'axios';
import { useAuth } from '@/contexts/AuthContext';
import { getOcrScanPayload, setOcrScanPayload } from '@/contexts/OcrScanStore';
import { parseWeeklyFromRaw, WeekdayBlock, CandidateEvent } from '@/utils/ocrTimetable';

type Editable = CandidateEvent & { id: string; selected: boolean };

export default function ScanPreview() {
  const router = useRouter();
  const { token } = useAuth();
  const API_BASE = process.env.EXPO_PUBLIC_API_BASE;
  const payload = getOcrScanPayload();
  const [days, setDays] = useState<WeekdayBlock[]>([]);
  const [edit, setEdit] = useState<Editable | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    if (!payload?.raw) {
      Alert.alert('Thiếu dữ liệu', 'Không có dữ liệu quét. Vui lòng quét lại.');
      router.back();
      return;
    }
    const parsed = parseWeeklyFromRaw(payload.raw);
    const withIds = parsed.map(d => ({
      ...d,
      events: d.events.map((e, idx) => ({ ...e, id: `${d.date || d.weekday}-${idx}`, selected: true })) as any,
    }));
    setDays(withIds as any);
  }, []);

  const allSelected = useMemo(() => days.length>0 && days.every(d => (d.events as any).every((e: any) => e.selected)), [days]);
  const totalEvents = useMemo(() => days.reduce((acc,d)=> acc + (d.events as any).length, 0), [days]);

  const toggleAll = (sel: boolean) => {
    setDays(prev => prev.map(d => ({ ...d, events: (d.events as any).map((e: any) => ({ ...e, selected: sel })) })) as any);
  };

  const createAll = async () => {
    if (!token) { Alert.alert('Lỗi','Chưa đăng nhập'); return; }
    const selected: Editable[] = days.flatMap(d => (d.events as any).filter((e: any) => e.selected));
    if (!selected.length) { Alert.alert('Chưa chọn', 'Vui lòng chọn ít nhất một lịch'); return; }
    try {
      // Ensure we have a typeId; if missing, fetch types and pick first
      let typeId = payload?.defaultTypeId || '';
      if(!typeId){
        try { const res = await axios.get(`${API_BASE}/api/event-types`, { headers: { Authorization: token ? `Bearer ${token}` : '' } }); typeId = (res.data?.find?.((t:any)=>t.isDefault)?._id) || (res.data?.[0]?._id) || ''; } catch {}
        if(!typeId){ Alert.alert('Thiếu loại lịch','Không có loại lịch mặc định để tạo. Hãy tạo loại lịch trước.'); return; }
      }
          for (const e of selected) {
        const date = e.date || deriveDateFromWeekday(days, e);
        const payloadEvt: any = {
          title: e.title || 'Lịch học',
          typeId,
          date,
          startTime: e.startTime,
          endTime: e.endTime,
          location: e.location,
          notes: [e.notes, e.lecturer ? `GV: ${e.lecturer}` : ''].filter(Boolean).join('\n'),
          props: {},
        };
            if(payload?.projectId) payloadEvt.projectId = String(payload.projectId);
        await axios.post(`${API_BASE}/api/events`, payloadEvt, { headers: { Authorization: token ? `Bearer ${token}` : '' } });
      }
      Alert.alert('Thành công','Đã tạo các lịch từ ảnh');
      setOcrScanPayload(null);
      router.back();
    } catch (e: any) {
      Alert.alert('Lỗi', e?.response?.data?.message || 'Không thể tạo lịch');
    }
  };

  const onEditSave = (updated: Editable) => {
    setDays(prev => prev.map(d => ({ ...d, events: (d.events as any).map((ev: any) => ev.id === updated.id ? updated : ev) })) as any);
    setEdit(null);
  };

  return (
    <SafeAreaView style={{ flex:1, backgroundColor: '#f1f5f9' }}>
      <View style={styles.header}>
        <Pressable onPress={()=>router.back()} style={styles.backBtn}><Text style={styles.backText}>{'‹'}</Text></Pressable>
        <Text style={styles.headerTitle}>Xem trước lịch tuần</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.actions}>
        <View style={{ flex: 1 }}>
          <Text style={{ color:'#16425b', fontWeight:'700' }}>Nhận dạng: {totalEvents} lịch</Text>
          <Pressable onPress={()=> setShowRaw(true)}><Text style={{ color:'#3a7ca5', fontWeight:'700', marginTop:4 }}>Xem văn bản OCR</Text></Pressable>
        </View>
        <Pressable style={[styles.actionBtn, allSelected? styles.secondary: styles.primary]} onPress={()=>toggleAll(!allSelected)}>
          <Text style={allSelected? styles.secondaryText: styles.primaryText}>{allSelected? 'Bỏ chọn tất cả' : 'Chọn tất cả'}</Text>
        </Pressable>
        <Pressable style={[styles.actionBtn, styles.primary]} onPress={createAll}>
          <Text style={styles.primaryText}>Xác nhận tạo</Text>
        </Pressable>
      </View>

      <ScrollView horizontal style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 12 }} showsHorizontalScrollIndicator={false}>
        {days.length === 0 && (
          <View style={{ padding: 16 }}>
            <Text style={{ color:'#16425b', fontWeight:'700', marginBottom:6 }}>Chưa nhận dạng được lịch tuần</Text>
            <Text style={{ color:'#334155' }}>• Hãy thử chọn ảnh rõ nét hơn, hoặc ảnh gốc từ cổng thông tin.</Text>
            <Text style={{ color:'#334155' }}>• Đảm bảo ảnh có tiêu đề cột ngày: "Thứ X DD/MM/YYYY" hoặc "Chủ nhật DD/MM/YYYY".</Text>
          </View>
        )}
        {days.map(day => (
          <View key={day.date || day.weekday} style={styles.dayColumn}>
            <Text style={styles.dayHeader}>{day.label}{day.date? `\n${toDisplay(day.date)}`:''}</Text>
            {(['morning','afternoon','evening'] as const).map(slot => (
              <View key={slot} style={styles.slotBlock}>
                <Text style={styles.slotLabel}>{slot==='morning'?'Sáng':slot==='afternoon'?'Chiều':'Tối'}</Text>
                {(day.events as any).filter((e: Editable)=> e.slot===slot).map((e: Editable)=> (
                  <Pressable key={e.id} onPress={()=> setEdit(e)} style={[styles.card, !e.selected && { opacity: 0.5 }]}>
                    <View style={{ flexDirection:'row', justifyContent:'space-between' }}>
                      <Text style={styles.cardTitle} numberOfLines={2} ellipsizeMode='tail'>{e.title}</Text>
                      <Pressable onPress={()=> setDays(prev => prev.map(d => ({ ...d, events: (d.events as any).map((ev: any) => ev.id===e.id? { ...ev, selected: !ev.selected }: ev) })) as any)}>
                        <Text style={[styles.toggle, e.selected? styles.toggleOn: styles.toggleOff]}>{e.selected? '✓' : '✗'}</Text>
                      </Pressable>
                    </View>
                    <Text style={styles.cardTime}>{e.startTime}–{e.endTime}</Text>
                    {!!e.location && <Text style={styles.cardSub}>Phòng: {e.location}</Text>}
                    {!!e.lecturer && <Text style={styles.cardSub}>GV: {e.lecturer}</Text>}
                    {!!e.notes && <Text style={styles.cardNote} numberOfLines={2} ellipsizeMode='tail'>{e.notes}</Text>}
                  </Pressable>
                ))}
              </View>
            ))}
          </View>
        ))}
      </ScrollView>

      {/* Edit Modal */}
      <Modal visible={!!edit} transparent animationType='fade' onRequestClose={()=> setEdit(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Chỉnh sửa</Text>
            <Text style={styles.modalLabel}>Tiêu đề</Text>
            <TextInput style={styles.input} value={edit?.title||''} onChangeText={t=> setEdit(prev => prev? { ...prev, title: t }: prev)} />
            <View style={{ flexDirection:'row', gap:8 }}>
              <View style={{ flex:1 }}>
                <Text style={styles.modalLabel}>Bắt đầu</Text>
                <TextInput style={styles.input} value={edit?.startTime||''} onChangeText={t=> setEdit(prev => prev? { ...prev, startTime: t }: prev)} placeholder='HH:MM' />
              </View>
              <View style={{ flex:1 }}>
                <Text style={styles.modalLabel}>Kết thúc</Text>
                <TextInput style={styles.input} value={edit?.endTime||''} onChangeText={t=> setEdit(prev => prev? { ...prev, endTime: t }: prev)} placeholder='HH:MM' />
              </View>
            </View>
            <Text style={styles.modalLabel}>Phòng</Text>
            <TextInput style={styles.input} value={edit?.location||''} onChangeText={t=> setEdit(prev => prev? { ...prev, location: t }: prev)} />
            <Text style={styles.modalLabel}>Ghi chú</Text>
            <TextInput style={[styles.input, styles.textarea]} multiline value={edit?.notes||''} onChangeText={t=> setEdit(prev => prev? { ...prev, notes: t }: prev)} />
            <View style={{ flexDirection:'row', gap:10, marginTop:10 }}>
              <Pressable onPress={()=> setEdit(null)} style={[styles.actionBtn, styles.secondary, { flex:1 }]}><Text style={styles.secondaryText}>Hủy</Text></Pressable>
              <Pressable onPress={()=> edit && onEditSave(edit)} style={[styles.actionBtn, styles.primary, { flex:1 }]}><Text style={styles.primaryText}>Lưu</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Raw OCR Modal */}
      <Modal visible={showRaw} transparent animationType='fade' onRequestClose={()=> setShowRaw(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { maxHeight: '80%' }]}>
            <Text style={styles.modalTitle}>Văn bản OCR</Text>
            <ScrollView style={{ maxHeight: '70%' }}>
              <Text style={{ color:'#0f172a' }}>{payload?.raw || ''}</Text>
            </ScrollView>
            <View style={{ flexDirection:'row', gap:10, marginTop:10 }}>
              <Pressable onPress={()=> setShowRaw(false)} style={[styles.actionBtn, styles.secondary, { flex:1 }]}><Text style={styles.secondaryText}>Đóng</Text></Pressable>
              <Pressable onPress={()=> { setShowRaw(false); router.back(); }} style={[styles.actionBtn, styles.primary, { flex:1 }]}><Text style={styles.primaryText}>Quét lại</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function toDisplay(iso: string) {
  const [y,m,d] = iso.split('-').map(x=>parseInt(x,10));
  return `${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`;
}

function deriveDateFromWeekday(days: WeekdayBlock[], e: CandidateEvent): string {
  const d = days.find(dd => dd.events.includes(e as any));
  if (d?.date) return d.date;
  // fallback: today
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}

const styles = StyleSheet.create({
  header:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingTop:8, paddingBottom:8, backgroundColor:'#f1f5f9' },
  backBtn:{ width:40, height:40, borderRadius:20, alignItems:'center', justifyContent:'center' },
  backText:{ fontSize:22, color:'#16425b' },
  headerTitle:{ fontSize:18, fontWeight:'600', color:'#16425b' },
  actions:{ flexDirection:'row', gap:10, paddingHorizontal:12, paddingBottom:8 },
  actionBtn:{ paddingHorizontal:14, paddingVertical:10, borderRadius:12, alignItems:'center', justifyContent:'center' },
  primary:{ backgroundColor:'#3a7ca5' },
  primaryText:{ color:'#fff', fontWeight:'700' },
  secondary:{ backgroundColor:'#e2e8f0' },
  secondaryText:{ color:'#16425b', fontWeight:'700' },
  dayColumn:{ width: 200, backgroundColor:'#fff', borderRadius:14, padding:8, marginRight:8 },
  dayHeader:{ textAlign:'center', fontWeight:'700', color:'#16425b', marginBottom:6, fontSize:12 },
  slotBlock:{ marginBottom:10 },
  slotLabel:{ fontSize:11, color:'#2f6690', marginBottom:4 },
  card:{ borderWidth:1, borderColor:'#e2e8f0', backgroundColor:'#f8fafc', borderRadius:10, padding:8, marginBottom:6 },
  cardTitle:{ fontWeight:'700', color:'#16425b', flex:1, marginRight:8, fontSize:13 },
  toggle:{ width:20, textAlign:'right', fontWeight:'900' },
  toggleOn:{ color:'#16a34a' },
  toggleOff:{ color:'#b91c1c' },
  cardTime:{ color:'#0f766e', fontWeight:'700', marginTop:2, fontSize:12 },
  cardSub:{ color:'#334155', fontSize:11 },
  cardNote:{ color:'#64748b', fontSize:11, marginTop:2 },
  modalBackdrop:{ flex:1, backgroundColor:'rgba(0,0,0,0.35)', alignItems:'center', justifyContent:'center' },
  modalCard:{ width:'90%', backgroundColor:'#fff', borderRadius:16, padding:14 },
  modalTitle:{ fontSize:16, fontWeight:'700', color:'#16425b', marginBottom:8 },
  modalLabel:{ fontSize:12, color:'#2f6690', marginTop:8, marginBottom:4 },
  input:{ backgroundColor:'#f8fafc', borderWidth:1, borderColor:'#e2e8f0', borderRadius:12, paddingHorizontal:10, paddingVertical:10, color:'#0f172a' },
  textarea:{ minHeight:80, textAlignVertical:'top' },
});
