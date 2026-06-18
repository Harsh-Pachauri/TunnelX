import { db, users } from '@tunnelx/db';
import { eq } from 'drizzle-orm';

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
}

export interface UserPublic {
  id: string;
  email: string;
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const rows = await db
    .select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return rows[0] ?? null;
}

export async function findUserById(id: string): Promise<UserPublic | null> {
  const rows = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createUser(email: string, passwordHash: string): Promise<UserPublic> {
  const [row] = await db.insert(users).values({ email, passwordHash }).returning({ id: users.id, email: users.email });
  return row!;
}
