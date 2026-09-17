import { act, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import RootLayout from '../app/_layout';

/**
 * The Create/Join Circle headers sat under the Android status bar because
 * nothing mounted <SafeAreaProvider>: every useSafeInsets() call fell back to
 * zeros, so the headers were padded by a hardcoded floor instead of the real
 * device inset. This test guards the provider mount at the app root.
 */

jest.mock('expo-router', () => ({ Stack: () => null }));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('../src/auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('../src/auth/AppLockManager', () => ({
  AppLockProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('../src/lib/PushManager', () => ({ PushManager: () => null }));

describe('App root safe-area provider', () => {
  it('mounts SafeAreaProvider so real device insets reach every screen', async () => {
    const tree = render(<RootLayout />);

    expect(tree.UNSAFE_getByType(SafeAreaProvider)).toBeTruthy();
    await act(async () => {});
    expect(tree.UNSAFE_getByType(SafeAreaProvider)).toBeTruthy();
  });
});