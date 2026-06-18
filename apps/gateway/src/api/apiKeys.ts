import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { createApiKey, listApiKeys, revokeApiKey } from '../db/queries/index.js';
import { createApiKeySchema } from './schemas.js';

export const apiKeysRouter = Router();
apiKeysRouter.use(requireAuth);

apiKeysRouter.get('/', async (req, res) => {
  res.json(await listApiKeys(req.user!.id));
});

apiKeysRouter.post('/', async (req, res) => {
  const parsed = createApiKeySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'name is required (1-100 characters)' });
    return;
  }

  const created = await createApiKey(req.user!.id, parsed.data.name);
  res.status(201).json(created);
});

apiKeysRouter.delete('/:id', async (req, res) => {
  const revoked = await revokeApiKey(req.user!.id, req.params.id);
  if (!revoked) {
    res.status(404).json({ error: 'API key not found' });
    return;
  }
  res.status(204).end();
});
