import { randomUUID } from "node:crypto";
import mongoose, { Schema } from "mongoose";

export type UploadIntent = {
  id: string;
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdBy: string;
  expiresAt: Date;
  consumedAt: Date | null;
};

export interface UploadIntentRepository {
  create(input: Omit<UploadIntent, "id" | "consumedAt">): Promise<UploadIntent>;
  findByKey(storageKey: string): Promise<UploadIntent | null>;
  consume(id: string): Promise<void>;
}

export function createMemoryUploadRepository(): UploadIntentRepository {
  const rows: UploadIntent[] = [];
  return {
    async create(input) {
      const record = { ...input, id: randomUUID(), consumedAt: null };
      rows.push(record);
      return record;
    },
    async findByKey(storageKey) {
      return rows.find((row) => row.storageKey === storageKey) ?? null;
    },
    async consume(id) {
      const row = rows.find((item) => item.id === id);
      if (row) {
        row.consumedAt = new Date();
      }
    },
  };
}

const uploadSchema = new Schema(
  {
    storageKey: { type: String, required: true, unique: true },
    fileName: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

const UploadModel = (mongoose.models.UploadIntent ?? mongoose.model("UploadIntent", uploadSchema)) as mongoose.Model<{
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdBy: { toString(): string };
  expiresAt: Date;
  consumedAt?: Date | null;
}>;

function toRecord(doc: {
  _id: { toString(): string };
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdBy: { toString(): string };
  expiresAt: Date;
  consumedAt?: Date | null;
}): UploadIntent {
  return {
    id: doc._id.toString(),
    storageKey: doc.storageKey,
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    createdBy: doc.createdBy.toString(),
    expiresAt: doc.expiresAt,
    consumedAt: doc.consumedAt ?? null,
  };
}

export function createMongoUploadRepository(): UploadIntentRepository {
  return {
    async create(input) {
      const doc = await UploadModel.create(input);
      return toRecord(doc);
    },
    async findByKey(storageKey) {
      const doc = await UploadModel.findOne({ storageKey }).lean();
      return doc ? toRecord(doc) : null;
    },
    async consume(id) {
      if (!mongoose.isValidObjectId(id)) {
        return;
      }
      await UploadModel.updateOne({ _id: id }, { consumedAt: new Date() });
    },
  };
}
