import { db, tunnels, type Tunnel } from '@tunnelx/db';
import { and, desc, eq } from 'drizzle-orm';

export interface NewTunnelSession {
  id: string;
  userId: string;
  apiKeyId: string;
  subdomain: string;
  targetPort: number;
}

export async function createTunnelSession(session: NewTunnelSession): Promise<void> {
  await db.insert(tunnels).values({
    id: session.id,
    userId: session.userId,
    apiKeyId: session.apiKeyId,
    subdomain: session.subdomain,
    targetPort: session.targetPort,
    status: 'active',
  });
}

export async function closeTunnelSession(tunnelId: string): Promise<void> {
  await db
    .update(tunnels)
    .set({ status: 'inactive', disconnectedAt: new Date() })
    .where(eq(tunnels.id, tunnelId));
}

export async function touchTunnelHeartbeat(tunnelId: string): Promise<void> {
  await db.update(tunnels).set({ lastHeartbeatAt: new Date() }).where(eq(tunnels.id, tunnelId));
}

/**
 * Marks any tunnels left "active" from a previous gateway process as
 * inactive. The in-memory registry always starts empty, so any row still
 * "active" at boot is stale.
 */
export async function reconcileStaleTunnels(): Promise<number> {
  const closed = await db
    .update(tunnels)
    .set({ status: 'inactive', disconnectedAt: new Date() })
    .where(eq(tunnels.status, 'active'))
    .returning({ id: tunnels.id });
  return closed.length;
}

export type TunnelRecord = Tunnel;

export async function listTunnels(userId: string, status?: 'active' | 'inactive'): Promise<TunnelRecord[]> {
  const conditions = status
    ? and(eq(tunnels.userId, userId), eq(tunnels.status, status))
    : eq(tunnels.userId, userId);

  return db.select().from(tunnels).where(conditions).orderBy(desc(tunnels.connectedAt));
}

export async function getTunnelById(userId: string, id: string): Promise<TunnelRecord | null> {
  const rows = await db
    .select()
    .from(tunnels)
    .where(and(eq(tunnels.id, id), eq(tunnels.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}
