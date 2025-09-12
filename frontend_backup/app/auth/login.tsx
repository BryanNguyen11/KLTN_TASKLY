import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { useRouter, Link } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { Ionicons } from '@expo/vector-icons';

// Màu placeholder rõ hơn (trước có thể quá nhạt trên nền sáng)
const PLACEHOLDER_COLOR = '#64748b'; // slate-500

export default function LoginScreen() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    if (!email || !password) {
      setError('Vui lòng nhập đầy đủ thông tin');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
    } catch (e: any) {
      setError(e.message || 'Đăng nhập thất bại');
    } finally {
      setLoading(false);
    }
  };

  const handleDemo = async () => {
    setLoading(true);
    setError(null);
    try {
      await login('demo@student.edu', '123456');
    } catch (e: any) {
      setError(e.message || 'Demo login lỗi');
    } finally { setLoading(false); }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.card}>        
        <View style={styles.logoWrapper}>
          <View style={styles.logoCircle}>
            <Ionicons name="school" size={42} color="#fff" />
          </View>
          <Text style={styles.brand}>Taskly</Text>
          <Text style={styles.subtitle}>Quản lý thời gian & công việc cho sinh viên</Text>
        </View>

        <View style={styles.field}>          
          <Text style={styles.label}>Email</Text>
          <View style={styles.inputWrapper}>
            <Ionicons name="mail" size={18} color="#666" style={styles.inputIcon} />
            <TextInput
              placeholder="student@example.com"
              placeholderTextColor={PLACEHOLDER_COLOR}
              keyboardType="email-address"
              autoCapitalize="none"
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              returnKeyType="next"
            />
          </View>
        </View>

        <View style={styles.field}>          
          <Text style={styles.label}>Mật khẩu</Text>
          <View style={styles.inputWrapper}>
            <Ionicons name="lock-closed" size={18} color="#666" style={styles.inputIcon} />
            <TextInput
              placeholder="••••••••"
              placeholderTextColor={PLACEHOLDER_COLOR}
              secureTextEntry
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              returnKeyType="done"
              onSubmitEditing={handleLogin}
            />
          </View>
        </View>

        <View style={styles.infoBox}>
          <Ionicons name="school" size={22} color="#2563eb" />
          <View style={{ flex: 1 }}>
            <Text style={styles.infoTitle}>Tài khoản Sinh viên</Text>
            <Text style={styles.infoDesc}>Quản lý tác vụ và lịch học cá nhân</Text>
          </View>
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]} onPress={handleLogin} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Đăng nhập</Text>}
        </Pressable>

        <View style={styles.dividerRow}>
          <View style={styles.divider} />
          <Text style={styles.dividerLabel}>Hoặc</Text>
          <View style={styles.divider} />
        </View>

        <Pressable style={({ pressed }) => [styles.outlineBtn, pressed && styles.outlineBtnPressed]} onPress={handleDemo} disabled={loading}>
          <Ionicons name="play" size={18} color="#2563eb" />
          <Text style={styles.outlineBtnText}>Thử demo</Text>
        </Pressable>

        <Text style={styles.footerText}>Chưa có tài khoản? <Text style={styles.link} onPress={() => router.push('/auth/register')}>Đăng ký ngay</Text></Text>
        <Text style={styles.policy}>Bằng cách đăng nhập, bạn đồng ý với điều khoản sử dụng và chính sách bảo mật</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f1f5f9', padding: 20, justifyContent: 'center' },
  card: { backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 24, padding: 24, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  logoWrapper: { alignItems: 'center', marginBottom: 24 },
  logoCircle: { width: 90, height: 90, borderRadius: 28, backgroundColor: '#2563eb', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  brand: { fontSize: 30, fontWeight: '600', color: '#111827' },
  subtitle: { fontSize: 13, color: '#4b5563', textAlign: 'center' },
  field: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '500', marginBottom: 6, color: '#111827' },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 12 },
  inputIcon: { marginRight: 6 },
  input: { flex: 1, height: 48, fontSize: 16 },
  infoBox: { flexDirection: 'row', gap: 12, backgroundColor: '#eff6ff', padding: 14, borderRadius: 16, alignItems: 'center', marginBottom: 4 },
  infoTitle: { fontSize: 14, fontWeight: '600', color: '#1e3a8a' },
  infoDesc: { fontSize: 12, color: '#1e40af' },
  button: { backgroundColor: '#2563eb', height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  buttonPressed: { opacity: 0.85 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 16 },
  divider: { flex: 1, height: 1, backgroundColor: '#e2e8f0' },
  dividerLabel: { marginHorizontal: 12, fontSize: 12, color: '#6b7280', textTransform: 'uppercase' },
  outlineBtn: { flexDirection: 'row', height: 48, borderRadius: 16, borderWidth: 1, borderColor: '#2563eb', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#fff' },
  outlineBtnPressed: { backgroundColor: '#f0f9ff' },
  outlineBtnText: { color: '#2563eb', fontSize: 15, fontWeight: '500' },
  footerText: { textAlign: 'center', marginTop: 18, fontSize: 13, color: '#374151' },
  link: { color: '#2563eb', fontWeight: '600' },
  policy: { textAlign: 'center', marginTop: 16, fontSize: 11, color: '#6b7280' },
  error: { color: '#dc2626', textAlign: 'center', marginBottom: 8, fontSize: 13 },
});
