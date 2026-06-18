import { Router } from 'express';
import { apiKeysRouter } from './apiKeys.js';
import { authRouter } from './auth.js';
import { logsRouter } from './logs.js';
import { tunnelsRouter } from './tunnels.js';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/api-keys', apiKeysRouter);
apiRouter.use('/tunnels', tunnelsRouter);
apiRouter.use('/logs', logsRouter);
