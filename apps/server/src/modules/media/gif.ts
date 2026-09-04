/**
 * GIF provider integration (M7.1) — docs/ARCHITECTURE.md §9.
 *
 * Provider: **Tenor (Google)** — chosen over Giphy because its free tier has
 * no attribution/branding requirements and the v2 API is a simple GET proxy.
 * The provider API key lives ONLY in the server environment
 * (`TENOR_API_KEY`, see .env.example); it is never sent to clients, and
 * search results are proxied + normalized by this server.
 *
 * Provider URLs (media.tenor.com) are public — they bypass the signed-URL
 * download flow deliberately. The MESSAGE itself remains gated by the D1
 * conversation-membership rule.
 */

const TENOR_SEARCH_URL = 'https://tenor.googleapis.com/v2/search';

export interface GifResult {
  id: string;
  url: string;
  previewUrl: string;
  width: number;
  height: number;
}

export function isGifSearchConfigured(): boolean {
  return typeof process.env.TENOR_API_KEY === 'string' && process.env.TENOR_API_KEY.length > 0;
}

function pickMediaVariant(formats: Record<string, { url: string; dims?: [number, number] }>, wanted: string): { url: string; width: number; height: number } | undefined {
  const variant = formats[wanted];
  if (!variant?.url) {
    return undefined;
  }
  const [width, height] = variant.dims ?? [0, 0];
  return { url: variant.url, width, height };
}

/** Fetches + normalizes Tenor search results; throws on provider errors. */
export async function searchGifs(query: string, limit = 12): Promise<GifResult[]> {
  const key = process.env.TENOR_API_KEY!;
  const url = `${TENOR_SEARCH_URL}?q=${encodeURIComponent(query)}&key=${encodeURIComponent(key)}&limit=${limit}&media_filter=gif,tinygif&client_key=circlechat_mvp`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`tenor_search_failed_${response.status}`);
  }
  const payload = (await response.json()) as {
    results?: Array<{
      id: string;
      media_formats?: Record<string, { url: string; dims?: [number, number] }>;
    }>;
  };
  const results: GifResult[] = [];
  for (const item of payload.results ?? []) {
    const full = pickMediaVariant(item.media_formats ?? {}, 'gif');
    const preview = pickMediaVariant(item.media_formats ?? {}, 'tinygif');
    if (!full || !preview) {
      continue;
    }
    results.push({
      id: item.id,
      url: full.url,
      previewUrl: preview.url,
      width: full.width,
      height: full.height,
    });
  }
  return results;
}
