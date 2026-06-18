export const config = {
  port: Number(process.env.PORT ?? 4000),
  baseDomain: process.env.BASE_DOMAIN ?? 'localhost:4000',
  /** Origin allowed to call /api with credentials (the dashboard dev server). */
  dashboardOrigin: process.env.DASHBOARD_ORIGIN ?? 'http://localhost:5173',
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 30_000),
  maxRequestBodyBytes: Number(process.env.MAX_REQUEST_BODY_BYTES ?? 10 * 1024 * 1024),
  /** How often the gateway pings each connected tunnel client. */
  heartbeatIntervalMs: Number(process.env.HEARTBEAT_INTERVAL_MS ?? 30_000),
  /** If no PONG is received within this window, the connection is considered dead. */
  heartbeatTimeoutMs: Number(process.env.HEARTBEAT_TIMEOUT_MS ?? 60_000),
  /** Symmetric signing secret for access + refresh JWTs. MUST be overridden in production. */
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-in-production',
  /** Access token lifetime, in seconds. */
  accessTokenTtlSec: Number(process.env.ACCESS_TOKEN_TTL_SEC ?? 15 * 60),
  /** Refresh token lifetime, in seconds. Also used as the refresh cookie's maxAge. */
  refreshTokenTtlSec: Number(process.env.REFRESH_TOKEN_TTL_SEC ?? 7 * 24 * 60 * 60),
};
