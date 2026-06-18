import { apiFetch } from './client';
import type { AuthResponse, RefreshResponse } from './types';

export function register(email: string, password: string): Promise<AuthResponse> {
  return apiFetch('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) });
}

export function login(email: string, password: string): Promise<AuthResponse> {
  return apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
}

export function refresh(): Promise<RefreshResponse> {
  return apiFetch('/auth/refresh', { method: 'POST' });
}

export function logout(): Promise<void> {
  return apiFetch('/auth/logout', { method: 'POST' });
}
