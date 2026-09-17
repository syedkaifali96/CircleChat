import { act, render } from '@testing-library/react-native';
import { View as MockView } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { loadAsync } from 'expo-font';
import RootLayout from '../app/_layout';
import { AuthProvider } from '../src/auth/AuthContext';
import { AppLockProvider } from '../src/auth/AppLockManager';
import { PushManager } from '../src/lib/PushManager';
import { typography } from '../src/design/tokens';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  initialWindowMetrics: {
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 44, right: 0, bottom: 34, left: 0 },
  },
}));
jest.mock('expo-font', () => ({ loadAsync: jest.fn() }));
jest.mock('expo-router', () => ({ Stack: () => <MockView testID="font-test-stack" /> }));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('../src/auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('../src/auth/AppLockManager', () => ({
  AppLockProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('../src/lib/PushManager', () => ({ PushManager: () => null }));

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup() {
  const jakarta = deferred();
  const inter = deferred();
  jest.mocked(loadAsync).mockReset();
  jest.mocked(loadAsync)
    .mockReturnValueOnce(jakarta.promise)
    .mockReturnValueOnce(inter.promise);
  const tree = render(<RootLayout />);
  return { tree, jakarta, inter };
}

describe('Root font loading', () => {
  it('registers all seven bundled fonts under aliases matching typography tokens', async () => {
    const { tree, jakarta, inter } = setup();
    expect(loadAsync).toHaveBeenCalledTimes(2);
    const families = jest.mocked(loadAsync).mock.calls.map(([map]) => map);
    expect(Object.keys(families[0])).toEqual([
      'PlusJakartaSans-Regular', 'PlusJakartaSans-Medium',
      'PlusJakartaSans-SemiBold', 'PlusJakartaSans-Bold',
    ]);
    expect(Object.keys(families[1])).toEqual(['Inter-Regular', 'Inter-Medium', 'Inter-SemiBold']);
    const registered = families.flatMap((family) => Object.keys(family));
    for (const style of Object.values(typography)) {
      expect(registered).toContain(style.fontFamily);
    }
    await act(async () => { jakarta.resolve(); inter.resolve(); });
    expect(tree.getByTestId('font-test-stack')).toBeTruthy();
  });

  it('keeps the providers mounted and in order while both families load', async () => {
    const { tree, jakarta, inter } = setup();
    const safeArea = tree.UNSAFE_getByType(SafeAreaProvider);
    const auth = tree.UNSAFE_getByType(AuthProvider);
    const appLock = tree.UNSAFE_getByType(AppLockProvider);
    const push = tree.UNSAFE_getByType(PushManager);
    expect(safeArea.findByType(AuthProvider)).toBe(auth);
    expect(auth.findByType(AppLockProvider)).toBe(appLock);
    expect(auth.findByType(PushManager)).toBe(push);
    expect(auth.children.indexOf(push)).toBeLessThan(auth.children.indexOf(appLock));
    expect(tree.getByTestId('font-loading')).toBeTruthy();
    expect(tree.queryByTestId('font-test-stack')).toBeNull();

    await act(async () => { jakarta.resolve(); });
    expect(tree.getByTestId('font-loading')).toBeTruthy();
    await act(async () => { inter.resolve(); });
    expect(tree.queryByTestId('font-loading')).toBeNull();
    expect(tree.getByTestId('font-test-stack')).toBeTruthy();
    expect(tree.UNSAFE_getByType(SafeAreaProvider)).toBe(safeArea);
    expect(tree.UNSAFE_getByType(AuthProvider)).toBe(auth);
    expect(tree.UNSAFE_getByType(AppLockProvider)).toBe(appLock);
    expect(tree.UNSAFE_getByType(PushManager)).toBe(push);
  });

  it('waits for Jakarta when Inter finishes first', async () => {
    const { tree, jakarta, inter } = setup();
    await act(async () => { inter.resolve(); });
    expect(tree.getByTestId('font-loading')).toBeTruthy();
    expect(tree.queryByTestId('font-test-stack')).toBeNull();
    await act(async () => { jakarta.resolve(); });
    expect(tree.getByTestId('font-test-stack')).toBeTruthy();
  });

  it.each([
    [true, false], [false, true], [true, true],
  ])('continues without crashing when font loading fails (Jakarta: %s, Inter: %s)', async (failJakarta, failInter) => {
    const { tree, jakarta, inter } = setup();
    await act(async () => {
      if (failJakarta) jakarta.reject(new Error('Font unavailable'));
      else jakarta.resolve();
    });
    expect(tree.getByTestId('font-loading')).toBeTruthy();
    await act(async () => {
      if (failInter) inter.reject(new Error('Font unavailable'));
      else inter.resolve();
    });
    expect(tree.queryByTestId('font-loading')).toBeNull();
    expect(tree.getByTestId('font-test-stack')).toBeTruthy();
    expect(tree.UNSAFE_getByType(AppLockProvider)).toBeTruthy();
  });
});
