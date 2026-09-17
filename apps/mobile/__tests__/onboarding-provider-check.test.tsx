import { render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import CreateCircleScreen from '../app/(app)/circles/create';
import JoinCircleScreen from '../app/(app)/circles/join';

const { SafeAreaProvider } = jest.requireActual<typeof import('react-native-safe-area-context')>('react-native-safe-area-context');

jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), replace: jest.fn() }) }));
jest.mock('../src/auth/session', () => ({ loadSessionToken: jest.fn() }));

it.each([
  ['create', CreateCircleScreen],
  ['join', JoinCircleScreen],
] as const)('preserves %s header offsets through SafeAreaProvider', (name, Screen) => {
  render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 360, height: 720 }, insets: { top: 32, bottom: 0, left: 0, right: 0 } }}>
      <Screen />
    </SafeAreaProvider>,
  );
  const container = screen.getByTestId(`${name}-circle-screen`);
  const header = within(container).getByTestId(`${name}-circle-header`);
  expect(container).toHaveStyle({ paddingTop: 44 });
  expect(header).toHaveStyle({ marginTop: 12, marginBottom: 4 });
  expect(within(header).getByTestId(`${name}-circle-back`)).toBeTruthy();
  const padding = StyleSheet.flatten(container.props.style).paddingTop;
  const margin = StyleSheet.flatten(header.props.style).marginTop;
  expect((padding + margin) * 3).toBe(168);
});
