import { render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import * as apiModule from '../src/lib/api';
import * as sessionModule from '../src/auth/session';
import { AuthProvider, useAuth } from '../src/auth/AuthContext';

/**
 * M2 mobile authentication tests: auth state transitions (session restore,
 * invalid session, sign-in persistence, sign-out cleanup). Network and secure
 * storage are mocked — the provider logic is what we test.
 */

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
}));

jest.mock('../src/auth/session', () => ({
  loadSessionToken: jest.fn(),
  saveSessionToken: jest.fn(),
  clearSessionToken: jest.fn(),
}));

const mockApi = apiModule as unknown as jest.Mocked<typeof apiModule>;
const mockSession = sessionModule as unknown as jest.Mocked<typeof sessionModule>;

const testUser = {
  id: 'u-1',
  username: 'kaif',
  displayName: 'Kaif',
  bio: null,
  avatarMediaId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function Probe(): React.JSX.Element {
  const { status, user } = useAuth();
  return (
    <>
      <Text testID="status">{status}</Text>
      <Text testID="user">{user ? user.username : 'none'}</Text>
    </>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AuthProvider bootstrap (session restoration)', () => {
  it('restores an authenticated session when the stored token validates', async () => {
    mockSession.loadSessionToken.mockResolvedValue('stored-token');
    mockApi.fetchCurrentUser.mockResolvedValue({ user: testUser });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status').props.children).toBe('authenticated'));
    expect(screen.getByTestId('user').props.children).toBe('kaif');
    expect(mockApi.fetchCurrentUser).toHaveBeenCalledWith('stored-token');
  });

  it('returns to unauthenticated when the stored session is invalid/revoked', async () => {
    mockSession.loadSessionToken.mockResolvedValue('stale-token');
    mockApi.fetchCurrentUser.mockRejectedValue(new Error('401'));

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status').props.children).toBe('unauthenticated'));
    expect(mockSession.clearSessionToken).toHaveBeenCalled();
    expect(screen.getByTestId('user').props.children).toBe('none');
  });

  it('starts unauthenticated when no token is stored', async () => {
    mockSession.loadSessionToken.mockResolvedValue(null);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status').props.children).toBe('unauthenticated'));
    expect(mockApi.fetchCurrentUser).not.toHaveBeenCalled();
  });
});

describe('signIn / signOut flows', () => {
  it('signs in and persists the token', async () => {
    mockSession.loadSessionToken.mockResolvedValue(null);
    mockApi.login.mockResolvedValue({ token: 'fresh-token', user: testUser });
    let capturedSignIn: ((username: string, password: string) => Promise<void>) | undefined;
    function Driver(): React.JSX.Element {
      const { signIn, status } = useAuth();
      capturedSignIn = signIn;
      return <Text testID="status">{status}</Text>;
    }

    render(
      <AuthProvider>
        <Driver />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status').props.children).toBe('unauthenticated'));
    await capturedSignIn!('kaif', 'super-secret-password');
    expect(mockSession.saveSessionToken).toHaveBeenCalledWith('fresh-token');
    await waitFor(() => expect(screen.getByTestId('status').props.children).toBe('authenticated'));
  });

  it('signs out, clears the token and calls the server logout', async () => {
    mockSession.loadSessionToken.mockResolvedValue('live-token');
    mockApi.fetchCurrentUser.mockResolvedValue({ user: testUser });
    let capturedSignOut: (() => Promise<void>) | undefined;
    function Driver(): React.JSX.Element {
      const { signOut, status } = useAuth();
      capturedSignOut = signOut;
      return <Text testID="status">{status}</Text>;
    }

    render(
      <AuthProvider>
        <Driver />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status').props.children).toBe('authenticated'));

    await capturedSignOut!();
    expect(mockApi.logout).toHaveBeenCalledWith('live-token');
    expect(mockSession.clearSessionToken).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('status').props.children).toBe('unauthenticated'));
  });
});
