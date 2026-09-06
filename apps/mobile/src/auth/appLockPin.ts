import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { argon2id } from '@noble/hashes/argon2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { base64urlnopad } from '@scure/base';

/**
 * Local App-Lock PIN (M13, docs/ARCHITECTURE.md §2.8): the PIN is hashed with
 * salted Argon2id (the same documented approach as every other credential in
 * this repo — AGENTS.md hard rule 4) and stored ONLY in SecureStore as a
 * standard PHC-format string. Nothing about App Lock ever reaches the server.
 *
 * Parameters are the OWASP password-hashing recommendations for Argon2id
 * (m=19456 KiB, t=2, p=1, 32-byte tag) — light enough for one-shot verification
 * on phones. The PHC string carries the parameters, so future retunes stay
 * verifiable without a format change.
 */

const PIN_HASH_KEY = 'circlechat.applock.pin-hash';

const ARGON2_M_KIB = 19456;
const ARGON2_T = 2;
const ARGON2_P = 1;
const SALT_BYTES = 16;
const TAG_BYTES = 32;

/** 4–6 digits: short enough to enter on a lock screen, long enough to not be
 * trivially guessable for a local-only privacy layer. */
export function isValidAppLockPin(pin: string): boolean {
  return /^[0-9]{4,6}$/.test(pin);
}

function encodePhc(salt: Uint8Array, tag: Uint8Array): string {
  // Standard PHC string format for Argon2id: params are carried inline so
  // verification never depends on out-of-band constants.
  return [
    '$argon2id$',
    `v=19$m=${ARGON2_M_KIB},t=${ARGON2_T},p=${ARGON2_P}$`,
    `${base64urlnopad.encode(salt)}$`,
    base64urlnopad.encode(tag),
  ].join('');
}

function decodePhc(phc: string): { salt: Uint8Array; tag: Uint8Array } | null {
  // `$argon2id$v=19$m=…,t=…,p=…$<salt>$<tag>` → split on '$' keeps an empty
  // first element; the rest is [alg, version, params, salt, tag].
  const parts = phc.split('$').filter((part) => part.length > 0);
  if (parts.length !== 5) {
    return null;
  }
  const [alg, versionPart, paramsPart, saltPart, tagPart] = parts;
  if (alg !== 'argon2id' || versionPart !== 'v=19' || !paramsPart.startsWith('m=')) {
    return null;
  }
  try {
    return {
      salt: base64urlnopad.decode(saltPart),
      tag: base64urlnopad.decode(tagPart),
    };
  } catch {
    return null;
  }
}

function derive(pin: string, salt: Uint8Array): Uint8Array {
  return argon2id(utf8ToBytes(pin), salt, {
    m: ARGON2_M_KIB,
    t: ARGON2_T,
    p: ARGON2_P,
    dkLen: TAG_BYTES,
  });
}

/** Constant-time byte comparison — a wrong PIN must not verify faster or
 * slower depending on how many bytes matched. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export async function hasAppLockPin(): Promise<boolean> {
  return (await SecureStore.getItemAsync(PIN_HASH_KEY)) !== null;
}

export async function setupAppLockPin(pin: string): Promise<void> {
  if (!isValidAppLockPin(pin)) {
    throw new Error('PIN must be 4-6 digits.');
  }
  const salt = await Crypto.getRandomBytesAsync(SALT_BYTES);
  const tag = derive(pin, salt);
  await SecureStore.setItemAsync(PIN_HASH_KEY, encodePhc(salt, tag));
}

/** Recomputes the stored Argon2id derivation for the candidate PIN. */
export async function verifyAppLockPin(pin: string): Promise<boolean> {
  const stored = await SecureStore.getItemAsync(PIN_HASH_KEY);
  if (!stored) {
    return false;
  }
  const parsed = decodePhc(stored);
  if (!parsed) {
    // Corrupt/foreign record behaves like no-match; setup overwrites it.
    return false;
  }
  return timingSafeEqual(derive(pin, parsed.salt), parsed.tag);
}

export async function clearAppLockPin(): Promise<void> {
  await SecureStore.deleteItemAsync(PIN_HASH_KEY);
}
