import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import axios from 'axios';
import { useRouter } from 'expo-router';

export default function ForgotPasswordScreen(){
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const BASE = process.env.EXPO_PUBLIC_API_BASE;
  const API_AUTH = BASE ? `${BASE}/api/auth` : undefined;

  const sendOtp = async () => {
    setError(null); setMessage(null);
    if(!email){ setError('Vui lòng nhập email'); return; }
    setSending(true);
    try{
      if(!API_AUTH) throw new Error('Chưa cấu hình EXPO_PUBLIC_API_BASE');
      await axios.post(`${API_AUTH}/request-password-reset`, { email });
      setMessage('OTP đã được gửi tới email của bạn (hiệu lực 10 phút).');
    }catch(e: any){
      setError(e.response?.data?.message || e.message || 'Gửi OTP thất bại');
    }finally{ setSending(false); }
  };

  const verifyOtp = async () => {
    setError(null);
    if(!email || !otp){ setError('Vui lòng nhập email và mã OTP'); return; }
    setVerifying(true);
    try{
      if(!API_AUTH) throw new Error('Chưa cấu hình EXPO_PUBLIC_API_BASE');
      const res = await axios.post(`${API_AUTH}/verify-reset-otp`, { email, otp });
      const resetToken = res.data?.resetToken;
      if(!resetToken) throw new Error('Không nhận được resetToken');
      // Chuyển sang màn resetPassword, truyền token
      router.push({ pathname: '/auth/reset-password', params: { token: resetToken } } as any);
    }catch(e: any){
      setError(e.response?.data?.message || e.message || 'Xác thực OTP thất bại');
    }finally{ setVerifying(false); }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={insets.top}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets showsVerticalScrollIndicator={false}>
      <View style={styles.card}>
        <Text style={styles.title}>Quên mật khẩu</Text>
  <Text style={styles.desc}>Nhập email đã đăng ký để nhận mã OTP đặt lại mật khẩu, sau đó nhập OTP để tiếp tục.</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="student@gmail.com"
          autoCapitalize="none"
          keyboardType="email-address"
          style={styles.input}
        />
        {error && <Text style={styles.error}>{error}</Text>}
        {message && <Text style={styles.message}>{message}</Text>}
        <Pressable style={styles.button} onPress={sendOtp} disabled={sending}>
          {sending ? <ActivityIndicator color="#fff"/> : <Text style={styles.buttonText}>Gửi OTP</Text>}
        </Pressable>

        <TextInput
          value={otp}
          onChangeText={setOtp}
          placeholder="Nhập mã OTP 6 số"
          keyboardType="number-pad"
          maxLength={6}
          style={styles.input}
        />
        <Pressable style={styles.secondaryButton} onPress={verifyOtp} disabled={verifying}>
          {verifying ? <ActivityIndicator color="#111"/> : <Text style={styles.secondaryButtonText}>Xác thực OTP</Text>}
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
  secondaryButton: { backgroundColor: '#e5e7eb', height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  secondaryButtonText: { color: '#111827', fontSize: 14, fontWeight: '600' },
  linkBtn: { marginTop: 10, alignItems: 'center' },
  linkText: { color: '#2563eb', fontWeight: '600' },
  error: { color: '#dc2626', marginTop: 8 },
  message: { color: '#16a34a', marginTop: 8 }
});
