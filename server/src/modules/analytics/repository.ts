import type { ExportKind, ExportStatus, LearningEventType, SupportIndicator } from "@dhruva/shared";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import mongoose, { Schema } from "mongoose";

export type LearningEventRecord = {
  id: string;
  studentId: string;
  type: LearningEventType;
  refType: string;
  refId: string;
  metadata: Record<string, string>;
  occurredAt: Date;
};

export type NewLearningEvent = Omit<LearningEventRecord, "id">;

export type TopicScore = {
  topic: string;
  assignedCount: number;
  completedCount: number;
  completionPct: number | null;
  averageScore: number | null;
};

export type FeedbackItem = {
  assignmentTitle: string;
  feedback: string;
  reviewedAt: string;
  score: number | null;
};

export type ProgressRecord = {
  studentId: string;
  assignedCount: number;
  completedCount: number;
  pendingCount: number;
  overdueCount: number;
  completionPct: number | null;
  averageScore: number | null;
  topicScores: TopicScore[];
  weeklyActiveDays: number;
  week: { date: string; active: boolean }[];
  recentFeedback: FeedbackItem[];
  supportIndicator: SupportIndicator;
  supportReasons: string[];
  computedAt: Date;
};

export type ExportRecord = {
  id: string;
  requestedBy: string;
  kind: ExportKind;
  cohortId: string | null;
  status: ExportStatus;
  storageKey: string | null;
  content: string | null;
  failure: string | null;
  tokenHash: string | null;
  downloadExpiresAt: Date | null;
  createdAt: Date;
  expiresAt: Date | null;
};

export interface LearningEventRepository {
  append(input: NewLearningEvent): Promise<LearningEventRecord>;
  listForStudent(studentId: string, limit: number): Promise<LearningEventRecord[]>;
  listAll(): Promise<LearningEventRecord[]>;
}

export interface ProgressRepository {
  find(studentId: string): Promise<ProgressRecord | null>;
  save(record: ProgressRecord): Promise<ProgressRecord>;
  list(): Promise<ProgressRecord[]>;
}

export interface ExportRepository {
  insert(input: { requestedBy: string; kind: ExportKind; cohortId: string | null; createdAt: Date }): Promise<ExportRecord>;
  find(id: string): Promise<ExportRecord | null>;
  markReady(id: string, content: string, expiresAt: Date): Promise<ExportRecord | null>;
  markFailed(id: string, failure: string): Promise<ExportRecord | null>;
  mintDownload(id: string, expiresAt: Date): Promise<{ record: ExportRecord; token: string } | null>;
  findByToken(id: string, token: string, now: Date): Promise<ExportRecord | null>;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function tokensMatch(stored: string, token: string): boolean {
  const candidate = hashToken(token);
  const left = Buffer.from(stored);
  const right = Buffer.from(candidate);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createMemoryLearningEventRepository(): LearningEventRepository {
  const rows: LearningEventRecord[] = [];
  return {
    async append(input) {
      const record = { ...input, id: randomUUID(), metadata: { ...input.metadata } };
      rows.push(record);
      return { ...record, metadata: { ...record.metadata }, occurredAt: new Date(record.occurredAt) };
    },
    async listForStudent(studentId, limit) {
      return rows
        .filter((row) => row.studentId === studentId)
        .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime())
        .slice(0, limit)
        .map((row) => ({ ...row, metadata: { ...row.metadata }, occurredAt: new Date(row.occurredAt) }));
    },
    async listAll() {
      return rows.map((row) => ({ ...row, metadata: { ...row.metadata }, occurredAt: new Date(row.occurredAt) }));
    },
  };
}

function cloneProgress(record: ProgressRecord): ProgressRecord {
  return {
    ...record,
    topicScores: record.topicScores.map((topic) => ({ ...topic })),
    week: record.week.map((day) => ({ ...day })),
    recentFeedback: record.recentFeedback.map((item) => ({ ...item })),
    supportReasons: [...record.supportReasons],
    computedAt: new Date(record.computedAt),
  };
}

export function createMemoryProgressRepository(): ProgressRepository {
  const rows = new Map<string, ProgressRecord>();
  return {
    async find(studentId) {
      const found = rows.get(studentId);
      return found ? cloneProgress(found) : null;
    },
    async save(record) {
      const stored = cloneProgress(record);
      rows.set(record.studentId, stored);
      return cloneProgress(stored);
    },
    async list() {
      return [...rows.values()].map(cloneProgress);
    },
  };
}

function cloneExport(record: ExportRecord): ExportRecord {
  return {
    ...record,
    downloadExpiresAt: record.downloadExpiresAt ? new Date(record.downloadExpiresAt) : null,
    createdAt: new Date(record.createdAt),
    expiresAt: record.expiresAt ? new Date(record.expiresAt) : null,
  };
}

export function createMemoryExportRepository(): ExportRepository {
  const rows = new Map<string, ExportRecord>();
  return {
    async insert(input) {
      const record: ExportRecord = {
        id: randomUUID(),
        requestedBy: input.requestedBy,
        kind: input.kind,
        cohortId: input.cohortId,
        status: "PENDING",
        storageKey: null,
        content: null,
        failure: null,
        tokenHash: null,
        downloadExpiresAt: null,
        createdAt: input.createdAt,
        expiresAt: null,
      };
      rows.set(record.id, record);
      return cloneExport(record);
    },
    async find(id) {
      const found = rows.get(id);
      return found ? cloneExport(found) : null;
    },
    async markReady(id, content, expiresAt) {
      const found = rows.get(id);
      if (!found || found.status === "READY") {
        return found ? cloneExport(found) : null;
      }
      found.status = "READY";
      found.content = content;
      found.storageKey = `exports/${id}.csv`;
      found.expiresAt = expiresAt;
      found.failure = null;
      return cloneExport(found);
    },
    async markFailed(id, failure) {
      const found = rows.get(id);
      if (!found || found.status === "READY") {
        return found ? cloneExport(found) : null;
      }
      found.status = "FAILED";
      found.failure = failure;
      return cloneExport(found);
    },
    async mintDownload(id, expiresAt) {
      const found = rows.get(id);
      if (!found || found.status !== "READY") {
        return null;
      }
      const token = randomBytes(24).toString("hex");
      found.tokenHash = hashToken(token);
      found.downloadExpiresAt = expiresAt;
      return { record: cloneExport(found), token };
    },
    async findByToken(id, token, now) {
      const found = rows.get(id);
      if (!found || found.status !== "READY" || !found.tokenHash || !found.downloadExpiresAt) {
        return null;
      }
      if (found.downloadExpiresAt.getTime() <= now.getTime() || !tokensMatch(found.tokenHash, token)) {
        return null;
      }
      return cloneExport(found);
    },
  };
}

const learningEventSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, required: true },
    type: { type: String, required: true },
    refType: { type: String, required: true },
    refId: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed, required: true },
    occurredAt: { type: Date, required: true },
  },
  { versionKey: false, timestamps: false },
);

function rejectLearningMutation(): never {
  throw new Error("LearningEvent is append-only");
}

for (const hook of ["updateOne", "updateMany", "findOneAndUpdate", "deleteOne", "deleteMany", "findOneAndDelete"] as const) {
  learningEventSchema.pre(hook, rejectLearningMutation);
}
learningEventSchema.index({ studentId: 1, occurredAt: -1 });
learningEventSchema.index({ type: 1, occurredAt: -1 });

type LearningDoc = {
  _id: { toString(): string };
  studentId: { toString(): string };
  type: LearningEventType;
  refType: string;
  refId: string;
  metadata?: Record<string, unknown> | null;
  occurredAt: Date;
};

const LearningEventModel = (mongoose.models.LearningEvent ??
  mongoose.model("LearningEvent", learningEventSchema)) as mongoose.Model<LearningDoc>;

function metadataOf(value: Record<string, unknown> | null | undefined): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const [key, item] of Object.entries(value ?? {})) {
    if (typeof item === "string") {
      metadata[key] = item;
    }
  }
  return metadata;
}

function toEvent(doc: LearningDoc): LearningEventRecord {
  return {
    id: doc._id.toString(),
    studentId: doc.studentId.toString(),
    type: doc.type,
    refType: doc.refType,
    refId: doc.refId,
    metadata: metadataOf(doc.metadata),
    occurredAt: doc.occurredAt,
  };
}

export function createMongoLearningEventRepository(): LearningEventRepository {
  return {
    async append(input) {
      const doc = await LearningEventModel.create(input);
      return toEvent(doc.toObject() as LearningDoc);
    },
    async listForStudent(studentId, limit) {
      if (!mongoose.isValidObjectId(studentId)) {
        return [];
      }
      const docs = await LearningEventModel.find({ studentId }).sort({ occurredAt: -1 }).limit(limit).lean<LearningDoc[]>();
      return docs.map(toEvent);
    },
    async listAll() {
      const docs = await LearningEventModel.find().lean<LearningDoc[]>();
      return docs.map(toEvent);
    },
  };
}

const topicScoreSchema = new Schema(
  {
    topic: { type: String, required: true },
    assignedCount: { type: Number, required: true },
    completedCount: { type: Number, required: true },
    completionPct: { type: Number, default: null },
    averageScore: { type: Number, default: null },
  },
  { _id: false },
);

const progressSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, required: true, unique: true },
    assignedCount: { type: Number, required: true },
    completedCount: { type: Number, required: true },
    pendingCount: { type: Number, required: true },
    overdueCount: { type: Number, required: true },
    completionPct: { type: Number, default: null },
    averageScore: { type: Number, default: null },
    topicScores: { type: [topicScoreSchema], default: [] },
    weeklyActiveDays: { type: Number, required: true },
    week: { type: [{ date: String, active: Boolean }], default: [] },
    recentFeedback: {
      type: [{ assignmentTitle: String, feedback: String, reviewedAt: String, score: Number }],
      default: [],
    },
    supportIndicator: { type: String, required: true },
    supportReasons: { type: [String], default: [] },
    computedAt: { type: Date, required: true },
  },
  { versionKey: false, timestamps: false },
);

type ProgressDoc = ProgressRecord & { _id: { toString(): string }; studentId: { toString(): string } };

const ProgressModel = (mongoose.models.StudentProgress ??
  mongoose.model("StudentProgress", progressSchema)) as mongoose.Model<ProgressDoc>;

function toProgress(doc: ProgressDoc): ProgressRecord {
  return {
    studentId: doc.studentId.toString(),
    assignedCount: doc.assignedCount,
    completedCount: doc.completedCount,
    pendingCount: doc.pendingCount,
    overdueCount: doc.overdueCount,
    completionPct: doc.completionPct ?? null,
    averageScore: doc.averageScore ?? null,
    topicScores: (doc.topicScores ?? []).map((topic) => ({
      topic: topic.topic,
      assignedCount: topic.assignedCount,
      completedCount: topic.completedCount,
      completionPct: topic.completionPct ?? null,
      averageScore: topic.averageScore ?? null,
    })),
    weeklyActiveDays: doc.weeklyActiveDays,
    week: (doc.week ?? []).map((day) => ({ date: day.date, active: day.active })),
    recentFeedback: (doc.recentFeedback ?? []).map((item) => ({
      assignmentTitle: item.assignmentTitle,
      feedback: item.feedback,
      reviewedAt: item.reviewedAt,
      score: item.score ?? null,
    })),
    supportIndicator: doc.supportIndicator,
    supportReasons: [...(doc.supportReasons ?? [])],
    computedAt: doc.computedAt,
  };
}

export function createMongoProgressRepository(): ProgressRepository {
  return {
    async find(studentId) {
      if (!mongoose.isValidObjectId(studentId)) {
        return null;
      }
      const doc = await ProgressModel.findOne({ studentId }).lean<ProgressDoc | null>();
      return doc ? toProgress(doc) : null;
    },
    async save(record) {
      const doc = await ProgressModel.findOneAndUpdate({ studentId: record.studentId }, record, {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }).lean<ProgressDoc | null>();
      if (!doc) {
        throw new Error("Progress could not be saved.");
      }
      return toProgress(doc);
    },
    async list() {
      const docs = await ProgressModel.find().lean<ProgressDoc[]>();
      return docs.map(toProgress);
    },
  };
}

const exportSchema = new Schema(
  {
    requestedBy: { type: Schema.Types.ObjectId, required: true },
    kind: { type: String, required: true },
    cohortId: { type: String, default: null },
    status: { type: String, required: true },
    storageKey: { type: String, default: null },
    content: { type: String, default: null },
    failure: { type: String, default: null },
    tokenHash: { type: String, default: null },
    downloadExpiresAt: { type: Date, default: null },
    createdAt: { type: Date, required: true },
    expiresAt: { type: Date, default: null },
  },
  { versionKey: false, timestamps: false },
);
exportSchema.index({ requestedBy: 1, createdAt: -1 });

type ExportDoc = {
  _id: { toString(): string };
  requestedBy: { toString(): string };
  kind: ExportKind;
  cohortId?: string | null;
  status: ExportStatus;
  storageKey?: string | null;
  content?: string | null;
  failure?: string | null;
  tokenHash?: string | null;
  downloadExpiresAt?: Date | null;
  createdAt: Date;
  expiresAt?: Date | null;
};

const ExportModel = (mongoose.models.ReportExport ?? mongoose.model("ReportExport", exportSchema)) as mongoose.Model<ExportDoc>;

function toExport(doc: ExportDoc): ExportRecord {
  return {
    id: doc._id.toString(),
    requestedBy: doc.requestedBy.toString(),
    kind: doc.kind,
    cohortId: doc.cohortId ?? null,
    status: doc.status,
    storageKey: doc.storageKey ?? null,
    content: doc.content ?? null,
    failure: doc.failure ?? null,
    tokenHash: doc.tokenHash ?? null,
    downloadExpiresAt: doc.downloadExpiresAt ?? null,
    createdAt: doc.createdAt,
    expiresAt: doc.expiresAt ?? null,
  };
}

export function createMongoExportRepository(): ExportRepository {
  return {
    async insert(input) {
      const doc = await ExportModel.create({ ...input, status: "PENDING" });
      return toExport(doc.toObject() as ExportDoc);
    },
    async find(id) {
      if (!mongoose.isValidObjectId(id)) {
        return null;
      }
      const doc = await ExportModel.findById(id).lean<ExportDoc | null>();
      return doc ? toExport(doc) : null;
    },
    async markReady(id, content, expiresAt) {
      if (!mongoose.isValidObjectId(id)) {
        return null;
      }
      const doc = await ExportModel.findOneAndUpdate(
        { _id: id, status: "PENDING" },
        { $set: { status: "READY", content, storageKey: `exports/${id}.csv`, expiresAt, failure: null } },
        { new: true },
      ).lean<ExportDoc | null>();
      if (doc) {
        return toExport(doc);
      }
      const current = await ExportModel.findById(id).lean<ExportDoc | null>();
      return current ? toExport(current) : null;
    },
    async markFailed(id, failure) {
      if (!mongoose.isValidObjectId(id)) {
        return null;
      }
      const doc = await ExportModel.findOneAndUpdate(
        { _id: id, status: "PENDING" },
        { $set: { status: "FAILED", failure } },
        { new: true },
      ).lean<ExportDoc | null>();
      return doc ? toExport(doc) : null;
    },
    async mintDownload(id, expiresAt) {
      if (!mongoose.isValidObjectId(id)) {
        return null;
      }
      const token = randomBytes(24).toString("hex");
      const doc = await ExportModel.findOneAndUpdate(
        { _id: id, status: "READY" },
        { $set: { tokenHash: hashToken(token), downloadExpiresAt: expiresAt } },
        { new: true },
      ).lean<ExportDoc | null>();
      return doc ? { record: toExport(doc), token } : null;
    },
    async findByToken(id, token, now) {
      if (!mongoose.isValidObjectId(id)) {
        return null;
      }
      const doc = await ExportModel.findById(id).lean<ExportDoc | null>();
      if (!doc || doc.status !== "READY" || !doc.tokenHash || !doc.downloadExpiresAt) {
        return null;
      }
      if (doc.downloadExpiresAt.getTime() <= now.getTime() || !tokensMatch(doc.tokenHash, token)) {
        return null;
      }
      return toExport(doc);
    },
  };
}
