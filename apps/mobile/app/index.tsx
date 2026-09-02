import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../src/design/tokens';

/**
 * M0 scaffold landing screen — proves the Expo app boots and identifies the
 * project. No product UI exists yet: auth, Home, Circle screens, chat, app
 * lock, etc. arrive in their own milestones (docs/CircleChat_AI_Build_Plan.md).
 */
export default function LandingScreen() {
  return (
    <View style={styles.container} testID="landing-screen">
      <Text style={styles.title}>CircleChat</Text>
      <Text style={styles.tagline}>Your little private world.</Text>
      <Text style={styles.note}>M0 scaffold — no product features yet.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: colors.text,
    fontSize: 32,
    fontWeight: '700',
  },
  tagline: {
    color: colors.accent,
    fontSize: 16,
    marginTop: 8,
  },
  note: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 24,
    textAlign: 'center',
  },
});
