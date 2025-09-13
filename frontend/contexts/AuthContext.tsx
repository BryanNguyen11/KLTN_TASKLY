import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode
} from 'react';
import axios from 'axios';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);

  const API_URL = 'http://192.168.3.18:5000/api/auth'; // IP máy tính

  const login = async (email: string, password: string) => {
    setLoading(true);
    try {
      const res = await axios.post(`${API_URL}/login`, { email, password });
      const { token, user } = res.data;
      setUser(user);
      // Nếu muốn lưu token:
      // await AsyncStorage.setItem('token', token);
    } catch (err: any) {
      throw new Error(err.response?.data?.message || 'Đăng nhập thất bại');
    } finally {
      setLoading(false);
    }
  };

  const register = async (name: string, email: string, password: string) => {
    setLoading(true);
    try {
      const res = await axios.post(`${API_URL}/register`, {
        name,
        email,
        password
      });
      const { token, user } = res.data;
      setUser(user);
      // await AsyncStorage.setItem('token', token);
    } catch (err: any) {
      throw new Error(err.response?.data?.message || 'Đăng ký thất bại');
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    setUser(null);
    // await AsyncStorage.removeItem('token');
  };

  useEffect(() => {
    // TODO: load token từ AsyncStorage nếu cần
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};