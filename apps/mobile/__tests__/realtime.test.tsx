import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import ConversationScreen from '../app/(app)/chats/[id]';
import * as apiModule from '../src/lib/api';
import * as socketModule from '../src/lib/socket';

/**
 * M6 mobile realtime tests: typing signals debounce correctly (start on
 * keystroke, stop after idle, stop on send), the typing indicator renders
 * from typing:update events, presence events drive the header indicator, and
 * listeners are cleaned up on unmount. The socket client is mocked — real
 * socket behavior is proven by the server integration tests.
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
    useFocusEffect: () => undefined,
    useLocalSearchParams: () => ({ id: 'conv-1' }),
  };
});

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
  fetchChatHeader: jest.fn(),
  fetchMessages: jest.fn(),
  sendMessage: jest.fn(),
  markConversationRead: jest.fn().mockResolvedValue({ unreadCount: 0, lastReadMessageId: null }),
  addReaction: jest.fn(),
  removeReaction: jest.fn(),
  editMessage: jest.fn(),
  deleteMessage: jest.fn(),
}));

jest.mock('../src/auth/session', () => ({
  loadSessionToken: jest.fn().mockResolvedValue('test-token'),
  saveSessionToken: jest.fn(),
  clearSessionToken: jest.fn(),
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

// M6: the conversation screen subscribes to the shared socket; tests mock the
// client so no network connection is attempted (server behavior is covered by
// the real-socket integration tests).
jest.mock('../src/lib/socket', () => ({
  subscribeToConversation: jest.fn(),
  sendTypingStart: jest.fn(),
  sendTypingStop: jest.fn(),
  trackJoinedRoom: jest.fn(),
  resetSocket: jest.fn(),
}));

const mockApi = apiModule as unknown as jest.Mocked<typeof apiModule>;
const mockSocket = socketModule as unknown as {
  subscribeToConversation: jest.Mock;
  sendTypingStart: jest.Mock;
  sendTypingStop: jest.Mock;
  trackJoinedRoom: jest.Mock;
};

type TypingHandler = (payload: { conversationId: string; userId: string; isTyping: boolean }) => void;
type PresenceHandler = (payload: { userId: string; lastSeenAt: string | null; online: boolean }) => void;

let typingHandler: TypingHandler | null = null;
let presenceHandler: PresenceHandler | null = null;
let unsubscribeCalls = 0;

const header = { type: 'direct' as const, title: 'Ayesha', avatarMediaId: null, subtitle: '@ayesha', circleRole: null };
const sampleMessage = {
  id: 'm-1',
  conversationId: 'conv-1',
  senderId: 'u2',
  senderUsername: 'ayesha',
  senderDisplayName: 'Ayesha',
  type: 'text' as const,
  body: 'hello there',
  mediaId: null,
  replyToId: null,
  replyPreview: null,
  editedAt: null,
  deleted: false,
  createdAt: '2026-09-04T10:00:00.000Z',
  reactions: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  typingHandler = null;
  presenceHandler = null;
  unsubscribeCalls = 0;
  mockSocket.subscribeToConversation.mockImplementation(async (options) => {
    typingHandler = options.onTyping ?? null;
    presenceHandler = options.onPresence ?? null;
    return () => {
      unsubscribeCalls += 1;
    };
  });
  mockApi.fetchChatHeader.mockResolvedValue({ header });
  mockApi.fetchMessages.mockResolvedValue({
    messages: [sampleMessage],
    nextBeforeCursor: null,
  });
  mockApi.markConversationRead.mockResolvedValue({ unreadCount: 0, lastReadMessageId: null });
});

afterEach(() => {
  jest.useRealTimers();
});

async function renderLoadedScreen() {
  const view = render(<ConversationScreen />);
  await waitFor(() => expect(screen.getByTestId('message-m-1')).toBeTruthy(), { timeout: 8000 });
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

describe('typing signals (M6)', () => {
  it('sends typing:start on first keystroke and typing:stop after 3s idle', async () => {
    await renderLoadedScreen();

    fireEvent.changeText(screen.getByTestId('composer-input'), 'h');
    expect(mockSocket.sendTypingStart).toHaveBeenCalledWith('conv-1');

    // Continued typing refreshes without duplicate starts.
    fireEvent.changeText(screen.getByTestId('composer-input'), 'hi');
    fireEvent.changeText(screen.getByTestId('composer-input'), 'hi!');

    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    expect(mockSocket.sendTypingStop).toHaveBeenCalledWith('conv-1');
  });

  it('sends typing:stop immediately when the message is sent', async () => {
    mockApi.sendMessage.mockResolvedValue({
      message: { ...sampleMessage, id: 'm-2', senderId: 'me-1', body: 'my reply' },
      created: true,
    });

    await renderLoadedScreen();

    fireEvent.changeText(screen.getByTestId('composer-input'), 'my reply');
    fireEvent.press(screen.getByTestId('composer-send'));

    await waitFor(() => expect(mockApi.sendMessage).toHaveBeenCalled(), { timeout: 8000 });
    expect(mockSocket.sendTypingStop).toHaveBeenCalledWith('conv-1');
  });

  it('renders and clears the typing indicator from typing:update events', async () => {
    await renderLoadedScreen();
    expect(screen.queryByTestId('typing-indicator')).toBeNull();

    await act(async () => {
      typingHandler?.({ conversationId: 'conv-1', userId: 'u2', isTyping: true });
    });
    const indicator = screen.getByTestId('typing-indicator');
    expect(String(indicator.props.children)).toContain('Ayesha is typing');

    await act(async () => {
      typingHandler?.({ conversationId: 'conv-1', userId: 'u2', isTyping: false });
    });
    expect(screen.queryByTestId('typing-indicator')).toBeNull();
  }, 30_000);

  it('ignores typing events for other conversations and for own user', async () => {
    await renderLoadedScreen();

    await act(async () => {
      typingHandler?.({ conversationId: 'other-conv', userId: 'u2', isTyping: true });
      typingHandler?.({ conversationId: 'conv-1', userId: 'me-1', isTyping: true });
    });
    expect(screen.queryByTestId('typing-indicator')).toBeNull();
  }, 30_000);
});

describe('presence (M6)', () => {
  it('shows online and last-seen state in the direct chat header', async () => {
    await renderLoadedScreen();

    await act(async () => {
      presenceHandler?.({ userId: 'u2', lastSeenAt: null, online: true });
    });
    expect(String(screen.getByTestId('presence-indicator').props.children)).toBe('online');

    await act(async () => {
      presenceHandler?.({ userId: 'u2', lastSeenAt: '2026-09-04T09:00:00.000Z', online: false });
    });
    expect(String(screen.getByTestId('presence-indicator').props.children)).toContain('last seen');
  }, 30_000);

  it('cleans up the subscription and stops typing on unmount', async () => {
    const view = await renderLoadedScreen();

    fireEvent.changeText(screen.getByTestId('composer-input'), 'still typing');

    view.unmount();
    expect(unsubscribeCalls).toBe(1);
    expect(mockSocket.sendTypingStop).toHaveBeenCalledWith('conv-1');
  }, 30_000);
});
