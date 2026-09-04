import type { FastifyInstance } from 'fastify';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createDatabase, type Database } from '../../db/client';
import { InMemoryStorageGateway } from '../media/storage';
import { migrateTestDatabase, resolveTestDatabaseUrl, startEmbeddedPostgres } from '../../db/testing';

/**
 * M7.1 external-GIF tests — provider-agnostic (GIPHY client-side search;
 * this server never proxies a GIF provider per its ToS). Covers the send
 * contract only: type='gif' + https external_url, idempotent retries, URL
 * validation, and D1-gated visibility of the resulting message.
 */

let client: Client;
let stopEmbedded: (() => Promise<void>) | undefined;
let db: Database;
let app: FastifyInstance;

const suffix = () => Math.random().toString(36).slice(2, 10);

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function signup(username: string): Promise<{ token: string; userId: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/signup',
    payload: { username, displayName: `Display ${username}`, password: 'super-secret-password' },
  });
  const body = res.json() as { token: string; user: { id: string } };
  return { token: body.token, userId: body.user.id };
}

async function setupCircleConversation(memberTokens: string[]): Promise<{ owner: { token: string; userId: string }; conversationId: string }> {
  const owner = await signup(`m71_ow_${suffix()}`);
  const created = await app.inject({
    method: 'POST',
    url: '/v1/circles',
    headers: bearer(owner.token),
    payload: { name: `M71 ${suffix()}` },
  });
  const circleId = (created.json() as { circle: { id: string } }).circle.id;
  const invite = await app.inject({
    method: 'POST',
    url: `/v1/circles/${circleId}/invite`,
    headers: bearer(owner.token),
    payload: {},
  });
  const code = (invite.json() as { inviteCode: string }).inviteCode;
  for (const token of memberTokens) {
    await app.inject({
      method: 'POST',
      url: '/v1/circles/join',
      headers: bearer(token),
      payload: { inviteCode: code },
    });
  }
  const list = await app.inject({ method: 'GET', url: '/v1/conversations', headers: bearer(owner.token) });
  const conversationId = (list.json() as { conversations: Array<{ id: string; circleId: string | null }> })
    .conversations.find((c) => c.circleId === circleId)!.id;
  return { owner, conversationId };
}

beforeAll(async () => {
  let url = resolveTestDatabaseUrl();
  if (!url) {
    const embedded = await startEmbeddedPostgres();
    stopEmbedded = embedded.stop;
    url = embedded.url;
  }
  client = new Client({ connectionString: url });
  await client.connect();
  await migrateTestDatabase(client);
  db = createDatabase(url);
  app = await buildApp({ db, storage: new InMemoryStorageGateway(), logger: { level: 'error' } });
}, 300_000);

afterAll(async () => {
  await db.$client.end();
  await client?.end();
  await stopEmbedded?.();
}, 60_000);

describe('external GIF messages (M7.1a, provider-agnostic)', () => {
  it('creates a gif message + external media row; idempotent on retry', async () => {
    const member = await signup(`m71_g_${suffix()}`);
    const { conversationId } = await setupCircleConversation([member.token]);
    const cmi = `gif_${suffix()}`;

    const send = async () =>
      app.inject({
        method: 'POST',
        url: `/v1/conversations/${conversationId}/messages`,
        headers: bearer(member.token),
        payload: {
          type: 'gif',
          externalUrl: 'https://media.giphy.com/abc123/giphy.gif',
          clientMessageId: cmi,
        },
      });

    const first = await send();
    expect(first.statusCode).toBe(201);
    const message = first.json().message as Record<string, unknown>;
    expect(message.type).toBe('gif');
    const media = message.media as Record<string, unknown>;
    expect(media.mimeType).toBe('image/gif');
    expect(media.externalUrl).toBe('https://media.giphy.com/abc123/giphy.gif');

    const retry = await send();
    expect(retry.statusCode).toBe(200);
    expect((retry.json().message as { id: string }).id).toBe((message as { id: string }).id);

    const mediaRows = await client.query<{ external_url: string | null; storage_key: string }>(
      `SELECT external_url, storage_key FROM media WHERE conversation_id = $1`,
      [conversationId],
    );
    expect(mediaRows.rows).toHaveLength(1);
    expect(mediaRows.rows[0]!.external_url).toBe('https://media.giphy.com/abc123/giphy.gif');
    expect(mediaRows.rows[0]!.storage_key).toMatch(/^external\//);
  });

  it('rejects gif messages without a URL and non-https URLs', async () => {
    const member = await signup(`m71_gr_${suffix()}`);
    const { conversationId } = await setupCircleConversation([member.token]);

    const noUrl = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/messages`,
      headers: bearer(member.token),
      payload: { type: 'gif', clientMessageId: `g1_${suffix}` },
    });
    expect(noUrl.statusCode).toBe(400);

    const http = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/messages`,
      headers: bearer(member.token),
      payload: { type: 'gif', externalUrl: 'http://insecure.example/gif.gif', clientMessageId: `g2_${suffix}` },
    });
    expect(http.statusCode).toBe(400);
  });

  it('keeps gif-message visibility D1-gated regardless of the public media URL', async () => {
    const member = await signup(`m71_gv_${suffix()}`);
    const outsider = await signup(`m71_gvo_${suffix()}`);
    const { conversationId } = await setupCircleConversation([member.token]);

    await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/messages`,
      headers: bearer(member.token),
      payload: {
        type: 'gif',
        externalUrl: 'https://media.giphy.com/visible/giphy.gif',
        clientMessageId: `gv_${suffix}`,
      },
    });

    // Non-members cannot even list the conversation's messages.
    const denied = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${conversationId}/messages`,
      headers: bearer(outsider.token),
    });
    expect(denied.statusCode).toBe(404);
    expect(denied.json().code).toBe('NOT_FOUND');
  });
});
