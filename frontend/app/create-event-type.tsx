import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, Alert, Switch, Platform } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import axios from 'axios';
import { useAuth } from '@/contexts/AuthContext';

interface FieldItem { key: string; label: string; type: 'text'|'url'; required?: boolean; }

export default function CreateEventType(){
  const router = useRouter();
  const { token } = useAuth();
  const API_BASE = process.env.EXPO_PUBLIC_API_BASE;

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [isDefault, setIsDefault] = useState(false);
  const [fields, setFields] = useState<FieldItem[]>([{ key: 'diaDiem', label: 'Địa điểm', type: 'text' }]);
  const [saving, setSaving] = useState(false);

  const authHeader = () => ({ headers: { Authorization: token ? `Bearer ${token}` : '' } });

  // Helpers: slugify và gợi ý key
  const toSlug = (s: string) => s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  const toKeyFromLabel = (s: string) => {
    const cleaned = s
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .trim();
    if(!cleaned) return '';
    const parts = cleaned.split(/\s+/);
    const head = (parts[0]||'').toLowerCase();
    const tail = parts.slice(1).map(w => w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()).join('');
    return (head+tail).replace(/^[^a-zA-Z]+/, '');
  };
  useEffect(()=>{ if(!slugTouched) setSlug(toSlug(name)); }, [name]);

  const addField = () => setFields(prev => ([ ...prev, { key: '', label: '', type: 'text' } ]));
  const updateField = (index:number, patch: Partial<FieldItem>) => setFields(prev => prev.map((f,i)=> {
    if(i!==index) return f;
    const next = { ...f, ...patch } as FieldItem;
    if(patch.label !== undefined && (!f.key || f.key.trim()==='')){
      const autoKey = toKeyFromLabel(patch.label || '');
      if(autoKey) next.key = autoKey;
    }
    return next;
  }));
  const removeField = (index:number) => setFields(prev => prev.filter((_,i)=> i!==index));

  const save = async () => {
    if(!token){ Alert.alert('Lỗi','Chưa đăng nhập'); return; }
    if(!name.trim() || !slug.trim()) { Alert.alert('Thiếu thông tin','Vui lòng nhập Tên. Slug sẽ tự tạo (có thể chỉnh).'); return; }
    const cleanFields = fields
      .map(f=>({ ...f, key: f.key.trim(), label: f.label.trim(), type: f.type }))
      .filter(f => f.key && f.label);
    if(cleanFields.length === 0){ Alert.alert('Thiếu thông tin','Thêm ít nhất 1 thuộc tính'); return; }
    // Validate key: dạng camelCase/underscore, không trùng
    const keyRegex = /^[a-zA-Z][a-zA-Z0-9_]*$/;
    const dupMap: Record<string, number> = {};
    const invalidKeys = cleanFields.filter(f=> !keyRegex.test(f.key)).map(f=> f.key);
    cleanFields.forEach(f=> { dupMap[f.key] = (dupMap[f.key]||0)+1; });
    const dups = Object.keys(dupMap).filter(k=> dupMap[k]>1);
    if(invalidKeys.length){ Alert.alert('Lỗi','Key không hợp lệ: '+ invalidKeys.join(', ') + '\nChỉ dùng chữ/số và _, bắt đầu bằng chữ.'); return; }
    if(dups.length){ Alert.alert('Lỗi','Key bị trùng: '+ dups.join(', ')); return; }
    setSaving(true);
    try {
      await axios.post(`${API_BASE}/api/event-types`, { name: name.trim(), slug: slug.trim(), fields: cleanFields, isDefault }, authHeader());
      Alert.alert('Thành công','Đã tạo loại sự kiện');
      router.back();
    } catch(e:any){
      Alert.alert('Lỗi', e?.response?.data?.message || 'Không thể tạo loại sự kiện');
    } finally { setSaving(false); }
  };

  // Mẫu nhanh
  const applyTemplate = (tpl: 'MEETING'|'CLASS'|'GENERAL') => {
    const doApply = () => {
      if(tpl==='MEETING'){
        setName('Lịch họp nhóm'); setSlugTouched(false); setSlug(toSlug('Lịch họp nhóm'));
        setFields([
          { key:'diaDiem', label:'Địa điểm', type:'text' },
          { key:'linkMeet', label:'Link Google Meet', type:'url' },
          { key:'ghiChu', label:'Ghi chú', type:'text' },
        ]);
      } else if(tpl==='CLASS'){
        setName('Lịch học'); setSlugTouched(false); setSlug(toSlug('Lịch học'));
        setFields([
          { key:'giangVien', label:'Giảng viên', type:'text' },
          { key:'phongHoc', label:'Phòng học', type:'text' },
          { key:'linkZoom', label:'Link Zoom', type:'url' },
        ]);
      } else {
        setName('Sự kiện'); setSlugTouched(false); setSlug(toSlug('Sự kiện'));
        setFields([
          { key:'diaDiem', label:'Địa điểm', type:'text' },
          { key:'ghiChu', label:'Ghi chú', type:'text' },
        ]);
      }
    };
    if(name || slug || (fields && fields.some(f=> f.key || f.label))){
      Alert.alert('Áp dụng mẫu?','Nội dung đang nhập sẽ được thay thế bởi mẫu.',[
        { text:'Hủy', style:'cancel' },
        { text:'Đồng ý', style:'destructive', onPress: doApply }
      ]);
    } else doApply();
  };

  return (
    <SafeAreaView style={{ flex:1, backgroundColor:'#f1f5f9' }} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={()=>router.back()} style={styles.backBtn}><Text style={styles.backText}>{'<'} Quay lại</Text></Pressable>
        <Text style={styles.headerTitle}>Loại sự kiện mới</Text>
        <View style={{ width:40 }} />
      </View>
      <KeyboardAwareScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps='handled'
        enableOnAndroid
        extraScrollHeight={100}
      >
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Thông tin</Text>
          <View style={styles.field}><Text style={styles.label}>Tên *</Text><TextInput style={styles.input} value={name} onChangeText={setName} placeholder='VD: Lịch họp nhóm' /></View>
          <View style={styles.field}>
            <Text style={styles.label}>Slug</Text>
            <TextInput style={styles.input} value={slug} onChangeText={(t)=>{ setSlugTouched(true); setSlug(t); }} autoCapitalize='none' placeholder='vd: lich-hop-nhom' />
            <Text style={styles.hint}>Slug dùng cho hệ thống, tự sinh từ Tên (có thể chỉnh).</Text>
          </View>
          <View style={[styles.row,{ alignItems:'center' }]}>
            <View style={{ flex:1 }}>
              <Text style={styles.label}>Đặt làm mặc định</Text>
              <Text style={styles.hint}>Tự chọn loại này khi tạo sự kiện mới.</Text>
            </View>
            <Switch value={isDefault} onValueChange={setIsDefault} />
          </View>
        </View>
        <View style={styles.card}>
          <View style={{ marginBottom:8 }}>
            <Text style={styles.sectionTitle}>Thuộc tính hiển thị</Text>
            <View style={[styles.typeList, { marginTop:6 }]}>
              <Pressable onPress={()=>applyTemplate('MEETING')} style={styles.typeChip}><Text style={styles.typeChipText}>Mẫu họp</Text></Pressable>
              <Pressable onPress={()=>applyTemplate('CLASS')} style={styles.typeChip}><Text style={styles.typeChipText}>Mẫu học</Text></Pressable>
              <Pressable onPress={()=>applyTemplate('GENERAL')} style={styles.typeChip}><Text style={styles.typeChipText}>Mẫu chung</Text></Pressable>
            </View>
          </View>
          <Text style={styles.hint}>VD: "Địa điểm", "Link tham gia", "Ghi chú". Key sẽ được gợi ý từ Nhãn.</Text>
          {fields.map((f, i) => (
            <View key={i} style={styles.fieldGroup}>
              <View style={styles.row}>
                <View style={[styles.field, styles.half]}>
                  <Text style={styles.label}>Nhãn *</Text>
                  <TextInput style={styles.input} value={f.label} onChangeText={(t)=>updateField(i,{ label:t })} placeholder='vd: Địa điểm' />
                </View>
                <View style={[styles.field, styles.half]}>
                  <Text style={styles.label}>Key *</Text>
                  <TextInput style={styles.input} value={f.key} onChangeText={(t)=>updateField(i,{ key:t })} autoCapitalize='none' placeholder='vd: diaDiem' />
                  <Text style={styles.hint}>Tạo tự động từ Nhãn, có thể chỉnh (a-z, A-Z, 0-9, _)</Text>
                </View>
              </View>
              <View style={[styles.row, { alignItems:'flex-start' }]}>
                <View style={[styles.field, styles.half]}>
                  <Text style={styles.label}>Loại dữ liệu</Text>
                  <View style={[styles.typeList, { width:'100%' }]}>
                    {(['text','url'] as const).map(tp => {
                      const active = f.type === tp;
                      return (
                        <Pressable key={tp} onPress={()=>updateField(i,{ type: tp })} style={[styles.typeChip, active && styles.typeChipActive]}>
                          <Text style={[styles.typeChipText, active && styles.typeChipTextActive]}>{tp==='text'?'Văn bản':'Liên kết'}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
                <View style={[styles.field, styles.half]}>
                  <Text style={styles.label}>Bắt buộc</Text>
                  <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', backgroundColor:'#fff', borderWidth:1, borderColor:'#e2e8f0', borderRadius:12, paddingHorizontal:12, paddingVertical:10 }}>
                    <Text style={{ color:'#16425b' }}>{f.required? 'Có':'Không'}</Text>
                    <Switch value={!!f.required} onValueChange={(v)=>updateField(i,{ required: v })} />
                  </View>
                </View>
              </View>
              <Pressable onPress={()=>removeField(i)} style={styles.removeBtn}><Text style={styles.removeText}>Xóa</Text></Pressable>
            </View>
          ))}
          <Pressable onPress={addField} style={styles.addBtn}><Text style={styles.addText}>+ Thêm field</Text></Pressable>
        </View>
        <View style={{ height: 16 }} />
  </KeyboardAwareScrollView>
      <View style={styles.bottomBar}>
        <Pressable style={[styles.bottomBtn, styles.cancelBtn]} onPress={()=>router.back()}><Text style={styles.cancelText}>Hủy</Text></Pressable>
        <Pressable style={[styles.bottomBtn, (!name.trim()||!slug.trim()||saving) ? styles.disabledBtn: styles.saveBtn]} disabled={!name.trim()||!slug.trim()||saving} onPress={save}><Text style={styles.saveText}>{saving? 'Đang lưu...':'Tạo loại'}</Text></Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingTop:4, paddingBottom:8, backgroundColor:'#f1f5f9' },
  backBtn:{ paddingVertical:10 },
  backText:{ color:'#16425b', fontWeight:'600' },
  headerTitle:{ fontSize:18, fontWeight:'600', color:'#16425b' },
  body:{ padding:16, paddingBottom:24 },
  card:{ backgroundColor:'#fff', borderRadius:20, padding:16, marginBottom:16, shadowColor:'#000', shadowOpacity:0.04, shadowRadius:6, elevation:2 },
  sectionTitle:{ fontSize:16, fontWeight:'600', color:'#16425b', marginBottom:12 },
  field:{ marginBottom:14 },
  fieldGroup:{ padding:12, borderWidth:1, borderColor:'#e2e8f0', borderRadius:14, marginBottom:12, backgroundColor:'#f8fafc' },
  label:{ fontSize:13, fontWeight:'500', color:'#2f6690', marginBottom:6 },
  hint:{ fontSize:11, color:'#607d8b', marginTop:4 },
  input:{ backgroundColor:'#fff', borderWidth:1, borderColor:'#e2e8f0', borderRadius:12, paddingHorizontal:12, paddingVertical:10, fontSize:14, color:'#16425b' },
  row:{ flexDirection:'row', justifyContent:'space-between', gap:12 },
  half:{ flex:1 },
  typeList:{ flexDirection:'row', flexWrap:'wrap', gap:8 },
  typeChip:{ paddingHorizontal:12, paddingVertical:6, backgroundColor:'rgba(58,124,165,0.08)', borderRadius:20 },
  typeChipActive:{ backgroundColor:'#3a7ca5' },
  typeChipText:{ color:'#2f6690', fontWeight:'600' },
  typeChipTextActive:{ color:'#fff' },
  addBtn:{ backgroundColor:'#3a7ca5', paddingVertical:12, borderRadius:12, alignItems:'center' },
  addText:{ color:'#fff', fontWeight:'600' },
  removeBtn:{ backgroundColor:'#fee2e2', paddingVertical:10, borderRadius:10, alignItems:'center', marginTop:8 },
  removeText:{ color:'#b91c1c', fontWeight:'700' },
  bottomBar:{ position:'absolute', left:0, right:0, bottom:0, flexDirection:'row', padding:16, backgroundColor:'#ffffffee', gap:12, borderTopWidth:1, borderColor:'#e2e8f0' },
  bottomBtn:{ flex:1, height:52, borderRadius:16, alignItems:'center', justifyContent:'center' },
  cancelBtn:{ backgroundColor:'rgba(217,220,214,0.55)' },
  cancelText:{ color:'#2f6690', fontWeight:'600', fontSize:14 },
  saveBtn:{ backgroundColor:'#3a7ca5' },
  disabledBtn:{ backgroundColor:'#94a3b8' },
  saveText:{ color:'#fff', fontWeight:'600', fontSize:15 },
});
