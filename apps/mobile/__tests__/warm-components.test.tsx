import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';
import { Avatar } from '../src/components/Avatar';
import { AvatarGroup } from '../src/components/AvatarGroup';
import { Badge } from '../src/components/Badge';
import { BottomNav } from '../src/components/BottomNav';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Input } from '../src/components/Input';
import { colors, typography } from '../src/design/tokens';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }));

describe('Warm Hearth shared components', () => {
  it('hashes initials deterministically into the four warm member colors', () => {
    const palette = [colors.memberCoral, colors.memberGold, colors.memberTerracotta, colors.memberAmber];
    for (const name of ['A', 'B', 'C', 'D', 'Kaif', 'Ayesha']) {
      let hash = 0;
      for (let i = 0; i < name.length; i++) {
        hash = (hash + name.charCodeAt(i) * (i + 1)) % palette.length;
      }
      const tree = render(<Avatar name={name} testID="avatar" />);
      const initial = tree.getByText(name[0].toUpperCase());
      const backgrounds = tree.UNSAFE_getAllByType(View)
        .map((node) => StyleSheet.flatten(node.props.style)?.backgroundColor)
        .filter(Boolean);
      expect(backgrounds).toContain(palette[hash]);
      expect(initial).toHaveStyle({ color: colors.primaryContent, fontFamily: typography.h2.fontFamily });
      tree.unmount();
    }
  });

  it('retains overflow count and warm surface in AvatarGroup', () => {
    const tree = render(<AvatarGroup items={['A', 'B', 'C'].map((name) => ({ id: name, name }))} max={1} />);
    expect(tree.getByText('+2')).toHaveStyle({ color: colors.primary, fontFamily: typography.captionStrong.fontFamily });
    const bubbleBackgrounds = tree.UNSAFE_getAllByType(View)
      .map((node) => StyleSheet.flatten(node.props.style)?.backgroundColor)
      .filter(Boolean);
    expect(bubbleBackgrounds).toContain(colors.surfaceElevated);
  });

  it('keeps primary button interactions and disabled/loading behavior with Inter labels', () => {
    const onPress = jest.fn();
    const tree = render(<Button testID="button" onPress={onPress}>Send</Button>);
    expect(tree.getByTestId('button')).toHaveStyle({ backgroundColor: colors.primary });
    expect(tree.getByText('Send')).toHaveStyle({ fontFamily: typography.button.fontFamily, color: colors.primaryContent });
    fireEvent.press(tree.getByTestId('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
    tree.rerender(<Button testID="button" onPress={onPress} disabled>Send</Button>);
    fireEvent.press(tree.getByTestId('button'));
    tree.rerender(<Button testID="button" onPress={onPress} loading>Send</Button>);
    fireEvent.press(tree.getByTestId('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders unread amber badges and elevated amber-glow cards', () => {
    const tree = render(<Card variant="elevated" testID="card"><Badge variant="unread" label={3} testID="badge" /></Card>);
    expect(tree.getByTestId('card')).toHaveStyle({ backgroundColor: colors.surfaceElevated, shadowColor: colors.primary });
    expect(tree.getByTestId('badge')).toHaveStyle({ backgroundColor: colors.primary });
    expect(tree.getByText('3')).toHaveStyle({ fontFamily: typography.captionStrong.fontFamily });
  });

  it('uses amber active navigation and preserves route replacement', () => {
    mockReplace.mockClear();
    const tree = render(<BottomNav activeTab="home" />);
    expect(tree.getByText('Circles')).toHaveStyle({ color: colors.primary, fontFamily: typography.captionStrong.fontFamily });
    expect(tree.getByTestId('bottom-nav-home')).toHaveStyle({ backgroundColor: colors.primaryGlowSoft });
    expect(tree.getByText('Chats')).toHaveStyle({ color: colors.textMuted });
    fireEvent.press(tree.getByTestId('bottom-nav-home'));
    expect(mockReplace).not.toHaveBeenCalled();
    fireEvent.press(tree.getByTestId('bottom-nav-chats'));
    expect(mockReplace).toHaveBeenCalledWith('/(app)/chats');
  });

  it('keeps focus callbacks and switches the input border to amber', () => {
    const onFocus = jest.fn();
    const onBlur = jest.fn();
    const tree = render(<Input testID="input" label="Name" helperText="Enter a name" onFocus={onFocus} onBlur={onBlur} />);
    const input = tree.getByTestId('input');
    expect(input).toHaveStyle({ fontFamily: typography.body.fontFamily });
    const borderColors = () => tree.UNSAFE_getAllByType(View)
      .map((node) => StyleSheet.flatten(node.props.style)?.borderColor)
      .filter(Boolean);
    expect(borderColors()).toContain(colors.border);
    fireEvent(input, 'focus', {});
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(borderColors()).toContain(colors.primary);
    expect(borderColors()).not.toContain(colors.border);
    fireEvent(input, 'blur', {});
    expect(onBlur).toHaveBeenCalledTimes(1);
    expect(borderColors()).toContain(colors.border);
    expect(tree.getByText('Enter a name')).toHaveStyle({ fontFamily: typography.caption.fontFamily });
  });
});
