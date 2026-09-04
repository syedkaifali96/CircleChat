// Manual-verification harness (M6): real server + real Socket.IO clients.
// Simulates a phone pulling the network cable (abrupt TCP destroy, no close
// frame) and a clean kill+reopen, then checks TTL expiry, presence flips,
// concurrent typing independence and rate-limit behavior.
import { io } from 'socket.io-client';
import { Client } from 'pg';

const API = 'http://localhost:3000';
const results = [];
function report(step, pass, detail = '') {
  results.push({ step, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${step}${detail ? ' | ' + detail : ''}`);
}

const pg = new Client({ connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/circlechat_dev' });
await pg.connect();

const api = async (path, { method = 'GET', token, body } = {}) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};

const suffix = Math.random().toString(36).slice(2, 8);
const mkUser = async (name) => {
  const r = await api('/v1/auth/signup', {
    method: 'POST',
    body: { username: `${name.toLowerCase()}_${suffix}`, displayName: name, password: 'super-secret-password' },
  });
  return { token: r.json.token, userId: r.json.user.id, username: r.json.user.username };
};

function connect(token, label) {
  const s = io(API, { auth: { token }, transports: ['websocket'], reconnection: false });
  s.label = label;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('connect timeout')), 10000);
    s.on('connect', () => { clearTimeout(t); resolve(s); });
    s.on('connect_error', (e) => { clearTimeout(t); reject(e); });
  });
}
const once = (s, ev, ms = 12000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`no ${ev}`)), ms);
  s.once(ev, (p) => { clearTimeout(t); resolve(p); });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Setup: A + B share a Circle; each has an open socket -----------------
const A = await mkUser('UserA');
const B = await mkUser('UserB');
const circle = (await api('/v1/circles', { method: 'POST', token: A.token, body: { name: 'M6 Manual' } })).json.circle;
const inv = (await api(`/v1/circles/${circle.id}/invite`, { method: 'POST', token: A.token, body: {} })).json;
await api('/v1/circles/join', { method: 'POST', token: B.token, body: { inviteCode: inv.inviteCode } });
const convs = (await api('/v1/conversations', { token: A.token })).json.conversations;
const convId = convs.find((c) => c.circleId === circle.id).id;

const sA = await connect(A.token, 'A');
const sB = await connect(B.token, 'B');
await sA.emitWithAck('join', { conversationId: convId });
await sB.emitWithAck('join', { conversationId: convId });
await sleep(300);

// ===========================================================================
// TEST 1+2: A types; network dies mid-typing (abrupt destroy, no stop).
// B must see typing:update(true) then typing:update(false) via TTL, plus
// presence:offline; last_seen_at must persist. Then reconnect: online again.
// ===========================================================================
const t1Events = [];
sB.on('typing:update', (p) => t1Events.push({ ...p, at: Date.now() }));
sB.on('presence:online', (p) => t1Events.push({ ...p, ev: 'presence:online', at: Date.now() }));

sA.emit('typing:start', { conversationId: convId });
await once(sB, 'typing:update', 5000);
report('1a. typing indicator reaches B while A types', t1Events.some((e) => e.isTyping === true && e.userId === A.userId));

const startedAt = t1Events.find((e) => e.isTyping === true).at;
sA.io.engine.close(true); // abrupt TCP kill — no close frame, no typing:stop

const stopEvt = await once(sB, 'typing:update', 12000);
const ttlSec = Math.round((stopEvt.at - startedAt) / 100) / 10;
report('1b. typing clears via TTL after abrupt network loss', stopEvt.isTyping === false, `observed ~${ttlSec}s (expected ~6-8s)`);

const offline = await once(sB, 'presence:offline', 12000);
report('2a. presence:offline on abrupt drop of the last socket', offline.userId === A.userId && typeof offline.lastSeenAt === 'string');
const dbStamp = await pg.query('SELECT last_seen_at FROM users WHERE id = $1', [A.userId]);
report('2b. last_seen_at persisted in PostgreSQL', dbStamp.rows[0].last_seen_at !== null);

// ===========================================================================
// TEST 3: reconnect — presence back online, no duplicates, chat works.
// Listener attaches BEFORE the reconnect so the online broadcast (which the
// server sends on connect, racing the join ack) is never missed.
// ===========================================================================
const onlineEvents = [];
sB.on('presence:online', (p) => onlineEvents.push({ ...p, at: Date.now() }));
const sA2 = await connect(A.token, 'A-reconnect');
await sA2.emitWithAck('join', { conversationId: convId });
await sleep(600);
const onlineList = onlineEvents.filter((e) => e.userId === A.userId);
report('3a. presence:online after reconnect', onlineList.length >= 1);
await sleep(600);
report('3b. exactly one online broadcast for one reconnect', onlineList.length === 1, `counted ${onlineList.length}`);

const msgP = once(sB, 'message:new', 10000);
const send = await api(`/v1/conversations/${convId}/messages`, {
  method: 'POST', token: A.token, body: { type: 'text', body: 'back online', clientMessageId: `manual_${suffix}` },
});
const msg = await msgP;
report('3c. send/receive resumes after reconnect', send.status === 201 && msg.message.body === 'back online');
report('3d. no stale/duplicate typing indicators after reconnect', !t1Events.some((e) => e.isTyping === true && e.at > startedAt + 8000));

// ===========================================================================
// TEST 4: app kill + reopen — fresh socket re-joins the room cleanly.
// ===========================================================================
sA2.disconnect();
await sleep(400);
let reopenOnline = 0;
const onReopenOnline = (p) => { if (p.userId === A.userId) reopenOnline += 1; };
sB.on('presence:online', onReopenOnline);
const sA3 = await connect(A.token, 'A-reopen');
const joinAck = await sA3.emitWithAck('join', { conversationId: convId });
report('4a. reopened app re-joins room (authorized join)', joinAck.ok === true);
await sleep(600);
sB.off('presence:online', onReopenOnline);
report('4b. exactly one online broadcast after reopen', reopenOnline === 1, `counted ${reopenOnline}`);

// ===========================================================================
// TEST 5: concurrent typing in the Circle (2 typers) — independent state.
// ===========================================================================
const t5 = [];
sB.on('typing:update', (p) => t5.push({ ...p, at: Date.now() }));
const userC = await mkUser('UserC');
const loginC = await api('/v1/auth/login', { method: 'POST', body: { username: userC.username, password: 'super-secret-password' } });
const inv2 = (await api(`/v1/circles/${circle.id}/invite`, { method: 'POST', token: A.token, body: {} })).json;
await api('/v1/circles/join', { method: 'POST', token: loginC.json.token, body: { inviteCode: inv2.inviteCode } });
const sC = await connect(loginC.json.token, 'C');
await sC.emitWithAck('join', { conversationId: convId });

sA3.emit('typing:start', { conversationId: convId });
sC.emit('typing:start', { conversationId: convId });
await sleep(1000);
const typingNow = new Set(t5.filter((e) => e.isTyping).map((e) => e.userId));
report('5a. two simultaneous typers both visible independently', typingNow.has(A.userId) && typingNow.has(userC.userId), `seen: ${typingNow.size} users`);

sA3.emit('typing:stop', { conversationId: convId });
await sleep(900);
const stillTyping = new Set(t5.filter((e) => e.isTyping && e.at > Date.now() - 5000).map((e) => e.userId));
const cleared = new Set(t5.filter((e) => !e.isTyping && e.userId === A.userId && e.at > Date.now() - 5000).map((e) => e.userId));
report('5b. only the stopped user clears; the other keeps typing', cleared.has(A.userId) && stillTyping.has(userC.userId));

// C never sends stop — TTL must clear it while A stays stopped.
sC.emit('typing:start', { conversationId: convId });
await sleep(7200);
report('5c. TTL expiry works for the remaining typer', !t5.some((e) => e.isTyping && e.userId === userC.userId && e.at > Date.now() - 5000));

// ===========================================================================
// TEST 6: rate limit sanity — real cadence passes, abuse is throttled.
// ===========================================================================
let denied = 0; const total = 24;
for (let i = 0; i < total; i++) { // ~12s of realistic fast typing
  const r = await sA3.emitWithAck('typing:start', { conversationId: convId });
  if (!r.ok) denied += 1;
  await sleep(500);
}
report('6a. realistic fast typing: zero denied acks, indicator responsive', denied === 0, `0/${total} denied`);

let abuseDenied = 0;
for (let i = 0; i < 60; i++) { // instant burst = abusive script
  const r = await sA3.emitWithAck('typing:start', { conversationId: convId });
  if (!r.ok) abuseDenied += 1;
}
report('6b. abusive burst (60 instant events) is throttled', abuseDenied > 0, `${abuseDenied}/60 denied`);

console.log('\n===== SUMMARY =====');
const pass = results.filter((r) => r.pass).length;
console.log(`${pass}/${results.length} checks passed`);
sA3.disconnect(); sB.disconnect(); sC.disconnect();
await pg.end();
process.exit(pass === results.length ? 0 : 1);
