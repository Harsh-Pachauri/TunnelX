import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { WebSocket } from 'ws';
import {
  gatewayToClientSchema,
  PROTOCOL_VERSION,
  type RegisterMessage,
  type RequestMessage,
  type ResponseChunkMessage,
  type ResponseEndMessage,
  type ResponseHeadersMessage,
} from '@tunnelx/protocol';

export interface TunnelOptions {
  localPort: number;
  gatewayUrl: string;
  apiKey: string;
  requestedSubdomain: string | null;
}

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const RECONNECT_JITTER_MS = 1000;

/**
 * Opens the tunnel connection and keeps it alive. On `close`/`error`, reconnects
 * with exponential backoff + jitter, capped at RECONNECT_MAX_DELAY_MS. The
 * gateway-assigned subdomain is remembered so a transient drop reconnects to the
 * same public URL where possible.
 */
export function startTunnel(options: TunnelOptions): void {
  const clientId = randomUUID();
  let subdomain = options.requestedSubdomain;
  let reconnectAttempt = 0;

  connect();

  function connect(): void {
    console.log(`Connecting to ${options.gatewayUrl} ...`);
    const ws = new WebSocket(options.gatewayUrl);

    ws.on('open', () => {
      const register: RegisterMessage = {
        type: 'REGISTER',
        version: PROTOCOL_VERSION,
        apiKey: options.apiKey,
        clientId,
        localPort: options.localPort,
        requestedSubdomain: subdomain,
      };
      ws.send(JSON.stringify(register));
    });

    ws.on('message', (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        console.error('Received malformed message from gateway');
        return;
      }

      const result = gatewayToClientSchema.safeParse(parsed);
      if (!result.success) {
        console.error('Received message that failed schema validation');
        return;
      }

      const msg = result.data;
      switch (msg.type) {
        case 'REGISTERED':
          reconnectAttempt = 0;
          subdomain = msg.subdomain;
          console.log('');
          console.log('  Tunnel established!');
          console.log(`  Forwarding ${msg.publicUrl} -> http://localhost:${options.localPort}`);
          console.log('');
          break;
        case 'REQUEST':
          forwardRequest(ws, msg, options.localPort);
          break;
        case 'PING':
          safeSend(ws, { type: 'PONG', timestamp: msg.timestamp });
          break;
        case 'ERROR':
          console.error(`Gateway error${msg.streamId ? ` [${msg.streamId}]` : ''}: ${msg.code} - ${msg.message}`);
          if (msg.code === 'SUBDOMAIN_TAKEN') {
            // Stop asking for a subdomain that's no longer ours; let the gateway assign a fresh one.
            subdomain = null;
          }
          break;
      }
    });

    ws.on('close', (code, reason) => {
      console.log(`Disconnected from gateway (code ${code}${reason.length ? `: ${reason}` : ''})`);
      scheduleReconnect();
    });

    ws.on('error', (err) => {
      console.error('Connection error:', err.message);
    });
  }

  function scheduleReconnect(): void {
    const delay =
      Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempt) +
      Math.floor(Math.random() * RECONNECT_JITTER_MS);
    reconnectAttempt++;
    console.log(`Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${reconnectAttempt})...`);
    setTimeout(connect, delay);
  }
}

/** Swallows sends on a socket that's already closing/closed — late chunks after a disconnect shouldn't crash the CLI. */
function safeSend(ws: WebSocket, message: unknown): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(message));
}

function forwardRequest(ws: WebSocket, msg: RequestMessage, localPort: number): void {
  const requestBody = msg.body ? Buffer.from(msg.body, 'base64') : undefined;

  const headers = { ...msg.headers };
  delete headers['host'];
  delete headers['connection'];

  const localReq = http.request(
    {
      hostname: '127.0.0.1',
      port: localPort,
      path: msg.path,
      method: msg.method,
      headers,
    },
    (localRes) => {
      const responseHeaders = flattenHeaders(localRes.headers);
      delete responseHeaders['connection'];
      delete responseHeaders['transfer-encoding'];

      const headersMsg: ResponseHeadersMessage = {
        type: 'RESPONSE_HEADERS',
        streamId: msg.streamId,
        statusCode: localRes.statusCode ?? 502,
        headers: responseHeaders,
      };
      safeSend(ws, headersMsg);

      let sequence = 0;
      let totalBytes = 0;

      localRes.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        const chunkMsg: ResponseChunkMessage = {
          type: 'RESPONSE_CHUNK',
          streamId: msg.streamId,
          sequence: sequence++,
          data: chunk.toString('base64'),
        };
        safeSend(ws, chunkMsg);
      });

      localRes.on('end', () => {
        const endMsg: ResponseEndMessage = {
          type: 'RESPONSE_END',
          streamId: msg.streamId,
          totalChunks: sequence,
          totalBytes,
        };
        safeSend(ws, endMsg);
        console.log(`${msg.method} ${msg.path} -> ${headersMsg.statusCode} (${totalBytes} bytes, ${sequence} chunk${sequence === 1 ? '' : 's'})`);
      });
    },
  );

  localReq.on('error', (err: NodeJS.ErrnoException) => {
    const code = err.code === 'ECONNREFUSED' ? 'LOCAL_CONNECTION_REFUSED' : 'LOCAL_TIMEOUT';
    console.error(`${msg.method} ${msg.path} -> local error: ${err.message}`);
    safeSend(ws, {
      type: 'ERROR',
      streamId: msg.streamId,
      code,
      message: err.message,
    });
  });

  if (requestBody) localReq.write(requestBody);
  localReq.end();
}

function flattenHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      result[key] = value;
    } else if (Array.isArray(value)) {
      result[key] = value.join(', ');
    }
  }
  return result;
}
