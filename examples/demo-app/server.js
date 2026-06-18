// Zero-dependency local server used to test TunnelX end-to-end.
// Run with: node examples/demo-app/server.js  (or `pnpm demo:app` from the repo root)
const http = require('node:http');

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    console.log(`${req.method} ${req.url}`);

    if (req.url === '/api/data') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'Hello from the local demo app', time: new Date().toISOString() }));
      return;
    }

    if (req.url === '/echo' && req.method === 'POST') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ youSent: body, length: body.length }));
      return;
    }

    if (req.url.startsWith('/slow')) {
      const requested = Number(new URL(req.url, 'http://localhost').searchParams.get('ms'));
      const delayMs = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 5000) : 800;
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'slow response', delayMs, finishedAt: new Date().toISOString() }));
      }, delayMs);
      return;
    }

    if (req.url === '/large') {
      // Written in several setImmediate-spaced chunks so the response is
      // streamed as multiple RESPONSE_CHUNK messages, not a single one.
      res.writeHead(200, { 'content-type': 'text/plain' });
      const chunk = 'x'.repeat(20_000);
      let sent = 0;
      const writeNext = () => {
        if (sent++ < 5) {
          res.write(chunk);
          setImmediate(writeNext);
        } else {
          res.end();
        }
      };
      writeNext();
      return;
    }

    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<html><body><h1>TunnelX demo app</h1><p>${req.method} ${req.url}</p></body></html>`);
  });
});

server.listen(PORT, () => {
  console.log(`Demo app listening on http://localhost:${PORT}`);
});
