import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import PinboardScreen from '../app/(app)/circles/[id]/pinboard';
import * as apiModule from '../src/lib/api';

/**
 * M10 Pinboard screen tests: the full pinned list renders with sender/pinner
 * metadata, the empty state explains how to pin, unpin follows the server
 * policy mirrored in the UI (own pins or owner/admin), and tapping an item
 * opens the Circle chat where the authorized media pipeline renders content.
 * Network and secure storage are mocked; the server remains authoritative.
 */

const pushMock = jest.fn();

declare global {
  var __pinboardPushMock: jest.Mock | undefined; // hoisted expo-router mock bridge
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
    useRouter: () => ({ push: (...args: unknown[]) => globalThis.__pinboardPushMock?.(...args), replace: jest.fn(), back: jest.fn() }),
    useFocusEffect: (callback: () => void) => {
      // Focus effects fire AFTER mount (like real expo-router) — a synchronous
      // callback would setState during render and loop.
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest factory must be CJS
      const { useEffect } = require('react');
      useEffect(() => {
        callback();
      }, [callback]);
    },
    useLocalSearchParams: () => ({ id: 'c-1' }),
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
  fetchCircleHome: jest.fn(),
  fetchCirclePins: jest.fn(),
  removePin: jest.fn(),
}));

jest.mock('../src/auth/session', () => ({
  loadSessionToken: jest.fn().mockResolvedValue('test-token'),
  saveSessionToken: jest.fn(),
  clearSessionToken: jest.fn(),
}));

jest.mock('../src/auth/AuthContext', () => ({
  useAuth: () => ({
    status: 'authenticated',
    // The signed-in user owns p-2; p-1 was pinned by someone else.
    user: { id: 'u-1', username: 'kaif', displayName: 'Kaif', bio: null, avatarMediaId: null, createdAt: '2026-01-01T00:00:00.000Z' },
    signOut: jest.fn(),
    updateUser: jest.fn(),
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const mockApi = apiModule as unknown as jest.Mocked<typeof apiModule>;

const pinMessage = (id: string, body: string) => ({
  id,
  conversationId: 'conv-1',
  senderId: 'u-2',
  senderUsername: 'ayesha',
  senderDisplayName: 'Ayesha',
  type: 'text' as const,
  body,
  mediaId: null,
  media: null,
  replyToId: null,
  replyPreview: null,
  reactions: [],
  editedAt: null,
  deleted: false,
  createdAt: '2026-01-02T00:00:00.000Z',
});

const samplePins = (extras: Partial<apiModule.PinItem> = {}): apiModule.PinItem[] => [
  {
    id: 'pin-1',
    messageId: 'm-1',
    pinnedAt: '2026-01-03T00:00:00.000Z',
    pinnedBy: { userId: 'u-2', username: 'ayesha', displayName: 'Ayesha' },
    message: pinMessage('m-1', 'trip plan'),
    ...extras,
  },
];

const homePayload = {
  circleId: 'c-1',
  conversationId: 'conv-1',
  name: 'Night Owls',
  description: null,
  avatarMediaId: null,
  membersCount: 2,
  callerRole: 'owner' as const,
  unreadCount: 0,
    pinnedItems: [],
  pinsCount: 0,
  members: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  (globalThis as { __pinboardPushMock?: jest.Mock }).__pinboardPushMock = pushMock;
  mockApi.fetchCircleHome.mockResolvedValue({ home: homePayload });
});

afterEach(() => {
  delete (globalThis as { __pinboardPushMock?: jest.Mock }).__pinboardPushMock;
});

describe('PinboardScreen (M10)', () => {
  it('renders pinned items with message, sender and pinner metadata', async () => {
    mockApi.fetchCirclePins.mockResolvedValue({ items: samplePins() });

    render(<PinboardScreen />);
    await waitFor(() => expect(screen.getByTestId('pinboard-item-m-1')).toBeTruthy());
    expect(screen.getByText('trip plan')).toBeTruthy();
    expect(screen.getByText(/pinned by Ayesha/)).toBeTruthy();
    expect(screen.getByTestId('pinboard-count').props.children).toBe('1 pinned message');
  });

  it('shows the empty state when nothing is pinned', async () => {
    mockApi.fetchCirclePins.mockResolvedValue({ items: [] });

    render(<PinboardScreen />);
    await waitFor(() => expect(screen.getByTestId('pinboard-empty')).toBeTruthy());
    expect(screen.getByTestId('pinboard-count').props.children).toBe('0 pinned messages');
  });

  it('shows a loading state while pins load', () => {
    mockApi.fetchCirclePins.mockImplementation(() => new Promise(() => undefined));

    render(<PinboardScreen />);
    expect(screen.getByTestId('pinboard-loading')).toBeTruthy();
  });

  it('shows an error state with retry when loading fails', async () => {
    mockApi.fetchCirclePins.mockRejectedValueOnce(new apiModule.ApiError('NOT_FOUND', 404, 'gone'));
    render(<PinboardScreen />);
    await waitFor(() => expect(screen.getByTestId('pinboard-error')).toBeTruthy());

    mockApi.fetchCirclePins.mockResolvedValue({ items: samplePins() });
    fireEvent.press(screen.getByTestId('pinboard-retry'));
    await waitFor(() => expect(screen.getByTestId('pinboard-screen')).toBeTruthy());
  });

  it('unpins own pins through the API and reloads', async () => {
    mockApi.fetchCirclePins.mockResolvedValue({
      items: samplePins({ pinnedBy: { userId: 'u-1', username: 'kaif', displayName: 'Kaif' } }),
    });
    mockApi.removePin.mockResolvedValue({ ok: true });

    render(<PinboardScreen />);
    const unpin = await screen.findByTestId('pin-unpin-pin-1');
    fireEvent.press(unpin);

    await waitFor(() => expect(mockApi.removePin).toHaveBeenCalledWith('test-token', 'c-1', 'pin-1'));
  });

  it('lets an owner unpin someone else’s pin (server policy mirrored)', async () => {
    mockApi.fetchCirclePins.mockResolvedValue({ items: samplePins() }); // pinned by u-2, viewer is u-1 (owner)
    mockApi.removePin.mockResolvedValue({ ok: true });

    render(<PinboardScreen />);
    const unpin = await screen.findByTestId('pin-unpin-pin-1');
    fireEvent.press(unpin);

    await waitFor(() => expect(mockApi.removePin).toHaveBeenCalledWith('test-token', 'c-1', 'pin-1'));
  });

  it('hides Unpin from a member viewing someone else’s pin', async () => {
    mockApi.fetchCircleHome.mockResolvedValue({ home: { ...homePayload, callerRole: 'member' } });
    mockApi.fetchCirclePins.mockResolvedValue({ items: samplePins() }); // pinned by u-2, viewer is u-1 (member)

    render(<PinboardScreen />);
    await waitFor(() => expect(screen.getByTestId('pinboard-item-m-1')).toBeTruthy());
    expect(screen.queryByTestId('pin-unpin-pin-1')).toBeNull();
  });

  it('opens the Circle chat when a pinned item is tapped', async () => {
    mockApi.fetchCirclePins.mockResolvedValue({ items: samplePins() });

    render(<PinboardScreen />);
    const item = await screen.findByTestId('pinboard-item-m-1');
    fireEvent.press(item);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/(app)/chats/conv-1'));
  });
});
