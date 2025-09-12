import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface User { id: string; email: string; }
interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);

  const fakeDelay = (ms: number) => new Promise(r => setTimeout(r, ms));

  const login = async (email: string, password: string) => {
    setLoading(true);
    await fakeDelay(800);
    // TODO: replace with real API call
    if (!email || !password) throw new Error('Thông tin không hợp lệ');
    setUser({ id: 'u_' + Date.now(), email });
    setLoading(false);
  };

  const register = async (email: string, password: string) => {
    setLoading(true);
    await fakeDelay(900);
    if (!email || !password) throw new Error('Thông tin không hợp lệ');
    setUser({ id: 'u_' + Date.now(), email });
    setLoading(false);
  };

  const logout = () => setUser(null);

  // Persist stub (optional future): use secure storage
  useEffect(() => { /* load persisted session if any */ }, []);

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
