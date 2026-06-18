import { insertRequestLog } from '../db/queries/index.js';
import { dashboardEvents } from '../ws/dashboardEvents.js';
import { bodyBuffer } from './bodyBuffer.js';
import type { PendingRequest } from './pendingRequests.js';

export interface RequestLogResult {
  statusCode: number | null;
  responseBytes: number;
  /** e.g. 'timeout', 'local_connection_refused', 'tunnel_disconnected' */
  error?: string;
}

/**
 * Fires an async insert into request_logs for a request that just reached a
 * terminal state (RESPONSE_END, gateway timeout, client ERROR, or tunnel
 * disconnect). After the insert resolves, stores body previews in the ring
 * buffer and pushes a new_request event to any subscribed dashboard clients.
 * Never throws — failures are logged and swallowed so a DB hiccup can't
 * affect the in-flight HTTP response.
 */
export function recordRequestLog(streamId: string, pending: PendingRequest, result: RequestLogResult): void {
  const durationMs = Date.now() - pending.startTime;

  const requestBody =
    pending.requestBody !== null ? pending.requestBody.toString('base64') : null;
  const responseBody =
    pending.responseBodyChunks.length > 0
      ? Buffer.concat(pending.responseBodyChunks).toString('base64')
      : null;

  insertRequestLog({
    tunnelId: pending.tunnelId,
    streamId,
    method: pending.method,
    path: pending.path,
    statusCode: result.statusCode,
    requestBytes: pending.requestBytes,
    responseBytes: result.responseBytes,
    durationMs,
    clientIp: pending.clientIp,
    userAgent: pending.userAgent,
    error: result.error ?? null,
  })
    .then((logId) => {
      bodyBuffer.store(logId, {
        requestHeaders: pending.requestHeaders,
        requestBody,
        requestBodyTruncated: pending.requestBodyTruncated,
        responseHeaders: pending.responseHeaders,
        responseBody,
        responseBodyTruncated: pending.responseBodyTruncated,
      });
      dashboardEvents.emitNewRequest(pending.userId, {
        id: logId,
        tunnelId: pending.tunnelId,
        streamId,
        method: pending.method,
        path: pending.path,
        statusCode: result.statusCode,
        requestBytes: pending.requestBytes,
        responseBytes: result.responseBytes,
        durationMs,
        clientIp: pending.clientIp,
        userAgent: pending.userAgent,
        error: result.error ?? null,
        createdAt: new Date().toISOString(),
      });
    })
    .catch((err) => console.error(`[stream ${streamId}] failed to insert request log:`, err));
}
