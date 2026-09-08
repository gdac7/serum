import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { authApi, type AuthUser } from "../api/auth";
import { ApiError } from "../api/client";

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

const STORAGE_KEY = "redteam.token";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY),
  );
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    authApi
      .me(token)
      .then((res) => {
        if (!cancelled) setUser(res.user);
      })
      .catch((err) => {
        if (cancelled) return;
        // Only a rejected token means the session is over. A network blip, a
        // rate limit or a 5xx says nothing about the token, and discarding it
        // there logs the user out for reasons that have nothing to do with
        // them -- reloading fast enough to abort this request used to be
        // enough to do it.
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          setToken(null);
          localStorage.removeItem(STORAGE_KEY);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const login = useCallback(async (email: string, password: string) => {
    const { token: next } = await authApi.login(email, password);
    localStorage.setItem(STORAGE_KEY, next);
    setToken(next);
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    await authApi.register(email, password);
    await login(email, password);
  }, [login]);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ token, user, loading, login, register, logout }),
    [token, user, loading, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
