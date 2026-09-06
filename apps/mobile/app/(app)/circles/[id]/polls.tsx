import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  ApiError,
  closePoll,
  fetchPolls,
  removePollVote,
  votePoll,
  type Poll,
} from '../../../../src/lib/api';
import { loadSessionToken } from '../../../../src/auth/session';
import { CircleThemeGate } from '../../../../src/design/useCircleSettings';
import { useCircleTheme } from '../../../../src/design/CircleTheme';
import { colors } from '../../../../src/design/tokens';

/**
 * Polls (M11): the Circle's poll list — active polls are votable (single
 * choice, tap an option), results render as per-option bars with the
 * caller's selection highlighted, and closed polls stay readable but frozen.
 * REST is the source of truth; changing a vote is the documented delete +
 * re-vote flow. All authorization is server-side; the UI mirrors responses.
 *
 * M12: the screen renders inside the Circle's personalization — the theme
 * gate wraps the themed body so hooks resolve the live context. Accent
 * recolors selection states (my-vote border, links, actions); primary
 * recolors the result bars.
 */

function votePercentage(votes: number, total: number): `${number}%` {
  if (total === 0) {
    return '0%';
  }
  return `${Math.round((votes / total) * 100)}%`;
}

function closedLabel(poll: Poll): string {
  return poll.closesAt
    ? `Closed · ${new Date(poll.closesAt).toLocaleDateString()}`
    : 'Closed';
}

export default function PollsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <CircleThemeGate circleId={id}>
      <PollsScreenThemed circleId={id} />
    </CircleThemeGate>
  );
}

function PollsScreenThemed({ circleId: id }: { circleId: string }) {
  const themed = useCircleTheme();
  const [polls, setPolls] = useState<Poll[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // The poll a mutation is in flight for (per-card busy state).
  const [busyPollId, setBusyPollId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const token = (await loadSessionToken()) ?? '';
      const { polls: found } = await fetchPolls(token, id);
      setPolls(found);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const friendlyError = (code: string): string => {
    if (code === 'VOTE_EXISTS') {
      return 'You already voted on this poll.';
    }
    if (code === 'POLL_CLOSED') {
      return 'This poll is closed.';
    }
    if (code === 'FORBIDDEN') {
      return 'You can only manage polls you created.';
    }
    return 'Something went wrong. Try again.';
  };

  const runMutation = async (pollId: string, mutate: (token: string) => Promise<unknown>) => {
    setActionError(null);
    setBusyPollId(pollId);
    try {
      const token = (await loadSessionToken()) ?? '';
      await mutate(token);
      await load();
    } catch (err) {
      setActionError(friendlyError(err instanceof ApiError ? err.code : 'UNKNOWN'));
    } finally {
      setBusyPollId(null);
    }
  };

  /** Tap an option: vote when unvoted, switch the vote when changing. */
  const onOptionPress = (poll: Poll, optionIndex: number) => {
    if (poll.closed || poll.myVote === optionIndex) {
      return;
    }
    void runMutation(poll.id, async (token) => {
      if (poll.myVote !== null) {
        await removePollVote(token, poll.id);
      }
      await votePoll(token, poll.id, optionIndex);
    });
  };

  const onRemoveVote = (poll: Poll) => {
    void runMutation(poll.id, (token) => removePollVote(token, poll.id));
  };

  const onClose = (poll: Poll) => {
    void runMutation(poll.id, (token) => closePoll(token, poll.id));
  };

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: themed.colors.background }]} testID="polls-loading">
        <ActivityIndicator color={themed.colors.accent} />
      </View>
    );
  }

  if (loadError || !polls) {
    return (
      <View style={[styles.centered, { backgroundColor: themed.colors.background }]} testID="polls-error">
        <Text style={styles.stateTitle}>Something went wrong.</Text>
        <Text style={styles.stateText}>Couldn't load the polls.</Text>
        <Pressable style={styles.secondaryButton} onPress={() => void load()} testID="polls-retry">
          <Text style={styles.secondaryButtonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const activePolls = polls.filter((poll) => !poll.closed);
  const closedPolls = polls.filter((poll) => poll.closed);

  const renderPoll = (poll: Poll) => (
    <View key={poll.id} style={styles.pollCard} testID={`poll-card-${poll.id}`}>
      <Text style={styles.pollQuestion}>{poll.question}</Text>
      <Text style={styles.pollMeta} testID={`poll-meta-${poll.id}`}>
        {poll.totalVotes === 1 ? '1 vote' : `${poll.totalVotes} votes`}
        {poll.closed ? ` · ${closedLabel(poll)}` : ''}
      </Text>
      {poll.options.map((label, index) => {
        const isMyVote = poll.myVote === index;
        const barWidth = votePercentage(poll.votes[index], poll.totalVotes);
        const votable = !poll.closed;
        return (
          <Pressable
            key={`${poll.id}-${index}`}
            style={({ pressed }) => [
              styles.optionRow,
              isMyVote ? { borderColor: themed.colors.accent } : null,
              votable && pressed && styles.buttonPressed,
            ]}
            onPress={() => onOptionPress(poll, index)}
            disabled={!votable || busyPollId === poll.id}
            testID={`poll-option-${poll.id}-${index}`}
          >
            <Text style={styles.optionLabel}>
              {isMyVote ? '● ' : '○ '}
              {label}
            </Text>
            <Text style={styles.optionVotes} testID={`poll-votes-${poll.id}-${index}`}>
              {poll.votes[index]}
            </Text>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: barWidth, backgroundColor: themed.colors.primary }]} />
            </View>
          </Pressable>
        );
      })}
      <View style={styles.pollActions}>
        {poll.myVote !== null && !poll.closed ? (
          <Pressable
            style={styles.textAction}
            onPress={() => onRemoveVote(poll)}
            disabled={busyPollId === poll.id}
            testID={`poll-unvote-${poll.id}`}
          >
            <Text style={[styles.textActionText, { color: themed.colors.accent }]}>Take back vote</Text>
          </Pressable>
        ) : null}
        {!poll.closed ? (
          <Pressable
            style={styles.textAction}
            onPress={() => onClose(poll)}
            disabled={busyPollId === poll.id}
            testID={`poll-close-${poll.id}`}
          >
            <Text style={[styles.textActionText, { color: themed.colors.accent }]}>Close poll</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: themed.colors.background }}>
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      testID="polls-screen"
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => void load()} tintColor={themed.colors.accent} />}
    >
      <View style={styles.headerRow}>
        <Text style={styles.title}>Polls</Text>
        <Link href={`/(app)/circles/${id}/polls/create`} style={[styles.createLink, { color: themed.colors.accent }]} testID="polls-create-link">
          New poll
        </Link>
      </View>

      {actionError ? <Text style={styles.error} testID="polls-action-error">{actionError}</Text> : null}

      {polls.length === 0 ? (
        <View style={styles.emptyCard} testID="polls-empty">
          <Text style={styles.emptyTitle}>No polls yet</Text>
          <Text style={styles.emptyText}>Start the first poll and settle the debate.</Text>
        </View>
      ) : null}

      {activePolls.length > 0 ? <Text style={styles.sectionLabel}>Active</Text> : null}
      {activePolls.map(renderPoll)}

      {closedPolls.length > 0 ? <Text style={styles.sectionLabel}>Closed</Text> : null}
      {closedPolls.map(renderPoll)}
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: 24, paddingTop: 64, paddingBottom: 40 },
  centered: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 24 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.text, fontSize: 26, fontWeight: '700' },
  createLink: { fontSize: 14, fontWeight: '700' },
  sectionLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginTop: 22 },
  pollCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginTop: 12,
  },
  pollQuestion: { color: colors.text, fontSize: 16, fontWeight: '700' },
  pollMeta: { color: colors.textMuted, fontSize: 12, marginTop: 3 },
  optionRow: {
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
  },
  optionLabel: { color: colors.text, fontSize: 14, fontWeight: '600' },
  optionVotes: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.background,
    marginTop: 6,
    overflow: 'hidden',
  },
  barFill: { height: 6, backgroundColor: colors.primary },
  pollActions: { flexDirection: 'row', marginTop: 10 },
  textAction: { paddingVertical: 6, paddingHorizontal: 8 },
  textActionText: { color: colors.accent, fontSize: 12, fontWeight: '700' },
  emptyCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
    marginTop: 16,
  },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  emptyText: { color: colors.textMuted, fontSize: 13, marginTop: 6 },
  secondaryButton: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 32,
    marginTop: 16,
  },
  secondaryButtonText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  stateTitle: { color: colors.text, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  stateText: { color: colors.textMuted, fontSize: 13, marginTop: 6, textAlign: 'center' },
  error: { color: colors.error, fontSize: 13, marginTop: 12 },
  buttonPressed: { opacity: 0.85 },
});
