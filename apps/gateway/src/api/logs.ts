import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { getRequestLogById, getTunnelById, listRequestLogs, type RequestLogFilters } from '../db/queries/index.js';
import { bodyBuffer } from '../proxy/bodyBuffer.js';
import { logsQuerySchema } from './schemas.js';

export const logsRouter = Router();
logsRouter.use(requireAuth);

logsRouter.get('/', async (req, res) => {
  const parsed = logsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid query parameters' });
    return;
  }
  const { tunnelId, status, method, path, from, to, page, pageSize } = parsed.data;

  if (tunnelId) {
    const tunnel = await getTunnelById(req.user!.id, tunnelId);
    if (!tunnel) {
      res.status(404).json({ error: 'Tunnel not found' });
      return;
    }
  }

  const filters: RequestLogFilters = { tunnelId, method: method?.toUpperCase(), path, page, pageSize };
  if (from) filters.from = new Date(from);
  if (to) filters.to = new Date(to);
  if (status) {
    if (/^[1-5]xx$/i.test(status)) {
      filters.statusClass = Number(status[0]);
    } else {
      filters.statusCode = Number(status);
    }
  }

  const { items, total } = await listRequestLogs(req.user!.id, filters);
  res.json({ items, total, page, pageSize });
});

logsRouter.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: 'Invalid log id' });
    return;
  }

  const log = await getRequestLogById(req.user!.id, id);
  if (!log) {
    res.status(404).json({ error: 'Request log not found' });
    return;
  }
  res.json(log);
});

logsRouter.get('/:id/body', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: 'Invalid log id' });
    return;
  }

  // Verify ownership first (same ownership check as GET /:id).
  const log = await getRequestLogById(req.user!.id, id);
  if (!log) {
    res.status(404).json({ error: 'Request log not found' });
    return;
  }

  const bodies = bodyBuffer.get(id);
  if (!bodies) {
    res.status(410).json({ error: 'Body preview is no longer available (ring buffer expired)' });
    return;
  }

  res.json(bodies);
});
