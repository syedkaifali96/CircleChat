import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { ImageBackground, StyleSheet, View } from 'react-native';
import { colors as baseColors } from '../design/tokens';
import type { BackgroundKey, ThemePreset } from '@circlechat/shared';

/**
 * Circle themes (M12, docs/DATABASE.md §1.4): the four app-defined presets
 * the server accepts as `circle_settings.theme_preset`. Each preset maps the
 * design-system roles onto the approved dark palette — personalization never
 * invents new roles, it only recolors existing tokens (docs/design.md §3).
 * The persisted `dark_purple` key remains for API compatibility; its visual
 * roles now resolve to the approved warm-midnight brand foundation.
 */

export interface ThemeColors {
  primary: string;
  background: string;
  surface: string;
  accent: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  /** Chat bubble fills — derived per preset, roles unchanged. */
  bubbleOwn: string;
  bubbleOther: string;
  bubbleOwnText: string;
}

const darkPurple: ThemeColors = {
  primary: baseColors.primary,
  background: baseColors.background,
  surface: baseColors.surface,
  accent: baseColors.accent,
  text: baseColors.text,
  textSecondary: baseColors.textSecondary,
  textMuted: baseColors.textMuted,
  border: baseColors.border,
  bubbleOwn: baseColors.primary,
  bubbleOther: baseColors.surface,
  bubbleOwnText: baseColors.primaryContent,
};

export const CIRCLE_THEMES: Record<ThemePreset, ThemeColors> = {
  dark_purple: darkPurple,
  midnight: {
    ...darkPurple,
    background: '#05050C',
    surface: '#101020',
    border: '#1F1F38',
    textMuted: '#7A7A92',
    bubbleOther: '#101020',
  },
  orchid: {
    ...darkPurple,
    background: '#12081C',
    surface: '#221233',
    accent: '#C4B5FD',
    border: '#3A2352',
    bubbleOther: '#221233',
  },
  ember: {
    ...darkPurple,
    primary: '#B45309',
    background: '#150A08',
    surface: '#2A1712',
    accent: '#FBBF24',
    border: '#47291C',
    textMuted: '#9C8878',
    bubbleOwn: '#B45309',
    bubbleOther: '#2A1712',
    bubbleOwnText: baseColors.text,
  },
};

export const THEME_LABELS: Record<ThemePreset, string> = {
  dark_purple: 'Warm Midnight (default)',
  midnight: 'Midnight',
  orchid: 'Orchid',
  ember: 'Ember',
};

/**
 * Bundled chat backgrounds (M12, docs/DATABASE.md §1.4 `background_key`):
 * STABLE app-defined keys, NOT user uploads — no second storage system, no
 * public URLs. Each asset ships in the app bundle and is dimmed under a
 * preset-colored scrim so text contrast (design.md §24) survives any combo.
 */
export const BACKGROUND_LABELS: Record<BackgroundKey, string> = {
  none: 'None',
  aurora: 'Aurora',
  dusk: 'Dusk',
  velvet: 'Velvet',
};

export const BACKGROUND_SOURCES: Record<Exclude<BackgroundKey, 'none'>, number> = {
  // Metro resolves asset `require()`s statically — the import-lint rule does
  // not apply to bundled asset references.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  aurora: require('../../assets/backgrounds/aurora.png'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  dusk: require('../../assets/backgrounds/dusk.png'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  velvet: require('../../assets/backgrounds/velvet.png'),
};

/** Tinted scrim over a bundled background: keeps bubbles/labels readable on
 * every theme preset (design.md §24 "personalization should not destroy
 * readability"). Returns null for `none`/undefined — no overlay then. */
export function themedBackdrop(backgroundKey?: string | null): ReactNode {
  if (!backgroundKey || backgroundKey === 'none' || !(backgroundKey in BACKGROUND_SOURCES)) {
    return null;
  }
  const key = backgroundKey as Exclude<BackgroundKey, 'none'>;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <ImageBackground
        source={BACKGROUND_SOURCES[key]}
        style={StyleSheet.absoluteFill}
        imageStyle={{ opacity: 0.5 }}
      >
        <View style={[StyleSheet.absoluteFill, { backgroundColor: baseColors.overlay }]} />
      </ImageBackground>
    </View>
  );
}

interface CircleThemeContextValue {
  /** Resolved colors for the current Circle's preset (default when none). */
  colors: ThemeColors;
  preset: ThemePreset;
  /** Optional per-Circle accent override from circle_settings.accent_color. */
  accentColor: string | null;
  /** Bundled chat background key from circle_settings.background_key. */
  backgroundKey: string | null;
}

const CircleThemeContext = createContext<CircleThemeContextValue>({
  colors: darkPurple,
  preset: 'dark_purple',
  accentColor: null,
  backgroundKey: null,
});

export function CircleThemeProvider({
  themePreset = 'dark_purple',
  accentColor = null,
  backgroundKey = null,
  children,
}: {
  themePreset?: ThemePreset;
  /** Server-validated `#RRGGBB` override for the accent role. */
  accentColor?: string | null;
  /** App-defined bundled background key (`none` treated as none). */
  backgroundKey?: string | null;
  children: ReactNode;
}) {
  const value = useMemo<CircleThemeContextValue>(() => {
    const colors = { ...CIRCLE_THEMES[themePreset] };
    if (accentColor) {
      colors.accent = accentColor;
    }
    return { colors, preset: themePreset, accentColor, backgroundKey };
  }, [themePreset, accentColor, backgroundKey]);
  return <CircleThemeContext.Provider value={value}>{children}</CircleThemeContext.Provider>;
}

export function useCircleTheme(): CircleThemeContextValue {
  return useContext(CircleThemeContext);
}
