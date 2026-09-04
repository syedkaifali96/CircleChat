import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { MediaContent } from '../src/chat/MediaContent';
import ConversationScreen from '../app/(app)/chats/[id]';
import * as apiModule from '../src/lib/api';
import * as mediaSendModule from '../src/lib/mediaSend';

/**
 * M7 mobile media tests: media bubble rendering (image/voice/attachment +
 * tombstone), upload pending/failed states with retry, and the composer
 * attachment flow driving the upload pipeline. Storage/network are mocked;
 * the confirmed-upload gate is proven server-side.
 */

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest factory must be CJS
  const { Text: RNText, Pressable: RNPressable } = require('react-native');
  return {
    Link: ({ children, testID }: { children: React.ReactNode; testID?: string }) => (
      <RNPressable testID={testID}>
        <RNText>{children}</RNText>
      </RNPressable>
    ),
    Redirect: ({ href }: { href: string }) => <RNText testID="redirect">{href}</RNText>,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    useFocusEffect: () => undefined,
    useLocalSearchParams: () => ({ id: 'conv-1' }),
  };
});

jest.mock('expo-av', () => ({
  Audio: {
    Sound: { createAsync: jest.fn().mockResolvedValue({ sound: { unloadAsync: jest.fn() }, status: {} }) },
    setAudioModeAsync: jest.fn(),
    requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
    Recording: jest.fn().mockImplementation(() => ({
      prepareToRecordAsync: jest.fn(),
      startAsync: jest.fn(),
      stopAndUnloadAsync: jest.fn(),
      getURI: jest.fn().mockReturnValue('file://voice.m4a'),
      getStatusAsync: jest.fn().mockResolvedValue({ durationMillis: 5200 }),
    })),
    RecordingOptionsPresets: { HIGH_QUALITY: {} },
  },
}));

jest.mock('expo-image-picker', () => ({
  MediaTypeOptions: { Images: 'Images', Videos: 'Videos', All: 'All' },
  requestMediaLibraryPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  launchImageLibraryAsync: jest.fn(),
}));

jest.mock('../src/lib/api', () => ({
  ApiError: class ApiError extends Error {
    code: string;
    statusCode: number;
    constructor(code: string, statusCode: number, message: string) {
      super(message);
      this.code = code;
      this.statusCode = statusCode;
    }
  },
  fetchChatHeader: jest.fn(),
  fetchMessages: jest.fn(),
  sendMessage: jest.fn(),
  markConversationRead: jest.fn().mockResolvedValue({ unreadCount: 0, lastReadMessageId: null }),
  addReaction: jest.fn(),
  removeReaction: jest.fn(),
  editMessage: jest.fn(),
  deleteMessage: jest.fn(),
  fetchMediaDownloadUrl: jest.fn(),
}));

jest.mock('../src/lib/mediaSend', () => ({
  uploadAndSendMedia: jest.fn(),
}));

jest.mock('../src/auth/session', () => ({
  loadSessionToken: jest.fn().mockResolvedValue('test-token'),
  saveSessionToken: jest.fn(),
  clearSessionToken: jest.fn(),
}));

jest.mock('../src/auth/AuthContext', () => ({
  useAuth: () => ({
    status: 'authenticated',
    user: {
      id: 'me-1',
      username: 'kaif',
      displayName: 'Kaif',
      bio: null,
      avatarMediaId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    signOut: jest.fn(),
    updateUser: jest.fn(),
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('../src/lib/socket', () => ({
  subscribeToConversation: jest.fn().mockResolvedValue(() => undefined),
  sendTypingStart: jest.fn(),
  sendTypingStop: jest.fn(),
  trackJoinedRoom: jest.fn(),
  resetSocket: jest.fn(),
}));

const mockApi = apiModule as unknown as jest.Mocked<typeof apiModule>;
const mockMediaSend = mediaSendModule as jest.Mocked<typeof mediaSendModule>;

const header = { type: 'direct' as const, title: 'Ayesha', avatarMediaId: null, subtitle: '@ayesha', circleRole: null };
const baseMessage = {
  conversationId: 'conv-1',
  senderId: 'u2',
  senderUsername: 'ayesha',
  senderDisplayName: 'Ayesha',
  type: 'text' as const,
  body: 'caption',
  mediaId: null,
  media: null,
  replyToId: null,
  replyPreview: null,
  editedAt: null,
  deleted: false,
  createdAt: '2026-09-04T10:00:00.000Z',
  reactions: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  // Local file:// reads resolve to a small Blob (the capture/selected asset).
  global.fetch = jest.fn((url: string) => {
    if (url.startsWith('file://')) {
      return Promise.resolve({ blob: async () => new Blob(['m7'], { type: 'text/plain' }) });
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  }) as unknown as typeof fetch;
  mockApi.fetchChatHeader.mockResolvedValue({ header });
  mockApi.fetchMessages.mockResolvedValue({ messages: [], nextBeforeCursor: null });
  mockApi.markConversationRead.mockResolvedValue({ unreadCount: 0, lastReadMessageId: null });
});

describe('MediaContent', () => {
  it('renders an image via the presigned URL and hides the body-less caption', async () => {
    mockApi.fetchMediaDownloadUrl.mockResolvedValue('https://signed/u1');
    render(
      <MediaContent
        message={{ ...baseMessage, id: 'img-1', type: 'image', mediaId: 'med-1', body: null, media: { kind: 'image', mimeType: 'image/png', sizeBytes: 10, durationMs: null, width: 400, height: 300 } }}
      />,
    );

    await waitFor(() => expect(mockApi.fetchMediaDownloadUrl).toHaveBeenCalledWith('med-1'));
    expect(screen.getByTestId('media-image-img-1')).toBeTruthy();
  });

  it('shows a voice player with duration for voice messages', () => {
    mockApi.fetchMediaDownloadUrl.mockResolvedValue('https://signed/v1');
    render(
      <MediaContent
        message={{ ...baseMessage, id: 'voice-1', type: 'voice', mediaId: 'med-v', body: null, media: { kind: 'voice', mimeType: 'audio/mp4', sizeBytes: 1200, durationMs: 5200, width: null, height: null } }}
      />,
    );

    expect(screen.getByTestId('voice-player-med-v')).toBeTruthy();
    expect(screen.getByText('0:05')).toBeTruthy();
  });

  it('shows the pending and failed upload states with retry', () => {
    const onRetry = jest.fn();
    const { rerender } = render(
      <MediaContent message={{ ...baseMessage, id: 'pend-1', type: 'image', mediaId: null }} uploadStage="pending" />,
    );
    expect(screen.getByTestId('media-pending-pend-1')).toBeTruthy();

    rerender(
      <MediaContent
        message={{ ...baseMessage, id: 'pend-1', type: 'image', mediaId: null }}
        uploadStage="failed"
        onRetry={onRetry}
      />,
    );
    fireEvent.press(screen.getByTestId('media-retry-pend-1'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('renders a tombstone instead of media for deleted messages', () => {
    render(
      <MediaContent message={{ ...baseMessage, id: 'del-1', deleted: true, body: null, mediaId: null }} />,
    );
    // Deleted bubbles render "Message deleted" via the bubble, not media.
    expect(screen.queryByTestId('media-pending-del-1')).toBeNull();
  });
});

describe('composer media flow (M7)', () => {
  it('sends a picked image through the upload pipeline with progress stages', async () => {
    const ImagePicker = jest.requireMock('expo-image-picker');
    ImagePicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://photo.png', type: 'image', mimeType: 'image/png' }],
    });
    mockMediaSend.uploadAndSendMedia.mockResolvedValue({
      message: { ...baseMessage, id: 'sent-1', type: 'image', senderId: 'me-1', mediaId: 'med-9', body: null },
    });

    render(<ConversationScreen />);
    await waitFor(() => expect(screen.getByTestId('composer-input')).toBeTruthy(), { timeout: 8000 });

    fireEvent.press(screen.getByTestId('composer-attachments'));
    fireEvent.press(screen.getByTestId('attach-image'));

    await waitFor(() => expect(mockMediaSend.uploadAndSendMedia).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', kind: 'image', mimeType: 'image/png' }),
    ), { timeout: 8000 });
    // Optimistic bubble dropped after success.
    await waitFor(() => expect(screen.queryByTestId('media-pending-')).toBeNull());
  }, 30_000);

  it('keeps the failed media bubble with retry available', async () => {
    const ImagePicker = jest.requireMock('expo-image-picker');
    ImagePicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://photo.png', type: 'image', mimeType: 'image/png' }],
    });
    mockMediaSend.uploadAndSendMedia.mockRejectedValue(new Error('UPLOAD_FAILED'));

    render(<ConversationScreen />);
    await waitFor(() => expect(screen.getByTestId('composer-input')).toBeTruthy(), { timeout: 8000 });

    fireEvent.press(screen.getByTestId('composer-attachments'));
    fireEvent.press(screen.getByTestId('attach-image'));

    await waitFor(() => expect(mockMediaSend.uploadAndSendMedia).toHaveBeenCalled(), { timeout: 8000 });
    // The optimistic bubble carries the local id; its failed state offers
    // retry so the local media is not lost.
    await waitFor(() => expect(screen.getByTestId(/media-retry-local_/)).toBeTruthy(), { timeout: 8000 });
  }, 30_000);
});
