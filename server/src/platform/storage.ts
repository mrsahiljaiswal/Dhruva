import { createHash, createHmac } from "node:crypto";
import type { Env } from "../config/env.js";

export type UploadSlot = {
  storageKey: string;
  uploadUrl: string;
  method: "PUT" | "POST";
  headers: Record<string, string>;
  fields: Record<string, string>;
  expiresAt: string;
};

export type StoredObject = {
  sizeBytes: number;
  mimeType: string | null;
};

export interface ObjectStorage {
  readonly configured: boolean;
  createUploadSlot(input: {
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
  }): Promise<UploadSlot>;
  confirm(storageKey: string): Promise<StoredObject | null>;
  createDownloadUrl(input: {
    storageKey: string;
    fileName: string;
    mimeType: string;
    expiresInSeconds: number;
  }): Promise<{ url: string; expiresAt: string }>;
}

const EMPTY_PAYLOAD_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function signingKey(secret: string, date: string, region: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), "s3"), "aws4_request");
}

function amzDate(now: Date): { short: string; full: string } {
  const full = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return { short: full.slice(0, 8), full };
}

function encodeKey(key: string): string {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

export function signCloudinaryParams(params: Record<string, string | number>, apiSecret: string): string {
  const serialized = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== "")
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return createHash("sha1").update(`${serialized}${apiSecret}`, "utf8").digest("hex");
}

export function createMemoryObjectStorage(now: () => Date = () => new Date()): ObjectStorage & {
  complete(storageKey: string, actual?: { sizeBytes?: number; mimeType?: string | null }): void;
} {
  const declared = new Map<string, { mimeType: string; sizeBytes: number }>();
  const stored = new Map<string, StoredObject>();

  return {
    configured: true,
    async createUploadSlot(input) {
      declared.set(input.storageKey, { mimeType: input.mimeType, sizeBytes: input.sizeBytes });
      const expiresAt = new Date(now().getTime() + 10 * 60 * 1000).toISOString();
      return {
        storageKey: input.storageKey,
        uploadUrl: `https://storage.test/upload/${encodeURIComponent(input.storageKey)}`,
        method: "PUT",
        headers: { "content-type": input.mimeType },
        fields: {},
        expiresAt,
      };
    },
    complete(storageKey, actual) {
      const pending = declared.get(storageKey);
      if (!pending) {
        return;
      }
      stored.set(storageKey, {
        sizeBytes: actual?.sizeBytes ?? pending.sizeBytes,
        mimeType: actual && "mimeType" in actual ? actual.mimeType ?? null : pending.mimeType,
      });
    },
    async confirm(storageKey) {
      return stored.get(storageKey) ?? null;
    },
    async createDownloadUrl(input) {
      const expiresAt = new Date(now().getTime() + input.expiresInSeconds * 1000).toISOString();
      const url = `https://storage.test/download/${encodeURIComponent(input.storageKey)}?name=${encodeURIComponent(input.fileName)}&exp=${encodeURIComponent(expiresAt)}`;
      return { url, expiresAt };
    },
  };
}

export function createUnconfiguredObjectStorage(): ObjectStorage {
  return {
    configured: false,
    async createUploadSlot() {
      throw new Error("File storage is not configured.");
    },
    async confirm() {
      return null;
    },
    async createDownloadUrl() {
      throw new Error("File storage is not configured.");
    },
  };
}

type S3Config = {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
};

export function createS3ObjectStorage(config: S3Config, now: () => Date = () => new Date()): ObjectStorage {
  const endpoint = config.endpoint?.replace(/\/$/, "");
  const virtualHost = endpoint ? null : `${config.bucket}.s3.${config.region}.amazonaws.com`;

  function host(): string {
    if (endpoint) {
      return new URL(endpoint).host;
    }
    return virtualHost ?? "";
  }

  function objectPath(storageKey: string): string {
    const key = encodeKey(storageKey);
    return endpoint ? `/${config.bucket}/${key}` : `/${key}`;
  }

  function objectUrl(storageKey: string): string {
    if (endpoint) {
      return `${endpoint}${objectPath(storageKey)}`;
    }
    return `https://${host()}${objectPath(storageKey)}`;
  }

  return {
    configured: true,
    async createUploadSlot(input) {
      const stamp = amzDate(now());
      const expiresAt = new Date(now().getTime() + 10 * 60 * 1000);
      const credential = `${config.accessKeyId}/${stamp.short}/${config.region}/s3/aws4_request`;
      const policy = {
        expiration: expiresAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
        conditions: [
          { bucket: config.bucket },
          { key: input.storageKey },
          { "Content-Type": input.mimeType },
          ["content-length-range", input.sizeBytes, input.sizeBytes],
          { "x-amz-algorithm": "AWS4-HMAC-SHA256" },
          { "x-amz-credential": credential },
          { "x-amz-date": stamp.full },
          { success_action_status: "201" },
        ],
      };
      const encodedPolicy = Buffer.from(JSON.stringify(policy), "utf8").toString("base64");
      const signature = createHmac("sha256", signingKey(config.secretAccessKey, stamp.short, config.region))
        .update(encodedPolicy, "utf8")
        .digest("hex");
      return {
        storageKey: input.storageKey,
        uploadUrl: endpoint ? `${endpoint}/${config.bucket}` : `https://${host()}`,
        method: "POST",
        headers: {},
        fields: {
          key: input.storageKey,
          "Content-Type": input.mimeType,
          policy: encodedPolicy,
          "x-amz-algorithm": "AWS4-HMAC-SHA256",
          "x-amz-credential": credential,
          "x-amz-date": stamp.full,
          "x-amz-signature": signature,
          success_action_status: "201",
        },
        expiresAt: expiresAt.toISOString(),
      };
    },
    async confirm(storageKey) {
      const stamp = amzDate(now());
      const canonicalHeaders = `host:${host()}\nx-amz-content-sha256:${EMPTY_PAYLOAD_HASH}\nx-amz-date:${stamp.full}\n`;
      const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
      const canonical = ["HEAD", objectPath(storageKey), "", canonicalHeaders, signedHeaders, EMPTY_PAYLOAD_HASH].join("\n");
      const scope = `${stamp.short}/${config.region}/s3/aws4_request`;
      const stringToSign = ["AWS4-HMAC-SHA256", stamp.full, scope, sha256(canonical)].join("\n");
      const signature = createHmac("sha256", signingKey(config.secretAccessKey, stamp.short, config.region))
        .update(stringToSign, "utf8")
        .digest("hex");
      const response = await fetch(objectUrl(storageKey), {
        method: "HEAD",
        headers: {
          host: host(),
          "x-amz-content-sha256": EMPTY_PAYLOAD_HASH,
          "x-amz-date": stamp.full,
          authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
        },
      });
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`Storage confirmation failed with status ${response.status}.`);
      }
      const length = Number(response.headers.get("content-length"));
      return {
        sizeBytes: Number.isFinite(length) ? length : 0,
        mimeType: response.headers.get("content-type"),
      };
    },
    async createDownloadUrl(input) {
      const stamp = amzDate(now());
      const scope = `${stamp.short}/${config.region}/s3/aws4_request`;
      const credential = `${config.accessKeyId}/${scope}`;
      const disposition = `attachment; filename="${input.fileName.replace(/"/g, "")}"`;
      const query = new URLSearchParams({
        "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
        "X-Amz-Credential": credential,
        "X-Amz-Date": stamp.full,
        "X-Amz-Expires": String(input.expiresInSeconds),
        "X-Amz-SignedHeaders": "host",
        "response-content-disposition": disposition,
      });
      const canonicalQuery = [...query.entries()]
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join("&");
      const canonical = ["GET", objectPath(input.storageKey), canonicalQuery, `host:${host()}\n`, "host", "UNSIGNED-PAYLOAD"].join(
        "\n",
      );
      const stringToSign = ["AWS4-HMAC-SHA256", stamp.full, scope, sha256(canonical)].join("\n");
      const signature = createHmac("sha256", signingKey(config.secretAccessKey, stamp.short, config.region))
        .update(stringToSign, "utf8")
        .digest("hex");
      query.set("X-Amz-Signature", signature);
      const expiresAt = new Date(now().getTime() + input.expiresInSeconds * 1000).toISOString();
      return { url: `${objectUrl(input.storageKey)}?${query.toString()}`, expiresAt };
    },
  };
}

const CLOUDINARY_FORMAT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "text/plain": "txt",
};

type CloudinaryConfig = {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
};

export function createCloudinaryObjectStorage(config: CloudinaryConfig, now: () => Date = () => new Date()): ObjectStorage {
  return {
    configured: true,
    async createUploadSlot(input) {
      const timestamp = Math.floor(now().getTime() / 1000);
      const format = CLOUDINARY_FORMAT[input.mimeType] ?? "raw";
      const params = { format, public_id: input.storageKey, timestamp };
      const signature = signCloudinaryParams(params, config.apiSecret);
      return {
        storageKey: input.storageKey,
        uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloudName}/raw/upload`,
        method: "POST",
        headers: {},
        fields: {
          api_key: config.apiKey,
          timestamp: String(timestamp),
          public_id: input.storageKey,
          format,
          signature,
        },
        expiresAt: new Date(now().getTime() + 10 * 60 * 1000).toISOString(),
      };
    },
    async confirm(storageKey) {
      const auth = Buffer.from(`${config.apiKey}:${config.apiSecret}`, "utf8").toString("base64");
      const response = await fetch(
        `https://api.cloudinary.com/v1_1/${config.cloudName}/resources/raw/upload/${encodeURIComponent(storageKey)}`,
        { headers: { authorization: `Basic ${auth}` } },
      );
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`Storage confirmation failed with status ${response.status}.`);
      }
      const body = (await response.json()) as { bytes?: number };
      return { sizeBytes: typeof body.bytes === "number" ? body.bytes : 0, mimeType: null };
    },
    async createDownloadUrl(input) {
      const expiresAtDate = new Date(now().getTime() + input.expiresInSeconds * 1000);
      const expiresAt = Math.floor(expiresAtDate.getTime() / 1000);
      const format = CLOUDINARY_FORMAT[input.mimeType] ?? "raw";
      const params = {
        expires_at: expiresAt,
        format,
        public_id: input.storageKey,
        timestamp: expiresAt,
        type: "upload",
      };
      const signature = signCloudinaryParams(params, config.apiSecret);
      const query = new URLSearchParams({
        public_id: input.storageKey,
        format,
        timestamp: String(expiresAt),
        expires_at: String(expiresAt),
        type: "upload",
        signature,
        api_key: config.apiKey,
      });
      return {
        url: `https://api.cloudinary.com/v1_1/${config.cloudName}/raw/download?${query.toString()}`,
        expiresAt: expiresAtDate.toISOString(),
      };
    },
  };
}

export function createObjectStorage(env: Env): ObjectStorage {
  if (env.STORAGE_DRIVER === "s3" && env.STORAGE_BUCKET && env.STORAGE_REGION && env.STORAGE_KEY && env.STORAGE_SECRET) {
    return createS3ObjectStorage({
      bucket: env.STORAGE_BUCKET,
      region: env.STORAGE_REGION,
      accessKeyId: env.STORAGE_KEY,
      secretAccessKey: env.STORAGE_SECRET,
      ...(env.STORAGE_ENDPOINT ? { endpoint: env.STORAGE_ENDPOINT } : {}),
    });
  }
  if (env.STORAGE_DRIVER === "cloudinary" && env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET) {
    return createCloudinaryObjectStorage({
      cloudName: env.CLOUDINARY_CLOUD_NAME,
      apiKey: env.CLOUDINARY_API_KEY,
      apiSecret: env.CLOUDINARY_API_SECRET,
    });
  }
  return createUnconfiguredObjectStorage();
}
