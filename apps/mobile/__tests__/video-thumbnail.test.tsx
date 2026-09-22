import { render, screen, fireEvent } from '@testing-library/react-native';
import { VideoPlaceholder, getVideoThumbnail } from '../src/chat/videoThumbnail';
import type { Message } from '../src/lib/api';

/**
 * M14.3 video thumbnail fallback: frame extraction (ffmpeg-scale native
 * tooling) is not part of the MVP build, so videos never have a thumbnail
 * URI. The seam must report null and the placeholder must render without
 * touching the network — a missing thumbnail can never break a bubble.
 * The seam is also the single place a future milestone can make videos
 * resolve a real frame without touching the chat renderer.
 */

const base = {
  id: 'media-9',
  conversationId: 'conv-1',
  senderId: 'u2',
  senderUsername: 'ayesha',
  senderDisplayName: 'Ayesha',
  type: 'video' as const,
  body: 'vacation.mp4',
  mediaId: 'media-9',
  media: { kind: 'video', mimeType: 'video/mp4', sizeBytes: 100, durationMs: null, width: 1280, height: 720, externalUrl: null, hasThumbnail: false },
  replyToId: null,
  replyPreview: null,
  editedAt: null,
  deleted: false,
  createdAt: '2026-09-04T10:00:00.000Z',
  reactions: [],
};

describe('getVideoThumbnail', () => {
  it('returns null in the MVP (no frame extraction in the toolchain)', () => {
    expect(getVideoThumbnail(base as unknown as Message)).toBeNull();
  });
});

describe('VideoPlaceholder', () => {
  it('renders a play icon and the video label', () => {
    render(<VideoPlaceholder message={base as unknown as Message} />);
    expect(screen.getByText('▶')).toBeTruthy();
    expect(screen.getByText('vacation.mp4')).toBeTruthy();
    expect(screen.getByTestId('video-placeholder-media-9')).toBeTruthy();
  });

  it('falls back to "Video" when the message has no body', () => {
    render(<VideoPlaceholder message={{ ...base, body: null } as unknown as Message} />);
    expect(screen.getByText('Video')).toBeTruthy();
  });

  it('invokes onPress with the message when tapped', () => {
    const onPress = jest.fn();
    const msg = { ...base, id: 'msg-v1' } as unknown as Message;
    render(<VideoPlaceholder message={msg} onPress={onPress} />);
    fireEvent.press(screen.getByTestId('video-placeholder-msg-v1'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg-v1' }));
  });
});