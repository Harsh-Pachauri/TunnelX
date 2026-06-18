import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { apiKeys } from './apiKeys.js';
import { users } from './users.js';

export const tunnels = pgTable(
  'tunnels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    apiKeyId: uuid('api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
    subdomain: text('subdomain').notNull(),
    targetPort: integer('target_port').notNull(),
    status: text('status').notNull().default('active'),
    connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
    disconnectedAt: timestamp('disconnected_at', { withTimezone: true }),
    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
  },
  (table) => ({
    userIdIdx: index('tunnels_user_id_idx').on(table.userId),
    // Source of truth for subdomain collisions: only one *active* tunnel may
    // hold a given subdomain at a time. Inactive history rows can repeat it.
    activeSubdomainIdx: uniqueIndex('tunnels_active_subdomain_idx')
      .on(table.subdomain)
      .where(sql`${table.status} = 'active'`),
    // Speeds up "list currently-active tunnels" (reconciliation, dashboard).
    activeStatusIdx: index('tunnels_active_status_idx').on(table.status).where(sql`${table.status} = 'active'`),
    statusCheck: check('tunnels_status_check', sql`${table.status} in ('active', 'inactive')`),
  }),
);

export type Tunnel = typeof tunnels.$inferSelect;
export type NewTunnel = typeof tunnels.$inferInsert;
