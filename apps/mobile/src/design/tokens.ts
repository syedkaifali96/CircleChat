/** Design tokens from design.md §3.1 — single source for screen styling.
 * The full component library (buttons, bubbles, inputs…) arrives with the
 * Phase-2 design-system milestone; M0 only pins the palette for the scaffold
 * screen so no hex values are hardcoded in screens (AGENTS.md §6).
 */
export const colors = {
  // Midnight foundations keep the app private and calm without reading as
  // pure black. Coral carries primary actions; lavender is supporting only.
  primary: '#F58A7A',
  primaryDark: '#DB7165',
  primaryGlow: 'rgba(245, 138, 122, 0.22)',
  primaryBorder: 'rgba(245, 138, 122, 0.28)',
  primaryContent: '#171E2D',
  background: '#0B1020',
  backgroundElevated: '#10182A',
  surface: '#151E30',
  surfaceElevated: '#1B263A',
  surfaceGlass: 'rgba(21, 30, 48, 0.92)',
  accent: '#D4B5FF',
  accentMuted: 'rgba(212, 181, 255, 0.14)',
  accentBorder: 'rgba(212, 181, 255, 0.28)',
  text: '#F7F7FA',
  textSecondary: '#C8D1E0',
  textMuted: '#8D9AB0',
  border: '#263044',
  borderActive: '#3A465E',
  borderGlow: 'rgba(245, 138, 122, 0.34)',
  success: '#4CD69A',
  successMuted: 'rgba(76, 214, 154, 0.14)',
  successBorder: 'rgba(76, 214, 154, 0.28)',
  warning: '#F59E0B',
  warningMuted: 'rgba(245, 158, 11, 0.14)',
  warningBorder: 'rgba(245, 158, 11, 0.28)',
  error: '#EF4444',
  errorMuted: 'rgba(239, 68, 68, 0.12)',
  errorBorder: 'rgba(239, 68, 68, 0.28)',
  info: '#60A5FA',
  overlay: 'rgba(3, 7, 16, 0.78)',
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
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 3,
  },
  glow: {
    shadowColor: '#F58A7A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 4,
  },
} as const;
