import type { Readable } from "node:stream";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { retry } from "@habit-tracker/shared";

export interface StorageConfig {
  /** where the *server* reaches storage (docker: http://minio:9000) */
  endpoint: string;
  /** where the *browser* reaches storage (http://localhost:9000) — signed into presigned URLs */
  publicEndpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

export interface PresignPutOptions {
  contentType: string;
  contentLength: number;
  expiresInSeconds?: number;
}

/**
 * Object storage wrapper (L12). MinIO locally, S3 in prod — same SDK, one env
 * var difference. Buckets are private by default; every read goes through a
 * short-lived presigned URL or a server-side stream.
 *
 * Presigning is offline math (HMAC over method+bucket+key+expiry+headers), so
 * we keep a second client whose only job is to sign URLs with the public host.
 */
export function createStorage(config: StorageConfig) {
  const common = {
    region: config.region,
    credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
    forcePathStyle: true // MinIO: http://host:9000/<bucket>/<key>
  };
  const internal = new S3Client({ ...common, endpoint: config.endpoint });
  const signer = new S3Client({ ...common, endpoint: config.publicEndpoint });
  const Bucket = config.bucket;

  return {
    bucket: Bucket,

    /** Idempotent bucket creation — used at boot and by tests. */
    async ensureBucket(): Promise<void> {
      try {
        await internal.send(new HeadBucketCommand({ Bucket }));
      } catch {
        await internal.send(new CreateBucketCommand({ Bucket }));
      }
    },

    /**
     * Presigned PUT: the URL *is* the permission slip — scoped to one key,
     * one content-type, a few minutes. Tampering with any of it breaks the
     * signature; the client never sees the secret key.
     */
    presignPut(key: string, opts: PresignPutOptions): Promise<string> {
      const command = new PutObjectCommand({
        Bucket,
        Key: key,
        ContentType: opts.contentType,
        ContentLength: opts.contentLength
      });
      return getSignedUrl(signer, command, {
        expiresIn: opts.expiresInSeconds ?? 300,
        // Content-Type is part of the signature → the client must send exactly it
        signableHeaders: new Set(["content-type"])
      });
    },

    presignGet(
      key: string,
      opts: { expiresInSeconds?: number; downloadName?: string; contentType?: string } = {}
    ): Promise<string> {
      const command = new GetObjectCommand({
        Bucket,
        Key: key,
        ResponseContentDisposition: opts.downloadName
          ? `attachment; filename="${opts.downloadName.replace(/"/g, "")}"`
          : undefined,
        ResponseContentType: opts.contentType
      });
      return getSignedUrl(signer, command, { expiresIn: opts.expiresInSeconds ?? 300 });
    },

    /** Metadata only — no bytes transferred. */
    async head(key: string): Promise<{ size: number; contentType: string | undefined } | null> {
      try {
        const res = await retry(() => internal.send(new HeadObjectCommand({ Bucket, Key: key })));
        return { size: res.ContentLength ?? 0, contentType: res.ContentType };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    /** Streaming read — the body is a Node Readable; never buffered whole. */
    async getStream(key: string): Promise<Readable> {
      const res = await retry(() => internal.send(new GetObjectCommand({ Bucket, Key: key })));
      return res.Body as Readable;
    },

    /** Read only the first `bytes` — enough for magic-byte sniffing. */
    async getHead(key: string, bytes = 4_100): Promise<Uint8Array> {
      const res = await retry(() =>
        internal.send(new GetObjectCommand({ Bucket, Key: key, Range: `bytes=0-${bytes - 1}` }))
      );
      return res.Body ? await res.Body.transformToByteArray() : new Uint8Array();
    },

    async put(key: string, body: Uint8Array | Buffer, contentType: string): Promise<void> {
      await retry(() =>
        internal.send(
          new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType })
        )
      );
    },

    async delete(key: string): Promise<void> {
      await retry(() => internal.send(new DeleteObjectCommand({ Bucket, Key: key })));
    },

    async destroy(): Promise<void> {
      internal.destroy();
      signer.destroy();
    }
  };
}

export type Storage = ReturnType<typeof createStorage>;

function isNotFound(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NotFound" || e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404;
}
