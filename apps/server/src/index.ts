import { Server as SocketServer } from 'socket.io';
import { createDatabase } from './db/client';
import { buildApp } from './app';
import { config } from './config';
import { wireRealtime } from './realtime';

/**
 * CircleChat server entrypoint.
 *
 * M2 wires the database, the authentication module and the authenticated
 * Socket.IO foundation (handshake session auth + revocation disconnects) onto
 * one HTTP server with clean startup/shutdown. No product realtime events
 * exist yet (docs/ARCHITECTURE.md §8 — messaging arrives in M5).
 */
async function main(): Promise<void> {
  if (!config.databaseUrl) {
    console.error('DATABASE_URL is required (docs/DEPLOYMENT.md §3). Startup aborted.');
    process.exit(1);
  }
  const db = createDatabase(config.databaseUrl);
  const app = await buildApp({ db });

  const io = new SocketServer(app.server, {
    // Same-origin defaults, no CORS widening. Handshake auth: session token.
  });
  const realtime = wireRealtime(io, db, config.sessionTtlDays);
  app.decorate('revokeSessionSockets', (sessionId: string) =>
    realtime.disconnectSessionSockets(sessionId),
  );

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
