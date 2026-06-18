export interface User {
  id: string;
  email: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
}

export interface RefreshResponse {
  accessToken: string;
}

export type TunnelStatus = 'active' | 'inactive';

export interface TunnelSummary {
  id: string;
  subdomain: string;
  publicUrl: string;
  targetPort: number;
  status: TunnelStatus;
  connectedAt: string;
  disconnectedAt: string | null;
  latencyMs: number | null;
}

export interface TunnelDetail extends TunnelSummary {
  apiKeyId: string | null;
  lastHeartbeatAt: string | null;
}

export interface RequestLog {
  id: number;
  tunnelId: string;
  streamId: string;
  method: string;
  path: string;
  statusCode: number | null;
  requestBytes: number;
  responseBytes: number;
  durationMs: number | null;
  clientIp: string | null;
  userAgent: string | null;
  error: string | null;
  createdAt: string;
}

export interface RequestLogPage {
  items: RequestLog[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RequestLogFilters {
  tunnelId?: string;
  status?: string;
  method?: string;
  path?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface LogBody {
  requestHeaders: Record<string, string>;
  /** base64-encoded, or null if absent or too large. */
  requestBody: string | null;
  requestBodyTruncated: boolean;
  responseHeaders: Record<string, string>;
  /** base64-encoded, or null if absent or too large. */
  responseBody: string | null;
  responseBodyTruncated: boolean;
}

export interface TunnelStatusEvent {
  type: 'tunnel_status';
  tunnelId: string;
  status: 'active' | 'inactive';
  latencyMs: number | null;
}

export interface NewRequestEvent {
  type: 'new_request';
  log: RequestLog;
}

export type DashboardEvent = TunnelStatusEvent | NewRequestEvent;

export interface ApiError {
  error: string;
}
