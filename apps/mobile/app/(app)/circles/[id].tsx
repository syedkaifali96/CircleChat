import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import {
  ApiError,
  createInvite,
  fetchCircleHome,
  leaveCircle,
  removeMember,
  revokeInvite,
  updateMemberRole,
  transferOwnership,
  type CircleHome,
  type CircleMember,
  type Message,
  type Poll,
} from '../../../src/lib/api';
import { loadSessionToken } from '../../../src/auth/session';
import { colors } from '../../../src/design/tokens';

/**
 * Circle Home (M9): the Circle's private home — identity, members preview and
 * the primary "Open Chat" action into the Circle conversation (M5), with the
 * server-computed unread count. Owner/admin actions (invite management,
 * removal, role changes, ownership transfer) live here and stay role-gated by
 * the server; the UI only mirrors what the API already enforces.
 */

function memberCountLabel(count: number): string {
  return count === 1 ? '1 member' : `${count} members`;
}

/** Circle Home shows a small pin preview; the full list lives on the
 * dedicated Pinboard screen (M10). */
const PIN_PREVIEW_COUNT = 3;

/** One-line label for a pinned message (media stays metadata-only here —
 * the chat renders it through the authorized media pipeline). */
function pinPreviewLabel(message: Message): string {
  if (message.deleted) {
    return 'Deleted message';
  }
  switch (message.type) {
    case 'image':
      return '📷 Photo';
    case 'video':
      return '🎥 Video';
    case 'voice':
      return '🎤 Voice message';
    case 'gif':
      return 'GIF';
    case 'file':
      return '📎 Attachment';
    default:
      return message.body ?? 'Message';
  }
}

/** One-line poll preview: question + where the caller's vote stands. */
function pollPreviewLabel(poll: Poll): string {
  const voted = poll.myVote !== null ? `You voted ${poll.options[poll.myVote]}` : 'Tap to vote';
  return `${poll.question} · ${poll.totalVotes} ${poll.totalVotes === 1 ? 'vote' : 'votes'} · ${voted}`;
}

function friendlyError(code: string): string {
  switch (code) {
    case 'OWNER_MUST_TRANSFER':
      return 'Transfer ownership before leaving the Circle.';
    case 'CANNOT_REMOVE_OWNER':
      return 'The owner cannot be removed.';
    case 'CANNOT_MODIFY_OWNER':
      return "The owner's role cannot be changed.";
    case 'FORBIDDEN':
      return 'You do not have access to this resource.';
    case 'NOT_FOUND':
      return 'This Circle is no longer available.';
    default:
      return 'Something went wrong. Try again.';
  }
}

export default function CircleHomeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [home, setHome] = useState<CircleHome | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [memberMenu, setMemberMenu] = useState<CircleMember | null>(null);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const token = (await loadSessionToken()) ?? '';
      const { home: found } = await fetchCircleHome(token, id);
      setHome(found);
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

  const withToken = async (): Promise<string> => (await loadSessionToken()) ?? '';

  const onGenerateInvite = async () => {
    setInviteBusy(true);
    setActionError(null);
    try {
      const token = await withToken();
      const { inviteCode: raw } = await createInvite(token, id, 7);
      setInviteCode(raw); // shown once; only the hash is stored server-side
    } catch (err) {
      setActionError(friendlyError(err instanceof ApiError ? err.code : 'UNKNOWN'));
    } finally {
      setInviteBusy(false);
    }
  };

  const onShareInvite = async () => {
    if (!inviteCode) {
      return;
    }
    await Share.share({ message: `Join my CircleChat Circle! Invite code: ${inviteCode}` });
  };

  const onRevokeInvite = async () => {
    setInviteBusy(true);
    setActionError(null);
    try {
      const token = await withToken();
      await revokeInvite(token, id);
      setInviteCode(null);
      setInviteModalVisible(false);
    } catch (err) {
      setActionError(friendlyError(err instanceof ApiError ? err.code : 'UNKNOWN'));
    } finally {
      setInviteBusy(false);
    }
  };

  const onRemoveMember = (member: CircleMember) => {
    setMemberMenu(null);
    Alert.alert(`Remove ${member.displayName}?`, 'They can rejoin later with a new invite.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          void (async () => {
            setActionError(null);
            try {
              const token = await withToken();
              await removeMember(token, id, member.userId);
              await load();
            } catch (err) {
              setActionError(friendlyError(err instanceof ApiError ? err.code : 'UNKNOWN'));
            }
          })(),
      },
    ]);
  };

  const onChangeRole = (member: CircleMember, role: 'admin' | 'member') => {
    setMemberMenu(null);
    void (async () => {
      setActionError(null);
      try {
        const token = await withToken();
        await updateMemberRole(token, id, member.userId, role);
        await load();
      } catch (err) {
        setActionError(friendlyError(err instanceof ApiError ? err.code : 'UNKNOWN'));
      }
    })();
  };

  const onTransferOwnership = (member: CircleMember) => {
    setMemberMenu(null);
    Alert.alert(
      'Transfer ownership?',
      `${member.displayName} will become the owner. You will become an admin.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Transfer',
          onPress: () =>
            void (async () => {
              setActionError(null);
              try {
                const token = await withToken();
                await transferOwnership(token, id, member.userId);
                await load();
              } catch (err) {
                setActionError(friendlyError(err instanceof ApiError ? err.code : 'UNKNOWN'));
              }
            })(),
        },
      ],
    );
  };

  const onLeave = () => {
    Alert.alert('Leave this Circle?', 'You will need a new invite to come back.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: () =>
          void (async () => {
            setActionError(null);
            try {
              const token = await withToken();
              await leaveCircle(token, id);
              router.replace('/(app)/home');
            } catch (err) {
              setActionError(friendlyError(err instanceof ApiError ? err.code : 'UNKNOWN'));
            }
          })(),
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.centered} testID="circle-loading">
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (loadError || !home) {
    return (
      <View style={styles.centered} testID="circle-error">
        <Text style={styles.stateTitle}>Something went wrong.</Text>
        <Text style={styles.stateText}>Couldn't load this Circle.</Text>
        <Pressable style={styles.secondaryButton} onPress={() => void load()} testID="circle-retry">
          <Text style={styles.secondaryButtonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const isOwner = home.callerRole === 'owner';
  const isAdmin = isOwner || home.callerRole === 'admin';
  const capacityLeft = 5 - home.membersCount;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      testID="circle-screen"
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => void load()} tintColor={colors.accent} />}
    >
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{home.name.charAt(0).toUpperCase()}</Text>
        </View>
        <Text style={styles.name}>{home.name}</Text>
        <Text style={styles.memberCount} testID="circle-member-count">{memberCountLabel(home.membersCount)}</Text>
        {home.description ? <Text style={styles.description}>"{home.description}"</Text> : null}
        {isAdmin ? (
          <Link href={`/(app)/circles/${id}/settings`} style={styles.settingsLink} testID="circle-settings-link">
            Circle settings
          </Link>
        ) : null}
        <Link href="/(app)/notification-settings" style={styles.settingsLink} testID="circle-notifications-link">
          Notification settings
        </Link>
      </View>

      {home.conversationId ? (
        <Pressable
          style={({ pressed }) => [styles.openChatButton, pressed && styles.buttonPressed]}
          onPress={() => router.push(`/(app)/chats/${home.conversationId}`)}
          testID="circle-open-chat"
        >
          <Text style={styles.openChatText}>Open Chat</Text>
          {home.unreadCount > 0 ? (
            <View style={styles.unreadBadge} testID="circle-unread">
              <Text style={styles.unreadBadgeText}>{home.unreadCount > 99 ? '99+' : String(home.unreadCount)}</Text>
            </View>
          ) : null}
        </Pressable>
      ) : null}

      {actionError ? <Text style={styles.error} testID="circle-action-error">{actionError}</Text> : null}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Pinboard</Text>
        {home.pinsCount > PIN_PREVIEW_COUNT ? (
          <Link href={`/(app)/circles/${id}/pinboard`} style={styles.viewAllLink} testID="pinboard-view-all">
            View all ({home.pinsCount})
          </Link>
        ) : null}
      </View>
      {home.pinsCount === 0 ? (
        <Text style={styles.pinboardEmpty} testID="pinboard-empty">
          Nothing pinned yet. Long-press a message in the chat and choose Pin.
        </Text>
      ) : (
        home.pinnedItems.slice(0, PIN_PREVIEW_COUNT).map((pin) => (
          <Pressable
            key={pin.id}
            style={({ pressed }) => [styles.pinRow, pressed && styles.buttonPressed]}
            onPress={() => home.conversationId && router.push(`/(app)/chats/${home.conversationId}`)}
            testID={`pinboard-item-${pin.messageId}`}
          >
            <Text style={styles.pinIcon}>📌</Text>
            <View style={styles.pinInfo}>
              <Text style={styles.pinBody} numberOfLines={2}>{pinPreviewLabel(pin.message)}</Text>
              <Text style={styles.pinMeta}>
                {pin.message.senderDisplayName} · pinned by {pin.pinnedBy.displayName}
              </Text>
            </View>
          </Pressable>
        ))
      )}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Polls</Text>
        {home.activePollsCount > 0 ? (
          <Link href={`/(app)/circles/${id}/polls`} style={styles.viewAllLink} testID="polls-view-all">
            View all ({home.activePollsCount})
          </Link>
        ) : null}
      </View>
      {home.activePolls.length === 0 ? (
        <Text style={styles.pinboardEmpty} testID="polls-empty">
          No active polls. Start one from the Polls screen.
        </Text>
      ) : (
        home.activePolls.slice(0, 2).map((poll) => (
          <Pressable
            key={poll.id}
            style={({ pressed }) => [styles.pinRow, pressed && styles.buttonPressed]}
            onPress={() => router.push(`/(app)/circles/${id}/polls`)}
            testID={`poll-preview-${poll.id}`}
          >
            <Text style={styles.pinIcon}>🗳️</Text>
            <View style={styles.pinInfo}>
              <Text style={styles.pinBody} numberOfLines={2}>{poll.question}</Text>
              <Text style={styles.pinMeta}>{pollPreviewLabel(poll)}</Text>
            </View>
          </Pressable>
        ))
      )}
      {isAdmin ? (
        <Pressable
          style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
          onPress={() => {
            setInviteCode(null);
            setInviteModalVisible(true);
          }}
          disabled={capacityLeft <= 0}
          testID="circle-invite-button"
        >
          <Text style={styles.primaryButtonText}>
            {capacityLeft > 0 ? `Invite people · ${capacityLeft} ${capacityLeft === 1 ? 'spot' : 'spots'} left` : 'Circle is full'}
          </Text>
        </Pressable>
      ) : null}

      <Text style={styles.sectionTitle}>Members</Text>
      {home.members.map((member) => (
        <Pressable
          key={member.userId}
          style={({ pressed }) => [styles.memberRow, pressed && styles.buttonPressed]}
          onPress={() => (isAdmin ? setMemberMenu(member) : undefined)}
          disabled={!isAdmin}
          testID={`circle-member-${member.username}`}
        >
          <View style={styles.memberAvatar}>
            <Text style={styles.memberAvatarText}>{member.displayName.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.memberInfo}>
            <Text style={styles.memberName}>{member.displayName}</Text>
            <Text style={styles.memberUsername}>@{member.username}</Text>
          </View>
          <Text style={[styles.roleBadge, member.role === 'owner' && styles.roleBadgeOwner]}>{member.role}</Text>
        </Pressable>
      ))}

      {!isOwner ? (
        <Pressable style={({ pressed }) => [styles.leaveButton, pressed && styles.buttonPressed]} onPress={onLeave} testID="circle-leave">
          <Text style={styles.leaveText}>Leave Circle</Text>
        </Pressable>
      ) : null}

      <Modal visible={inviteModalVisible} transparent animationType="fade" onRequestClose={() => setInviteModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard} testID="invite-modal">
            <Text style={styles.modalTitle}>Invite people</Text>
            {capacityLeft > 0 ? (
              <Text style={styles.modalSubtitle}>
                {memberCountLabel(home.membersCount)} · you can invite {capacityLeft} more. Multi-use while active.
              </Text>
            ) : (
              <Text style={styles.modalSubtitle}>The Circle is full (5 of 5 members).</Text>
            )}
            {inviteCode ? (
              <>
                <Text style={styles.modalNote}>Shown only once — share it now.</Text>
                <Text style={styles.inviteCode} selectable testID="invite-code">{inviteCode}</Text>
                <Pressable style={styles.primaryButton} onPress={() => void onShareInvite()} testID="invite-share">
                  <Text style={styles.primaryButtonText}>Share code</Text>
                </Pressable>
                <Pressable style={styles.textButton} onPress={onRevokeInvite} disabled={inviteBusy} testID="invite-revoke">
                  <Text style={styles.textButtonText}>{inviteBusy ? 'Revoking…' : 'Revoke invite'}</Text>
                </Pressable>
              </>
            ) : (
              <Pressable
                style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
                onPress={() => void onGenerateInvite()}
                disabled={inviteBusy || capacityLeft <= 0}
                testID="invite-generate"
              >
                {inviteBusy ? (
                  <ActivityIndicator color={colors.text} />
                ) : (
                  <Text style={styles.primaryButtonText}>Generate invite code</Text>
                )}
              </Pressable>
            )}
            <Pressable style={styles.textButton} onPress={() => setInviteModalVisible(false)} testID="invite-close">
              <Text style={styles.textButtonText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={memberMenu !== null} transparent animationType="fade" onRequestClose={() => setMemberMenu(null)}>
        {memberMenu ? (
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard} testID="member-menu">
              <Text style={styles.modalTitle}>{memberMenu.displayName}</Text>
              <Text style={styles.modalSubtitle}>@{memberMenu.username} · {memberMenu.role}</Text>
              {isOwner && memberMenu.role === 'member' ? (
                <Pressable style={styles.menuOption} onPress={() => onChangeRole(memberMenu, 'admin')} testID="member-promote">
                  <Text style={styles.menuOptionText}>Make admin</Text>
                </Pressable>
              ) : null}
              {isOwner && memberMenu.role === 'admin' ? (
                <Pressable style={styles.menuOption} onPress={() => onChangeRole(memberMenu, 'member')} testID="member-demote">
                  <Text style={styles.menuOptionText}>Change to member</Text>
                </Pressable>
              ) : null}
              {isOwner && memberMenu.role !== 'owner' ? (
                <Pressable style={styles.menuOption} onPress={() => onTransferOwnership(memberMenu)} testID="member-transfer">
                  <Text style={styles.menuOptionText}>Transfer ownership</Text>
                </Pressable>
              ) : null}
              {memberMenu.role !== 'owner' ? (
                <Pressable style={styles.menuOptionDanger} onPress={() => onRemoveMember(memberMenu)} testID="member-remove">
                  <Text style={styles.menuOptionDangerText}>Remove from Circle</Text>
                </Pressable>
              ) : null}
              <Pressable style={styles.textButton} onPress={() => setMemberMenu(null)} testID="member-menu-close">
                <Text style={styles.textButtonText}>Close</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingTop: 64 },
  centered: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: { alignItems: 'center' },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.text, fontSize: 34, fontWeight: '700' },
  name: { color: colors.text, fontSize: 24, fontWeight: '700', marginTop: 14 },
  memberCount: { color: colors.textSecondary, fontSize: 13, marginTop: 4 },
  description: { color: colors.textMuted, fontSize: 13, marginTop: 8, textAlign: 'center', fontStyle: 'italic' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 28 },
  viewAllLink: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  pinboardEmpty: { color: colors.textMuted, fontSize: 13, marginTop: 8 },
  pinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginTop: 10,
  },
  pinIcon: { fontSize: 16 },
  pinInfo: { flex: 1, marginLeft: 10 },
  pinBody: { color: colors.text, fontSize: 14 },
  pinMeta: { color: colors.textMuted, fontSize: 11, marginTop: 3 },
  settingsLink: { color: colors.accent, fontSize: 14, fontWeight: '600', marginTop: 14 },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '700', marginTop: 28 },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginTop: 10,
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarText: { color: colors.text, fontSize: 16, fontWeight: '700' },
  memberInfo: { flex: 1, marginLeft: 12 },
  memberName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  memberUsername: { color: colors.textMuted, fontSize: 12, marginTop: 1 },
  roleBadge: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  roleBadgeOwner: { color: colors.accent, borderColor: colors.accent },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  primaryButtonText: { color: colors.text, fontSize: 14, fontWeight: '700' },
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
  leaveButton: {
    backgroundColor: colors.surface,
    borderColor: colors.error,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 24,
  },
  leaveText: { color: colors.error, fontSize: 14, fontWeight: '600' },
  openChatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 15,
    marginTop: 22,
  },
  openChatText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  unreadBadge: {
    minWidth: 22,
    borderRadius: 11,
    backgroundColor: colors.error,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignItems: 'center',
    marginLeft: 8,
  },
  unreadBadgeText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  error: { color: colors.error, fontSize: 13, marginTop: 12, textAlign: 'center' },
  stateTitle: { color: colors.text, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  stateText: { color: colors.textMuted, fontSize: 13, marginTop: 6, textAlign: 'center' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(11,7,20,0.8)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 18,
    padding: 24,
    alignSelf: 'stretch',
  },
  modalTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  modalSubtitle: { color: colors.textMuted, fontSize: 13, marginTop: 6 },
  modalNote: { color: colors.warning, fontSize: 12, fontWeight: '600', marginTop: 14 },
  inviteCode: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 3,
    textAlign: 'center',
    marginTop: 10,
    paddingVertical: 12,
    backgroundColor: colors.background,
    borderRadius: 10,
    overflow: 'hidden',
  },
  textButton: { alignItems: 'center', marginTop: 14, padding: 6 },
  textButtonText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  menuOption: { paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.border },
  menuOptionText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  menuOptionDanger: { paddingVertical: 13 },
  menuOptionDangerText: { color: colors.error, fontSize: 15, fontWeight: '600' },
  buttonPressed: { opacity: 0.85 },
});
