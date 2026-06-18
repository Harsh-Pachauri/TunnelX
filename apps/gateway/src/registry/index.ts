import type { WebSocket } from 'ws';

export interface TunnelConnection {
  tunnelId: string;
  /** Owner — used to scope dashboard WS push events to the right user. */
  userId: string;
  subdomain: string;
  localPort: number;
  ws: WebSocket;
  connectedAt: Date;
  /** Updated whenever a PONG is received; used by the heartbeat to detect dead connections. */
  lastPongAt: number;
  /** Round-trip latency in ms, computed from the most recent PING/PONG pair. */
  lastLatencyMs?: number;
  heartbeatTimer?: NodeJS.Timeout;
}

/**
 * Single-instance, in-memory registry of active tunnels keyed by subdomain.
 * v1 runs as a single gateway process; a multi-instance deployment would back
 * this with Redis (see Planning.md future-scaling notes).
 */
class TunnelRegistry {
  private bySubdomain = new Map<string, TunnelConnection>();

  register(conn: TunnelConnection): void {
    this.bySubdomain.set(conn.subdomain, conn);
  }

  unregister(subdomain: string): void {
    this.bySubdomain.delete(subdomain);
  }

  get(subdomain: string): TunnelConnection | undefined {
    return this.bySubdomain.get(subdomain);
  }

  has(subdomain: string): boolean {
    return this.bySubdomain.has(subdomain);
  }

  size(): number {
    return this.bySubdomain.size;
  }
}

export const registry = new TunnelRegistry();
