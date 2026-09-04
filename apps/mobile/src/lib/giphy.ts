import { loadSessionToken } from '../auth/session';

/**
 * GIPHY client (M7.1a) — docs/ARCHITECTURE.md §9.
 *
 * IMPORTANT (GIPHY API ToS): requests to GIPHY must be made **directly from
 * the client** — proxying them through our server is explicitly prohibited.
 * That is why this module calls GIPHY from the app with `EXPO_PUBLIC_GIPHY_API_KEY`.
 * The key is public by GIPHY's own design (their beta keys ship inside apps);
 * a production-tier key requires GIPHY's app review once the "Powered By
 * GIPHY" attribution is live (manual step for the owner).
 *
 * Rules honored here: results are rendered exactly as GIPHY returns them
 * (no reordering/filtering), never mixed with another provider, and the
 * attribution mark is always shown alongside the grid.
 */

const GIPHY_SEARCH_URL = 'https://api.giphy.com/v1/gifs/search';

export interface GifResult {
  id: string;
  url: string;
  previewUrl: string;
  width: number;
  height: number;
}

export function isGifSearchConfigured(): boolean {
  return typeof process.env.EXPO_PUBLIC_GIPHY_API_KEY === 'string' && process.env.EXPO_PUBLIC_GIPHY_API_KEY.length > 0;
}

export class GiphyError extends Error {
  readonly code: string;
  readonly statusCode: number;
  constructor(code: string, statusCode: number, message: string) {
    super(message);
    this.name = 'GiphyError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/** Searches GIPHY directly from the client and normalizes the result shape. */
export async function searchGiphy(query: string, limit = 12): Promise<GifResult[]> {
  const apiKey = process.env.EXPO_PUBLIC_GIPHY_API_KEY;
  if (!apiKey) {
    throw new GiphyError('GIF_SEARCH_UNAVAILABLE', 503, 'GIF search is not configured.');
  }
  const url = `${GIPHY_SEARCH_URL}?api_key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(query)}&limit=${limit}&rating=g`;
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new GiphyError('NETWORK_ERROR', 0, 'Cannot reach GIPHY. Check your connection.');
  }
  if (response.status === 429) {
    // GIPHY dev-tier quota (~42 req/hour) — surface a retry-later message.
    throw new GiphyError('GIF_RATE_LIMITED', 429, 'Search temporarily unavailable, try again shortly.');
  }
  if (!response.ok) {
    throw new GiphyError('GIF_SEARCH_FAILED', response.status, 'GIF search failed. Try again.');
  }
  const payload = (await response.json()) as {
    data?: Array<{
      id: string;
      images?: {
        original?: { url?: string; width?: string; height?: string };
        fixed_width?: { url?: string; width?: string; height?: string };
      };
    }>;
  };
  const results: GifResult[] = [];
  for (const item of payload.data ?? []) {
    const original = item.images?.original;
    const preview = item.images?.fixed_width;
    if (!original?.url || !preview?.url) {
      continue;
    }
    results.push({
      id: item.id,
      url: original.url,
      previewUrl: preview.url,
      width: Number(preview.width ?? 0),
      height: Number(preview.height ?? 0),
    });
  }
  return results;
}

export { loadSessionToken };
void loadSessionToken; // re-export kept for future token-scoped GIF features
