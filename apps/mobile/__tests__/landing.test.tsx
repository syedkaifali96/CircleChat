import { render, screen } from '@testing-library/react-native';
import LandingScreen from '../app/index';

describe('LandingScreen (M0 scaffold)', () => {
  it('renders the CircleChat landing screen with tagline', () => {
    render(<LandingScreen />);

    expect(screen.getByText('CircleChat')).toBeTruthy();
    expect(screen.getByText('Your little private world.')).toBeTruthy();
    expect(screen.getByText('M0 scaffold — no product features yet.')).toBeTruthy();
  });
});
