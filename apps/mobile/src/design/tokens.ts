/**
 * Design tokens — Warm Hearth / Amber palette (DESIGN.md).
 *
 * Single source of truth for mobile screen styling. Every screen and shared
 * component consumes these tokens — no hex values are hardcoded elsewhere
 * (AGENTS.md §6).
 *
 * Color palette: deep warm charcoal canvas (#161311), firelight amber (#F59E0B)
 * primary, warm coral (#E06D53) accent, warm pearl text (#F5F0EB). Surfaces use
 * organic timber tints; borders are soft earth lines. No purple, cold blue, or
 * pitch black (#000) anywhere.
 *
 * Typography: Plus Jakarta Sans for headings, Inter for body/chat/metadata.
 */
export const colors = {
  // Firelight Amber — primary actions, outgoing message bubbles, active states,
  // unread badges, and focused interactive elements. Text on primary must use
  // the deep-charcoal onPrimary for contrast (DESIGN.md "Primary & Text").
  primary: '#F59E0B',
  primaryDark: '#D97706',
  primaryGlow: 'rgba(245, 158, 11, 0.22)',
  primaryBorder: 'rgba(245, 158, 11, 0.28)',
  primaryContent: '#161311',
  primaryGlowSoft: 'rgba(245, 158, 11, 0.12)',

  // Surface hierarchy — cured-timber warmth. Level 0 is the app canvas;
  // higher levels are elevated cards, modals, and sheets.
  background: '#161311',
  backgroundElevated: '#1F1B18',
  surface: '#1F1B18',
  surfaceElevated: '#241F1B',
  surfaceContainerLowest: '#100e0c',
  surfaceContainerLow: '#1e1b19',
  surfaceContainer: '#221f1d',
  surfaceContainerHigh: '#2d2927',
  surfaceContainerHighest: '#383432',
  surfaceGlass: 'rgba(31, 27, 24, 0.88)',

  // Warm Coral — supporting accent for secondary highlights, identity, links.
  accent: '#E06D53',
  accentMuted: 'rgba(224, 109, 83, 0.14)',
  accentBorder: 'rgba(224, 109, 83, 0.28)',

  // Text tiers — warm pearl / warm gray-beige / hearth stone.
  text: '#F5F0EB',
  textSecondary: '#A89F91',
  textMuted: '#78716C',

  // Borders & outlines — soft earthy lines, never pure black.
  border: '#332B25',
  // Internal warm border token — not in DESIGN.md palette but required for surface separation
  borderActive: '#4A4238',
  borderGlow: 'rgba(245, 158, 11, 0.34)',
  outline: '#A08E7A',
  outlineVariant: '#534434',

  // Status / semantic colors (unchanged where they fit the warm palette).
  success: '#4CD69A',
  successMuted: 'rgba(76, 214, 154, 0.14)',
  successBorder: 'rgba(76, 214, 154, 0.28)',
  warning: '#F59E0B',
  warningMuted: 'rgba(245, 158, 11, 0.14)',
  warningBorder: 'rgba(245, 158, 11, 0.28)',
  error: '#EF4444',
  errorMuted: 'rgba(239, 68, 68, 0.12)',
  errorBorder: 'rgba(239, 68, 68, 0.28)',
  info: '#F59E0B',

  // Modal / scrim overlay — warm charcoal, never pure black.
  overlay: 'rgba(10, 8, 7, 0.82)',

  // Warm member-identity palette for avatar fallbacks (DESIGN.md §"Avatar &
  // Group Stacking"). Replaces the old blue/green/coral mix.
  memberCoral: '#E06D53',
  memberGold: '#E5A93C',
  memberTerracotta: '#E87A4F',
  memberAmber: '#F59E0B',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

export const radii = {
  xs: 8,
  sm: 10,
  md: 12,
  lg: 14,
  xl: 18,
  xxl: 22,
  sheet: 24,
  full: 9999,
} as const;

/**
 * Typography scale (DESIGN.md §Typography).
 * Plus Jakarta Sans for headings, Inter for body/chat/metadata.
 * Font family variant names must match registration in app/_layout.tsx via expo-font.
 * Each entry carries the full fontFamily + weight so screens can spread tokens
 * directly without specifying a separate weight.
 */
export const typography = {
  display: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 32, fontWeight: '700' as const, lineHeight: 40, letterSpacing: -0.64 },
  h1: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 28, fontWeight: '700' as const, lineHeight: 34, letterSpacing: -0.28 },
  h2: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 22, fontWeight: '700' as const, lineHeight: 28, letterSpacing: -0.22 },
  h3: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 18, fontWeight: '600' as const, lineHeight: 24 },
  bodyLarge: { fontFamily: 'Inter-Regular', fontSize: 16, fontWeight: '400' as const, lineHeight: 24 },
  body: { fontFamily: 'Inter-Regular', fontSize: 15, fontWeight: '400' as const, lineHeight: 22 },
  bodyStrong: { fontFamily: 'Inter-SemiBold', fontSize: 15, fontWeight: '600' as const, lineHeight: 22 },
  caption: { fontFamily: 'Inter-Regular', fontSize: 12, fontWeight: '400' as const, lineHeight: 16, letterSpacing: 0.12 },
  captionStrong: { fontFamily: 'Inter-SemiBold', fontSize: 12, fontWeight: '600' as const, lineHeight: 16, letterSpacing: 0.12 },
  button: { fontFamily: 'Inter-SemiBold', fontSize: 15, fontWeight: '600' as const, lineHeight: 20, letterSpacing: 0.15 },
} as const;

export const shadows = {
  subtle: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  card: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 3,
  },
  glow: {
    shadowColor: '#F59E0B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 4,
  },
} as const;
