#!/usr/bin/env node
/**
 * Local MinIO lifecycle for development (S3-compatible stand-in for R2).
 *
 *   npm run minio        # start if not running (idempotent), wait for health
 *   npm run minio:stop   # stop the instance this script started
 *
 * No secrets are hardcoded: the MinIO root user/password are read from the
 * repo-root `.env` (R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY) — the same values
 * the server uses, so there is exactly one place to change them. The binary
 * and data directory live OUTSIDE the repo by default (override with the
 * MINIO_EXE / MINIO_DATA environment variables). See docs/DEPLOYMENT.md §3.1.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const HEALTH_URL = 'http://127.0.0.1:9000/minio/health/live';
const PID_FILE = join(homedir(), 'minio', 'minio.pid');

const mode = process.argv[2] ?? 'start';

function findMinioExe() {
  if (process.env.MINIO_EXE) {
    return process.env.MINIO_EXE;
  }
  const defaultPath = join(homedir(), 'minio', 'minio.exe');
  if (existsSync(defaultPath)) {
    return defaultPath;
  }
  // Non-Windows developer machines: expect minio on PATH.
  return 'minio';
}

function readEnvValue(name) {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) {
    return undefined;
  }
  const line = readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim() : undefined;
}

async function isHealthy() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      const res = await fetch(HEALTH_URL, { signal: controller.signal });
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

async function waitForHealth(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isHealthy()) {
      return true;
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  return false;
}

async function start() {
  if (await isHealthy()) {
    console.log('MinIO is already running on http://127.0.0.1:9000 (console: http://127.0.0.1:9001)');
    return;
  }

  const accessKey = readEnvValue('R2_ACCESS_KEY_ID');
  const secretKey = readEnvValue('R2_SECRET_ACCESS_KEY');
  if (!accessKey || !secretKey) {
    console.error('Could not find R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY in the repo-root .env.');
    console.error('MinIO root credentials come from those values — copy .env.example to .env first.');
    process.exit(1);
  }

  const exe = findMinioExe();
  const dataDir = process.env.MINIO_DATA ?? join(homedir(), 'minio', 'data');
  const child = spawn(
    exe,
    ['server', dataDir, '--address', ':9000', '--console-address', ':9001'],
    {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, MINIO_ROOT_USER: accessKey, MINIO_ROOT_PASSWORD: secretKey },
    },
  );
  child.unref();
  writeFileSync(PID_FILE, String(child.pid));

  if (await waitForHealth()) {
    console.log(`MinIO started (pid ${child.pid}) — API http://127.0.0.1:9000, console http://127.0.0.1:9001`);
    console.log(`Data directory: ${dataDir}`);
  } else {
    console.error(`MinIO (pid ${child.pid}) did not become healthy within 20s — check it manually.`);
    process.exit(1);
  }
}

async function stop() {
  if (!existsSync(PID_FILE)) {
    console.log('No MinIO pid file — nothing this script started.');
    return;
  }
  const pid = Number(readFileSync(PID_FILE, 'utf8').trim());
  try {
    process.kill(pid);
    console.log(`MinIO (pid ${pid}) stopped.`);
  } catch {
    console.log(`MinIO pid ${pid} was not running.`);
  } finally {
    unlinkSync(PID_FILE);
  }
}

if (mode === 'start') {
  await start();
} else if (mode === 'stop') {
  await stop();
} else {
  console.error('Usage: npm run minio | npm run minio:stop');
  process.exit(1);
}
