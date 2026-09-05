import { Server as SocketServer } from 'socket.io';
import { createDatabase } from './db/client';
import { buildApp } from './app';
import { config } from './config';
import { wireRealtime, conversationPublisher } from './realtime';
import { createPresenceRegistry } from './presence';
import { readR2StorageConfig, R2StorageGateway } from './modules/media/storage';
import { HttpExpoPushGateway } from './modules/notifications/expo';

/**
 * CircleChat server entrypoint.
 *
 * M2 wires the database, the authentication module and the authenticated
 * Socket.IO foundation (handshake session auth + revocation disconnects) onto
 * one HTTP server with clean startup/shutdown. M5 adds the messaging REST
 * modules plus minimal message change notifications (docs/ARCHITECTURE.md §8).
 */
async function main(): Promise<void> {
  if (!config.databaseUrl) {
    console.error('DATABASE_URL is required (docs/DEPLOYMENT.md §3). Startup aborted.');
    process.exit(1);
  }
  const db = createDatabase(config.databaseUrl);
  const r2Config = readR2StorageConfig();
  if (!r2Config) {
    console.error('R2 storage is not configured (docs/DEPLOYMENT.md section 3). Startup aborted.');
    process.exit(1);
  }
  const storage = new R2StorageGateway(r2Config);

  const io = new SocketServer({
    // Same-origin defaults, no CORS widening. Handshake auth: session token.
  });
  // One presence registry shared by Socket.IO and the REST presence endpoint:
  // a single source of truth for who is online in this process.
  const presence = createPresenceRegistry();
  const realtime = wireRealtime(io, db, config.sessionTtlDays, { presence });
  const publish = conversationPublisher(realtime);
  // M8: real Expo Push gateway when configured; buildApp falls back to the
  // no-op gateway for local dev/tests, where push delivery is irrelevant.
  const expoPush = config.expoAccessToken
    ? new HttpExpoPushGateway(config.expoAccessToken)
    : undefined;
  const app = await buildApp({ db, storage, publish, presence, expoPush });
  io.attach(app.server);
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
