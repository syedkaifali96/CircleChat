/**
 * Expo Push gateway (M8, docs/ARCHITECTURE.md §10).
 *
 * The only server↔Expo boundary: `send` posts a batch to Expo's push API
 * and returns per-message tickets so callers can react to invalid tokens.
 * Failure-safe by contract — push delivery must never break message
 * persistence or realtime delivery (docs/ARCHITECTURE.md §8).
 *
 * When EXPO_ACCESS_TOKEN is absent (local dev/tests), the no-op gateway
 * silently swallows pushes; messaging behavior is unchanged.
 */

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

export interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  details?: { error?: string };
}

export interface ExpoPushGateway {
  send(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]>;
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo batches up to 100 messages per request. */
const BATCH_SIZE = 100;

/** Real gateway: posts to Expo Push over HTTPS with the access token. */
export class HttpExpoPushGateway implements ExpoPushGateway {
  constructor(private readonly accessToken: string) {}

  async send(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
    const tickets: ExpoPushTicket[] = [];
    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const batch = messages.slice(i, i + BATCH_SIZE);
      try {
        const response = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.accessToken}`,
          },
          body: JSON.stringify(batch),
        });
        if (!response.ok) {
          // Provider outage/quota: report every message in the batch as an
          // error ticket so the caller can log and move on.
          for (let j = 0; j < batch.length; j++) {
            tickets.push({ status: 'error', details: { error: `http_${response.status}` } });
          }
          continue;
        }
        const payload = (await response.json()) as { data?: ExpoPushTicket[] };
        tickets.push(...(payload.data ?? []));
      } catch {
        for (let j = 0; j < batch.length; j++) {
          tickets.push({ status: 'error', details: { error: 'network_error' } });
        }
      }
    }
    return tickets;
  }
}

/** No-op gateway: used when EXPO_ACCESS_TOKEN is not configured. */
export class NoOpExpoPushGateway implements ExpoPushGateway {
  async send(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
    void messages;
    return [];
  }
}

export function createExpoPushGateway(env: NodeJS.ProcessEnv = process.env): ExpoPushGateway {
  const token = env.EXPO_ACCESS_TOKEN;
  return token ? new HttpExpoPushGateway(token) : new NoOpExpoPushGateway();
}
