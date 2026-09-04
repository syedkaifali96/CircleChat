import { isGifSearchConfigured, searchGiphy } from '../src/lib/giphy';
import { loadSessionToken } from '../src/auth/session';

/**
 * M7.1a GIPHY client tests — the client calls GIPHY directly (GIPHY API ToS
 * prohibits proxying through our server). The provider HTTP boundary is
 * stubbed at `fetch`; everything else (normalization, key handling, error
 * mapping) runs for real. Secure storage is mocked (session import chain).
 */

jest.mock('../src/auth/session', () => ({
  loadSessionToken: jest.fn().mockResolvedValue('test-token'),
  saveSessionToken: jest.fn(),
  clearSessionToken: jest.fn(),
}));

const originalKey = process.env.EXPO_PUBLIC_GIPHY_API_KEY;

afterEach(() => {
  if (originalKey === undefined) {
    delete process.env.EXPO_PUBLIC_GIPHY_API_KEY;
  } else {
    process.env.EXPO_PUBLIC_GIPHY_API_KEY = originalKey;
  }
  jest.restoreAllMocks();
});

describe('GIPHY client (M7.1a)', () => {
  it('reports unconfigured when no key is present', async () => {
    delete process.env.EXPO_PUBLIC_GIPHY_API_KEY;
    expect(isGifSearchConfigured()).toBe(false);
    await expect(searchGiphy('cats')).rejects.toMatchObject({ code: 'GIF_SEARCH_UNAVAILABLE' });
  });

  it('normalizes results (original + fixed_width preview) exactly as returned', async () => {
    process.env.EXPO_PUBLIC_GIPHY_API_KEY = 'test-key';
    const fetchMock = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            data: [
              {
                id: 'gif-1',
                images: {
                  original: { url: 'https://media.giphy.com/full.gif', width: '480', height: '360' },
                  fixed_width: { url: 'https://media.giphy.com/preview.gif', width: '200', height: '150' },
                },
              },
            ],
          }),
      }),
    );
    jest.spyOn(global, 'fetch').mockImplementation(fetchMock as unknown as typeof fetch);

    const results = await searchGiphy('happy');
    expect(results).toEqual([
      {
        id: 'gif-1',
        url: 'https://media.giphy.com/full.gif',
        previewUrl: 'https://media.giphy.com/preview.gif',
        width: 200,
        height: 150,
      },
    ]);
    // The request went straight to GIPHY (no server proxy) with the env key.
    const requestUrl = String((fetchMock.mock.calls as unknown[][])[0]?.[0] ?? '');
    expect(requestUrl).toContain('api.giphy.com/v1/gifs/search');
    expect(requestUrl).toContain('api_key=test-key');
  });

  it('maps GIPHY 429 to GIF_RATE_LIMITED with a retry-later message', async () => {
    process.env.EXPO_PUBLIC_GIPHY_API_KEY = 'test-key';
    jest.spyOn(global, 'fetch').mockImplementation(
      jest.fn(() => Promise.resolve({ ok: false, status: 429 })) as unknown as typeof fetch,
    );

    await expect(searchGiphy('cats')).rejects.toMatchObject({
      code: 'GIF_RATE_LIMITED',
      statusCode: 429,
    });
  });

  it('maps network failures to NETWORK_ERROR without crashing the caller', async () => {
    process.env.EXPO_PUBLIC_GIPHY_API_KEY = 'test-key';
    jest.spyOn(global, 'fetch').mockImplementation(
      jest.fn(() => Promise.reject(new Error('offline'))) as unknown as typeof fetch,
    );

    await expect(searchGiphy('cats')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('never loads the real session module (secure storage stays mocked)', () => {
    expect(jest.isMockFunction(loadSessionToken)).toBe(true);
  });
});
