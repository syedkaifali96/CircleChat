import { useEffect } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import ProfileEditScreen from '../app/(app)/profile-edit';
import * as apiModule from '../src/lib/api';
import * as sessionModule from '../src/auth/session';
import { AuthProvider, useAuth } from '../src/auth/AuthContext';

/**
 * M3 mobile profile tests: profile edit form renders with read-only username,
 * validation errors surface client-side, successful updates push the new user
 * into the auth context, and the API client receives the PATCH payload.
 * Network and secure storage are mocked.
 */

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest factory must be CJS
  const { Text: RNText } = require('react-native');
  return {
    Link: ({ children, testID }: { children: React.ReactNode; testID?: string }) => (
      <RNText testID={testID}>{children}</RNText>
    ),
    Redirect: ({ href }: { href: string }) => <RNText testID="redirect">{href}</RNText>,
    useRouter: () => ({
      replace: jest.fn(),
      back: jest.fn(),
    }),
  };
});

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  launchImageLibraryAsync: jest.fn().mockResolvedValue({ canceled: true }),
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
  login: jest.fn(),
  signup: jest.fn(),
  fetchCurrentUser: jest.fn(),
  logout: jest.fn(),
  updateProfile: jest.fn(),
  uploadAndAssignAvatar: jest.fn(),
}));

jest.mock('../src/auth/session', () => ({
  loadSessionToken: jest.fn().mockResolvedValue('test-token'),
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

const updatedUser = { ...testUser, displayName: 'Renamed Kaif', bio: 'New bio' };

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.loadSessionToken.mockResolvedValue('test-token');
});

describe('ProfileEditScreen', () => {
  it('renders the edit form with read-only username and current values', async () => {
    mockApi.fetchCurrentUser.mockResolvedValue({ user: testUser });
    render(
      <AuthProvider>
        <ProfileEditScreen />
      </AuthProvider>,
    );

    expect(screen.getByTestId('profile-edit-screen')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId('edit-username').props.children).toEqual(['@', 'kaif']), // read-only
    );
    expect(screen.getByTestId('edit-display-name').props.value).toBe('Kaif');
    expect(screen.getByTestId('edit-save')).toBeTruthy();
    expect(screen.getByTestId('edit-cancel')).toBeTruthy();
  });

  it('shows a client-side validation error for an empty display name', async () => {
    render(
      <AuthProvider>
        <ProfileEditScreen />
      </AuthProvider>,
    );

    fireEvent.changeText(screen.getByTestId('edit-display-name'), '   ');
    fireEvent.press(screen.getByTestId('edit-save'));

    await waitFor(() => expect(screen.getByTestId('edit-error')).toBeTruthy());
    expect(screen.getByTestId('edit-error').props.children).toContain('1–40');
    expect(mockApi.updateProfile).not.toHaveBeenCalled();
  });

  it('saves through the API and pushes the updated user into auth state', async () => {
    mockApi.updateProfile.mockResolvedValue({ user: updatedUser });

    function Probe(): React.JSX.Element {
      const { user } = useAuth();
      return <Text testID="context-user">{user?.displayName ?? 'none'}</Text>;
    }
    function Screen(): React.JSX.Element {
      return (
        <>
          <ProfileEditScreen />
          <Probe />
        </>
      );
    }

    render(
      <AuthProvider>
        <Screen />
      </AuthProvider>,
    );

    fireEvent.changeText(screen.getByTestId('edit-display-name'), 'Renamed Kaif');
    fireEvent.changeText(screen.getByTestId('edit-bio'), 'New bio');
    fireEvent.press(screen.getByTestId('edit-save'));

    await waitFor(() => expect(screen.getByTestId('context-user').props.children).toBe('Renamed Kaif'));
    expect(mockApi.updateProfile).toHaveBeenCalledWith('test-token', {
      displayName: 'Renamed Kaif',
      bio: 'New bio',
    });
  });

  it('surfaces the API error message on failure', async () => {
    mockApi.fetchCurrentUser.mockResolvedValue({ user: testUser });
    mockApi.updateProfile.mockRejectedValue(new apiModule.ApiError('VALIDATION_FAILED', 400, 'Validation failed.'));

    render(
      <AuthProvider>
        <ProfileEditScreen />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('edit-display-name').props.value).toBe('Kaif'));
    fireEvent.press(screen.getByTestId('edit-save'));

    await waitFor(() => expect(screen.getByTestId('edit-error')).toBeTruthy());
    expect(screen.getByTestId('edit-error').props.children).toBe('Validation failed.');
  });

  it('clears the bio when the field is emptied (null payload)', async () => {
    const userWithBio = { ...testUser, bio: 'existing' };
    mockSession.loadSessionToken.mockResolvedValue('test-token');
    mockApi.updateProfile.mockResolvedValue({ user: { ...userWithBio, bio: null } });

    function Seeded(): React.JSX.Element {
      const { updateUser } = useAuth();
      // Seed the context with a user that has a bio.
      useEffect(() => {
        updateUser(userWithBio);
      }, [updateUser]);
      return <ProfileEditScreen />;
    }

    render(
      <AuthProvider>
        <Seeded />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('edit-bio').props.value).toBe('existing'));
    fireEvent.changeText(screen.getByTestId('edit-bio'), '');
    fireEvent.press(screen.getByTestId('edit-save'));

    await waitFor(() =>
      expect(mockApi.updateProfile).toHaveBeenCalledWith('test-token', {
        displayName: 'Kaif',
        bio: null,
      }),
    );
  });
});
