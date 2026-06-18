import { createServer, type IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { runMigrations } from '@tunnelx/db';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { WebSocketServer } from 'ws';
import { apiRouter } from './api/index.js';
import { config } from './config.js';
import { reconcileStaleTunnels } from './db/queries/index.js';
import { handleTunnelRequest } from './proxy/router.js';
import { handleConnection } from './ws/server.js';
import { handleDashboardConnection, verifyDashboardClient } from './ws/dashboardServer.js';

const app = express();

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Scoped to /api so express.json() doesn't consume the raw body stream that
// the proxy below needs to forward byte-for-byte for tunneled requests.
app.use('/api', cors({ origin: config.dashboardOrigin, credentials: true }), express.json(), cookieParser(), apiRouter);

app.all('*', handleTunnelRequest);

const server = createServer(app);

// Use noServer mode so each WebSocketServer does NOT install its own upgrade
// listener (which would cause the non-matching server to call abortHandshake
// and destroy the socket that the other server already accepted).
const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
const dashboardWss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

wss.on('connection', handleConnection);
dashboardWss.on('connection', handleDashboardConnection);

// Route upgrade requests manually based on path.
server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
  const path = req.url?.split('?')[0];
  if (path === '/ws/tunnel') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else if (path === '/api/ws/dashboard') {
    verifyDashboardClient({ req }, (ok, code, message) => {
      if (!ok) {
        socket.write(`HTTP/1.1 ${code ?? 401} ${message ?? 'Unauthorized'}\r\n\r\n`);
        socket.destroy();
        return;
      }
      dashboardWss.handleUpgrade(req, socket, head, (ws) => dashboardWss.emit('connection', ws, req));
    });
  } else {
    socket.destroy();
  }
});

await runMigrations();

const reconciled = await reconcileStaleTunnels();
if (reconciled > 0) {
  console.log(`[startup] marked ${reconciled} stale tunnel session(s) as inactive`);
}

server.listen(config.port, () => {
  console.log(`TunnelX gateway listening on http://localhost:${config.port}`);
  console.log(`Tunnel clients connect to ws://localhost:${config.port}/ws/tunnel`);
});
