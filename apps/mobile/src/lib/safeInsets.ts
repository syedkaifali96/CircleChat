import { useContext } from 'react';
import { SafeAreaInsetsContext, type EdgeInsets } from 'react-native-safe-area-context';

const DEFAULT_INSETS: EdgeInsets = { top: 0, bottom: 0, left: 0, right: 0 };

/**
 * Safe insets hook that gracefully falls back to zero in test environments
 * where <SafeAreaProvider> is not mounted, preventing crashes.
 */
export function useSafeInsets(): EdgeInsets {
  const insets = useContext(SafeAreaInsetsContext);
  return insets ?? DEFAULT_INSETS;
}
