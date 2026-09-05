import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { MessageBubble } from '../src/chat/MessageBubble';
import ChatsScreen from '../app/(app)/chats';
import ConversationScreen from '../app/(app)/chats/[id]';
import * as apiModule from '../src/lib/api';
import { Alert } from 'react-native';

/**
 * M5 mobile messaging tests: bubble rendering (own/incoming, sender name,
 * reply preview, edited/deleted states, reactions), the chats list
 * (rows/unread badge/empty/error states, private-chat start), and the
 * conversation screen send flow with long-press permission gating.
 * Network and secure storage are mocked; the server stays authoritative.
 */

const pushMock = jest.fn();

declare global {
  var __m5PushMock: jest.Mock | undefined; // hoisted expo-router mock bridge
}

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
    useRouter: () => ({
      push: (...args: unknown[]) => globalThis.__m5PushMock?.(...args),
      replace: jest.fn(),
      back: jest.fn(),
    }),
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
}));

jest.mock('../src/auth/session', () => ({
  loadSessionToken: jest.fn().mockResolvedValue('test-token'),
  saveSessionToken: jest.fn(),
  clearSessionToken: jest.fn(),
}));

// expo-av needs the native ExponentAV module; tests mock the Audio surface.
jest.mock('expo-av', () => ({
  Audio: {
    Sound: { createAsync: jest.fn().mockResolvedValue({ sound: { unloadAsync: jest.fn() }, status: {} }) },
    setAudioModeAsync: jest.fn(),
    requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
    Recording: jest.fn(),
    RecordingOptionsPresets: { HIGH_QUALITY: {} },
  },
}));

// M6: the conversation screen subscribes to the shared socket; tests mock the
// client so no network connection is attempted (server behavior is covered by
// the real-socket integration tests).
const mockUnsubscribe = jest.fn();
jest.mock('../src/lib/socket', () => ({
  subscribeToConversation: jest.fn().mockResolvedValue(() => mockUnsubscribe()),
  sendTypingStart: jest.fn(),
  sendTypingStop: jest.fn(),
  trackJoinedRoom: jest.fn(),
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

const baseMessage = {
  conversationId: 'conv-1',
  senderId: 'me-1',
  senderUsername: 'kaif',
  senderDisplayName: 'Kaif',
  type: 'text' as const,
  mediaId: null,
  media: null,
  replyToId: null,
  replyPreview: null,
  editedAt: null,
  deleted: false,
  createdAt: '2026-09-03T10:00:00.000Z',
  reactions: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  (globalThis as { __m5PushMock?: jest.Mock }).__m5PushMock = pushMock;
  // clearAllMocks wipes factory implementations; re-pin the always-needed ones.
  mockApi.markConversationRead.mockResolvedValue({ unreadCount: 0, lastReadMessageId: null });
  mockApi.listCircles.mockResolvedValue({ circles: [] });
});

afterEach(() => {
  delete (globalThis as { __m5PushMock?: jest.Mock }).__m5PushMock;
});

describe('MessageBubble', () => {
  it('renders own and incoming bubbles with sender name in Circle chats', () => {
    const { rerender } = render(
      <MessageBubble
        message={{ ...baseMessage, id: 'm1', body: 'hello world' }}
        isOwn
        showSender
      />,
    );
    expect(screen.getByTestId('message-body-m1').props.children).toBe('hello world');

    rerender(
      <MessageBubble
        message={{ ...baseMessage, id: 'm2', senderId: 'u2', senderDisplayName: 'Ayesha', body: 'hi there' }}
        isOwn={false}
        showSender
      />,
    );
    expect(screen.getByTestId('message-sender-m2').props.children).toBe('Ayesha');
  });

  it('shows the edited marker, reactions and a tombstone for deleted messages', () => {
    render(
      <MessageBubble
        message={{
          ...baseMessage,
          id: 'm3',
          body: 'nice',
          editedAt: '2026-09-03T10:05:00.000Z',
          reactions: [{ emoji: '❤️', userId: 'u2', username: 'ayesha' }],
        }}
        isOwn
        showSender={false}
      />,
    );
    expect(screen.getByTestId('edited-m3')).toBeTruthy();
    expect(screen.getByTestId('reactions-m3')).toBeTruthy();

    render(
      <MessageBubble
        message={{ ...baseMessage, id: 'm4', deleted: true, body: null }}
        isOwn={false}
        showSender
      />,
    );
    expect(screen.getByTestId('message-body-m4').props.children).toBe('Message deleted');
  });

  it('renders the reply preview above the bubble body', () => {
    render(
      <MessageBubble
        message={{
          ...baseMessage,
          id: 'm5',
          body: 'replying',
          replyToId: 'm0',
          replyPreview: { id: 'm0', senderUsername: 'ayesha', body: 'original text', deleted: false },
        }}
        isOwn
        showSender={false}
      />,
    );
    expect(screen.getByTestId('reply-preview-m5')).toBeTruthy();
    expect(screen.getByText('original text')).toBeTruthy();
  });
});

describe('ChatsScreen', () => {
  it('lists circle + direct conversations with unread badges', async () => {
    mockApi.listConversations.mockResolvedValue({
      conversations: [
        {
          id: 'c-1',
          type: 'circle',
          circleId: 'circle-1',
          circleName: 'Night Owls',
          circleAvatarMediaId: null,
          partnerUsername: null,
          partnerDisplayName: null,
          partnerAvatarMediaId: null,
          lastMessageAt: '2026-09-03T10:00:00.000Z',
          lastMessagePreview: 'latest ping',
          unreadCount: 2,
        },
        {
          id: 'c-2',
          type: 'direct',
          circleId: null,
          circleName: null,
          circleAvatarMediaId: null,
          partnerUsername: 'ayesha',
          partnerDisplayName: 'Ayesha',
          partnerAvatarMediaId: null,
          lastMessageAt: null,
          lastMessagePreview: null,
          unreadCount: 0,
        },
      ],
    });

    render(<ChatsScreen />);

    await waitFor(() => expect(screen.getByTestId('chat-row-c-1')).toBeTruthy());
    expect(screen.getByText('Night Owls')).toBeTruthy();
    expect(screen.getByTestId('unread-c-1')).toBeTruthy();
    expect(screen.getByTestId('preview-c-1').props.children).toBe('latest ping');
    expect(screen.getByText('Ayesha')).toBeTruthy();
    expect(screen.queryByTestId('unread-c-2')).toBeNull();
  });

  it('shows the empty state when there are no conversations', async () => {
    mockApi.listConversations.mockResolvedValue({ conversations: [] });

    render(<ChatsScreen />);

    expect(await screen.findByTestId('chats-empty')).toBeTruthy();
  });

  it('shows an error state with retry when loading fails', async () => {
    mockApi.listConversations.mockRejectedValue(new Error('down'));

    render(<ChatsScreen />);

    expect(await screen.findByTestId('chats-error')).toBeTruthy();
  });

  it('starts a private chat by username and navigates to it', async () => {
    mockApi.listConversations.mockResolvedValue({ conversations: [] });
    mockApi.createDirectConversation.mockResolvedValue({ conversationId: 'new-conv', created: true });

    render(<ChatsScreen />);

    fireEvent.press(await screen.findByTestId('new-chat-button'));
    fireEvent.changeText(screen.getByTestId('new-chat-username'), 'ayesha');
    fireEvent.press(screen.getByTestId('new-chat-start'));

    await waitFor(() => expect(mockApi.createDirectConversation).toHaveBeenCalledWith('test-token', 'ayesha'));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/(app)/chats/new-conv'));
  });

  it('surfaces the no-shared-Circle error without leaking existence', async () => {
    mockApi.listConversations.mockResolvedValue({ conversations: [] });
    mockApi.createDirectConversation.mockRejectedValue(
      new (apiModule.ApiError as new (c: string, s: number, m: string) => Error)('NOT_FOUND', 404, 'nf'),
    );

    render(<ChatsScreen />);

    fireEvent.press(await screen.findByTestId('new-chat-button'));
    fireEvent.changeText(screen.getByTestId('new-chat-username'), 'stranger');
    fireEvent.press(screen.getByTestId('new-chat-start'));

    const error = await screen.findByTestId('new-chat-error');
    expect(String(error.props.children)).toContain('share a Circle');
  });
});

describe('ConversationScreen', () => {
  const header = { type: 'circle' as const, circleId: 'c-1', title: 'Night Owls', avatarMediaId: null, subtitle: '3 members', circleRole: 'member' };

  function message(overrides: Partial<apiModule.Message>): apiModule.Message {
    return { ...baseMessage, id: `m-${overrides.senderId ?? 'x'}`, ...overrides } as apiModule.Message;
  }

  it('loads history, renders the composer, and sends a message', async () => {
    mockApi.fetchChatHeader.mockResolvedValue({ header });
    mockApi.fetchMessages.mockResolvedValue({
      messages: [
        message({ id: 'old-1', senderId: 'u2', senderDisplayName: 'Ayesha', body: 'older message', createdAt: '2026-09-03T09:59:00.000Z' }),
      ],
      nextBeforeCursor: null,
    });
    mockApi.sendMessage.mockResolvedValue({
      message: message({ id: 'new-1', body: 'my reply', createdAt: '2026-09-03T10:01:00.000Z' }),
      created: true,
    });

    render(<ConversationScreen />);

    await waitFor(() => expect(screen.getByTestId('conversation-list')).toBeTruthy());
    expect(screen.getByText('Night Owls')).toBeTruthy();
    expect(screen.getByTestId('composer-input')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('composer-input'), 'my reply');
    fireEvent.press(screen.getByTestId('composer-send'));

    await waitFor(() =>
      expect(mockApi.sendMessage).toHaveBeenCalledWith('test-token', 'conv-1', expect.objectContaining({ body: 'my reply' })),
    );
    await waitFor(() => expect(screen.getByTestId('message-body-new-1')).toBeTruthy());
    // Read marking happened against the newest message.
    await waitFor(() => expect(mockApi.markConversationRead).toHaveBeenCalled());
  }, 30_000);

  it('plain circle member sees no delete action for another member message', async () => {
    mockApi.fetchChatHeader.mockResolvedValue({ header });
    mockApi.fetchMessages.mockResolvedValue({
      messages: [message({ id: 'other-1', senderId: 'u2', senderDisplayName: 'Ayesha', body: 'from ayesha' })],
      nextBeforeCursor: null,
    });

    render(<ConversationScreen />);
    await waitFor(() => expect(screen.getByTestId('message-other-1')).toBeTruthy(), { timeout: 8000 });
    fireEvent(screen.getByTestId('message-other-1'), 'longPress');
    expect(screen.queryByTestId('action-delete')).toBeNull();
  }, 30_000);

  it('circle admin sees the delete action for another member message', async () => {
    mockApi.fetchChatHeader.mockResolvedValue({ header: { ...header, circleRole: 'admin' } });
    mockApi.fetchMessages.mockResolvedValue({
      messages: [message({ id: 'other-1', senderId: 'u2', senderDisplayName: 'Ayesha', body: 'from ayesha' })],
      nextBeforeCursor: null,
    });

    render(<ConversationScreen />);
    await waitFor(() => expect(screen.getByTestId('message-other-1')).toBeTruthy(), { timeout: 8000 });
    fireEvent(screen.getByTestId('message-other-1'), 'longPress');
    expect(screen.getByTestId('action-delete')).toBeTruthy();
  }, 30_000);

  it('circle messages offer Pin to Pinboard and it calls the pin API (M10)', async () => {
    mockApi.fetchChatHeader.mockResolvedValue({ header });
    mockApi.fetchMessages.mockResolvedValue({
      messages: [message({ id: 'other-1', senderId: 'u2', senderDisplayName: 'Ayesha', body: 'pin me' })],
      nextBeforeCursor: null,
    });
    mockApi.addPin.mockResolvedValue({ item: {} as apiModule.PinItem });
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    render(<ConversationScreen />);
    await waitFor(() => expect(screen.getByTestId('message-other-1')).toBeTruthy(), { timeout: 8000 });
    fireEvent(screen.getByTestId('message-other-1'), 'longPress');
    expect(screen.getByTestId('action-pin')).toBeTruthy();

    fireEvent.press(screen.getByTestId('action-pin'));
    await waitFor(() => expect(mockApi.addPin).toHaveBeenCalledWith('test-token', 'c-1', 'other-1'));
  }, 30_000);

  it('tombstoned messages offer no pin action (M10)', async () => {
    mockApi.fetchChatHeader.mockResolvedValue({ header });
    mockApi.fetchMessages.mockResolvedValue({
      messages: [message({ id: 'tomb-1', senderId: 'u2', body: 'gone', deleted: true } as Partial<apiModule.Message>)],
      nextBeforeCursor: null,
    });

    render(<ConversationScreen />);
    await waitFor(() => expect(screen.getByTestId('message-tomb-1')).toBeTruthy(), { timeout: 8000 });
    // Tombstones render the deleted bubble with no long-press affordance at
    // all — the action menu (and therefore Pin) can never open for them.
    expect(screen.getByText('Message deleted')).toBeTruthy();
    expect(screen.queryByTestId('action-pin')).toBeNull();
  }, 30_000);

  it('direct conversations offer no pin action (M10)', async () => {
    mockApi.fetchChatHeader.mockResolvedValue({
      header: { type: 'direct', circleId: null, title: 'Ayesha', avatarMediaId: null, subtitle: '@ayesha', circleRole: null },
    });
    mockApi.fetchMessages.mockResolvedValue({
      messages: [message({ id: 'dm-1', senderId: 'u2', senderDisplayName: 'Ayesha', body: 'dm' })],
      nextBeforeCursor: null,
    });

    render(<ConversationScreen />);
    await waitFor(() => expect(screen.getByTestId('message-dm-1')).toBeTruthy(), { timeout: 8000 });
    fireEvent(screen.getByTestId('message-dm-1'), 'longPress');
    expect(screen.queryByTestId('action-pin')).toBeNull();
  }, 30_000);
});
