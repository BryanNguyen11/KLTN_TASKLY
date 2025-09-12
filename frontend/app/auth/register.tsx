import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { validateEmail, validatePassword } from '@/utils/validation';

const PLACEHOLDER_COLOR = '#64748b';

export default function RegisterScreen() {
  const router = useRouter();
  const { register } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRegister = async () => {
    if (!email || !password || !confirm) {
      setError('Vui lòng nhập đầy đủ thông tin');
      return;
    }
    if (!validateEmail(email)) { setError('Email không hợp lệ'); return; }
    if (!validatePassword(password)) { setError('Mật khẩu tối thiểu 6 ký tự'); return; }
    if (password !== confirm) { setError('Mật khẩu nhập lại không khớp'); return; }
    setError(null);
    setLoading(true);
    try {
      await register(email, password);
    } catch (e: any) {
      setError(e.message || 'Đăng ký thất bại');
    } finally { setLoading(false); }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.card}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#1f2937" />
        </Pressable>
        <View style={styles.logoWrapper}>
          <View style={styles.logoCircle}>
            <Ionicons name="person-add" size={40} color="#fff" />
          </View>
          <Text style={styles.brand}>Tạo tài khoản</Text>
          <Text style={styles.subtitle}>Bắt đầu trải nghiệm Taskly</Text>
        </View>

        <Field label="Email" icon="mail" value={email} onChangeText={setEmail} placeholder="student@example.com" keyboardType="email-address" />
        <Field label="Mật khẩu" icon="lock-closed" value={password} onChangeText={setPassword} placeholder="••••••" secureTextEntry />
        <Field label="Nhập lại mật khẩu" icon="repeat" value={confirm} onChangeText={setConfirm} placeholder="••••••" secureTextEntry />

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]} onPress={handleRegister} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Đăng ký</Text>}
        </Pressable>

        <Text style={styles.footerText}>Đã có tài khoản? <Text style={styles.link} onPress={() => router.push('/auth/login' as any)}>Đăng nhập</Text></Text>
      </View>
    </KeyboardAvoidingView>
  );
}

interface FieldProps { label: string; icon: any; value: string; onChangeText: (t: string) => void; placeholder?: string; secureTextEntry?: boolean; keyboardType?: any; }
const Field = ({ label, icon, value, onChangeText, placeholder, secureTextEntry, keyboardType }: FieldProps) => (
  <View style={styles.field}>          
    <Text style={styles.label}>{label}</Text>
    <View style={styles.inputWrapper}>
      <Ionicons name={icon} size={18} color="#666" style={styles.inputIcon} />
      <TextInput
        placeholder={placeholder}
  placeholderTextColor={PLACEHOLDER_COLOR}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        style={styles.input}
        autoCapitalize="none"
        keyboardType={keyboardType}
      />
    </View>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f1f5f9', padding: 20, justifyContent: 'center' },
  card: { backgroundColor: 'rgba(255,255,255,0.97)', borderRadius: 28, padding: 26, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 5 },
  backBtn: { position: 'absolute', top: 16, left: 16, zIndex: 10, backgroundColor: '#fff', padding: 8, borderRadius: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowOffset: { width:0, height:2 }, shadowRadius: 4 },
  logoWrapper: { alignItems: 'center', marginBottom: 24 },
  logoCircle: { width: 86, height: 86, borderRadius: 26, backgroundColor: '#2563eb', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  brand: { fontSize: 26, fontWeight: '600', color: '#111827' },
  subtitle: { fontSize: 13, color: '#4b5563', textAlign: 'center' },
  field: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '500', marginBottom: 6, color: '#111827' },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 12 },
  inputIcon: { marginRight: 6 },
  input: { flex: 1, height: 48, fontSize: 16 },
  button: { backgroundColor: '#2563eb', height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  buttonPressed: { opacity: 0.85 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  footerText: { textAlign: 'center', marginTop: 22, fontSize: 13, color: '#374151' },
  link: { color: '#2563eb', fontWeight: '600' },
  error: { color: '#dc2626', textAlign: 'center', marginBottom: 8, fontSize: 13 },
});
