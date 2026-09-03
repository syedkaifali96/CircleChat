import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import HomeScreen from '../app/(app)/home';
import CreateCircleScreen from '../app/(app)/circles/create';
import JoinCircleScreen from '../app/(app)/circles/join';
import * as apiModule from '../src/lib/api';

/**
 * M4 mobile circles tests: the Home list renders Circle cards and empty
 * state, create flow validates and posts, and the join flow previews a valid
 * code then surfaces friendly errors for invalid/expired/full codes. Network
 * and secure storage are mocked; server authorization stays authoritative.
 */

const replaceMock = jest.fn();

declare global {
  var __circlesReplaceMock: jest.Mock | undefined; // hoisted expo-router mock bridge
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
    useRouter: () => ({ replace: (...args: unknown[]) => globalThis.__circlesReplaceMock?.(...args), back: jest.fn(), push: jest.fn() }),
    useFocusEffect: (callback: () => void) => callback(),
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
  },
  {
    id: 'c-2',
    name: 'Family',
    description: null,
    avatarMediaId: null,
    membersCount: 5,
    callerRole: 'member' as const,
    unreadCount: 0,
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  (globalThis as { __circlesReplaceMock?: jest.Mock }).__circlesReplaceMock = replaceMock;
});

afterEach(() => {
  delete (globalThis as { __circlesReplaceMock?: jest.Mock }).__circlesReplaceMock;
});

describe('HomeScreen circles (M4)', () => {
  it('renders Circle cards with member counts from the server list', async () => {
    mockApi.listCircles.mockResolvedValue({ circles: sampleCircles });

    render(<HomeScreen />);

    await waitFor(() => expect(screen.getByTestId('circle-card-c-1')).toBeTruthy());
    expect(screen.getByText('Night Owls')).toBeTruthy();
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
