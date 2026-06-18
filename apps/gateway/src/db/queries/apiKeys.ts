import { apiKeys, db, generateApiKey, hashApiKey, type ApiKey } from '@tunnelx/db';
import { and, desc, eq, isNull } from 'drizzle-orm';

export interface AuthenticatedKey {
  userId: string;
  apiKeyId: string;
}

/** Looks up an API key by its hash, rejecting revoked keys, and bumps last_used_at. */
export async function authenticateApiKey(rawKey: string): Promise<AuthenticatedKey | null> {
  const keyHash = hashApiKey(rawKey);
  const rows = await db
    .select({ id: apiKeys.id, userId: apiKeys.userId })
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));

  return { userId: row.userId, apiKeyId: row.id };
}

export type ApiKeySummary = Pick<ApiKey, 'id' | 'name' | 'keyPrefix' | 'createdAt' | 'lastUsedAt' | 'revokedAt'>;

export async function listApiKeys(userId: string): Promise<ApiKeySummary[]> {
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(desc(apiKeys.createdAt));
}

export interface CreatedApiKey {
  id: string;
  name: string;
  key: string;
  keyPrefix: string;
  createdAt: Date;
}

export async function createApiKey(userId: string, name: string): Promise<CreatedApiKey> {
  const { rawKey, keyPrefix, keyHash } = generateApiKey();
  const [row] = await db
    .insert(apiKeys)
    .values({ userId, name, keyPrefix, keyHash })
    .returning({ id: apiKeys.id, createdAt: apiKeys.createdAt });

  return { id: row!.id, name, key: rawKey, keyPrefix, createdAt: row!.createdAt };
}

/** Revokes a key owned by the given user. Returns false if not found, not owned, or already revoked. */
export async function revokeApiKey(userId: string, id: string): Promise<boolean> {
  const rows = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id });

  return rows.length > 0;
}
