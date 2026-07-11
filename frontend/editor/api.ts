export type StoredLevel = { id: string; version: number; ascii2d: string };
export type GeneratedLevel = { seed: number; size: number; ascii2d: string };

const API_URL = "http://127.0.0.1:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, init);
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    const error = new Error(detail?.detail ?? `Request failed (${response.status})`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return response.json() as Promise<T>;
}

export function listLevels(): Promise<string[]> { return request("/levels"); }
export function loadLevel(id: string): Promise<StoredLevel> { return request(`/level/load?id=${encodeURIComponent(id)}`); }
export function generateLevel(seed: number, size: number): Promise<GeneratedLevel> {
  return request("/level/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seed, size }) });
}
export function storeLevel(ascii2d: string, id?: string, baseVersion?: number): Promise<StoredLevel> {
  return request("/level/store", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ascii2d, id, base_version: baseVersion }) });
}
