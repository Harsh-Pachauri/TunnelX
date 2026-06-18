import type { PingMessage } from '@tunnelx/protocol';
import { config } from '../config.js';
import type { TunnelConnection } from '../registry/index.js';

/**
 * Periodically pings a tunnel client and terminates the connection if it stops
 * responding. `ws.close()` relies on the peer cooperating; `terminate()` forces
 * the socket closed so the `close` handler in ws/server.ts can clean up the
 * registry entry and fail any in-flight requests for this tunnel.
 */
export function startHeartbeat(conn: TunnelConnection): void {
  conn.heartbeatTimer = setInterval(() => {
    const sinceLastPong = Date.now() - conn.lastPongAt;
    if (sinceLastPong > config.heartbeatTimeoutMs) {
      console.log(
        `[heartbeat] ${conn.subdomain}: no PONG for ${sinceLastPong}ms (timeout ${config.heartbeatTimeoutMs}ms), closing connection`,
      );
      conn.ws.terminate();
      return;
    }

    const ping: PingMessage = { type: 'PING', timestamp: Date.now() };
    conn.ws.send(JSON.stringify(ping));
  }, config.heartbeatIntervalMs);
}

export function stopHeartbeat(conn: TunnelConnection): void {
  if (conn.heartbeatTimer) {
    clearInterval(conn.heartbeatTimer);
    conn.heartbeatTimer = undefined;
  }
}
