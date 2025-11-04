import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { validateEmail, validatePassword } from '@/utils/validation';
// Removed KeyboardAwareScrollView to avoid overscroll; use ScrollView + KeyboardAvoidingView

const PLACEHOLDER_COLOR = '#64748b';

export default function RegisterScreen() {
  const router = useRouter();
  const { register } = useAuth();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inline validate để hiện lỗi ngay dưới ô nhập
  const emailError = useMemo(() => {
    if(!email) return null;
    return validateEmail(email) ? null : 'Email không hợp lệ (chỉ @gmail.com)';
  }, [email]);
  const passwordError = useMemo(() => {
    if(!password) return null;
    return validatePassword(password) ? null : 'Mật khẩu tối thiểu 8 ký tự';
  }, [password]);
  const confirmError = useMemo(() => {
    if(!confirm) return null;
    return password === confirm ? null : 'Mật khẩu nhập lại không khớp';
  }, [password, confirm]);

  const handleRegister = async () => {
  if (!email || !password || !confirm) {
    setError('Vui lòng nhập đầy đủ thông tin');
    return;
  }
  if (!validateEmail(email)) {
    setError('Chỉ chấp nhận email @gmail.com');
    return;
  }
  if (!validatePassword(password)) {
    setError('Mật khẩu tối thiểu 8 ký tự');
    return;
  }
  if (password !== confirm) {
    setError('Mật khẩu nhập lại không khớp');
    return;
  }

  setError(null);
  setLoading(true);
  try {
    const name = email.split('@')[0]; // ✅ tạo tên từ email
    await register(name, email, password); // ✅ truyền đủ 3 tham số
    // ✅ THÊM THÔNG BÁO VÀ CHUYỂN MÀN HÌNH
    Alert.alert('Thành công', 'Tài khoản đã được tạo!', [
      {
        text: 'OK',
        onPress: () => router.replace('/auth/login') // hoặc router.push nếu bạn muốn quay lại
      }
    ]);
  } catch (e: any) {
    setError(e.message || 'Đăng ký thất bại');
  } finally {
    setLoading(false);
  }
};

  return (
  <SafeAreaView style={{ flex:1, backgroundColor:'#f1f5f9' }} edges={['top']}>
  <KeyboardAvoidingView style={{ flex:1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={insets.top}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        automaticallyAdjustKeyboardInsets
      >
      <View style={styles.card}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#1f2937" />
        </Pressable>
        <View style={styles.logoWrapper}>
          <Image
            source={require('../../assets/images/icon.png')}
            style={styles.logoImage}
            contentFit="contain"
            accessibilityLabel="Taskly Logo"
          />
          <Text style={styles.brand}>Tạo tài khoản</Text>
          <Text style={styles.subtitle}>Bắt đầu trải nghiệm Taskly</Text>
        </View>

  <Field label="Email" required icon="mail" value={email} onChangeText={setEmail} placeholder="student@gmail.com" keyboardType="email-address" error={emailError || undefined} />
    <Field label="Mật khẩu" required icon="lock-closed" value={password} onChangeText={setPassword} placeholder="••••••" secureTextEntry error={passwordError || undefined} />
    <Field label="Nhập lại mật khẩu" required icon="repeat" value={confirm} onChangeText={setConfirm} placeholder="••••••" secureTextEntry error={confirmError || undefined} />

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]} onPress={handleRegister} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Đăng ký</Text>}
        </Pressable>

        <Text style={styles.footerText}>Đã có tài khoản? <Text style={styles.link} onPress={() => router.push('/auth/login' as any)}>Đăng nhập</Text></Text>
      </View>
      </ScrollView>
  </KeyboardAvoidingView>
  </SafeAreaView>
  );
}

interface FieldProps { label: string; icon: any; value: string; onChangeText: (t: string) => void; placeholder?: string; secureTextEntry?: boolean; keyboardType?: any; error?: string; required?: boolean; }
const Field = ({ label, icon, value, onChangeText, placeholder, secureTextEntry, keyboardType, error, required }: FieldProps) => (
  <View style={styles.field}>          
    <Text style={styles.label}>{label}{required ? ' *' : ''}</Text>
    <View style={[styles.inputWrapper, error && styles.inputWrapperError]}>
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
    {!!error && <Text style={styles.fieldError}>{error}</Text>}
  </View>
);

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: '#f1f5f9', padding: 20, justifyContent: 'center' },
  card: { backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 24, padding: 24, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  backBtn: { position: 'absolute', top: 16, left: 16, zIndex: 10, backgroundColor: '#fff', padding: 8, borderRadius: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowOffset: { width:0, height:2 }, shadowRadius: 4 },
  logoWrapper: { alignItems: 'center', marginBottom: 24 },
  logoImage: { width: 96, height: 96, borderRadius: 20, marginBottom: 12 },
  brand: { fontSize: 30, fontWeight: '600', color: '#111827' },
  subtitle: { fontSize: 13, color: '#4b5563', textAlign: 'center' },
  field: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '500', marginBottom: 6, color: '#111827' },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 12 },
  inputWrapperError: { borderColor: '#dc2626', backgroundColor: '#fff1f2' },
  inputIcon: { marginRight: 6 },
  input: { flex: 1, height: 48, fontSize: 16 },
  button: { backgroundColor: '#2563eb', height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  buttonPressed: { opacity: 0.85 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  footerText: { textAlign: 'center', marginTop: 18, fontSize: 13, color: '#374151' },
  link: { color: '#2563eb', fontWeight: '600' },
  error: { color: '#dc2626', textAlign: 'center', marginBottom: 8, fontSize: 13 },
  fieldError: { color: '#dc2626', marginTop: 6, fontSize: 12 },
});
