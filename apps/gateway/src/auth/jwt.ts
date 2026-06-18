import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export interface AccessTokenPayload {
  sub: string;
  email: string;
}

export interface RefreshTokenPayload {
  sub: string;
}

export function signAccessToken(user: AccessTokenPayload): string {
  return jwt.sign({ type: 'access', email: user.email }, config.jwtSecret, {
    subject: user.sub,
    expiresIn: config.accessTokenTtlSec,
  });
}

export function signRefreshToken(user: RefreshTokenPayload): string {
  return jwt.sign({ type: 'refresh' }, config.jwtSecret, {
    subject: user.sub,
    expiresIn: config.refreshTokenTtlSec,
  });
}

/** Throws if the token is missing, expired, malformed, or not an access token. */
export function verifyAccessToken(token: string): AccessTokenPayload {
  const payload = jwt.verify(token, config.jwtSecret);
  if (typeof payload === 'string' || payload.type !== 'access' || typeof payload.sub !== 'string') {
    throw new Error('Not an access token');
  }
  return { sub: payload.sub, email: payload.email as string };
}

/** Throws if the token is missing, expired, malformed, or not a refresh token. */
export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const payload = jwt.verify(token, config.jwtSecret);
  if (typeof payload === 'string' || payload.type !== 'refresh' || typeof payload.sub !== 'string') {
    throw new Error('Not a refresh token');
  }
  return { sub: payload.sub };
}
