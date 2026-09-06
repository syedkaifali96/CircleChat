import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { CircleThemeProvider, CIRCLE_THEMES, themedBackdrop, THEME_LABELS } from '../src/design/CircleTheme';
import { CircleThemeGate } from '../src/design/useCircleSettings';
import { useCircleTheme } from '../src/design/CircleTheme';
import { MessageBubble } from '../src/chat/MessageBubble';
import CircleSettingsScreen from '../app/(app)/circles/[id]/settings';
import * as apiModule from '../src/lib/api';
import { colors as baseColors } from '../src/design/tokens';
import { THEME_PRESETS, BACKGROUND_KEYS } from '@circlechat/shared';

/**
 * M12 personalization tests: the theme provider maps the four app-defined
 * presets onto the design roles (defaults for direct chats), the gate skips
 * fetching for direct chats and applies Circle settings otherwise, bubbles
 * recolor through the preset, bundled backgrounds resolve only for approved
 * keys, and the settings-screen pickers submit stable identifiers with the
 * documented owner/admin policy mirrored from the server.
 */

const pushMock = jest.fn();

declare global {
  var __persPushMock: jest.Mock | undefined; // hoisted expo-router mock bridge
}

beforeEach(() => {
  jest.clearAllMocks();
  (globalThis as { __persPushMock?: jest.Mock }).__persPushMock = pushMock;
});

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest factory must be CJS
  const { Text: RNText, Pressable: RNPressable } = require('react-native');
  return {
    Link: ({ children, testID }: { children: React.ReactNode; testID?: string }) => (
      <RNPressable testID={testID}>
        <RNText>{children}</RNText>
      </RNPressable>
    ),
    useRouter: () => ({ push: (...args: unknown[]) => globalThis.__persPushMock?.(...args), replace: jest.fn(), back: jest.fn() }),
    useFocusEffect: (callback: () => void) => {
      // Focus effects fire AFTER mount (like real expo-router) — a synchronous
      // callback would setState during render and loop.
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest factory must be CJS
      const { useEffect } = require('react');
      useEffect(() => {
        callback();
      }, [callback]);
    },
    useLocalSearchParams: () => ({ id: 'c-1' }),
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
  fetchCircle: jest.fn(),
  fetchCircleSettings: jest.fn(),
  updateCircleSettings: jest.fn(),
  updateCircle: jest.fn(),
  deleteCircle: jest.fn(),
}));

jest.mock('../src/auth/session', () => ({
  loadSessionToken: jest.fn().mockResolvedValue('test-token'),
  saveSessionToken: jest.fn(),
  clearSessionToken: jest.fn(),
}));

// expo-av needs the native ExponentAV module; MessageBubble pulls MediaContent
// which imports it — mock the Audio surface like the messaging tests do.
jest.mock('expo-av', () => ({
  Audio: {
    Sound: { createAsync: jest.fn().mockResolvedValue({ sound: { unloadAsync: jest.fn() }, status: {} }) },
    setAudioModeAsync: jest.fn(),
  },
}));

const mockApi = apiModule as unknown as jest.Mocked<typeof apiModule>;

/** Reads the live theme context into testIDs for assertions. */
function ThemeProbe() {
  const { colors, preset, backgroundKey } = useCircleTheme();
  return (
    <>
      <Text testID="probe-preset">{preset}</Text>
      <Text testID="probe-primary">{colors.primary}</Text>
      <Text testID="probe-background">{colors.background}</Text>
      <Text testID="probe-accent">{colors.accent}</Text>
      <Text testID="probe-bubble-own">{colors.bubbleOwn}</Text>
      <Text testID="probe-background-key">{backgroundKey ?? 'none'}</Text>
    </>
  );
}

const ownMessage = {
  id: 'm-own',
  conversationId: 'conv-1',
  senderId: 'u-1',
  senderUsername: 'kaif',
  senderDisplayName: 'Kaif',
  type: 'text' as const,
  body: 'Hello from me',
  mediaId: null,
  media: null,
  replyToId: null,
  replyPreview: null,
  editedAt: null,
  deleted: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  reactions: [],
};

const otherMessage = {
  ...ownMessage,
  id: 'm-other',
  senderId: 'u-2',
  body: 'Hello from them',
};

describe('theme provider (M12)', () => {
  it('resolves the default preset to the documented brand tokens', () => {
    render(
      <CircleThemeProvider>
        <ThemeProbe />
      </CircleThemeProvider>,
    );
    expect(screen.getByTestId('probe-preset').props.children).toBe('dark_purple');
    expect(screen.getByTestId('probe-primary').props.children).toBe(baseColors.primary);
    expect(screen.getByTestId('probe-background').props.children).toBe(baseColors.background);
    expect(screen.getByTestId('probe-bubble-own').props.children).toBe(baseColors.primary);
    expect(screen.getByTestId('probe-background-key').props.children).toBe('none');
  });

  it('maps every approved preset and applies the accent override', () => {
    for (const preset of THEME_PRESETS) {
      expect(CIRCLE_THEMES[preset]).toBeDefined();
      expect(THEME_LABELS[preset]).toBeTruthy();
    }
    const { getByTestId } = render(
      <CircleThemeProvider themePreset="ember">
        <ThemeProbe />
      </CircleThemeProvider>,
    );
    expect(getByTestId('probe-preset').props.children).toBe('ember');
    expect(getByTestId('probe-primary').props.children).toBe(CIRCLE_THEMES.ember.primary);

    const override = render(
      <CircleThemeProvider themePreset="ember" accentColor="#34D399" backgroundKey="aurora">
        <ThemeProbe />
      </CircleThemeProvider>,
    );
    expect(override.getByTestId('probe-accent').props.children).toBe('#34D399');
    expect(override.getByTestId('probe-background-key').props.children).toBe('aurora');
  });
});

describe('circle theme gate (M12)', () => {
  it('skips the network for direct chats (empty circleId) and keeps defaults', () => {
    render(
      <CircleThemeGate circleId="">
        <ThemeProbe />
      </CircleThemeGate>,
    );
    expect(mockApi.fetchCircleSettings).not.toHaveBeenCalled();
    expect(screen.getByTestId('probe-primary').props.children).toBe(baseColors.primary);
  });

  it('applies the Circle settings once fetched', async () => {
    mockApi.fetchCircleSettings.mockResolvedValueOnce({
      settings: { themePreset: 'orchid', accentColor: null, backgroundKey: null },
    });
    render(
      <CircleThemeGate circleId="c-1">
        <ThemeProbe />
      </CircleThemeGate>,
    );
    await waitFor(() => expect(screen.getByTestId('probe-preset').props.children).toBe('orchid'));
    expect(screen.getByTestId('probe-primary').props.children).toBe(CIRCLE_THEMES.orchid.primary);
  });
});

describe('bundled chat backgrounds (M12)', () => {
  it('renders nothing for none/unknown keys and an overlay for approved keys', () => {
    expect(themedBackdrop(null)).toBeNull();
    expect(themedBackdrop('none')).toBeNull();
    expect(themedBackdrop('https://evil.example/bg.png')).toBeNull();
    expect(themedBackdrop('aurora')).not.toBeNull();
    expect(themedBackdrop('dusk')).not.toBeNull();
    expect(themedBackdrop('velvet')).not.toBeNull();
  });
});

describe('message bubbles under a preset (M12)', () => {
  it('recolors bubble fills and accent details from the Circle theme', () => {
    const { toJSON } = render(
      <CircleThemeProvider themePreset="ember" backgroundKey="velvet">
        <MessageBubble message={ownMessage} isOwn showSender={false} />
        <MessageBubble message={otherMessage} isOwn={false} showSender />
      </CircleThemeProvider>,
    );
    const tree = JSON.stringify(toJSON());
    // Own bubble uses the preset primary; incoming uses the preset surface.
    expect(tree).toContain(CIRCLE_THEMES.ember.bubbleOwn);
    expect(tree).toContain(CIRCLE_THEMES.ember.bubbleOther);
    // Accent details (sender name) use the preset accent, not the brand one.
    expect(tree).toContain(CIRCLE_THEMES.ember.accent);
  });

  it('keeps the documented brand colors for direct chats (no provider)', () => {
    const { toJSON } = render(<MessageBubble message={ownMessage} isOwn showSender={false} />);
    expect(JSON.stringify(toJSON())).toContain(baseColors.primary);
  });
});

describe('circle settings personalization (M12)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const ownerCircle = {
    id: 'c-1',
    name: 'Personalized',
    description: null,
    avatarMediaId: null,
    membersCount: 1,
    callerRole: 'owner' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
    members: [],
  };

  const baseSettings = { themePreset: 'midnight' as const, accentColor: null, backgroundKey: null };

  it('shows the pickers for owner/admin and patches stable identifiers', async () => {
    mockApi.fetchCircle.mockResolvedValue({ circle: ownerCircle });
    mockApi.fetchCircleSettings.mockResolvedValue({ settings: baseSettings });
    mockApi.updateCircleSettings.mockResolvedValue({
      settings: { themePreset: 'ember', accentColor: null, backgroundKey: 'velvet' },
    });

    render(<CircleSettingsScreen />);

    await waitFor(() => expect(screen.getByTestId('personalization-section')).toBeTruthy());
    for (const preset of THEME_PRESETS) {
      expect(screen.getByTestId(`theme-option-${preset}`)).toBeTruthy();
    }
    for (const key of BACKGROUND_KEYS) {
      expect(screen.getByTestId(`background-option-${key}`)).toBeTruthy();
    }
    expect(screen.getByTestId('theme-selected-midnight')).toBeTruthy();

    fireEvent.press(screen.getByTestId('theme-option-ember'));
    await waitFor(() => expect(mockApi.updateCircleSettings).toHaveBeenCalledWith('test-token', 'c-1', { themePreset: 'ember' }));
    await waitFor(() => expect(screen.getByTestId('theme-selected-ember')).toBeTruthy());
  });

  it('reverts the selection and shows an error when the patch fails', async () => {
    mockApi.fetchCircle.mockResolvedValue({ circle: ownerCircle });
    mockApi.fetchCircleSettings.mockResolvedValue({ settings: baseSettings });
    mockApi.updateCircleSettings.mockRejectedValueOnce(new Error('network down'));

    render(<CircleSettingsScreen />);
    await waitFor(() => expect(screen.getByTestId('personalization-section')).toBeTruthy());

    fireEvent.press(screen.getByTestId('background-option-velvet'));
    await waitFor(() => expect(screen.getByTestId('personalization-error')).toBeTruthy());
    // Optimistic update rolled back — the previous key stays selected.
    expect(screen.getByTestId('background-selected-none')).toBeTruthy();
    expect(screen.queryByTestId('background-selected-velvet')).toBeNull();
  });

  it('hides personalization from plain members (server rejects them anyway)', async () => {
    mockApi.fetchCircle.mockResolvedValue({ circle: { ...ownerCircle, callerRole: 'member' } });
    mockApi.fetchCircleSettings.mockResolvedValue({ settings: baseSettings });

    render(<CircleSettingsScreen />);
    await waitFor(() => expect(screen.getByTestId('circle-settings-screen')).toBeTruthy());
    expect(screen.queryByTestId('personalization-section')).toBeNull();
  });
});
