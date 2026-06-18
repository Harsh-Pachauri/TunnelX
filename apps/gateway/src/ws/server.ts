import { randomUUID } from 'node:crypto';
import { customAlphabet } from 'nanoid';
import type { RawData, WebSocket } from 'ws';
import {
  clientToGatewaySchema,
  type ErrorCode,
  type ErrorMessage,
  type RegisterMessage,
  type RegisteredMessage,
  type ResponseChunkMessage,
  type ResponseEndMessage,
  type ResponseHeadersMessage,
} from '@tunnelx/protocol';
import { config } from '../config.js';
import { authenticateApiKey, closeTunnelSession, createTunnelSession, touchTunnelHeartbeat } from '../db/queries/index.js';
import { BODY_CAP } from '../proxy/bodyBuffer.js';
import { pendingRequests } from '../proxy/pendingRequests.js';
import { recordRequestLog } from '../proxy/requestLog.js';
import { registry, type TunnelConnection } from '../registry/index.js';
import { dashboardEvents } from './dashboardEvents.js';
import { startHeartbeat, stopHeartbeat } from './heartbeat.js';

const generateSubdomain = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8);

export function handleConnection(ws: WebSocket): void {
  let conn: TunnelConnection | null = null;

  ws.on('message', (raw: RawData) => {
    const parsed = parseJson(raw);
    if (parsed === undefined) {
      sendError(ws, undefined, 'INVALID_MESSAGE', 'Message is not valid JSON');
      return;
    }

    const result = clientToGatewaySchema.safeParse(parsed);
    if (!result.success) {
      sendError(ws, undefined, 'INVALID_MESSAGE', 'Message failed schema validation');
      return;
    }

    const msg = result.data;
    switch (msg.type) {
      case 'REGISTER':
        void handleRegister(ws, msg).then((registered) => {
          conn = registered;
        });
        break;
      case 'RESPONSE_HEADERS':
        handleResponseHeaders(msg);
        break;
      case 'RESPONSE_CHUNK':
        handleResponseChunk(msg);
        break;
      case 'RESPONSE_END':
        handleResponseEnd(msg);
        break;
      case 'PONG':
        if (conn) {
          conn.lastPongAt = Date.now();
          conn.lastLatencyMs = Date.now() - msg.timestamp;
          touchTunnelHeartbeat(conn.tunnelId).catch((err) =>
            console.error('[db] failed to update last_heartbeat_at:', err),
          );
          dashboardEvents.emitTunnelStatus(conn.userId, { type: 'tunnel_status', tunnelId: conn.tunnelId, status: 'active', latencyMs: conn.lastLatencyMs });
        }
        break;
      case 'ERROR':
        handleClientError(msg);
        break;
    }
  });

  ws.on('close', () => {
    if (!conn) return;
    stopHeartbeat(conn);
    registry.unregister(conn.subdomain);
    pendingRequests.failAllForTunnel(conn.tunnelId, 502, 'Tunnel disconnected');
    closeTunnelSession(conn.tunnelId).catch((err) => console.error('[db] failed to close tunnel session:', err));
    dashboardEvents.emitTunnelStatus(conn.userId, { type: 'tunnel_status', tunnelId: conn.tunnelId, status: 'inactive', latencyMs: null });
    console.log(`[tunnel] disconnected: ${conn.subdomain}`);
  });

  ws.on('error', (err) => {
    console.error('[ws] connection error:', err.message);
  });
}

async function handleRegister(ws: WebSocket, msg: RegisterMessage): Promise<TunnelConnection | null> {
  const auth = await authenticateApiKey(msg.apiKey);
  if (!auth) {
    sendError(ws, undefined, 'INVALID_API_KEY', 'API key is invalid or has been revoked');
    ws.close();
    return null;
  }

  let subdomain = msg.requestedSubdomain;

  if (subdomain) {
    if (registry.has(subdomain)) {
      sendError(ws, undefined, 'SUBDOMAIN_TAKEN', `Subdomain "${subdomain}" is already in use`);
      ws.close();
      return null;
    }
  } else {
    do {
      subdomain = generateSubdomain();
    } while (registry.has(subdomain));
  }

  const conn: TunnelConnection = {
    tunnelId: randomUUID(),
    userId: auth.userId,
    subdomain,
    localPort: msg.localPort,
    ws,
    connectedAt: new Date(),
    lastPongAt: Date.now(),
  };
  registry.register(conn);

  try {
    await createTunnelSession({
      id: conn.tunnelId,
      userId: auth.userId,
      apiKeyId: auth.apiKeyId,
      subdomain,
      targetPort: msg.localPort,
    });
  } catch (err) {
    registry.unregister(subdomain);
    console.error('[tunnel] failed to persist tunnel session:', err);
    ws.close();
    return null;
  }

  startHeartbeat(conn);

  const registered: RegisteredMessage = {
    type: 'REGISTERED',
    tunnelId: conn.tunnelId,
    subdomain,
    publicUrl: `http://${subdomain}.${config.baseDomain}`,
    heartbeatIntervalMs: config.heartbeatIntervalMs,
  };
  ws.send(JSON.stringify(registered));
  console.log(`[tunnel] registered: ${subdomain} -> localhost:${msg.localPort} (${registered.publicUrl})`);

  dashboardEvents.emitTunnelStatus(auth.userId, { type: 'tunnel_status', tunnelId: conn.tunnelId, status: 'active', latencyMs: null });

  return conn;
}

function handleResponseHeaders(msg: ResponseHeadersMessage): void {
  const pending = pendingRequests.get(msg.streamId);
  if (!pending) return;
  pending.res.writeHead(msg.statusCode, stripHopByHopHeaders(msg.headers));
  pending.headersWritten = true;
  pending.statusCode = msg.statusCode;
  pending.responseHeaders = msg.headers;
}

function handleResponseChunk(msg: ResponseChunkMessage): void {
  const pending = pendingRequests.get(msg.streamId);
  if (!pending) return;
  const chunk = Buffer.from(msg.data, 'base64');
  pending.bytesReceived += chunk.length;
  pending.res.write(chunk);
  if (!pending.responseBodyTruncated) {
    if (pending.responseBodySize + chunk.length <= BODY_CAP) {
      pending.responseBodyChunks.push(chunk);
      pending.responseBodySize += chunk.length;
    } else {
      pending.responseBodyTruncated = true;
    }
  }
}

function handleResponseEnd(msg: ResponseEndMessage): void {
  const pending = pendingRequests.take(msg.streamId);
  if (!pending) return;
  pending.res.end();
  const durationMs = Date.now() - pending.startTime;
  console.log(`[stream ${msg.streamId}] completed in ${durationMs}ms, ${pending.bytesReceived} bytes`);
  recordRequestLog(msg.streamId, pending, {
    statusCode: pending.statusCode,
    responseBytes: pending.bytesReceived,
  });
}

function handleClientError(msg: ErrorMessage): void {
  console.error(`[client error] ${msg.code}: ${msg.message}`);
  if (!msg.streamId) return;

  const pending = pendingRequests.take(msg.streamId);
  if (!pending) return;

  let statusCode: number | null;
  if (pending.headersWritten) {
    pending.res.end();
    statusCode = pending.statusCode;
  } else {
    statusCode = msg.code === 'LOCAL_CONNECTION_REFUSED' ? 502 : 504;
    pending.res.writeHead(statusCode, { 'content-type': 'text/plain' });
    pending.res.end(`Tunnel error (${msg.code}): ${msg.message}`);
  }

  recordRequestLog(msg.streamId, pending, {
    statusCode,
    responseBytes: pending.bytesReceived,
    error: msg.code.toLowerCase(),
  });
}

function stripHopByHopHeaders(headers: Record<string, string>): Record<string, string> {
  const { connection: _connection, 'transfer-encoding': _transferEncoding, ...rest } = headers;
  return rest;
}

function parseJson(raw: RawData): unknown {
  try {
    return JSON.parse(raw.toString());
  } catch {
    return undefined;
  }
}

function sendError(ws: WebSocket, streamId: string | undefined, code: ErrorCode, message: string): void {
  const error: ErrorMessage = { type: 'ERROR', streamId, code, message };
  ws.send(JSON.stringify(error));
}
