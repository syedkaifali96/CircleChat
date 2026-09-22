import { render, screen, fireEvent, waitFor, within } from '@testing-library/react-native';
import ConversationScreen from '../app/(app)/chats/[id]';
import * as apiModule from '../src/lib/api';

/**
 * M14.3 direct-chat reply tests: the API accepts replyToId for every
 * conversation type, so the long-press menu in a direct chat must offer the
 * same Reply action as Circle chats. Selecting it shows the composer quote
 * preview, sending attaches replyToId, and Cancel clears the pending reply.
 * Server-side validation (same-conversation check) is covered by the
 * messages module tests; these cover the UI seam only.
 */

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest factory must be CJS
  const { Text: RNText, Pressable: RNPressable } = require('react-native');
  return {
    Link: ({ children, testID }: { children: React.ReactNode; testID?: string }) => (
      <RNPressable testID={testID}>
        <RNText>{children}</RNText>
      </RNPressable>
    ),
    Redirect: ({ href }: { href: string }) => <RNText testID="redirect">{href}</RNText>,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    // Mirrors real semantics: run the callback once per focus (mount here).
    useFocusEffect: (callback: () => void) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest factory must be CJS
      const react = require('react');
      react.useEffect(() => {
        callback();
      }, [callback]);
    },
    useLocalSearchParams: () => ({ id: 'conv-1' }),
  };
});

jest.mock('react-native/Libraries/Components/Clipboard/Clipboard', () => ({
  setString: jest.fn(),
}));

jest.mock('../src/lib/api', () => ({
  ApiError: class ApiError extends Error {
    code: string;
    statusCode: number;
    constructor(code: string, statusCode: number, message: string) {
      super(message);
      this.code = code;
      this.statusCode = statusCode;
    }
  },
  listCircles: jest.fn().mockResolvedValue({ circles: [] }),
  listConversations: jest.fn(),
  createDirectConversation: jest.fn(),
  fetchChatHeader: jest.fn(),
  fetchMessages: jest.fn(),
  sendMessage: jest.fn(),
  editMessage: jest.fn(),
  deleteMessage: jest.fn(),
  addReaction: jest.fn(),
  addPin: jest.fn(),
  removePin: jest.fn(),
  removeReaction: jest.fn(),
  markConversationRead: jest.fn().mockResolvedValue({ unreadCount: 0, lastReadMessageId: null }),
  fetchMediaDownloadUrl: jest.fn(),
  fetchNotificationPref: jest.fn().mockResolvedValue({ pref: { muted: false } }),
  updateNotificationPref: jest.fn().mockResolvedValue({ pref: { muted: false } }),
}));

jest.mock('../src/auth/session', () => ({
  loadSessionToken: jest.fn().mockResolvedValue('test-token'),
  saveSessionToken: jest.fn(),
  clearSessionToken: jest.fn(),
}));

jest.mock('expo-av', () => ({
  Audio: {
    Sound: { createAsync: jest.fn().mockResolvedValue({ sound: { unloadAsync: jest.fn() }, status: {} }) },
    setAudioModeAsync: jest.fn(),
    requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
    Recording: jest.fn(),
    RecordingOptionsPresets: { HIGH_QUALITY: {} },
  },
}));

const mockUnsubscribe = jest.fn();
jest.mock('../src/lib/socket', () => ({
  subscribeToConversation: jest.fn().mockResolvedValue(() => mockUnsubscribe()),
  sendTypingStart: jest.fn(),
  sendTypingStop: jest.fn(),
  trackJoinedRoom: jest.fn(),
  untrackJoinedRoom: jest.fn(),
  resetSocket: jest.fn(),
}));

jest.mock('../src/auth/AuthContext', () => ({
  useAuth: () => ({
    status: 'authenticated',
    user: {
      id: 'me-1',
      username: 'kaif',
      displayName: 'Kaif',
      bio: null,
      avatarMediaId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    signOut: jest.fn(),
    updateUser: jest.fn(),
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const mockApi = apiModule as unknown as jest.Mocked<typeof apiModule>;

const directHeader = {
  type: 'direct' as const,
  circleId: null,
  title: 'Ayesha',
  avatarMediaId: null,
  subtitle: '@ayesha',
  circleRole: null,
};

const baseMessage = {
  conversationId: 'conv-1',
  senderId: 'me-1',
  senderUsername: 'kaif',
  senderDisplayName: 'Kaif',
  type: 'text' as const,
  body: null,
  mediaId: null,
  media: null,
  replyToId: null,
  replyPreview: null,
  editedAt: null,
  deleted: false,
  createdAt: '2026-09-03T10:00:00.000Z',
  reactions: [],
};

function message(overrides: Partial<apiModule.Message>): apiModule.Message {
  return { ...baseMessage, id: `m-${overrides.senderId ?? 'x'}`, ...overrides } as apiModule.Message;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.markConversationRead.mockResolvedValue({ unreadCount: 0, lastReadMessageId: null });
  mockApi.listCircles.mockResolvedValue({ circles: [] });
  mockApi.fetchNotificationPref.mockResolvedValue({ pref: { muted: false } } as never);
  mockApi.fetchChatHeader.mockResolvedValue({ header: directHeader } as never);
  mockApi.fetchMessages.mockResolvedValue({
    messages: [message({ id: 'dm-1', senderId: 'u2', senderDisplayName: 'Ayesha', body: 'hey, are we still on?' })],
    nextBeforeCursor: null,
  } as never);
});

async function renderOpenChat() {
  render(<ConversationScreen />);
  await waitFor(() => expect(screen.getByTestId('message-dm-1')).toBeTruthy(), { timeout: 8000 });
}

describe('direct chat reply UI (M14.3)', () => {
  it('long-press in a direct chat offers the Reply action', async () => {
    await renderOpenChat();
    fireEvent(screen.getByTestId('message-dm-1'), 'longPress');
    expect(screen.getByTestId('action-reply')).toBeTruthy();
  });

  it('selecting Reply shows the composer quote preview with sender and body', async () => {
    await renderOpenChat();
    fireEvent(screen.getByTestId('message-dm-1'), 'longPress');
    fireEvent.press(screen.getByTestId('action-reply'));

    expect(screen.queryByTestId('message-actions')).toBeNull();
    expect(screen.getByTestId('composer-quote')).toBeTruthy();
    expect(within(screen.getByTestId('composer-quote')).getByText('Ayesha')).toBeTruthy();
    expect(within(screen.getByTestId('composer-quote')).getByText('hey, are we still on?')).toBeTruthy();
  });

  it('sending with an active reply attaches replyToId and clears the quote bar', async () => {
    const sent = message({ id: 'sent-1', body: 'yes!', createdAt: '2026-09-03T10:02:00.000Z' });
    mockApi.sendMessage.mockResolvedValue({ message: sent, created: true } as never);

    await renderOpenChat();
    fireEvent(screen.getByTestId('message-dm-1'), 'longPress');
    fireEvent.press(screen.getByTestId('action-reply'));
    fireEvent.changeText(screen.getByTestId('composer-input'), 'yes!');
    fireEvent.press(screen.getByTestId('composer-send'));

    await waitFor(() =>
      expect(mockApi.sendMessage).toHaveBeenCalledWith(
        'test-token',
        'conv-1',
        expect.objectContaining({ body: 'yes!', replyToId: 'dm-1' }),
      ),
    );
    await waitFor(() => expect(screen.queryByTestId('composer-quote')).toBeNull());
    await waitFor(() => expect(screen.getByTestId('message-body-sent-1')).toBeTruthy());
  }, 30_000);

  it('Cancel clears the quote preview and the next send carries no replyToId', async () => {
    const sent = message({ id: 'sent-2', body: 'plain note', createdAt: '2026-09-03T10:03:00.000Z' });
    mockApi.sendMessage.mockResolvedValue({ message: sent, created: true } as never);

    await renderOpenChat();
    fireEvent(screen.getByTestId('message-dm-1'), 'longPress');
    fireEvent.press(screen.getByTestId('action-reply'));
    fireEvent.press(screen.getByTestId('quote-cancel'));
    expect(screen.queryByTestId('composer-quote')).toBeNull();

    fireEvent.changeText(screen.getByTestId('composer-input'), 'plain note');
    fireEvent.press(screen.getByTestId('composer-send'));

    await waitFor(() =>
      expect(mockApi.sendMessage).toHaveBeenCalledWith('test-token', 'conv-1', {
        body: 'plain note',
        clientMessageId: expect.any(String),
      }),
    );
  }, 30_000);

  it('a reply-target message renders its replyPreview in the bubble after refresh', async () => {
    mockApi.fetchMessages.mockResolvedValue({
      messages: [
        message({ id: 'dm-1', senderId: 'u2', senderDisplayName: 'Ayesha', body: 'hey, are we still on?' }),
        message({
          id: 'dm-2',
          senderId: 'u2',
          senderDisplayName: 'Ayesha',
          body: 'quoting me',
          replyToId: 'dm-1',
          replyPreview: { id: 'dm-1', senderUsername: 'kaif', body: 'hey, are we still on?', deleted: false },
        }),
      ],
      nextBeforeCursor: null,
    } as never);

    await renderOpenChat();
    const preview = screen.getByTestId('reply-preview-dm-2');
    expect(within(preview).getByText('@kaif')).toBeTruthy();
    expect(within(preview).getByText('hey, are we still on?')).toBeTruthy();
  });
});