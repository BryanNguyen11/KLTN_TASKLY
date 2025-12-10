import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import axios from 'axios';
import { useRouter, useLocalSearchParams } from 'expo-router';

export default function ResetPasswordScreen(){
  const params = useLocalSearchParams<{ token?: string }>();
  const resetToken = typeof params.token === 'string' ? params.token : '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const BASE = process.env.EXPO_PUBLIC_API_BASE;
  const API_AUTH = BASE ? `${BASE}/api/auth` : undefined;

  const onSubmit = async () => {
    setError(null); setMessage(null);
    if(!resetToken){ setError('Thiếu token đặt lại mật khẩu. Vui lòng quay lại bước xác thực OTP.'); return; }
    if(!password || !confirm){ setError('Vui lòng nhập mật khẩu mới và xác nhận'); return; }
    if(password.length < 8){ setError('Mật khẩu tối thiểu 8 ký tự'); return; }
    if(password !== confirm){ setError('Mật khẩu nhập lại không khớp'); return; }
    setLoading(true);
    try{
      if(!API_AUTH) throw new Error('Chưa cấu hình EXPO_PUBLIC_API_BASE');
      await axios.post(`${API_AUTH}/reset-password`, { token: resetToken, password });
  setMessage('Đặt lại mật khẩu thành công. Đang chuyển về đăng nhập...');
  router.replace('/auth/login' as any);
    }catch(e: any){
      setError(e.response?.data?.message || e.message || 'Đặt lại mật khẩu thất bại');
    }finally{ setLoading(false); }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={insets.top}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets showsVerticalScrollIndicator={false}>
      <View style={styles.card}>
        <Text style={styles.title}>Đặt lại mật khẩu</Text>
        <Text style={styles.desc}>Nhập mật khẩu mới và xác nhận. Token đã được xác thực từ bước OTP.</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Mật khẩu mới"
          secureTextEntry
          style={styles.input}
        />
        <TextInput
          value={confirm}
          onChangeText={setConfirm}
          placeholder="Nhập lại mật khẩu mới"
          secureTextEntry
          style={styles.input}
        />
        {error && <Text style={styles.error}>{error}</Text>}
        {message && <Text style={styles.message}>{message}</Text>}
        <Pressable style={styles.button} onPress={onSubmit} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff"/> : <Text style={styles.buttonText}>Đặt lại</Text>}
        </Pressable>
        <Pressable style={styles.linkBtn} onPress={() => router.push('/auth/login')}>
          <Text style={styles.linkText}>Quay lại đăng nhập</Text>
        </Pressable>
      </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f1f5f9' },
  scroll: { flexGrow: 1, padding: 20, justifyContent: 'center' },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 20 },
  title: { fontSize: 20, fontWeight: '700', color: '#111827' },
  desc: { fontSize: 13, color: '#4b5563', marginTop: 6 },
  input: { marginTop: 12, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, paddingHorizontal: 12, height: 48 },
  button: { backgroundColor: '#2563eb', height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  linkBtn: { marginTop: 10, alignItems: 'center' },
  linkText: { color: '#2563eb', fontWeight: '600' },
  error: { color: '#dc2626', marginTop: 8 },
  message: { color: '#16a34a', marginTop: 8 }
});
