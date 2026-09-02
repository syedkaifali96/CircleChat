import { useEffect } from 'react';
import { Text } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import RecoveryCodeScreen from '../app/(auth)/recovery-code';
import HomeScreen from '../app/(app)/home';
import * as apiModule from '../src/lib/api';
import { AuthProvider, useAuth } from '../src/auth/AuthContext';

/**
 * Screen render tests (M2): the recovery-code screen shows the pending code
 * exactly once; the authenticated home greets the user and offers logout.
 * Network and secure storage are mocked.
 */

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest factory requires CJS
  const { Text: RNText } = require('react-native');
  return {
    Link: ({ children, testID }: { children: React.ReactNode; testID?: string }) => (
      <RNText testID={testID}>{children}</RNText>
    ),
    Redirect: ({ href }: { href: string }) => <RNText testID="redirect">{href}</RNText>,
    useRouter: () => ({ replace: jest.fn() }),
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
}));

jest.mock('../src/auth/session', () => ({
  loadSessionToken: jest.fn().mockResolvedValue(null),
  saveSessionToken: jest.fn(),
  clearSessionToken: jest.fn(),
}));

const mockApi = apiModule as unknown as jest.Mocked<typeof apiModule>;

const testUser = {
  id: 'u-1',
  username: 'kaif',
  displayName: 'Kaif',
  bio: null,
  avatarMediaId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('RecoveryCodeScreen', () => {
  it('shows the pending recovery code exactly once with an acknowledge action', async () => {
    mockApi.signup.mockResolvedValue({ token: 't', recoveryCode: 'ABCD-EFGH-JKLM', user: testUser });

    function Flow(): React.JSX.Element {
      const { signUp, pendingRecoveryCode, acknowledgeRecoveryCode } = useAuth();
      useEffect(() => {
        void signUp('kaif', 'Kaif', 'super-secret-password');
      }, [signUp]);
      if (!pendingRecoveryCode) {
        return <Text testID="no-code">none</Text>;
      }
      return (
        <>
          <RecoveryCodeScreen />
          <Text onPress={acknowledgeRecoveryCode} testID="acknowledge">
            acknowledge
          </Text>
        </>
      );
    }

    render(
      <AuthProvider>
        <Flow />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('recovery-code')).toBeTruthy());
    expect(screen.getByTestId('recovery-code').props.children).toBe('ABCD-EFGH-JKLM');
    fireEvent.press(screen.getByTestId('acknowledge'));
    await waitFor(() => expect(screen.getByTestId('no-code')).toBeTruthy());
  });
});

describe('HomeScreen (authenticated)', () => {
  it('greets the signed-in user and offers logout', async () => {
    const { loadSessionToken } = jest.requireMock('../src/auth/session') as {
      loadSessionToken: jest.Mock;
    };
    loadSessionToken.mockResolvedValue('live-token');
    mockApi.fetchCurrentUser.mockResolvedValue({ user: testUser });

    render(
      <AuthProvider>
        <HomeScreen />
      </AuthProvider>,
    );

    const userLine = await screen.findByTestId('home-user');
    expect(String(userLine.props.children)).toContain('Kaif');
    expect(screen.getByTestId('logout-button')).toBeTruthy();
  });
});
