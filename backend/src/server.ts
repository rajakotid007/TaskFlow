import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import { buildApp } from './app.js';
import { config } from './config.js';
import { createSubscriber } from './realtime.js';
import { bullScheduler } from './queue.js';
import { setScheduler } from './services/scheduler.js';

const app = buildApp();
await app.register(websocket);

// WebSocket fan-out (Action Cable equivalent). Clients receive sanitized events only.
const clients = new Set<WebSocket>();
app.get('/cable', { websocket: true }, (socket) => {
  clients.add(socket);
  socket.on('close', () => clients.delete(socket));
  socket.send(JSON.stringify({ type: 'connected', at: new Date().toISOString() }));
});

const subscriber = createSubscriber((event) => {
  const message = JSON.stringify(event);
  for (const socket of clients) {
    if (socket.readyState === 1) socket.send(message);
  }
});

setScheduler(bullScheduler);

await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`TaskFlow API listening on http://localhost:${config.port}`);

const shutdown = async () => {
  subscriber.disconnect();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
