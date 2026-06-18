import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as authApi from '../api/auth';
import { setAccessToken, setOnAuthLost } from '../api/client';
import type { User } from '../api/types';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  user: User | null;
  status: AuthStatus;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * The access token is a signed JWT containing `sub`/`email`. Decoding it
 * client-side (without verifying the signature) is fine here — it's only
 * used to show the logged-in user's email; every API request is still
 * verified server-side.
 */
function userFromToken(token: string): User | null {
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const decoded = JSON.parse(json) as { sub: string; email: string };
    return { id: decoded.sub, email: decoded.email };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  const applyToken = useCallback((accessToken: string, userInfo?: User) => {
    setAccessToken(accessToken);
    setUser(userInfo ?? userFromToken(accessToken));
    setStatus('authenticated');
  }, []);

  const clear = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  useEffect(() => {
    setOnAuthLost(clear);
    authApi
      .refresh()
      .then((res) => applyToken(res.accessToken))
      .catch(() => clear());
  }, [applyToken, clear]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await authApi.login(email, password);
      applyToken(res.accessToken, res.user);
    },
    [applyToken],
  );

  const register = useCallback(
    async (email: string, password: string) => {
      const res = await authApi.register(email, password);
      applyToken(res.accessToken, res.user);
    },
    [applyToken],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // ignore — local auth state is cleared regardless
    } finally {
      clear();
    }
  }, [clear]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, login, register, logout }),
    [user, status, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
