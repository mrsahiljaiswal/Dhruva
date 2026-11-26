import type { Difficulty, ResourceStatus, ResourceType, Visibility } from "@dhruva/shared";
import { randomUUID } from "node:crypto";
import mongoose, { Schema } from "mongoose";

export type ResourceAttachment = {
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

export type ResourceTestCase = {
  name: string;
  input: string;
  expectedOutput: string;
  hidden: boolean;
};

export type ResourceRecord = {
  id: string;
  title: string;
  description: string;
  type: ResourceType;
  content: string;
  externalLink: string | null;
  attachments: ResourceAttachment[];
  topic: string;
  tags: string[];
  difficulty: Difficulty;
  estimatedDurationMin: number;
  visibility: Visibility | null;
  targetIds: string[];
  language: string | null;
  testCases: ResourceTestCase[];
  version: number;
  revision: number;
  status: ResourceStatus;
  createdBy: string;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type NewResource = Omit<ResourceRecord, "id" | "revision" | "createdAt" | "updatedAt">;

export type ResourceUpdate = Omit<ResourceRecord, "id" | "revision" | "createdAt" | "createdBy" | "updatedAt">;

export type UpdateResult = ResourceRecord | "conflict" | null;

export interface ResourceRepository {
  list(): Promise<ResourceRecord[]>;
  findById(id: string): Promise<ResourceRecord | null>;
  create(input: NewResource): Promise<ResourceRecord>;
  update(id: string, expectedRevision: number, patch: ResourceUpdate): Promise<UpdateResult>;
}

export function createMemoryResourceRepository(): ResourceRepository {
  const byId = new Map<string, ResourceRecord>();
  return {
    async list() {
      return [...byId.values()];
    },
    async findById(id) {
      return byId.get(id) ?? null;
    },
    async create(input) {
      const now = new Date();
      const record: ResourceRecord = { ...input, id: randomUUID(), revision: 0, createdAt: now, updatedAt: now };
      byId.set(record.id, record);
      return record;
    },
    async update(id, expectedRevision, patch) {
      const current = byId.get(id);
      if (!current) {
        return null;
      }
      if (current.revision !== expectedRevision) {
        return "conflict";
      }
      const next: ResourceRecord = {
        ...patch,
        id,
        createdBy: current.createdBy,
        createdAt: current.createdAt,
        revision: current.revision + 1,
        updatedAt: new Date(),
      };
      byId.set(id, next);
      return next;
    },
  };
}

const attachmentSchema = new Schema(
  {
    storageKey: { type: String, required: true },
    fileName: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
  },
  { _id: false },
);

const testCaseSchema = new Schema(
  {
    name: { type: String, required: true },
    input: { type: String, required: true },
    expectedOutput: { type: String, required: true },
    hidden: { type: Boolean, required: true },
  },
  { _id: false },
);

const resourceSchema = new Schema(
  {
    title: { type: String, required: true },
    description: { type: String, default: "" },
    type: {
      type: String,
      required: true,
      enum: ["ARTICLE", "VIDEO", "PDF", "DOCUMENTATION", "CODING_EXERCISE", "QUIZ", "PROJECT", "EXTERNAL_LINK"],
    },
    content: { type: String, default: "" },
    externalLink: { type: String, default: null },
    attachments: { type: [attachmentSchema], default: [] },
    topic: { type: String, required: true },
    tags: { type: [String], default: [] },
    difficulty: { type: String, required: true, enum: ["BEGINNER", "INTERMEDIATE", "ADVANCED"] },
    estimatedDurationMin: { type: Number, required: true },
    visibility: { type: String, enum: ["GLOBAL", "COHORT", "MENTOR_GROUP", "INDIVIDUAL", null], default: null },
    targetIds: { type: [Schema.Types.ObjectId], default: [] },
    language: { type: String, default: null },
    testCases: { type: [testCaseSchema], default: [] },
    version: { type: Number, required: true, default: 1 },
    revision: { type: Number, required: true, default: 0 },
    status: { type: String, required: true, enum: ["DRAFT", "PUBLISHED", "ARCHIVED"] },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

resourceSchema.index({ status: 1, visibility: 1 });
resourceSchema.index({ topic: 1, difficulty: 1 });
resourceSchema.index({ createdBy: 1 });
resourceSchema.index({ targetIds: 1 });

const ResourceModel = (mongoose.models.Resource ?? mongoose.model("Resource", resourceSchema)) as mongoose.Model<{
  title: string;
  description?: string;
  type: ResourceType;
  content?: string;
  externalLink?: string | null;
  attachments?: ResourceAttachment[];
  topic: string;
  tags?: string[];
  difficulty: Difficulty;
  estimatedDurationMin: number;
  visibility?: Visibility | null;
  targetIds?: { toString(): string }[];
  language?: string | null;
  testCases?: ResourceTestCase[];
  version: number;
  revision: number;
  status: ResourceStatus;
  createdBy: { toString(): string };
  publishedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}>;

function toRecord(doc: {
  _id: { toString(): string };
  title: string;
  description?: string;
  type: ResourceType;
  content?: string;
  externalLink?: string | null;
  attachments?: ResourceAttachment[];
  topic: string;
  tags?: string[];
  difficulty: Difficulty;
  estimatedDurationMin: number;
  visibility?: Visibility | null;
  targetIds?: { toString(): string }[];
  language?: string | null;
  testCases?: ResourceTestCase[];
  version: number;
  revision: number;
  status: ResourceStatus;
  createdBy: { toString(): string };
  publishedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ResourceRecord {
  return {
    id: doc._id.toString(),
    title: doc.title,
    description: doc.description ?? "",
    type: doc.type,
    content: doc.content ?? "",
    externalLink: doc.externalLink ?? null,
    attachments: doc.attachments ?? [],
    topic: doc.topic,
    tags: doc.tags ?? [],
    difficulty: doc.difficulty,
    estimatedDurationMin: doc.estimatedDurationMin,
    visibility: doc.visibility ?? null,
    targetIds: (doc.targetIds ?? []).map((id) => id.toString()),
    language: doc.language ?? null,
    testCases: doc.testCases ?? [],
    version: doc.version,
    revision: doc.revision,
    status: doc.status,
    createdBy: doc.createdBy.toString(),
    publishedAt: doc.publishedAt ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toMongoUpdate(patch: ResourceUpdate): Record<string, unknown> {
  return {
    title: patch.title,
    description: patch.description,
    type: patch.type,
    content: patch.content,
    externalLink: patch.externalLink,
    attachments: patch.attachments,
    topic: patch.topic,
    tags: patch.tags,
    difficulty: patch.difficulty,
    estimatedDurationMin: patch.estimatedDurationMin,
    visibility: patch.visibility,
    targetIds: patch.targetIds,
    language: patch.language,
    testCases: patch.testCases,
    version: patch.version,
    status: patch.status,
    publishedAt: patch.publishedAt,
  };
}

export function createMongoResourceRepository(): ResourceRepository {
  return {
    async list() {
      const docs = await ResourceModel.find().lean();
      return docs.map((doc) => toRecord(doc));
    },
    async findById(id) {
      if (!mongoose.isValidObjectId(id)) {
        return null;
      }
      const doc = await ResourceModel.findById(id).lean();
      return doc ? toRecord(doc) : null;
    },
    async create(input) {
      const doc = await ResourceModel.create({ ...input, revision: 0 });
      return toRecord(doc);
    },
    async update(id, expectedRevision, patch) {
      if (!mongoose.isValidObjectId(id)) {
        return null;
      }
      const doc = await ResourceModel.findOneAndUpdate(
        { _id: id, revision: expectedRevision },
        { $set: toMongoUpdate(patch), $inc: { revision: 1 } },
        { new: true, timestamps: true },
      ).lean();
      if (doc) {
        return toRecord(doc);
      }
      const exists = await ResourceModel.exists({ _id: id });
      return exists ? "conflict" : null;
    },
  };
}
