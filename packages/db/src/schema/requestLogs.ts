import { bigserial, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tunnels } from './tunnels.js';

export const requestLogs = pgTable(
  'request_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tunnelId: uuid('tunnel_id')
      .notNull()
      .references(() => tunnels.id, { onDelete: 'cascade' }),
    streamId: text('stream_id').notNull(),
    method: text('method').notNull(),
    path: text('path').notNull(),
    statusCode: integer('status_code'),
    requestBytes: integer('request_bytes').notNull().default(0),
    responseBytes: integer('response_bytes').notNull().default(0),
    durationMs: integer('duration_ms'),
    clientIp: text('client_ip'),
    userAgent: text('user_agent'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // The dashboard's primary query: "recent requests for this tunnel," already sorted.
    tunnelCreatedIdx: index('request_logs_tunnel_id_created_at_idx').on(table.tunnelId, table.createdAt.desc()),
    // Supports a retention job (DELETE WHERE created_at < now() - interval) and global recent-activity views.
    createdAtIdx: index('request_logs_created_at_idx').on(table.createdAt),
  }),
);

export type RequestLog = typeof requestLogs.$inferSelect;
export type NewRequestLog = typeof requestLogs.$inferInsert;
