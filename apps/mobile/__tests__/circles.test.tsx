import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import HomeScreen from '../app/(app)/home';
import CreateCircleScreen from '../app/(app)/circles/create';
import JoinCircleScreen from '../app/(app)/circles/join';
import CircleHomeScreen from '../app/(app)/circles/[id]';
import * as apiModule from '../src/lib/api';

/**
 * M4 mobile circles tests: the Home list renders Circle cards and empty
 * state, create flow validates and posts, and the join flow previews a valid
 * code then surfaces friendly errors for invalid/expired/full codes. Network
 * and secure storage are mocked; server authorization stays authoritative.
 * M9 adds the Circle Home screen (identity, members preview, Open Chat).
 */

const replaceMock = jest.fn();
const pushMock = jest.fn();
const backMock = jest.fn();

declare global {
  var __circlesReplaceMock: jest.Mock | undefined; // hoisted expo-router mock bridge
  var __circlesPushMock: jest.Mock | undefined; // hoisted expo-router mock bridge
  var __circlesBackMock: jest.Mock | undefined; // hoisted expo-router mock bridge
}jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest factory must be CJS
  const { Text: RNText, Pressable: RNPressable } = require('react-native');
  return {
    Link: ({ children, testID, onPress }: { children: React.ReactNode; testID?: string; onPress?: () => void }) => (
      <RNPressable testID={testID} onPress={onPress}>
        <RNText>{children}</RNText>
      </RNPressable>
    ),
    Redirect: ({ href }: { href: string }) => <RNText testID="redirect">{href}</RNText>,
    useRouter: () => ({
      replace: (...args: unknown[]) => globalThis.__circlesReplaceMock?.(...args),
      push: (...args: unknown[]) => globalThis.__circlesPushMock?.(...args),
      back: (...args: unknown[]) => globalThis.__circlesBackMock?.(...args),
    }),
    useFocusEffect: (callback: () => void) => {
      // Focus effects fire AFTER mount (like real expo-router) — running the
      // callback synchronously during render would loop setState calls.
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
  login: jest.fn(),
  signup: jest.fn(),
  fetchCurrentUser: jest.fn(),
  logout: jest.fn(),
  listCircles: jest.fn(),
  createCircle: jest.fn(),
  fetchCircle: jest.fn(),
  fetchCircleHome: jest.fn(),
  fetchInvitePreview: jest.fn(),
  joinCircle: jest.fn(),
}));

jest.mock('../src/auth/session', () => ({
  loadSessionToken: jest.fn().mockResolvedValue('test-token'),
  saveSessionToken: jest.fn(),
  clearSessionToken: jest.fn(),
}));

// AuthProvider touches fetchCurrentUser through bootstrap; bypass it.
jest.mock('../src/auth/AuthContext', () => ({
  useAuth: () => ({
    status: 'authenticated',
    user: {
      id: 'u-1',
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

const sampleCircles = [
  {
    id: 'c-1',
    name: 'Night Owls',
    description: null,
    avatarMediaId: null,
    membersCount: 3,
    callerRole: 'owner' as const,
    unreadCount: 0,
    activePolls: [],
    activePollsCount: 0,
  },
  {
    id: 'c-2',
    name: 'Family',
    description: null,
    avatarMediaId: null,
    membersCount: 5,
    callerRole: 'member' as const,
    unreadCount: 0,
    activePolls: [],
    activePollsCount: 0,
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  (globalThis as { __circlesReplaceMock?: jest.Mock }).__circlesReplaceMock = replaceMock;
  (globalThis as { __circlesPushMock?: jest.Mock }).__circlesPushMock = pushMock;
  (globalThis as { __circlesBackMock?: jest.Mock }).__circlesBackMock = backMock;
});

afterEach(() => {
  delete (globalThis as { __circlesReplaceMock?: jest.Mock }).__circlesReplaceMock;
  delete (globalThis as { __circlesPushMock?: jest.Mock }).__circlesPushMock;
  delete (globalThis as { __circlesBackMock?: jest.Mock }).__circlesBackMock;
});

describe('HomeScreen circles (M4)', () => {
  it('renders Circle cards with member counts from the server list', async () => {
    mockApi.listCircles.mockResolvedValue({ circles: sampleCircles });

    render(<HomeScreen />);

    await waitFor(() => expect(screen.getByTestId('circle-card-c-1')).toBeTruthy());
    expect(screen.getByText('3 members · owner')).toBeTruthy();
    expect(screen.getByText('Family')).toBeTruthy();
    expect(screen.getByText('5 members · member')).toBeTruthy();
  });

  it('shows the documented empty state when the user has no Circles', async () => {
    mockApi.listCircles.mockResolvedValue({ circles: [] });

    render(<HomeScreen />);

    await waitFor(() => expect(screen.getByTestId('home-empty')).toBeTruthy());
    expect(screen.getByText('Your little world starts here.')).toBeTruthy();
    expect(screen.getByTestId('home-create-circle')).toBeTruthy();
    expect(screen.getByTestId('home-join-circle')).toBeTruthy();
  });

  it('shows an error state with retry when loading fails', async () => {
    mockApi.listCircles.mockRejectedValue(new Error('network down'));

    render(<HomeScreen />);

    await waitFor(() => expect(screen.getByTestId('home-error')).toBeTruthy());
    expect(screen.getByTestId('home-retry')).toBeTruthy();
  });
});

describe('CreateCircleScreen header (real-device bug fixes)', () => {
  it('renders the header with title and a working back button', () => {
    render(<CreateCircleScreen />);

    expect(screen.getByTestId('create-circle-header')).toBeTruthy();
    expect(screen.getByTestId('create-circle-back')).toBeTruthy();
    expect(screen.getAllByText('Create Circle').length).toBeGreaterThanOrEqual(1);

    fireEvent.press(screen.getByTestId('create-circle-back'));
    expect(backMock).toHaveBeenCalled();
  });
});

describe('Create/Join header top inset (status-bar clipping fix)', () => {
  it('create-circle container pads with the live top safe-area inset', () => {
    const insets = { top: 42, bottom: 0, left: 0, right: 0 };
    render(
      <SafeAreaInsetsContext.Provider value={insets}>
        <CreateCircleScreen />
      </SafeAreaInsetsContext.Provider>,
    );
    const container = screen.getByTestId('create-circle-screen');
    const style = Array.isArray(container.props.style) ? Object.assign({}, ...container.props.style) : container.props.style;
    // 42px injected inset + 12 base offset = 54 — never a fixed pixel value.
    expect(style.paddingTop).toBe(54);
  });

  it('join-circle container pads with the live top safe-area inset', () => {
    const insets = { top: 42, bottom: 0, left: 0, right: 0 };
    render(
      <SafeAreaInsetsContext.Provider value={insets}>
        <JoinCircleScreen />
      </SafeAreaInsetsContext.Provider>,
    );
    const container = screen.getByTestId('join-circle-screen');
    const style = Array.isArray(container.props.style) ? Object.assign({}, ...container.props.style) : container.props.style;
    expect(style.paddingTop).toBe(54);
  });
});

describe('CreateCircleScreen', () => {
  it('blocks submission with an empty name and shows the validation message', async () => {
    render(<CreateCircleScreen />);

    fireEvent.press(screen.getByTestId('create-circle-submit'));
    expect(await screen.findByTestId('create-circle-error')).toBeTruthy();
    expect(mockApi.createCircle).not.toHaveBeenCalled();
  });

  it('creates the Circle and navigates to it on success', async () => {
    mockApi.createCircle.mockResolvedValue({
      circle: { id: 'c-new', name: 'Night Owls', membersCount: 1, callerRole: 'owner' },
    });

    render(<CreateCircleScreen />);

    fireEvent.changeText(screen.getByTestId('create-circle-name'), 'Night Owls');
    fireEvent.press(screen.getByTestId('create-circle-submit'));

    await waitFor(() => expect(mockApi.createCircle).toHaveBeenCalledWith('test-token', { name: 'Night Owls' }));
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/(app)/circles/c-new'));
  });

  it('surfaces a friendly error when creation fails', async () => {
    mockApi.createCircle.mockRejectedValue(new Error('boom'));

    render(<CreateCircleScreen />);

    fireEvent.changeText(screen.getByTestId('create-circle-name'), 'Night Owls');
    fireEvent.press(screen.getByTestId('create-circle-submit'));

    expect(await screen.findByTestId('create-circle-error')).toBeTruthy();
  });
});

describe('JoinCircleScreen header (real-device bug fixes)', () => {
  it('renders the header with title and a working back button', () => {
    render(<JoinCircleScreen />);

    expect(screen.getByTestId('join-circle-header')).toBeTruthy();
    expect(screen.getByTestId('join-circle-back')).toBeTruthy();
    expect(screen.getByText('Join Circle')).toBeTruthy();

    fireEvent.press(screen.getByTestId('join-circle-back'));
    expect(backMock).toHaveBeenCalled();
  });
});

describe('JoinCircleScreen', () => {
  it('previews a valid invite with limited fields and joins on confirm', async () => {
    mockApi.fetchInvitePreview.mockResolvedValue({
      preview: { name: 'Night Owls', memberCount: 3, avatarMediaId: null, avatarUrl: null },
    });
    mockApi.joinCircle.mockResolvedValue({ circleId: 'c-joined' });

    render(<JoinCircleScreen />);

    fireEvent.changeText(screen.getByTestId('join-circle-code'), 'ABCD-EFGH-JKLM');
    fireEvent.press(screen.getByTestId('join-lookup'));
    await waitFor(() => expect(screen.getByTestId('join-preview')).toBeTruthy());

    expect(screen.getByText('Night Owls')).toBeTruthy();
    expect(screen.queryByText('@someone')).toBeNull(); // no member data before joining

    fireEvent.press(screen.getByTestId('join-confirm'));
    await waitFor(() => expect(mockApi.joinCircle).toHaveBeenCalledWith('test-token', 'ABCD-EFGH-JKLM'));
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/(app)/circles/c-joined'));
  });

  it('shows a friendly error for an invalid code', async () => {
    const { ApiError } = apiModule;
    mockApi.fetchInvitePreview.mockRejectedValue(
      new (ApiError as new (code: string, status: number, message: string) => Error)('INVALID_INVITE', 404, 'nope'),
    );

    render(<JoinCircleScreen />);

    fireEvent.changeText(screen.getByTestId('join-circle-code'), 'ZZZZ-ZZZZ-ZZZZ');
    fireEvent.press(screen.getByTestId('join-lookup'));

    expect(await screen.findByTestId('join-preview-error')).toBeTruthy();
    expect(screen.queryByTestId('join-preview')).toBeNull();
  });

  it('maps CIRCLE_FULL to an understandable full-Circle message on join', async () => {
    const { ApiError } = apiModule;
    mockApi.fetchInvitePreview.mockResolvedValue({
      preview: { name: 'Full House', memberCount: 5, avatarMediaId: null, avatarUrl: null },
    });
    mockApi.joinCircle.mockRejectedValue(
      new (ApiError as new (code: string, status: number, message: string) => Error)('CIRCLE_FULL', 409, 'full'),
    );

    render(<JoinCircleScreen />);

    fireEvent.changeText(screen.getByTestId('join-circle-code'), 'AAAA-BBBB-CCCC');
    fireEvent.press(screen.getByTestId('join-lookup'));
    await waitFor(() => expect(screen.getByTestId('join-preview')).toBeTruthy());
    expect(screen.getByText('This Circle is full.')).toBeTruthy();

    // Join is disabled at full capacity — no pointless request is sent.
    const confirm = screen.getByTestId('join-confirm');
    expect(confirm.props.accessibilityState?.disabled ?? confirm.props.disabled).toBe(true);
    expect(mockApi.joinCircle).not.toHaveBeenCalled();
  });
});

describe('CircleHomeScreen (M9)', () => {
  const homePayload = {
    circleId: 'c-1',
    conversationId: 'conv-1',
    name: 'Night Owls',
    description: 'Late night talks',
    avatarMediaId: null,
    membersCount: 2,
    callerRole: 'owner' as const,
    unreadCount: 4,
    activePolls: [],
    activePollsCount: 0,
        pinnedItems: [],
    pinsCount: 0,
    members: [
      { userId: 'u-1', username: 'kaif', displayName: 'Kaif', role: 'owner' as const, joinedAt: '2026-01-01T00:00:00.000Z' },
      { userId: 'u-2', username: 'ayesha', displayName: 'Ayesha', role: 'member' as const, joinedAt: '2026-01-02T00:00:00.000Z' },
    ],
  };

  it('renders Circle identity, unread badge and members preview from the home payload', async () => {
    mockApi.fetchCircleHome.mockResolvedValue({ home: homePayload });

    render(<CircleHomeScreen />);

    await waitFor(() => expect(screen.getByTestId('circle-screen')).toBeTruthy());
    expect(screen.getByText('Night Owls')).toBeTruthy();
    expect(screen.getByTestId('circle-member-count').props.children).toBe('2 members');
    expect(screen.getByText('"Late night talks"')).toBeTruthy();
    // Members preview: display names are visible for the ≤5 member Circle.
    expect(screen.getByText('Kaif')).toBeTruthy();
    expect(screen.getByText('Ayesha')).toBeTruthy();
    // Server-computed unread renders as a badge on the Open Chat action.
    expect(screen.getByTestId('circle-unread')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(mockApi.fetchCircleHome).toHaveBeenCalledWith('test-token', 'c-1');
  });

  it('Open Chat navigates to the Circle conversation (M5 authorization stays server-side)', async () => {
    mockApi.fetchCircleHome.mockResolvedValue({ home: homePayload });

    render(<CircleHomeScreen />);
    await waitFor(() => expect(screen.getByTestId('circle-open-chat')).toBeTruthy());

    fireEvent.press(screen.getByTestId('circle-open-chat'));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/(app)/chats/conv-1'));
  });

  it('hides the Open Chat action when no conversation exists yet', async () => {
    mockApi.fetchCircleHome.mockResolvedValue({ home: { ...homePayload, conversationId: null } });

    render(<CircleHomeScreen />);
    await waitFor(() => expect(screen.getByTestId('circle-screen')).toBeTruthy());
    expect(screen.queryByTestId('circle-open-chat')).toBeNull();
    expect(screen.queryByTestId('circle-unread')).toBeNull();
  });

  it('shows a loading state while the home payload loads', async () => {
    mockApi.fetchCircleHome.mockImplementation(() => new Promise(() => undefined));

    render(<CircleHomeScreen />);
    expect(screen.getByTestId('circle-loading')).toBeTruthy();
  });

  it('shows an error state with retry when the Circle is inaccessible', async () => {
    mockApi.fetchCircleHome.mockRejectedValueOnce(new apiModule.ApiError('NOT_FOUND', 404, 'nope'));
    render(<CircleHomeScreen />);
    await waitFor(() => expect(screen.getByTestId('circle-error')).toBeTruthy());

    // Retry recovers once the server responds.
    mockApi.fetchCircleHome.mockResolvedValue({ home: homePayload });
    fireEvent.press(screen.getByTestId('circle-retry'));
    await waitFor(() => expect(screen.getByTestId('circle-screen')).toBeTruthy());
  });
});

describe('CircleHomeScreen — Pinboard (M10)', () => {
  const pinnedHome = (overrides: Partial<apiModule.CircleHome> = {}): { home: apiModule.CircleHome } => ({
    home: {
      circleId: 'c-1',
      conversationId: 'conv-1',
      name: 'Night Owls',
      description: null,
      avatarMediaId: null,
      membersCount: 2,
      callerRole: 'owner',
      unreadCount: 0,
    activePolls: [],
    activePollsCount: 0,
            pinnedItems: [],
      pinsCount: 0,
      members: [],
      ...overrides,
    },
  });

  const pin = (id: string, messageId: string, body: string, pinnedByDisplay: string): apiModule.PinItem => ({
    id,
    messageId,
    pinnedAt: '2026-01-03T00:00:00.000Z',
    pinnedBy: { userId: 'u-2', username: 'ayesha', displayName: pinnedByDisplay },
    message: {
      id: messageId,
      conversationId: 'conv-1',
      senderId: 'u-2',
      senderUsername: 'ayesha',
      senderDisplayName: 'Ayesha',
      type: 'text',
      body,
      mediaId: null,
      media: null,
      replyToId: null,
      editedAt: null,
      deleted: false,
      createdAt: '2026-01-02T00:00:00.000Z',
    } as apiModule.Message,
  });

  it('renders the Pinboard preview with pinned items and pinner metadata', async () => {
    mockApi.fetchCircleHome.mockResolvedValue(
      pinnedHome({
        pinsCount: 2,
        pinnedItems: [pin('p-1', 'm-1', 'trip plan', 'Ayesha'), pin('p-2', 'm-2', 'wifi password', 'Ayesha')],
      }),
    );

    render(<CircleHomeScreen />);
    await waitFor(() => expect(screen.getByTestId('pinboard-item-m-1')).toBeTruthy());
    expect(screen.getByText('trip plan')).toBeTruthy();
    expect(screen.getByText('wifi password')).toBeTruthy();
    expect(screen.getAllByText('Ayesha · pinned by Ayesha')).toHaveLength(2);
    // Only a preview — the full list lives on the Pinboard screen.
    expect(screen.queryByTestId('pinboard-view-all')).toBeNull();
  });

  it('shows the Pinboard empty state and no preview when nothing is pinned', async () => {
    mockApi.fetchCircleHome.mockResolvedValue(pinnedHome());

    render(<CircleHomeScreen />);
    await waitFor(() => expect(screen.getByTestId('circle-screen')).toBeTruthy());
    expect(screen.getByTestId('pinboard-empty')).toBeTruthy();
    expect(screen.queryByTestId(/pinboard-item-/)).toBeNull();
    expect(screen.queryByTestId('pinboard-view-all')).toBeNull();
  });

  it('shows the View all link when the Circle has more pins than the preview', async () => {
    mockApi.fetchCircleHome.mockResolvedValue(pinnedHome({ pinsCount: 7, pinnedItems: [pin('p-1', 'm-1', 'x', 'Ayesha')] }));

    render(<CircleHomeScreen />);
    await waitFor(() => expect(screen.getByTestId('pinboard-view-all')).toBeTruthy());
    // Preview is capped at three items even when more exist.
    expect(screen.getAllByTestId(/^pinboard-item-/)).toHaveLength(1);
  });
});

describe('CircleHomeScreen — Polls (M11)', () => {
  const pollHome = (overrides: Partial<apiModule.CircleHome> = {}): { home: apiModule.CircleHome } => ({
    home: {
      circleId: 'c-1',
      conversationId: 'conv-1',
      name: 'Night Owls',
      description: null,
      avatarMediaId: null,
      membersCount: 2,
      callerRole: 'owner',
      unreadCount: 0,
      activePolls: [],
      activePollsCount: 0,
      pinnedItems: [],
      pinsCount: 0,
      members: [],
      ...overrides,
    },
  });

  const activePoll: apiModule.Poll = {
    id: 'poll-1',
    conversationId: 'conv-1',
    question: 'Where should we go?',
    options: ['Beach', 'Cinema'],
    votes: [1, 0],
    totalVotes: 1,
    myVote: 0,
    closed: false,
    closesAt: null,
    createdAt: '2026-01-02T00:00:00.000Z',
    createdBy: { userId: 'u-2', username: 'ayesha', displayName: 'Ayesha' },
  };

  it('renders an active poll preview with vote state', async () => {
    mockApi.fetchCircleHome.mockResolvedValue(pollHome({ activePolls: [activePoll], activePollsCount: 1 }));

    render(<CircleHomeScreen />);
    await waitFor(() => expect(screen.getByTestId(`poll-preview-${activePoll.id}`)).toBeTruthy());
    expect(screen.getByText('Where should we go?')).toBeTruthy();
    expect(screen.getByText('Where should we go? · 1 vote · You voted Beach')).toBeTruthy();
  });

  it('shows the polls empty state when there are no active polls', async () => {
    mockApi.fetchCircleHome.mockResolvedValue(pollHome());

    render(<CircleHomeScreen />);
    await waitFor(() => expect(screen.getByTestId('circle-screen')).toBeTruthy());
    expect(screen.getByTestId('polls-empty')).toBeTruthy();
    expect(screen.queryByTestId('polls-view-all')).toBeNull();
  });
});
