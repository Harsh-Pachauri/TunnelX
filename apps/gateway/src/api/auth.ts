import { Router, type Response } from 'express';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../auth/jwt.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { config } from '../config.js';
import { createUser, findUserByEmail, findUserById } from '../db/queries/index.js';
import { loginSchema, registerSchema } from './schemas.js';

const REFRESH_COOKIE = 'tunnelx_refresh_token';

export const authRouter = Router();

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    // TODO: set `secure: true` once the gateway is served over HTTPS.
    maxAge: config.refreshTokenTtlSec * 1000,
    path: '/api/auth',
  });
}

authRouter.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'email must be valid and password must be at least 8 characters' });
    return;
  }

  const { email, password } = parsed.data;
  if (await findUserByEmail(email)) {
    res.status(409).json({ error: 'Email is already registered' });
    return;
  }

  const passwordHash = await hashPassword(password);
  const user = await createUser(email, passwordHash);

  const accessToken = signAccessToken({ sub: user.id, email: user.email });
  setRefreshCookie(res, signRefreshToken({ sub: user.id }));
  res.status(201).json({ user, accessToken });
});

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }

  const { email, password } = parsed.data;
  const user = await findUserByEmail(email);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const accessToken = signAccessToken({ sub: user.id, email: user.email });
  setRefreshCookie(res, signRefreshToken({ sub: user.id }));
  res.json({ user: { id: user.id, email: user.email }, accessToken });
});

authRouter.post('/refresh', async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) {
    res.status(401).json({ error: 'Missing refresh token' });
    return;
  }

  try {
    const payload = verifyRefreshToken(token);
    const user = await findUserById(payload.sub);
    if (!user) {
      res.status(401).json({ error: 'User no longer exists' });
      return;
    }

    const accessToken = signAccessToken({ sub: user.id, email: user.email });
    res.json({ accessToken });
  } catch {
    res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  res.status(204).end();
});
