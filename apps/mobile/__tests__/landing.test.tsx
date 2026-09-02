import { render, screen } from '@testing-library/react-native';
import AuthGate from '../app/index';
import { AuthProvider } from '../src/auth/AuthContext';

/** M2: the root route is the auth gate; the brand screen shows while loading. */
describe('AuthGate (root route)', () => {
  it('renders the brand screen while the session is being restored', () => {
    render(
      <AuthProvider>
        <AuthGate />
      </AuthProvider>,
    );

    expect(screen.getByText('CircleChat')).toBeTruthy();
    expect(screen.getByText('Your little private world.')).toBeTruthy();
  });
});
