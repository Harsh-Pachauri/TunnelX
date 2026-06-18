import { db, requestLogs, tunnels, type RequestLog } from '@tunnelx/db';
import { and, count, desc, eq, gte, ilike, lte, type SQL } from 'drizzle-orm';

export interface NewRequestLogEntry {
  tunnelId: string;
  streamId: string;
  method: string;
  path: string;
  statusCode: number | null;
  requestBytes: number;
  responseBytes: number;
  durationMs: number | null;
  clientIp: string | null;
  userAgent: string | null;
  error: string | null;
}

export async function insertRequestLog(entry: NewRequestLogEntry): Promise<number> {
  const rows = await db.insert(requestLogs).values(entry).returning({ id: requestLogs.id });
  return rows[0]!.id;
}

export interface RequestLogFilters {
  tunnelId?: string;
  statusCode?: number;
  /** First digit of a status class filter, e.g. 2 for "2xx", 5 for "5xx". */
  statusClass?: number;
  method?: string;
  path?: string;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

export interface RequestLogPage {
  items: RequestLog[];
  total: number;
}

const logColumns = {
  id: requestLogs.id,
  tunnelId: requestLogs.tunnelId,
  streamId: requestLogs.streamId,
  method: requestLogs.method,
  path: requestLogs.path,
  statusCode: requestLogs.statusCode,
  requestBytes: requestLogs.requestBytes,
  responseBytes: requestLogs.responseBytes,
  durationMs: requestLogs.durationMs,
  clientIp: requestLogs.clientIp,
  userAgent: requestLogs.userAgent,
  error: requestLogs.error,
  createdAt: requestLogs.createdAt,
};

function buildWhere(userId: string, filters: RequestLogFilters): SQL | undefined {
  const conditions = [eq(tunnels.userId, userId)];
  if (filters.tunnelId) conditions.push(eq(requestLogs.tunnelId, filters.tunnelId));
  if (filters.statusCode !== undefined) conditions.push(eq(requestLogs.statusCode, filters.statusCode));
  if (filters.statusClass !== undefined) {
    conditions.push(gte(requestLogs.statusCode, filters.statusClass * 100));
    conditions.push(lte(requestLogs.statusCode, filters.statusClass * 100 + 99));
  }
  if (filters.method) conditions.push(eq(requestLogs.method, filters.method));
  if (filters.path) conditions.push(ilike(requestLogs.path, `%${filters.path}%`));
  if (filters.from) conditions.push(gte(requestLogs.createdAt, filters.from));
  if (filters.to) conditions.push(lte(requestLogs.createdAt, filters.to));
  return and(...conditions);
}

export async function listRequestLogs(userId: string, filters: RequestLogFilters): Promise<RequestLogPage> {
  const where = buildWhere(userId, filters);

  const [items, totalRows] = await Promise.all([
    db
      .select(logColumns)
      .from(requestLogs)
      .innerJoin(tunnels, eq(requestLogs.tunnelId, tunnels.id))
      .where(where)
      .orderBy(desc(requestLogs.createdAt))
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize),
    db.select({ total: count() }).from(requestLogs).innerJoin(tunnels, eq(requestLogs.tunnelId, tunnels.id)).where(where),
  ]);

  return { items, total: Number(totalRows[0]?.total ?? 0) };
}

export async function getRequestLogById(userId: string, id: number): Promise<RequestLog | null> {
  const rows = await db
    .select(logColumns)
    .from(requestLogs)
    .innerJoin(tunnels, eq(requestLogs.tunnelId, tunnels.id))
    .where(and(eq(requestLogs.id, id), eq(tunnels.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}
