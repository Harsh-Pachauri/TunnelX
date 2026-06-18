import { createHash, randomBytes } from 'node:crypto';

export interface GeneratedApiKey {
  rawKey: string;
  keyPrefix: string;
  keyHash: string;
}

export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

export function generateApiKey(): GeneratedApiKey {
  const rawKey = `tx_${randomBytes(24).toString('base64url')}`;
  return {
    rawKey,
    keyPrefix: rawKey.slice(0, 11),
    keyHash: hashApiKey(rawKey),
  };
}
