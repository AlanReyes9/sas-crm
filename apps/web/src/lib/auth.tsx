import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, tokenStore } from "./api";
import { disconnectSocket } from "./socket";

interface Me {
  user: { id: string; name: string; email: string };
  role: "OWNER" | "ADMIN" | "AGENT";
  workspace: { id: string; name: string; slug: string };
  workspaces: { id: string; name: string; role: string }[];
}

interface AuthCtx {
  me: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { name: string; email: string; password: string; company: string }) => Promise<void>;
  logout: () => void;
  switchWorkspace: (id: string) => Promise<void>;
}

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!tokenStore.get()) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      setMe(await api.get<Me>("/auth/me"));
    } catch {
      tokenStore.clear();
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value: AuthCtx = {
    me,
    loading,
    async login(email, password) {
      const r = await api.post<{ token: string }>("/auth/login", { email, password });
      tokenStore.set(r.token);
      await refresh();
    },
    async register(data) {
      const r = await api.post<{ token: string }>("/auth/register", data);
      tokenStore.set(r.token);
      await refresh();
    },
    logout() {
      tokenStore.clear();
      disconnectSocket();
      setMe(null);
    },
    async switchWorkspace(workspaceId) {
      const r = await api.post<{ token: string }>("/auth/switch", { workspaceId });
      tokenStore.set(r.token);
      disconnectSocket();
      window.location.href = "/";
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
