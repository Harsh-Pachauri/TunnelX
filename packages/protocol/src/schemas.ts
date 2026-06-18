import { z } from 'zod';

export const errorCodeSchema = z.enum([
  'INVALID_API_KEY',
  'SUBDOMAIN_TAKEN',
  'LOCAL_CONNECTION_REFUSED',
  'LOCAL_TIMEOUT',
  'BODY_TOO_LARGE',
  'PROTOCOL_VERSION_MISMATCH',
  'UNKNOWN_STREAM',
  'INVALID_MESSAGE',
]);

export const registerSchema = z.object({
  type: z.literal('REGISTER'),
  version: z.string(),
  apiKey: z.string().min(1),
  clientId: z.string().uuid(),
  localPort: z.number().int().min(1).max(65535),
  requestedSubdomain: z
    .string()
    .regex(/^[a-z0-9-]{3,30}$/)
    .nullish(),
});

export const registeredSchema = z.object({
  type: z.literal('REGISTERED'),
  tunnelId: z.string().uuid(),
  subdomain: z.string(),
  publicUrl: z.string().url(),
  heartbeatIntervalMs: z.number().int().positive(),
});

export const requestSchema = z.object({
  type: z.literal('REQUEST'),
  streamId: z.string().uuid(),
  method: z.string(),
  path: z.string(),
  headers: z.record(z.string()),
  body: z.string().nullable(),
});

export const responseHeadersSchema = z.object({
  type: z.literal('RESPONSE_HEADERS'),
  streamId: z.string().uuid(),
  statusCode: z.number().int().min(100).max(599),
  headers: z.record(z.string()),
});

export const responseChunkSchema = z.object({
  type: z.literal('RESPONSE_CHUNK'),
  streamId: z.string().uuid(),
  sequence: z.number().int().nonnegative(),
  data: z.string(),
});

export const responseEndSchema = z.object({
  type: z.literal('RESPONSE_END'),
  streamId: z.string().uuid(),
  totalChunks: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
});

export const pingSchema = z.object({
  type: z.literal('PING'),
  timestamp: z.number(),
});

export const pongSchema = z.object({
  type: z.literal('PONG'),
  timestamp: z.number(),
});

export const errorSchema = z.object({
  type: z.literal('ERROR'),
  streamId: z.string().uuid().optional(),
  code: errorCodeSchema,
  message: z.string(),
});

export const clientToGatewaySchema = z.discriminatedUnion('type', [
  registerSchema,
  responseHeadersSchema,
  responseChunkSchema,
  responseEndSchema,
  pongSchema,
  errorSchema,
]);

export const gatewayToClientSchema = z.discriminatedUnion('type', [
  registeredSchema,
  requestSchema,
  pingSchema,
  errorSchema,
]);

export const tunnelMessageSchema = z.discriminatedUnion('type', [
  registerSchema,
  registeredSchema,
  requestSchema,
  responseHeadersSchema,
  responseChunkSchema,
  responseEndSchema,
  pingSchema,
  pongSchema,
  errorSchema,
]);
