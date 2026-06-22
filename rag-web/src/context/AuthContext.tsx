"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { api, CREDENTIALS_KEY } from "@/lib/api";

interface AuthContextValue {
  isAuthenticated: boolean;
  username: string | null;
  /** True once the initial credential check has completed (avoids guard flicker). */
  ready: boolean;
  login: (username: string, password: string) => Promise<void>;
  signup: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readCredentials(): string | null {
  try {
    return localStorage.getItem(CREDENTIALS_KEY);
  } catch {
    return null;
  }
}

function writeCredentials(value: string | null): void {
  try {
    if (value) {
      localStorage.setItem(CREDENTIALS_KEY, value);
    } else {
      localStorage.removeItem(CREDENTIALS_KEY);
    }
  } catch {
    /* ignore quota / privacy mode */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [username, setUsername] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => {
    setIsAuthenticated(false);
    setUsername(null);
    writeCredentials(null);
  }, []);

  const login = useCallback(async (user: string, password: string) => {
    const credentials = btoa(`${user}:${password}`);
    const res = await api.sessionWithBasic(credentials);
    writeCredentials(credentials);
    setIsAuthenticated(true);
    setUsername(res.username);
  }, []);

  const signup = useCallback(async (user: string, password: string) => {
    await api.signup(user, password);
  }, []);

  // Restore the session on first mount (ports AuthService.checkAuthStatus).
  useEffect(() => {
    const credentials = readCredentials();
    if (!credentials) {
      setReady(true);
      return;
    }
    let cancelled = false;
    api
      .session()
      .then((res) => {
        if (cancelled) return;
        setIsAuthenticated(true);
        setUsername(res.username ?? null);
      })
      .catch(() => {
        if (!cancelled) logout();
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [logout]);

  const value = useMemo<AuthContextValue>(
    () => ({ isAuthenticated, username, ready, login, signup, logout }),
    [isAuthenticated, username, ready, login, signup, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
