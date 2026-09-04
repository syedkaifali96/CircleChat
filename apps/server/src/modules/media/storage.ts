import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomBytes } from 'node:crypto';

/**
 * Private object storage gateway (docs/ARCHITECTURE.md §9).
 * Production uses Cloudflare R2 via the S3 API. The bucket is always PRIVATE:
 * clients receive short-lived presigned credentials only, after server-side
 * authorization. The server never exposes bucket credentials or raw keys.
 *
 * Tests use the in-memory implementation — no network, real bytes.
 */

export interface PresignedUpload {
  uploadUrl: string;
  uploadFields: Record<string, string>;
}

export interface StorageGateway {
  /**
   * Presigned POST upload with pinned Content-Type and content-length-range
   * (docs/ARCHITECTURE.md §9) valid for `expiresInSeconds`.
   */
  createUploadIntent(
    key: string,
    contentType: string,
    maxBytes: number,
    expiresInSeconds: number,
  ): Promise<PresignedUpload>;
  headObject(key: string): Promise<{ sizeBytes: number } | undefined>;
  /** Reads the first `length` bytes of the object for magic-byte sniffing. */
  readObjectBytes(key: string, length: number): Promise<Buffer | undefined>;
  /** Reads the whole object (thumbnail generation needs all bytes). */
  getObject(key: string): Promise<Buffer | undefined>;
  /** Server-side write — used only by thumbnail generation, never clients. */
  putObject(key: string, contentType: string, bytes: Buffer): Promise<void>;
  createDownloadUrl(key: string, expiresInSeconds: number): Promise<string>;
}

/** Non-guessable object key: the client never chooses storage paths. */
export function avatarStorageKey(): string {
  return `avatar/${randomBytes(16).toString('hex')}`;
}

/** Chat media keys are namespaced per kind, still non-guessable. */
export function chatMediaStorageKey(kind: string): string {
  return `chat/${kind}/${randomBytes(16).toString('hex')}`;
}

export interface R2StorageConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export function readR2StorageConfig(env: NodeJS.ProcessEnv = process.env): R2StorageConfig | undefined {
  const accountId = env.R2_ACCOUNT_ID;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const bucket = env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return undefined;
  }
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

export class R2StorageGateway implements StorageGateway {
  private readonly client: S3Client;

  constructor(private readonly config: R2StorageConfig) {
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async createUploadIntent(
    key: string,
    contentType: string,
    maxBytes: number,
    expiresInSeconds: number,
  ): Promise<PresignedUpload> {
    const presigned = await createPresignedPost(this.client, {
      Bucket: this.config.bucket,
      Key: key,
      Conditions: [
        ['eq', '$Content-Type', contentType],
        ['content-length-range', 1, maxBytes],
      ],
      Fields: { 'Content-Type': contentType },
      Expires: expiresInSeconds,
    });
    return { uploadUrl: presigned.url, uploadFields: presigned.fields };
  }

  async headObject(key: string): Promise<{ sizeBytes: number } | undefined> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      return { sizeBytes: head.ContentLength ?? 0 };
    } catch {
      return undefined; // object absent or unreadable; caller decides
    }
  }

  async readObjectBytes(key: string, length: number): Promise<Buffer | undefined> {
    try {
      const head = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: key, Range: `bytes=0-${length - 1}` }),
      );
      const bytes = await head.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : undefined;
    } catch {
      return undefined;
    }
  }

  async getObject(key: string): Promise<Buffer | undefined> {
    try {
      const head = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
      const bytes = await head.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : undefined;
    } catch {
      return undefined;
    }
  }

  /** Server-side write — used only by thumbnail generation, never clients. */
  async putObject(key: string, contentType: string, bytes: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.config.bucket, Key: key, ContentType: contentType, Body: bytes }),
    );
  }

  async createDownloadUrl(key: string, expiresInSeconds: number): Promise<string> {
    // Short-TTL presigned GET from the private bucket (docs/ARCHITECTURE.md §9).
    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      ResponseContentDisposition: 'inline',
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }
}

export class InMemoryStorageGateway implements StorageGateway {
  private readonly objects = new Map<string, Buffer>();
  /** Opaque download tokens mapped to storage keys (mirrors the R2 contract). */
  private readonly downloadTokens = new Map<string, string>();

  async createUploadIntent(
    key: string,
    contentType: string,
    maxBytes: number,
    expiresInSeconds: number,
  ): Promise<PresignedUpload> {
    void expiresInSeconds;
    return {
      uploadUrl: `http://storage.test/upload/${key}`,
      uploadFields: {
        key,
        'Content-Type': contentType,
        policy: `content-length-range:1,${maxBytes}`,
      },
    };
  }

  /** Test-side helper: simulates the client's direct upload. */
  put(key: string, bytes: Buffer): void {
    this.objects.set(key, bytes);
  }

  get(key: string): Buffer | undefined {
    return this.objects.get(key);
  }

  async headObject(key: string): Promise<{ sizeBytes: number } | undefined> {
    const object = this.objects.get(key);
    return object ? { sizeBytes: object.length } : undefined;
  }

  async readObjectBytes(key: string, length: number): Promise<Buffer | undefined> {
    const object = this.objects.get(key);
    if (!object) {
      return undefined;
    }
    return object.subarray(0, length);
  }

  async getObject(key: string): Promise<Buffer | undefined> {
    return this.objects.get(key);
  }

  /** Server-side write — used only by thumbnail generation, never clients. */
  async putObject(key: string, contentType: string, bytes: Buffer): Promise<void> {
    void contentType;
    this.objects.set(key, bytes);
  }

  async createDownloadUrl(key: string, expiresInSeconds: number): Promise<string> {
    void expiresInSeconds;
    // Mirrors the R2 contract: the presigned URL never carries credentials or
    // storage-key metadata — the signature itself grants time-boxed access.
    const token = randomBytes(16).toString('hex');
    this.downloadTokens.set(token, key);
    return `http://storage.test/download/${token}?sig=test`;
  }
}
