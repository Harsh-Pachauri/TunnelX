import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { WebSocket } from 'ws';
import type { RequestMessage } from '@tunnelx/protocol';
import { config } from '../config.js';
import { registry } from '../registry/index.js';
import { BODY_CAP } from './bodyBuffer.js';
import { pendingRequests } from './pendingRequests.js';
import { recordRequestLog } from './requestLog.js';

export async function handleTunnelRequest(req: Request, res: Response): Promise<void> {
  const subdomain = extractSubdomain(req.headers.host);
  if (!subdomain) {
    res
      .status(400)
      .send('TunnelX gateway: request must include a subdomain, e.g. http://<subdomain>.tunnelx.dev');
    return;
  }

  const tunnel = registry.get(subdomain);
  if (!tunnel) {
    res.status(404).send(`No active tunnel for "${subdomain}"`);
    return;
  }
  if (tunnel.ws.readyState !== WebSocket.OPEN) {
    res.status(502).send('Tunnel client is disconnected');
    return;
  }

  let body: Buffer;
  try {
    body = await readBody(req, config.maxRequestBodyBytes);
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      res.status(413).send('Request body exceeds the maximum allowed size');
    } else {
      res.status(400).send('Failed to read request body');
    }
    return;
  }

  const streamId = randomUUID();
  const timeout = setTimeout(() => {
    const pending = pendingRequests.take(streamId);
    if (!pending) return;
    pending.res.status(504).send('Gateway timeout: local server did not respond in time');
    recordRequestLog(streamId, pending, {
      statusCode: pending.statusCode ?? 504,
      responseBytes: pending.bytesReceived,
      error: 'timeout',
    });
  }, config.requestTimeoutMs);

  pendingRequests.add(streamId, {
    res,
    tunnelId: tunnel.tunnelId,
    userId: tunnel.userId,
    method: req.method,
    path: req.originalUrl,
    requestHeaders: flattenHeaders(req.headers),
    requestBody: body.length > 0 && body.length <= BODY_CAP ? body : null,
    requestBodyTruncated: body.length > BODY_CAP,
    requestBytes: body.length,
    clientIp: req.ip ?? null,
    userAgent: req.headers['user-agent'] ?? null,
    statusCode: null,
    responseHeaders: {},
    responseBodyChunks: [],
    responseBodySize: 0,
    responseBodyTruncated: false,
    startTime: Date.now(),
    timeout,
    bytesReceived: 0,
    headersWritten: false,
  });

  const message: RequestMessage = {
    type: 'REQUEST',
    streamId,
    method: req.method,
    path: req.originalUrl,
    headers: flattenHeaders(req.headers),
    body: body.length > 0 ? body.toString('base64') : null,
  };

  console.log(`[stream ${streamId}] -> ${tunnel.subdomain} ${req.method} ${req.originalUrl}`);
  tunnel.ws.send(JSON.stringify(message));
}

export function extractSubdomain(host: string | undefined): string | null {
  if (!host) return null;
  const hostname = host.split(':')[0];
  const parts = hostname.split('.');
  if (parts.length < 2) return null;
  return parts[0];
}

function flattenHeaders(headers: Request['headers']): Record<string, string> {
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

class BodyTooLargeError extends Error {}

function readBody(req: Request, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new BodyTooLargeError('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
