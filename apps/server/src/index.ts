import { Server as SocketServer } from 'socket.io';
import { buildApp } from './app';
import { config } from './config';

/**
 * CircleChat server entrypoint (M0 foundation).
 *
 * Wires the Fastify app and the Socket.IO foundation onto one HTTP server with
 * clean startup/shutdown. Realtime authorization and messaging events arrive
 * in later milestones per docs/ARCHITECTURE.md §8 — intentionally none exist here.
 */
async function main(): Promise<void> {
  const app = await buildApp();

  const io = new SocketServer(app.server, {
    // M0: same-origin defaults, no CORS widening. M2 adds the session-token
    // handshake auth; M5 adds room joins with server-side membership checks.
  });
  io.on('connection', (socket) => {
    // Log the socket id only — never handshake auth payloads or headers.
    app.log.debug({ socketId: socket.id }, 'socket connected');
    socket.on('disconnect', (reason) => {
      app.log.debug({ socketId: socket.id, reason }, 'socket disconnected');
    });
  });

  // Idempotent shutdown: SIGINT + SIGTERM (or repeats) must not double-close.
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    try {
      io.close();
      await app.close();
    } catch (err) {
      app.log.error({ err }, 'error during shutdown');
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    app.log.info({ port: config.port, nodeEnv: config.nodeEnv }, 'circlechat server listening');
  } catch (err) {
    app.log.error({ err }, 'failed to start');
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error('Failed to start CircleChat server:', err instanceof Error ? err.message : err);
  process.exit(1);
});
