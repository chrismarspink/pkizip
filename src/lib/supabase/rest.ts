/**
 * Supabase REST fetch 공용 헬퍼
 */
export const SUPABASE_URL = 'https://ikyhpuerwljxypyzkpiw.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlreWhwdWVyd2xqeHlweXprcGl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1OTM1NjQsImV4cCI6MjA5MjE2OTU2NH0.31GrKSlBzcGRXCU7yHioEVIChO3EMi6di75O6mLFlBU';

export function getAccessToken(): string | null {
  try {
    const raw = localStorage.getItem('sb-ikyhpuerwljxypyzkpiw-auth-token');
    if (!raw) return null;
    return JSON.parse(raw)?.access_token ?? null;
  } catch { return null; }
}

export function headers(prefer?: string): Record<string, string> {
  const token = getAccessToken();
  const h: Record<string, string> = {
    'apikey': SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
  };
  if (prefer) h['Prefer'] = prefer;
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

export async function restGet<T>(path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: headers() });
  if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function restPost<T = unknown>(path: string, body: unknown, prefer = 'return=representation'): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: headers(prefer),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : (undefined as unknown as T);
}

export async function restPatch<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: headers('return=representation'),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${path}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : (undefined as unknown as T);
}

export async function restDelete(path: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: headers(),
  });
  if (!res.ok) throw new Error(`DELETE ${path}: ${res.status} ${await res.text()}`);
}

export async function rpc<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(args ?? {}),
  });
  if (!res.ok) throw new Error(`RPC ${name}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : (undefined as unknown as T);
}
