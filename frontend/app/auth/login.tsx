import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { Ionicons } from '@expo/vector-icons';

const PLACEHOLDER_COLOR = '#64748b';

export default function LoginScreen() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goDashboard = () => {
    router.replace('/(tabs)/dashboard');
  };

  const handleLogin = async () => {
    if (!email || !password) {
      setError('Vui lòng nhập đầy đủ thông tin');
      return;
    }

    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      Alert.alert('Đăng nhập thành công', `Chào mừng ${email}`, [
        { text: 'Tiếp tục', onPress: goDashboard }
      ]);
    } catch (e: any) {
      setError(e.message || 'Đăng nhập thất bại');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f1f5f9' }} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.card}>
          <View style={styles.logoWrapper}>
            <View style={styles.logoCircle}>
              <Ionicons name="school" size={42} color="#fff" />
            </View>
            <Text style={styles.brand}>Taskly</Text>
            <Text style={styles.subtitle}>
              Quản lý thời gian & công việc cho sinh viên
            </Text>
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

          {error && <Text style={styles.error}>{error}</Text>}

          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Đăng nhập</Text>
            )}
          </Pressable>

          <Text style={styles.footerText}>
            Chưa có tài khoản?{' '}
            <Text style={styles.link} onPress={() => router.push('/auth/register')}>
              Đăng ký ngay
            </Text>
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    padding: 20,
    justifyContent: 'center'
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 24,
    padding: 24,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4
  },
  logoWrapper: { alignItems: 'center', marginBottom: 24 },
  logoCircle: {
    width: 90,
    height: 90,
    borderRadius: 28,
    backgroundColor: '#2563eb',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12
  },
  brand: { fontSize: 30, fontWeight: '600', color: '#111827' },
  subtitle: { fontSize: 13, color: '#4b5563', textAlign: 'center' },
  field: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '500', marginBottom: 6, color: '#111827' },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 12
  },
  inputIcon: { marginRight: 6 },
  input: { flex: 1, height: 48, fontSize: 16 },
  button: {
    backgroundColor: '#2563eb',
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8
  },
  buttonPressed: { opacity: 0.85 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  footerText: { textAlign: 'center', marginTop: 18, fontSize: 13, color: '#374151' },
  link: { color: '#2563eb', fontWeight: '600' },
  error: { color: '#dc2626', textAlign: 'center', marginBottom: 8, fontSize: 13 }
});