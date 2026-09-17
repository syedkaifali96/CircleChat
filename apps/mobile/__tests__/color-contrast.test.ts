import { CIRCLE_THEMES } from '../src/design/CircleTheme';
import { colors } from '../src/design/tokens';

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

it('keeps terracotta normal text at WCAG AA contrast on every Circle canvas and surface', () => {
  const foreground = luminance(colors.memberTerracotta);
  for (const theme of Object.values(CIRCLE_THEMES)) {
    for (const background of [theme.background, theme.surface]) {
      const backdrop = luminance(background);
      const contrast = (Math.max(foreground, backdrop) + 0.05) / (Math.min(foreground, backdrop) + 0.05);
      expect(contrast).toBeGreaterThanOrEqual(4.5);
    }
  }
  expect([colors.memberAmber, colors.memberCoral, colors.memberGold]).not.toContain(colors.memberTerracotta);
});
