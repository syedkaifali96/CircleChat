import {
  confirmMediaUpload,
  requestChatMediaUploadUrl,
  sendMessage,
  uploadBytesToStorage,
  type ChatMediaKind,
  type Message,
} from './api';

/**
 * Chat media upload pipeline (M7, docs/ARCHITECTURE.md §9):
 * presigned URL → direct PUT to private storage (byte-level progress) →
 * server confirm (size re-check + magic-byte sniff) → idempotent media
 * message create. Bytes never pass through the API server; each step
 * surfaces progress so the UI renders pending → uploading → sent/failed
 * with retry, and the local blob is retried, never lost.
 */

export interface UploadAndSendInput {
  token: string;
  conversationId: string;
  kind: ChatMediaKind;
  mimeType: string;
  bytes: Blob;
  durationMs?: number;
  clientMessageId: string;
  replyToId?: string;
  /** Optional caption; media messages keep the body slot free for it. */
  body?: string;
  /** Stage changes plus 0..1 byte-level progress for the uploading stage. */
  onProgress?: (stage: 'uploading' | 'confirming' | 'sending', progress?: number) => void;
}

export async function uploadAndSendMedia(input: UploadAndSendInput): Promise<{ message: Message }> {
  input.onProgress?.('uploading', 0);
  const intent = await requestChatMediaUploadUrl(input.token, input.conversationId, {
    kind: input.kind,
    mimeType: input.mimeType,
    sizeBytes: input.bytes.size,
    ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
  });
  await uploadBytesToStorage(intent, input.bytes, (fraction) => {
    input.onProgress?.('uploading', fraction);
  });

  input.onProgress?.('confirming', 1);
  const confirmed = await confirmMediaUpload(input.token, intent.mediaId);
  if (confirmed.status !== 'ready') {
    throw new Error('MEDIA_NOT_READY');
  }

  input.onProgress?.('sending', 1);
  const { message } = await sendMessage(input.token, input.conversationId, {
    type: input.kind,
    ...(input.body !== undefined ? { body: input.body } : {}),
    mediaId: intent.mediaId,
    ...(input.replyToId ? { replyToId: input.replyToId } : {}),
    clientMessageId: input.clientMessageId,
  });
  return { message };
}
