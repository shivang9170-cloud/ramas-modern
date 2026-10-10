import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, setUnauthorizedHandler, tokenStore } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => {
    tokenStore.set(null);
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!tokenStore.get()) { setReady(true); return; }
    api.get('/auth/me')
      .then((r) => setUser(r.data.user))
      .catch(() => tokenStore.set(null))
      .finally(() => setReady(true));
  }, [logout]);

  const applySession = useCallback(({ token, user: u }) => {
    tokenStore.set(token);
    setUser(u);
    queryClient.clear(); // branch/division-scoped data must be refetched
  }, [queryClient]);

  const login = useCallback(async (values) => {
    const { data } = await api.post('/auth/login', values);
    applySession(data);
    return data.user;
  }, [applySession]);

  const switchBranch = useCallback(async (branchCode) => {
    const { data } = await api.post('/auth/switch-branch', { branchCode });
    applySession(data);
  }, [applySession]);

  const value = useMemo(() => ({ user, ready, login, logout, switchBranch, applySession }), [user, ready, login, logout, switchBranch, applySession]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
