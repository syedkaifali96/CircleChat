import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { ImageBackground, StyleSheet, View } from 'react-native';
import { colors as baseColors } from '../design/tokens';
import type { BackgroundKey, ThemePreset } from '@circlechat/shared';

/**
 * Circle themes (M12, docs/DATABASE.md §1.4): the four app-defined presets
 * the server accepts as `circle_settings.theme_preset`. Each preset maps the
 * design-system roles onto the approved Warm Hearth palette — personalization
 * only recolors existing roles, never invents new ones (design.md §24).
 *
 * ⚠️ TECHNICAL DEBT (V2): the preset enum NAMES (`dark_purple`, `orchid`) still
 * reference the old purple palette, but their VISUAL appearance is now Warm
 * Hearth amber/timber. Renaming requires a server-side schema + API change
 * (packages/shared/src/circles.ts Zod enum + DB migration), which is out of
 * scope for this visual migration. The names are API-stable identifiers only.
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

/** Warm Hearth default — Firelight Amber on deep charcoal canvas. */
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
  /** Warm Hearth — amber firelight on deep charcoal. */
  dark_purple: darkPurple,
  /** Cabin Night — deepest charcoal base, same amber identity. */
  midnight: {
    ...darkPurple,
    background: baseColors.surfaceContainerLowest,
    surface: baseColors.surfaceContainerLow,
    border: baseColors.borderActive,
    textMuted: baseColors.textMuted,
    bubbleOther: baseColors.surfaceContainerLow,
  },
  /** Velvet Dusk — warm coral primary, terracotta accent. */
  orchid: {
    ...darkPurple,
    primary: baseColors.memberCoral,
    accent: baseColors.memberTerracotta,
    border: baseColors.borderActive,
    textMuted: baseColors.textMuted,
    bubbleOwn: baseColors.memberCoral,
    bubbleOwnText: baseColors.primaryContent,
  },
  /** Amber Timber — deep ochre amber on elevated timber. */
  ember: {
    ...darkPurple,
    primary: baseColors.primaryDark,
    accent: baseColors.primary,
    background: baseColors.background,
    surface: baseColors.surfaceElevated,
    border: baseColors.borderActive,
    textMuted: baseColors.textMuted,
    bubbleOwn: baseColors.primaryDark,
    bubbleOther: baseColors.surfaceElevated,
    bubbleOwnText: baseColors.primaryContent,
  },
};

export const THEME_LABELS: Record<ThemePreset, string> = {
  dark_purple: 'Warm Hearth (default)',
  midnight: 'Cabin Night',
  orchid: 'Velvet Dusk',
  ember: 'Amber Timber',
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
