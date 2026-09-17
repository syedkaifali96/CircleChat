import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  fetchNotificationSettings,
  updateNotificationSettings,
} from '../../src/lib/api';
import {
  registerForPushNotifications,
  type PushPermissionStatus,
} from '../../src/lib/notifications';
import { loadSessionToken } from '../../src/auth/session';
import { colors, typography } from '../../src/design/tokens';

/**
 * Notification settings (M8): the user's global push preferences — global
 * enable/disable and message preview privacy — plus the OS permission state.
 * The server constructs all payloads; these toggles only set preferences the
 * server reads at send time.
 */

function permissionLabel(status: PushPermissionStatus): string {
  switch (status) {
    case 'granted':
      return 'Allowed — this device will receive pushes.';
    case 'denied':
      return 'Denied — enable notifications for CircleChat in system settings.';
    default:
      return 'Unavailable — pushes need a physical device.';
  }
}

export default function NotificationSettingsScreen() {
  const [settings, setSettings] = useState<{ notificationsEnabled: boolean; notificationPreview: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [permission, setPermission] = useState<PushPermissionStatus>('unavailable');

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const token = (await loadSessionToken()) ?? '';
      const { settings: found } = await fetchNotificationSettings(token);
      setSettings(found);
      setPermission(await registerForPushNotifications(token));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onToggle = async (key: 'notificationsEnabled' | 'notificationPreview', value: boolean) => {
    if (!settings) {
      return;
    }
    setSaving(true);
    const previous = settings[key];
    setSettings({ ...settings, [key]: value });
    try {
      const authToken = (await loadSessionToken()) ?? '';
      const { settings: updated } = await updateNotificationSettings(authToken, { [key]: value });
      setSettings(updated);
    } catch {
      setSettings((current) => (current ? { ...current, [key]: previous } : current)); // revert on failure
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered} testID="notif-settings-loading">
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (loadError || !settings) {
    return (
      <View style={styles.centered} testID="notif-settings-error">
        <Text style={styles.stateTitle}>Something went wrong.</Text>
        <Text style={styles.stateText}>Couldn't load your notification settings.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} testID="notif-settings-screen">
      <Text style={styles.title}>Notifications</Text>

      <View style={styles.row} testID="toggle-global">
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Push notifications</Text>
          <Text style={styles.rowSubtitle}>Turn off to stop all pushes. Messaging is unaffected.</Text>
        </View>
        <Switch
          value={settings.notificationsEnabled}
          onValueChange={(value) => void onToggle('notificationsEnabled', value)}
          disabled={saving}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor={colors.text}
          testID="switch-global"
        />
      </View>

      <View style={styles.row} testID="toggle-preview">
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Message preview</Text>
          <Text style={styles.rowSubtitle}>Show message text in notifications. Off shows "New message".</Text>
        </View>
        <Switch
          value={settings.notificationPreview}
          onValueChange={(value) => void onToggle('notificationPreview', value)}
          disabled={saving}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor={colors.text}
          testID="switch-preview"
        />
      </View>

      <View style={styles.permissionBox} testID="push-permission">
        <Text style={styles.permissionTitle}>Device permission</Text>
        <Text style={styles.permissionText}>{permissionLabel(permission)}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingTop: 64 },
  centered: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { ...typography.h1, color: colors.text, fontSize: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginTop: 16,
  },
  rowText: { flex: 1, marginRight: 12 },
  rowTitle: { ...typography.bodyStrong, color: colors.text, fontSize: 15 },
  rowSubtitle: { ...typography.caption, color: colors.textMuted, fontSize: 12, marginTop: 3 },
  permissionBox: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginTop: 20,
  },
  permissionTitle: { ...typography.h3, color: colors.text, fontSize: 13 },
  permissionText: { ...typography.caption, color: colors.textMuted, fontSize: 12, marginTop: 4 },
  stateTitle: { ...typography.h3, color: colors.text, fontSize: 15 },
  stateText: { ...typography.caption, color: colors.textMuted, fontSize: 13, marginTop: 6 },
});
