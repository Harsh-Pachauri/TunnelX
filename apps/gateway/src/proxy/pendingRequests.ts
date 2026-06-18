import type { Response } from 'express';
import { recordRequestLog } from './requestLog.js';

export interface PendingRequest {
  res: Response;
  /** Which tunnel this request was sent to — lets us fail it if that tunnel disconnects. */
  tunnelId: string;
  /** Owner of the tunnel — used to scope dashboard WS push events. */
  userId: string;
  method: string;
  path: string;
  requestHeaders: Record<string, string>;
  /** null if the body was absent or exceeded BODY_CAP. */
  requestBody: Buffer | null;
  /** true when body.length > BODY_CAP; false when absent or within cap. */
  requestBodyTruncated: boolean;
  requestBytes: number;
  clientIp: string | null;
  userAgent: string | null;
  /** Set once RESPONSE_HEADERS arrives; null if the request never got a response. */
  statusCode: number | null;
  /** Set once RESPONSE_HEADERS arrives. */
  responseHeaders: Record<string, string>;
  /** Accumulated response body chunks up to BODY_CAP; empty if body was truncated early. */
  responseBodyChunks: Buffer[];
  responseBodySize: number;
  responseBodyTruncated: boolean;
  startTime: number;
  timeout: NodeJS.Timeout;
  bytesReceived: number;
  headersWritten: boolean;
}

/**
 * Tracks in-flight HTTP requests waiting on RESPONSE_* messages from the tunnel
 * client, keyed by streamId. This is the core of request/response multiplexing
 * over the single WS connection.
 */
class PendingRequestMap {
  private pending = new Map<string, PendingRequest>();

  add(streamId: string, entry: PendingRequest): void {
    this.pending.set(streamId, entry);
  }

  get(streamId: string): PendingRequest | undefined {
    return this.pending.get(streamId);
  }

  /** Removes and returns the entry, clearing its timeout. Use on RESPONSE_END or a terminal ERROR. */
  take(streamId: string): PendingRequest | undefined {
    const entry = this.pending.get(streamId);
    if (entry) {
      clearTimeout(entry.timeout);
      this.pending.delete(streamId);
    }
    return entry;
  }

  /** Ends every request still waiting on `tunnelId`. Called when that tunnel's connection drops. */
  failAllForTunnel(tunnelId: string, statusCode: number, message: string): void {
    for (const [streamId, entry] of this.pending) {
      if (entry.tunnelId !== tunnelId) continue;
      clearTimeout(entry.timeout);
      this.pending.delete(streamId);

      let finalStatusCode: number | null;
      if (entry.headersWritten) {
        entry.res.end();
        finalStatusCode = entry.statusCode;
      } else {
        entry.res.writeHead(statusCode, { 'content-type': 'text/plain' });
        entry.res.end(message);
        finalStatusCode = statusCode;
      }

      recordRequestLog(streamId, entry, {
        statusCode: finalStatusCode,
        responseBytes: entry.bytesReceived,
        error: 'tunnel_disconnected',
      });
    }
  }

  size(): number {
    return this.pending.size;
  }
}

export const pendingRequests = new PendingRequestMap();
