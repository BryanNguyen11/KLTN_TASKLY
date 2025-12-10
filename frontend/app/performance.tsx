import React from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, Platform } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import api from '../api';

type Mode = 'month' | 'year' | 'custom';

function toISO(d: Date){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

export default function PerformanceScreen(){
  const [mode, setMode] = React.useState<Mode>('month');
  const [from, setFrom] = React.useState<string | null>(null);
  const [to, setTo] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [data, setData] = React.useState<any | null>(null);

  const pickDate = (which: 'from'|'to') => {
    const cur = new Date();
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        mode: 'date',
        value: cur,
        onChange: (_, date) => {
          if (!date) return;
          const iso = toISO(date);
          if (which === 'from') setFrom(iso); else setTo(iso);
        }
      });
    } else {
      // For iOS/web, fallback simple prompt for now
      const input = prompt(`Chọn ${which === 'from' ? 'Từ ngày' : 'Đến ngày'} (YYYY-MM-DD)`);
      if (input) {
        if (which === 'from') setFrom(input); else setTo(input);
      }
    }
  };

  const load = React.useCallback(async ()=>{
    setLoading(true); setError(null);
    try {
      const params: any = { mode };
      if (mode === 'custom') { if (from) params.from = from; if (to) params.to = to; }
      const r = await api.get('/api/users/me/stats', { params });
      setData(r.data);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Lỗi tải dữ liệu');
    } finally { setLoading(false); }
  }, [mode, from, to]);

  React.useEffect(()=>{ load(); }, [load]);

  // UI helpers
  const ModeChip = ({ k, label }: { k: Mode; label: string }) => (
    <Pressable onPress={()=> setMode(k)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: mode===k? '#2563eb':'#e5e7eb', backgroundColor: mode===k? '#eff6ff':'#fff', marginRight: 8 }}>
      <Text style={{ color: '#16425b', fontSize: 12, fontWeight: mode===k? '700' : '500' }}>{label}</Text>
    </Pressable>
  );

  const Summary = () => (
    <View style={{ padding: 12, borderWidth: 1, borderColor:'#e5e7eb', borderRadius: 12, backgroundColor:'#fff' }}>
      <Text style={{ fontSize: 14, fontWeight:'700', color:'#16425b', marginBottom: 8 }}>Tổng quan hiệu suất</Text>
      {data ? (
        <View style={{ gap: 4 }}>
          <Text style={{ color:'#16425b' }}>Tổng hoàn thành: {data.totalCompleted}</Text>
          <Text style={{ color:'#16425b' }}>Đúng hạn: {data.onTime}</Text>
          <Text style={{ color:'#16425b' }}>Trễ hạn: {data.late}</Text>
          <Text style={{ color:'#16425b' }}>Tỷ lệ đúng hạn: {Math.round((data.onTimeRate||0)*100)}%</Text>
          <Text style={{ color:'#607d8b' }}>Đánh giá: {data.evaluation}</Text>
        </View>
      ) : null}
    </View>
  );

  const Breakdown = () => {
    const items: Array<any> = data?.breakdown || [];
    if (!items.length) return <Text style={{ color:'#607d8b' }}>Chưa có dữ liệu thống kê theo kỳ</Text>;
    return (
      <View style={{ padding: 12, borderWidth: 1, borderColor:'#e5e7eb', borderRadius: 12, backgroundColor:'#fff' }}>
        <Text style={{ fontSize: 14, fontWeight:'700', color:'#16425b', marginBottom: 8 }}>Thống kê theo kỳ</Text>
        {items.map((it, idx)=> (
          <View key={idx} style={{ flexDirection:'row', justifyContent:'space-between', paddingVertical: 6, borderBottomWidth: idx===items.length-1? 0: 1, borderColor:'#f1f5f9' }}>
            <Text style={{ color:'#16425b' }}>{it.period}</Text>
            <Text style={{ color:'#16425b' }}>Tổng: {it.total} | Đúng hạn: {it.onTime} | Trễ: {it.late} | Tỷ lệ: {Math.round((it.onTimeRate||0)*100)}%</Text>
          </View>
        ))}
      </View>
    );
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Text style={{ fontSize: 16, fontWeight:'700', color:'#16425b', marginBottom: 8 }}>Hiệu suất</Text>
      <View style={{ flexDirection:'row', marginBottom: 10 }}>
        <ModeChip k="month" label="Tháng" />
        <ModeChip k="year" label="Năm" />
        <ModeChip k="custom" label="Tùy chọn" />
      </View>
      {mode === 'custom' && (
        <View style={{ flexDirection:'row', gap: 12, alignItems:'center', marginBottom: 8 }}>
          <Pressable onPress={()=> pickDate('from')} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor:'#e5e7eb' }}>
            <Text style={{ color:'#16425b' }}>{from ? `Từ: ${from}` : 'Chọn Từ ngày'}</Text>
          </Pressable>
          <Pressable onPress={()=> pickDate('to')} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor:'#e5e7eb' }}>
            <Text style={{ color:'#16425b' }}>{to ? `Đến: ${to}` : 'Chọn Đến ngày'}</Text>
          </Pressable>
          <Pressable onPress={load} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor:'#2563eb' }}>
            <Text style={{ color:'#fff' }}>Áp dụng</Text>
          </Pressable>
        </View>
      )}
      {loading && (<View style={{ paddingVertical: 12 }}><ActivityIndicator /></View>)}
      {error && (<Text style={{ color:'#b91c1c' }}>{error}</Text>)}
      {!loading && !error && (<>
        <Summary />
        <View style={{ height: 8 }} />
        <Breakdown />
      </>)}
    </ScrollView>
  );
}
