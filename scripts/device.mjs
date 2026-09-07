#!/usr/bin/env node
/**
 * One-shot USB device setup for real-device development (design docs:
 * docs/DEPLOYMENT.md §3.1). Idempotent — safe to re-run any time:
 *
 *   npm run device
 *
 * Reverses the three dev ports from the connected Android device to this
 * machine so the phone can reach everything over USB via `localhost`:
 *   8081 → Metro (Expo), 3000 → API server, 9000 → MinIO (presigned media)
 *
 * Nothing is hardcoded per device or per network — `adb reverse` binds the
 * PHONE's localhost to THIS machine, no WiFi/IP configuration needed.
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const CANDIDATE_ADB = [
  process.env.ADB,
  join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
  '/usr/bin/adb',
  '/usr/local/bin/adb',
  'adb',
].filter(Boolean);

function findAdb() {
  for (const candidate of CANDIDATE_ADB) {
    try {
      execFileSync(candidate, ['version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      // try the next one
    }
  }
  return undefined;
}

const adb = findAdb();
if (!adb) {
  console.error('adb not found — install Android SDK platform-tools or set ADB=<path to adb>.');
  process.exit(1);
}

let devices;
try {
  devices = execFileSync(adb, ['devices'], { encoding: 'utf8' });
} catch (error) {
  console.error(`adb devices failed: ${error.message}`);
  process.exit(1);
}

const attached = devices
  .split(/\r?\n/)
  .slice(1)
  .filter((line) => line.trim().length > 0 && !line.startsWith('*'))
  .map((line) => line.split(/\s+/)[0]);

if (attached.length === 0) {
  console.error('No Android device attached. Connect the phone over USB (with USB debugging enabled) and re-run.');
  process.exit(1);
}

for (const port of [8081, 3000, 9000]) {
  try {
    execFileSync(adb, ['reverse', `tcp:${port}`, `tcp:${port}`], { stdio: 'ignore' });
    console.log(`reverse tcp:${port} → tcp:${port}`);
  } catch {
    console.error(`failed to reverse tcp:${port}`);
    process.exitCode = 1;
  }
}

console.log(`Device: ${attached.join(', ')}`);
console.log('The phone can now reach Metro :8081, the API :3000 and MinIO :9000 via localhost over USB.');
