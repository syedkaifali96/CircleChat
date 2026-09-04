import sharp from 'sharp';

/**
 * Thumbnail generation (M7.1, docs/ARCHITECTURE.md §9): chat images get a
 * max-400px-edge JPEG derivative stored alongside the original so bubbles
 * load a fraction of the bytes. Generation is best-effort — callers must not
 * fail the upload flow when it errors (fallback = original image).
 */

export const THUMBNAIL_MAX_EDGE = 400;

export function isImageKind(kind: string): boolean {
  return kind === 'image';
}

/** Generates a JPEG thumbnail (max 400px longest edge). Throws on failure. */
export async function generateThumbnail(bytes: Buffer): Promise<Buffer> {
  return sharp(bytes)
    .rotate() // respect EXIF orientation
    .resize(THUMBNAIL_MAX_EDGE, THUMBNAIL_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 75 })
    .toBuffer();
}
