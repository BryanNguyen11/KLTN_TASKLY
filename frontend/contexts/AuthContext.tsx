import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode
} from 'react';
import axios from 'axios';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  avatar?: string;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  token: string | null; // added
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  updateName: (name: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateAvatar: (avatar: string) => Promise<void>;
  // Push notifications
  pushToken?: string | null;
  shouldSimulatePush: boolean; // true when we should use local notifications as a fallback (e.g., Expo Go without a registered push token)
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [shouldSimulatePush, setShouldSimulatePush] = useState<boolean>(false);

  const BASE = process.env.EXPO_PUBLIC_API_BASE;
  const API_AUTH = BASE ? `${BASE}/api/auth` : undefined;
  const API_USERS = BASE ? `${BASE}/api/users` : undefined;

  const applyToken = (tk: string) => {
    axios.defaults.headers.common['Authorization'] = `Bearer ${tk}`;
  };

  const registerPushToken = async () => {
    try {
      const isExpoGo = Constants.appOwnership === 'expo';
      // Ask permission
      const settings = await Notifications.getPermissionsAsync();
      let granted = settings.granted || settings.ios?.status === Notifications.IosAuthorizationStatus.AUTHORIZED;
      if(!granted){
        const req = await Notifications.requestPermissionsAsync();
        granted = req.granted || req.ios?.status === Notifications.IosAuthorizationStatus.AUTHORIZED;
      }
      if(!granted){
        // no permission; on Expo Go we fallback to local notifications
        setPushToken(null);
        setShouldSimulatePush(isExpoGo);
        return;
      }
      // Get token
      const pid = (Constants as any)?.expoConfig?.extra?.eas?.projectId || (Constants as any)?.easConfig?.projectId;
      let expoToken: string | null = null;
      try {
        expoToken = pid
          ? (await Notifications.getExpoPushTokenAsync({ projectId: pid })).data
          : (await Notifications.getExpoPushTokenAsync()).data;
      } catch {
        expoToken = null;
      }
      setPushToken(expoToken);
    const API_USERS = BASE ? `${BASE}/api/users` : undefined;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
    if(API_USERS && expoToken){ await axios.patch(`${API_USERS}/me/push-token`, { token: expoToken, replace: true, timezone: tz }); }
      // If we successfully obtained a push token, do not simulate local push to avoid duplicates
      setShouldSimulatePush(!expoToken && isExpoGo);
    } catch { /* silent */ }
  };

  const login = async (email: string, password: string) => {
    setLoading(true);
    try {
      if(!API_AUTH) throw new Error('Chưa cấu hình EXPO_PUBLIC_API_BASE');
      // Debug log base URL (printed once per session typically)
      if (typeof (global as any).__AUTH_BASE_LOGGED === 'undefined') {
        // eslint-disable-next-line no-console
        console.log('[AUTH] API_AUTH =', API_AUTH);
        (global as any).__AUTH_BASE_LOGGED = true;
      }
      const res = await axios.post(`${API_AUTH}/login`, { email, password });
      const { token, user } = res.data;
      setUser(user);
      setToken(token);
      applyToken(token);
      // ensure freshest profile (including avatar)
      await refreshProfile();
      // try to register push token
      await registerPushToken();
    } catch (err: any) {
      // Detailed debug
      // eslint-disable-next-line no-console
      console.log('[AUTH][LOGIN][ERROR]', err?.response?.status, err?.response?.data, err?.message);
      throw new Error(err.response?.data?.message || err.message || 'Đăng nhập thất bại');
    } finally { setLoading(false); }
  };

  const register = async (name: string, email: string, password: string) => {
    setLoading(true);
    try {
      if(!API_AUTH) throw new Error('Chưa cấu hình EXPO_PUBLIC_API_BASE');
      const res = await axios.post(`${API_AUTH}/register`, { name, email, password });
      const { token, user } = res.data;
      setUser(user);
      setToken(token);
      applyToken(token);
      await refreshProfile();
      await registerPushToken();
    } catch (err: any) {
      throw new Error(err.response?.data?.message || 'Đăng ký thất bại');
    } finally { setLoading(false); }
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    setPushToken(null);
    setShouldSimulatePush(false);
    delete axios.defaults.headers.common['Authorization'];
  };

  const refreshProfile = async () => {
    if(!API_USERS || !token) return;
    try {
      const res = await axios.get(`${API_USERS}/me`);
      setUser(res.data);
    } catch { /* silent */ }
  };

  const updateName = async (name: string) => {
    if(!API_USERS) throw new Error('Chưa cấu hình EXPO_PUBLIC_API_BASE');
    if(!token) throw new Error('Chưa đăng nhập');
    const trimmed = name.trim();
    if(trimmed.length < 2) throw new Error('Tên tối thiểu 2 ký tự');
    await axios.patch(`${API_USERS}/me`, { name: trimmed });
    // refresh user
    await refreshProfile();
  };

  const updateAvatar = async (avatar: string) => {
    if(!API_USERS) throw new Error('Chưa cấu hình EXPO_PUBLIC_API_BASE');
    if(!token) throw new Error('Chưa đăng nhập');
    await axios.patch(`${API_USERS}/me/avatar`, { avatar });
    await refreshProfile();
  };

  useEffect(() => {
    if(token){ applyToken(token); }
  }, []);

  return (
  <AuthContext.Provider value={{ user, loading, token, login, register, logout, updateName, refreshProfile, updateAvatar, pushToken, shouldSimulatePush }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};