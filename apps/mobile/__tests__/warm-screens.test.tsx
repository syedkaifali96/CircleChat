import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import LoginScreen from '../app/(auth)/login';
import RegisterScreen from '../app/(auth)/register';
import { colors, typography } from '../src/design/tokens';

const mockReplace = jest.fn();
const mockSignIn = jest.fn();
const mockSignUp = jest.fn();

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest factory requires CJS.
  const { Text } = require('react-native');
  return {
    Link: Text,
    useRouter: () => ({ replace: mockReplace }),
  };
});

jest.mock('../src/auth/AuthContext', () => ({
  useAuth: () => ({ signIn: mockSignIn, signUp: mockSignUp }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockSignIn.mockResolvedValue(undefined);
  mockSignUp.mockResolvedValue(undefined);
});

it('renders warm login typography and preserves sign-in navigation', async () => {
  render(<LoginScreen />);
  expect(screen.getByText('CircleChat')).toHaveStyle({ fontFamily: typography.h1.fontFamily });
  expect(screen.getByTestId('login-username')).toHaveStyle({ fontFamily: typography.body.fontFamily });
  expect(screen.getByText('Log in')).toHaveStyle({ color: colors.primaryContent });
  fireEvent.changeText(screen.getByTestId('login-username'), ' Friend ');
  fireEvent.changeText(screen.getByTestId('login-password'), 'example-password');
  fireEvent.press(screen.getByTestId('login-submit'));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(app)/home'));
  expect(mockSignIn).toHaveBeenCalledWith('friend', 'example-password');
});

it('keeps generic login errors on the login screen', async () => {
  mockSignIn.mockRejectedValue(new Error('unavailable'));
  render(<LoginScreen />);
  fireEvent.press(screen.getByTestId('login-submit'));
  expect(await screen.findByTestId('login-error')).toHaveTextContent('Invalid username or password.');
  expect(mockReplace).not.toHaveBeenCalled();
});

it('preserves registration fields and the recovery-code destination', async () => {
  render(<RegisterScreen />);
  expect(screen.getByTestId('register-display-name')).toHaveStyle({ fontFamily: typography.body.fontFamily });
  fireEvent.changeText(screen.getByTestId('register-username'), ' Friend ');
  fireEvent.changeText(screen.getByTestId('register-display-name'), ' Friend Name ');
  fireEvent.changeText(screen.getByTestId('register-password'), 'example-password');
  fireEvent.press(screen.getByTestId('register-submit'));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(auth)/recovery-code'));
  expect(mockSignUp).toHaveBeenCalledWith('friend', 'Friend Name', 'example-password');
});
