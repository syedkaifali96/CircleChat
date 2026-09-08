/** Design tokens from design.md §3.1 — single source for screen styling.
 * The full component library (buttons, bubbles, inputs…) arrives with the
 * Phase-2 design-system milestone; M0 only pins the palette for the scaffold
 * screen so no hex values are hardcoded in screens (AGENTS.md §6).
 */
export const colors = {
  primary: '#7C3AED',
  primaryDark: '#6D28D9',
  primaryGlow: 'rgba(124, 58, 237, 0.35)',
  background: '#0B0714',
  backgroundElevated: '#110C1D',
  surface: '#171225',
  surfaceElevated: '#201833',
  surfaceGlass: 'rgba(23, 18, 37, 0.85)',
  accent: '#A78BFA',
  accentMuted: 'rgba(167, 139, 250, 0.15)',
  text: '#F5F3FF',
  textSecondary: '#B8B2C8',
  textMuted: '#81798F',
  border: '#29223A',
  borderActive: '#3F3459',
  borderGlow: 'rgba(124, 58, 237, 0.5)',
  success: '#22C55E',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#60A5FA',
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
  xs: 6,
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
  xxl: 20,
  sheet: 24,
  full: 9999,
} as const;

export const typography = {
  display: { fontSize: 32, fontWeight: '700' as const, lineHeight: 40 },
  h1: { fontSize: 28, fontWeight: '700' as const, lineHeight: 34 },
  h2: { fontSize: 22, fontWeight: '700' as const, lineHeight: 28 },
  h3: { fontSize: 18, fontWeight: '600' as const, lineHeight: 24 },
  bodyLarge: { fontSize: 16, fontWeight: '400' as const, lineHeight: 22 },
  body: { fontSize: 15, fontWeight: '400' as const, lineHeight: 20 },
  bodyStrong: { fontSize: 15, fontWeight: '600' as const, lineHeight: 20 },
  caption: { fontSize: 12, fontWeight: '400' as const, lineHeight: 16 },
  captionStrong: { fontSize: 12, fontWeight: '600' as const, lineHeight: 16 },
  button: { fontSize: 15, fontWeight: '600' as const, lineHeight: 20 },
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
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  glow: {
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
  },
} as const;

