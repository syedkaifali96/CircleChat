/** Design tokens from design.md §3.1 — single source for screen styling.
 * The full component library (buttons, bubbles, inputs…) arrives with the
 * Phase-2 design-system milestone; M0 only pins the palette for the scaffold
 * screen so no hex values are hardcoded in screens (AGENTS.md §6).
 */
export const colors = {
  primary: '#7C3AED',
  background: '#0B0714',
  surface: '#171225',
  accent: '#A78BFA',
  text: '#F5F3FF',
  textSecondary: '#B8B2C8',
  textMuted: '#81798F',
  border: '#29223A',
  success: '#22C55E',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#60A5FA',
} as const;
