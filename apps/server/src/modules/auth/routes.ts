import type { FastifyInstance } from 'fastify';
import {
  changePasswordSchema,
  loginSchema,
  publicUserSchema,
  pushTokenSchema,
  recoveryResetSchema,
  signupSchema,
} from '@circlechat/shared';
import { users } from '../../db/schema';
import type { Database } from '../../db/client';
import { invalidCredentials, rateLimited, usernameTaken, validationFailed } from '../../errors';
import { setSessionPushToken } from '../notifications/service';
import { generateRecoveryCode, hashSecret, normalizeRecoveryCode, verifySecret } from './crypto';
import { clearFailures, isBlocked, recordFailure } from './guard';
import {
  createSession,
  findUserByUsername,
  findUserById,
  getPasswordHash,
  listActiveSessions,
  revokeAllOtherSessions,
  revokeAllSessions,
  revokeSession,
  updatePasswordHash,
  updateRecoveryCodeHash,
} from './service';
import { getDummyPasswordHash } from './tokens';

const DEVICE_PLATFORMS = ['android', 'ios', 'other'] as const;

function deviceInfo(body: unknown): { deviceName: string; platform: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const deviceName =
    typeof b.deviceName === 'string' && b.deviceName.trim().length > 0 && b.deviceName.length <= 60
      ? b.deviceName.trim()
      : 'Unknown device';
  const platform =
    typeof b.platform === 'string' && (DEVICE_PLATFORMS as readonly string[]).includes(b.platform)
      ? b.platform
      : 'other';
  return { deviceName, platform };
}

function toPublicUser(row: {
  id: string;
  username: string;
  displayName: string;
  bio: string | null;
  avatarMediaId: string | null;
  createdAt: Date;
}): Record<string, unknown> {
  return publicUserSchema.parse({
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    bio: row.bio,
    avatarMediaId: row.avatarMediaId,
    createdAt: row.createdAt.toISOString(),
  });
}

/**
 * Authentication routes (docs/API.md): signup, login, change-password,
 * recovery-reset, logout, session listing and revocation.
 * Every handler validates with Zod, hashes with Argon2id and returns only
 * app-authored messages — no internals, no hashes; raw tokens appear exactly
 * once in the signup/login response.
 */
export interface AuthRoutesOptions {
  db: Database;
  ttlDays: number;
}

export async function authRoutes(app: FastifyInstance, options: AuthRoutesOptions): Promise<void> {
  const { db, ttlDays } = options;
  app.post(
    '/v1/auth/signup',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const parsed = signupSchema.safeParse(request.body);
      if (!parsed.success) {
        throw validationFailed();
      }
      const { username, displayName, password } = parsed.data;
      // Denylist: password must not contain the username (docs/SECURITY.md §4.2).
      if (password.toLowerCase().includes(username)) {
        throw validationFailed();
      }
      const existing = await findUserByUsername(db, username);
      if (existing) {
        throw usernameTaken();
      }
      const recoveryCode = generateRecoveryCode();
      const [passwordHash, recoveryCodeHash] = await Promise.all([
        hashSecret(password),
        hashSecret(normalizeRecoveryCode(recoveryCode)),
      ]);
      const inserted = await db
        .insert(users)
        .values({ username, displayName, passwordHash, recoveryCodeHash })
        .returning({ id: users.id });
      const user = await findUserById(db, inserted[0]!.id);
      const session = await createSession(db, {
        userId: user!.id,
        ...deviceInfo(request.body),
        ttlDays,
      });
      request.log.info({ userId: user!.id }, 'signup'); // audit event: no secrets
      await reply.code(201).send({ token: session.token, recoveryCode, user: toPublicUser(user!) });
    },
  );

  app.post(
    '/v1/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        throw invalidCredentials();
      }
      const { username, password } = parsed.data;
      const blockedSeconds = isBlocked(username);
      if (blockedSeconds > 0) {
        reply.header('retry-after', String(blockedSeconds));
        throw rateLimited();
      }
      const user = await findUserByUsername(db, username);
      // Unknown usernames still perform one Argon2 verification (timing equalization).
      const hashToVerify = user?.passwordHash ?? (await getDummyPasswordHash(hashSecret));
      const ok = await verifySecret(hashToVerify, password);
      if (!user || !ok) {
        recordFailure(username);
        throw invalidCredentials();
      }
      clearFailures(username);
      const session = await createSession(db, {
        userId: user.id,
        ...deviceInfo(request.body),
        ttlDays,
      });
      request.log.info({ userId: user.id }, 'login');
      await reply.send({ token: session.token, user: toPublicUser(user) });
    },
  );

  app.post(
    '/v1/auth/recovery-reset',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = recoveryResetSchema.safeParse(request.body);
      if (!parsed.success) {
        throw validationFailed();
      }
      const { username, recoveryCode, newPassword } = parsed.data;
      const blockedSeconds = isBlocked(username);
      if (blockedSeconds > 0) {
        reply.header('retry-after', String(blockedSeconds));
        throw rateLimited();
      }
      const user = await findUserByUsername(db, username);
      // Unknown usernames still perform one Argon2 verification (timing equalization).
      const hashToVerify = user?.recoveryCodeHash ?? (await getDummyPasswordHash(hashSecret));
      const codeOk = await verifySecret(hashToVerify, normalizeRecoveryCode(recoveryCode));
      if (!user || !codeOk) {
        recordFailure(username);
        throw invalidCredentials();
      }
      // Rotate the recovery code and revoke ALL sessions (docs/SECURITY.md §4.3).
      const newRecoveryCode = generateRecoveryCode();
      const [newPasswordHash, newRecoveryHash] = await Promise.all([
        hashSecret(newPassword),
        hashSecret(normalizeRecoveryCode(newRecoveryCode)),
      ]);
      await updatePasswordHash(db, user.id, newPasswordHash);
      await updateRecoveryCodeHash(db, user.id, newRecoveryHash);
      const revokedIds = await revokeAllSessions(db, user.id);
      // DB revocation is authoritative; disconnecting live sockets is the
      // immediate consequence (docs/SECURITY.md §3). ALL sessions die here.
      for (const sessionId of revokedIds) {
        request.server.revokeSessionSockets?.(sessionId);
      }
      request.log.info({ userId: user.id, revokedSessions: revokedIds.length }, 'recovery-reset');
      await reply.send({ recoveryCode: newRecoveryCode, revokedSessions: revokedIds.length });
    },
  );

  app.post('/v1/auth/logout', { config: { auth: true } }, async (request, reply) => {
    const { authUser } = request;
    const revoked = await revokeSession(db, authUser!.sessionId);
    request.server.revokeSessionSockets?.(authUser!.sessionId);
    request.log.info({ revoked }, 'logout');
    await reply.send({ ok: revoked });
  });

  app.post(
    '/v1/auth/change-password',
    { config: { auth: true, rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = changePasswordSchema.safeParse(request.body);
      if (!parsed.success) {
        throw validationFailed();
      }
      const { currentPassword, newPassword } = parsed.data;
      const { authUser } = request;
      const currentHash = await getPasswordHash(db, authUser!.userId);
      const ok = await verifySecret(currentHash, currentPassword);
      if (!ok) {
        throw invalidCredentials();
      }
      const newPasswordHash = await hashSecret(newPassword);
      await updatePasswordHash(db, authUser!.userId, newPasswordHash);
      // Current session stays valid; every other session is revoked (docs/SECURITY.md §4.4)
      // and its live sockets are disconnected — only the OTHER sessions.
      const revokedIds = await revokeAllOtherSessions(db, authUser!.userId, authUser!.sessionId);
      for (const sessionId of revokedIds) {
        request.server.revokeSessionSockets?.(sessionId);
      }
      request.log.info({ userId: authUser!.userId, revokedSessions: revokedIds.length }, 'change-password');
      await reply.send({ ok: true, revokedSessions: revokedIds.length });
    },
  );

  app.get('/v1/auth/sessions', { config: { auth: true } }, async (request, reply) => {
    const rows = await listActiveSessions(db, request.authUser!.userId);
    await reply.send({
      sessions: rows.map((row) => ({
        id: row.id,
        deviceName: row.deviceName,
        platform: row.platform,
        createdAt: row.createdAt.toISOString(),
        lastActiveAt: row.lastActiveAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        current: row.id === request.authUser!.sessionId,
      })),
    });
  });

  app.delete('/v1/auth/sessions/:id', { config: { auth: true } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    // Only sessions owned by the authenticated user can be revoked; foreign or
    // nonexistent ids are indistinguishable (404 for both).
    const target = await db.query.sessions.findFirst({ where: (s, ops) => ops.eq(s.id, id) });
    if (!target || target.userId !== request.authUser!.userId) {
      await reply.code(404).send({ code: 'NOT_FOUND', message: 'Session not found.' });
      return;
    }
    const revoked = await revokeSession(db, id);
    if (revoked) {
      request.server.revokeSessionSockets?.(id);
    }
    await reply.send({ ok: revoked });
  });

  app.delete('/v1/auth/sessions', { config: { auth: true } }, async (request, reply) => {
    const { authUser } = request;
    // Current session is preserved; all others are revoked and their sockets
    // disconnected.
    const revokedIds = await revokeAllOtherSessions(db, authUser!.userId, authUser!.sessionId);
    for (const sessionId of revokedIds) {
      request.server.revokeSessionSockets?.(sessionId);
    }
    request.log.info({ revokedSessions: revokedIds.length }, 'revoke-other-sessions');
    await reply.send({ ok: true, revokedSessions: revokedIds.length });
  });

  // M8 push token (Expo Push): bound to the CURRENT session (device = session,
  // docs/DATABASE.md §1.10). Registering a token moves it off any other
  // session owned by the user (one token = one device); clearing stops pushes
  // to this device. Rate-limited: token churn must not become write-amp abuse.
  app.put(
    '/v1/auth/push-token',
    { config: { auth: true, rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = pushTokenSchema.safeParse(request.body);
      if (!parsed.success) {
        throw validationFailed();
      }
      await setSessionPushToken(db, {
        sessionId: request.authUser!.sessionId,
        userId: request.authUser!.userId,
        pushToken: parsed.data.pushToken,
      });
      request.log.info('push token registered');
      await reply.send({ ok: true });
    },
  );

  app.delete('/v1/auth/push-token', { config: { auth: true } }, async (request, reply) => {
    await setSessionPushToken(db, {
      sessionId: request.authUser!.sessionId,
      userId: request.authUser!.userId,
      pushToken: null,
    });
    await reply.send({ ok: true });
  });
}
