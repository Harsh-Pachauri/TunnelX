import { apiFetch, buildQuery } from './client';
import type { LogBody, RequestLog, RequestLogFilters, RequestLogPage } from './types';

export function listLogs(filters: RequestLogFilters): Promise<RequestLogPage> {
  return apiFetch(`/logs${buildQuery(filters)}`);
}

export function getLog(id: number): Promise<RequestLog> {
  return apiFetch(`/logs/${id}`);
}

export function getLogBody(id: number): Promise<LogBody> {
  return apiFetch(`/logs/${id}/body`);
}
