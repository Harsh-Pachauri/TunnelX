import { WebSocket } from 'ws';

export interface TunnelStatusEvent {
  type: 'tunnel_status';
  tunnelId: string;
  status: 'active' | 'inactive';
  latencyMs: number | null;
}

export interface NewRequestEvent {
  type: 'new_request';
  log: {
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
  };
}

export type DashboardEvent = TunnelStatusEvent | NewRequestEvent;

class DashboardEventBus {
  /** userId → set of open dashboard WebSocket connections for that user. */
  private clients = new Map<string, Set<WebSocket>>();

  subscribe(userId: string, ws: WebSocket): void {
    if (!this.clients.has(userId)) this.clients.set(userId, new Set());
    this.clients.get(userId)!.add(ws);
    ws.on('close', () => {
      this.clients.get(userId)?.delete(ws);
    });
  }

  emitTunnelStatus(userId: string, event: TunnelStatusEvent): void {
    this.broadcast(userId, event);
  }

  emitNewRequest(userId: string, log: NewRequestEvent['log']): void {
    this.broadcast(userId, { type: 'new_request', log });
  }

  private broadcast(userId: string, event: DashboardEvent): void {
    const clients = this.clients.get(userId);
    if (!clients || clients.size === 0) return;
    const json = JSON.stringify(event);
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(json);
    }
  }
}

export const dashboardEvents = new DashboardEventBus();
