import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import { verifyAccessToken } from '../auth/jwt.js';
import { dashboardEvents } from './dashboardEvents.js';

/** Called by the dashboard WebSocketServer for each authenticated connection. */
export function handleDashboardConnection(ws: WebSocket, req: IncomingMessage): void {
  const user = (req as IncomingMessage & { __user?: { sub: string; email: string } }).__user;
  if (!user) {
    ws.close(1008, 'Unauthorized');
    return;
  }
  dashboardEvents.subscribe(user.sub, ws);
  // The channel is server → client only; ignore any incoming messages.
}

/**
 * Called by WebSocketServer's verifyClient callback during the HTTP upgrade.
 * Validates the JWT access token from the `?token=` query parameter.
 * Attaches `__user` to req on success so handleDashboardConnection can read it.
 */
export function verifyDashboardClient(
  info: { req: IncomingMessage },
  done: (result: boolean, code?: number, name?: string) => void,
): void {
  try {
    const raw = info.req.url ?? '';
    const qs = raw.includes('?') ? raw.slice(raw.indexOf('?')) : '';
    const token = new URLSearchParams(qs).get('token');
    if (!token) return done(false, 401, 'Unauthorized');
    const payload = verifyAccessToken(token);
    (info.req as IncomingMessage & { __user?: unknown }).__user = payload;
    done(true);
  } catch {
    done(false, 401, 'Unauthorized');
  }
}
