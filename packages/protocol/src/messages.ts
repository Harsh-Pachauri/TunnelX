/**
 * WebSocket protocol v1 — JSON messages exchanged between the tunnel client (CLI)
 * and the gateway over a single persistent connection. Binary bodies are base64-encoded
 * inside JSON for v1 (see docs/decisions.md for the tradeoff vs. a future binary framing v2).
 */

export const PROTOCOL_VERSION = '1.0';

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------

/** Client -> Gateway: sent once, immediately after the WS connection opens. */
export interface RegisterMessage {
  type: 'REGISTER';
  version: string;
  apiKey: string;
  clientId: string;
  localPort: number;
  requestedSubdomain?: string | null;
}

/** Gateway -> Client: confirms registration and assigns the public URL. */
export interface RegisteredMessage {
  type: 'REGISTERED';
  tunnelId: string;
  subdomain: string;
  publicUrl: string;
  heartbeatIntervalMs: number;
}

// ---------------------------------------------------------------------------
// Request/response multiplexing
// Every in-flight HTTP request is identified by a `streamId` (UUID) so many
// requests can be interleaved over the one WS connection.
// ---------------------------------------------------------------------------

/** Gateway -> Client: an inbound HTTP request that should be forwarded to localPort. */
export interface RequestMessage {
  type: 'REQUEST';
  streamId: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  /** base64-encoded request body, or null if empty. */
  body: string | null;
}

/** Client -> Gateway: status line + headers from the local server's response. */
export interface ResponseHeadersMessage {
  type: 'RESPONSE_HEADERS';
  streamId: string;
  statusCode: number;
  headers: Record<string, string>;
}

/** Client -> Gateway: one chunk of the response body, base64-encoded. */
export interface ResponseChunkMessage {
  type: 'RESPONSE_CHUNK';
  streamId: string;
  sequence: number;
  data: string;
}

/** Client -> Gateway: signals the response body is complete. */
export interface ResponseEndMessage {
  type: 'RESPONSE_END';
  streamId: string;
  totalChunks: number;
  totalBytes: number;
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

/** Gateway -> Client */
export interface PingMessage {
  type: 'PING';
  timestamp: number;
}

/** Client -> Gateway */
export interface PongMessage {
  type: 'PONG';
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Errors (bidirectional)
// ---------------------------------------------------------------------------

export type ErrorCode =
  | 'INVALID_API_KEY'
  | 'SUBDOMAIN_TAKEN'
  | 'LOCAL_CONNECTION_REFUSED'
  | 'LOCAL_TIMEOUT'
  | 'BODY_TOO_LARGE'
  | 'PROTOCOL_VERSION_MISMATCH'
  | 'UNKNOWN_STREAM'
  | 'INVALID_MESSAGE';

/** Either side may send this. `streamId` is present when the error relates to one in-flight request. */
export interface ErrorMessage {
  type: 'ERROR';
  streamId?: string;
  code: ErrorCode;
  message: string;
}

// ---------------------------------------------------------------------------
// Unions
// ---------------------------------------------------------------------------

export type ClientToGatewayMessage =
  | RegisterMessage
  | ResponseHeadersMessage
  | ResponseChunkMessage
  | ResponseEndMessage
  | PongMessage
  | ErrorMessage;

export type GatewayToClientMessage =
  | RegisteredMessage
  | RequestMessage
  | PingMessage
  | ErrorMessage;

export type TunnelMessage = ClientToGatewayMessage | GatewayToClientMessage;
