import type { Tunnel } from '@tunnelx/db';
import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { config } from '../config.js';
import { getTunnelById, listTunnels } from '../db/queries/index.js';
import { registry } from '../registry/index.js';

export const tunnelsRouter = Router();
tunnelsRouter.use(requireAuth);

function toSummary(tunnel: Tunnel) {
  const live = tunnel.status === 'active' ? registry.get(tunnel.subdomain) : undefined;
  return {
    id: tunnel.id,
    subdomain: tunnel.subdomain,
    publicUrl: `http://${tunnel.subdomain}.${config.baseDomain}`,
    targetPort: tunnel.targetPort,
    status: tunnel.status,
    connectedAt: tunnel.connectedAt,
    disconnectedAt: tunnel.disconnectedAt,
    latencyMs: live?.lastLatencyMs ?? null,
  };
}

function toDetail(tunnel: Tunnel) {
  return {
    ...toSummary(tunnel),
    apiKeyId: tunnel.apiKeyId,
    lastHeartbeatAt: tunnel.lastHeartbeatAt,
  };
}

tunnelsRouter.get('/', async (req, res) => {
  const status = req.query.status;
  if (status !== undefined && status !== 'active' && status !== 'all') {
    res.status(400).json({ error: "status must be 'active' or 'all'" });
    return;
  }

  const rows = await listTunnels(req.user!.id, status === 'active' ? 'active' : undefined);
  res.json(rows.map(toSummary));
});

tunnelsRouter.get('/:id', async (req, res) => {
  const tunnel = await getTunnelById(req.user!.id, req.params.id);
  if (!tunnel) {
    res.status(404).json({ error: 'Tunnel not found' });
    return;
  }
  res.json(toDetail(tunnel));
});
