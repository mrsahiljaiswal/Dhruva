import { createHash, randomBytes } from "node:crypto";
import { randomUUID } from "node:crypto";
import mongoose, { Schema } from "mongoose";

export type TokenPurpose = "INVITE" | "RESET";

export type TokenRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  purpose: TokenPurpose;
  expiresAt: Date;
  usedAt: Date | null;
};

export interface TokenRepository {
  create(input: Omit<TokenRecord, "id">): Promise<TokenRecord>;
  findValid(tokenHash: string, purpose: TokenPurpose, now: Date): Promise<TokenRecord | null>;
  markUsed(id: string, usedAt: Date): Promise<void>;
  invalidateActive(userId: string, purpose: TokenPurpose, usedAt: Date): Promise<void>;
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function newRawToken(): string {
  return randomBytes(32).toString("base64url");
}

export function createMemoryTokenRepository(): TokenRepository {
  const tokens: TokenRecord[] = [];
  return {
    async create(input) {
      const record = { ...input, id: randomUUID() };
      tokens.push(record);
      return record;
    },
    async findValid(tokenHash, purpose, now) {
      return (
        tokens.find(
          (token) =>
            token.tokenHash === tokenHash &&
            token.purpose === purpose &&
            token.usedAt === null &&
            token.expiresAt.getTime() > now.getTime(),
        ) ?? null
      );
    },
    async markUsed(id, usedAt) {
      const token = tokens.find((item) => item.id === id);
      if (token) {
        token.usedAt = usedAt;
      }
    },
    async invalidateActive(userId, purpose, usedAt) {
      for (const token of tokens) {
        if (token.userId === userId && token.purpose === purpose && token.usedAt === null) {
          token.usedAt = usedAt;
        }
      }
    },
  };
}

const tokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    purpose: { type: String, required: true, enum: ["INVITE", "RESET"] },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

const TokenModel = (mongoose.models.PasswordToken ?? mongoose.model("PasswordToken", tokenSchema)) as mongoose.Model<{
  userId: mongoose.Types.ObjectId;
  tokenHash: string;
  purpose: TokenPurpose;
  expiresAt: Date;
  usedAt?: Date | null;
}>;

function toRecord(doc: {
  _id: { toString(): string };
  userId: { toString(): string };
  tokenHash: string;
  purpose: TokenPurpose;
  expiresAt: Date;
  usedAt?: Date | null;
}): TokenRecord {
  return {
    id: doc._id.toString(),
    userId: doc.userId.toString(),
    tokenHash: doc.tokenHash,
    purpose: doc.purpose,
    expiresAt: doc.expiresAt,
    usedAt: doc.usedAt ?? null,
  };
}

export function createMongoTokenRepository(): TokenRepository {
  return {
    async create(input) {
      const doc = await TokenModel.create(input);
      return toRecord(doc);
    },
    async findValid(tokenHash, purpose, now) {
      const doc = await TokenModel.findOne({
        tokenHash,
        purpose,
        usedAt: null,
        expiresAt: { $gt: now },
      }).lean();
      return doc ? toRecord(doc) : null;
    },
    async markUsed(id, usedAt) {
      await TokenModel.updateOne({ _id: id }, { usedAt });
    },
    async invalidateActive(userId, purpose, usedAt) {
      await TokenModel.updateMany({ userId, purpose, usedAt: null }, { usedAt });
    },
  };
}
