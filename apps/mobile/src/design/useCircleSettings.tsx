import { useCallback, useEffect, useState } from 'react';
import { fetchCircleSettings, updateCircleSettings } from '../lib/api';
import { loadSessionToken } from '../auth/session';
import { CircleThemeProvider } from './CircleTheme';
import type { BackgroundKey, ThemePreset } from '@circlechat/shared';

/**
 * Circle personalization (M12, design.md §24): fetches this Circle's
 * `circle_settings` (theme preset + accent + background key) and wraps
 * children in the theme provider so the subtree renders with the Circle's
 * identity. Defaults apply while loading — no flash, no duplicate theme
 * state. `circleId` is empty for direct chats: they have no Circle settings,
 * so the gate renders documented defaults without a network round-trip.
 */

export interface CircleSettings {
  themePreset: ThemePreset;
  accentColor: string | null;
  backgroundKey: string | null;
}

export function useCircleSettingsState(circleId: string) {
  const [settings, setSettings] = useState<CircleSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const token = (await loadSessionToken()) ?? '';
      const { settings: found } = await fetchCircleSettings(token, circleId);
      setSettings(found);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [circleId]);

  useEffect(() => {
    // Direct chats (no Circle) stay on defaults — nothing to fetch.
    if (!circleId) {
      setLoading(false);
      return;
    }
    void load();
  }, [circleId, load]);

  const patch = useCallback(
    async (partial: { themePreset?: ThemePreset; accentColor?: string | null; backgroundKey?: BackgroundKey | null }) => {
      const token = (await loadSessionToken()) ?? '';
      const { settings: updated } = await updateCircleSettings(token, circleId, partial);
      setSettings(updated);
    },
    [circleId],
  );

  return { settings, loading, error, reload: load, patch };
}

/** Resolves the fetched settings into the theme provider (defaults while
 * loading, so screens never render an unstyled frame). Screens that need the
 * raw settings (pickers) use `useCircleSettingsState` directly instead. */
export function CircleThemeGate({
  circleId,
  children,
}: {
  circleId: string;
  children: React.ReactNode;
}) {
  const { settings } = useCircleSettingsState(circleId);
  return (
    <CircleThemeProvider
      themePreset={settings?.themePreset}
      accentColor={settings?.accentColor}
      backgroundKey={settings?.backgroundKey}
    >
      {children}
    </CircleThemeProvider>
  );
}
