import { apiFetch, buildQuery } from './client';
import type { TunnelDetail, TunnelSummary } from './types';

export function listTunnels(status?: 'active' | 'all'): Promise<TunnelSummary[]> {
  return apiFetch(`/tunnels${buildQuery({ status })}`);
}

export function getTunnel(id: string): Promise<TunnelDetail> {
  return apiFetch(`/tunnels/${id}`);
}
