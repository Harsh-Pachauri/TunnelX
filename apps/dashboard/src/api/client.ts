import type { ApiError, RefreshResponse } from './types';

const API_BASE_URL = `${import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000'}/api`;

export class ApiClientError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

let accessToken: string | null = null;
let onAuthLost: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setOnAuthLost(handler: () => void): void {
  onAuthLost = handler;
}

export function buildQuery(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

function rawFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  if (init.body && typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(`${API_BASE_URL}${path}`, { ...init, headers, credentials: 'include' });
}

let refreshPromise: Promise<boolean> | null = null;

/** Calls /auth/refresh directly (bypassing apiFetch) to avoid recursive 401 handling. */
function refreshAccessToken(): Promise<boolean> {
  refreshPromise ??= (async () => {
    try {
      const res = await rawFetch('/auth/refresh', { method: 'POST' });
      if (!res.ok) return false;
      const data = (await res.json()) as RefreshResponse;
      setAccessToken(data.accessToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

/**
 * Fetches `path` (relative to /api) with the current access token. On a 401,
 * tries one silent refresh + retry before giving up and notifying
 * `onAuthLost` (which AuthContext uses to drop back to the login page).
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}, isRetry = false): Promise<T> {
  const res = await rawFetch(path, init);

  if (res.status === 401 && !isRetry && path !== '/auth/refresh') {
    if (await refreshAccessToken()) {
      return apiFetch<T>(path, init, true);
    }
    setAccessToken(null);
    onAuthLost?.();
  }

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiClientError(res.status, (data as ApiError | null)?.error ?? res.statusText);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
