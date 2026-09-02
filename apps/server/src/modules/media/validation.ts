import { AVATAR_MAX_BYTES, AVATAR_MIME_TYPES } from '@circlechat/shared';

/**
 * Media validation (docs/ARCHITECTURE.md §9, docs/SECURITY.md §7).
 * The client's declared MIME type is never trusted: after upload, the stored
 * bytes are sniffed with `file-type` and must match the allowlisted type the
 * upload intent pinned.
 */

export const UPLOAD_CAPS: Record<string, number> = {
  avatar: AVATAR_MAX_BYTES, // 2 MB
  image: 10 * 1024 * 1024,
  video: 50 * 1024 * 1024,
  voice: 10 * 1024 * 1024,
  file: 10 * 1024 * 1024,
};

export const MIME_ALLOWLIST: Record<string, readonly string[]> = {
  avatar: AVATAR_MIME_TYPES,
  image: AVATAR_MIME_TYPES,
  video: ['video/mp4'],
  voice: ['audio/aac', 'audio/m4a', 'audio/mp4'],
  file: [], // file uploads are not part of the MVP scope
};

/** Raster/audio signatures accepted in place of file-type for tiny prefixes. */
const SIGNATURES: Array<{ mime: string; test: (bytes: Buffer) => boolean }> = [
  { mime: 'image/jpeg', test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/png',
    test: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    mime: 'image/gif',
    test: (b) => b.length >= 6 && b.subarray(0, 3).toString('ascii') === 'GIF',
  },
  {
    mime: 'image/webp',
    test: (b) =>
      b.length >= 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  {
    mime: 'video/mp4',
    test: (b) => b.length >= 12 && b.subarray(4, 8).toString('ascii') === 'ftyp',
  },
  {
    mime: 'audio/mp4',
    test: (b) => b.length >= 12 && b.subarray(4, 8).toString('ascii') === 'ftyp',
  },
];

/**
 * Detects the true MIME type of the stored bytes. Returns undefined when no
 * allowlisted signature matches — the upload is then rejected.
 */
export function sniffMimeType(bytes: Buffer): string | undefined {
  for (const signature of SIGNATURES) {
    if (signature.test(bytes)) {
      return signature.mime;
    }
  }
  return undefined;
}

/** audio/aac + audio/m4a are ADTS/ISO container variants of the mp4 family. */
export function mimeFamilyMatches(declared: string, sniffed: string): boolean {
  if (declared === sniffed) {
    return true;
  }
  if (declared.startsWith('audio/') && sniffed === 'video/mp4') {
    // ftyp containers are shared by audio (m4a) and video (mp4).
    return ['audio/aac', 'audio/m4a', 'audio/mp4'].includes(declared);
  }
  return false;
}
