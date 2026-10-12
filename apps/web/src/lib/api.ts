const TOKEN_KEY = "nexus_token";

export const tokenStore = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (t: string) => {
    try {
      localStorage.setItem(TOKEN_KEY, t);
    } catch {
      /* almacenamiento no disponible */
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* noop */
    }
  },
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

const BASE = import.meta.env.VITE_API_URL ?? "";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = tokenStore.get();
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && token) {
    tokenStore.clear();
    window.location.href = "/login";
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = data.details;
    const extra = Array.isArray(details) ? `: ${details.join(", ")}` : "";
    throw new ApiError(res.status, (data.error ?? res.statusText) + extra, details);
  }
  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>("GET", p),
  post: <T>(p: string, b?: unknown) => request<T>("POST", p, b ?? {}),
  put: <T>(p: string, b?: unknown) => request<T>("PUT", p, b ?? {}),
  patch: <T>(p: string, b?: unknown) => request<T>("PATCH", p, b ?? {}),
  del: <T>(p: string) => request<T>("DELETE", p),
};

export const apiBase = BASE;
