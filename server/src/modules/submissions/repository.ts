import type { SubmissionStatus, SubmissionType } from "@dhruva/shared";
import { randomUUID } from "node:crypto";
import mongoose, { Schema } from "mongoose";

export type RubricScoreRecord = {
  criterion: string;
  points: number;
};

export type RevisionRecord = {
  id: string;
  recipientId: string;
  studentId: string;
  revisionNo: number;
  submissionType: SubmissionType;
  textAnswer: string | null;
  fileKey: string | null;
  fileName: string | null;
  mimeType: string | null;
  repositoryUrl: string | null;
  editorUrl: string | null;
  resourceVersion: number | null;
  submittedAt: Date;
  status: SubmissionStatus;
  score: number | null;
  rubricScores: RubricScoreRecord[];
  feedback: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  idempotencyKey: string;
  bodyHash: string;
};

export type NewRevision = Omit<
  RevisionRecord,
  "id" | "status" | "score" | "rubricScores" | "feedback" | "reviewedBy" | "reviewedAt"
>;

export type ReviewPatch = {
  status: "APPROVED" | "REVISION_REQUESTED";
  score: number | null;
  rubricScores: RubricScoreRecord[];
  feedback: string;
  reviewedBy: string;
  reviewedAt: Date;
};

export type InsertResult =
  | { kind: "created"; revision: RevisionRecord }
  | { kind: "duplicate"; field: "key" | "number"; revision: RevisionRecord | null };

export interface SubmissionRepository {
  listForRecipient(recipientId: string): Promise<RevisionRecord[]>;
  findById(id: string): Promise<RevisionRecord | null>;
  findByKey(recipientId: string, idempotencyKey: string): Promise<RevisionRecord | null>;
  insert(input: NewRevision): Promise<InsertResult>;
  markReviewed(id: string, patch: ReviewPatch): Promise<RevisionRecord | "stale" | null>;
  revertReview(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}

function clone(row: RevisionRecord): RevisionRecord {
  return {
    ...row,
    submittedAt: new Date(row.submittedAt),
    reviewedAt: row.reviewedAt ? new Date(row.reviewedAt) : null,
    rubricScores: row.rubricScores.map((item) => ({ ...item })),
  };
}

function duplicateField(error: unknown): "key" | "number" | null {
  if (typeof error !== "object" || error === null || !("code" in error) || error.code !== 11000) {
    return null;
  }
  const pattern =
    "keyPattern" in error && typeof error.keyPattern === "object" && error.keyPattern
      ? (error.keyPattern as Record<string, unknown>)
      : {};
  if ("revisionNo" in pattern) {
    return "number";
  }
  return "key";
}

export function createMemorySubmissionRepository(): SubmissionRepository {
  const rows: RevisionRecord[] = [];

  function byKey(recipientId: string, idempotencyKey: string): RevisionRecord | null {
    return rows.find((row) => row.recipientId === recipientId && row.idempotencyKey === idempotencyKey) ?? null;
  }

  return {
    async listForRecipient(recipientId) {
      return rows
        .filter((row) => row.recipientId === recipientId)
        .sort((left, right) => left.revisionNo - right.revisionNo)
        .map((row) => clone(row));
    },
    async findById(id) {
      const found = rows.find((row) => row.id === id);
      return found ? clone(found) : null;
    },
    async findByKey(recipientId, idempotencyKey) {
      const found = byKey(recipientId, idempotencyKey);
      return found ? clone(found) : null;
    },
    async insert(input) {
      const existingKey = byKey(input.recipientId, input.idempotencyKey);
      if (existingKey) {
        return { kind: "duplicate", field: "key", revision: clone(existingKey) };
      }
      if (rows.some((row) => row.recipientId === input.recipientId && row.revisionNo === input.revisionNo)) {
        return { kind: "duplicate", field: "number", revision: null };
      }
      const record: RevisionRecord = {
        ...input,
        id: randomUUID(),
        status: "PENDING",
        score: null,
        rubricScores: [],
        feedback: null,
        reviewedBy: null,
        reviewedAt: null,
      };
      rows.push(record);
      return { kind: "created", revision: clone(record) };
    },
    async markReviewed(id, patch) {
      const found = rows.find((row) => row.id === id);
      if (!found) {
        return null;
      }
      if (found.status !== "PENDING") {
        return "stale";
      }
      found.status = patch.status;
      found.score = patch.score;
      found.rubricScores = patch.rubricScores.map((item) => ({ ...item }));
      found.feedback = patch.feedback;
      found.reviewedBy = patch.reviewedBy;
      found.reviewedAt = patch.reviewedAt;
      return clone(found);
    },
    async revertReview(id) {
      const found = rows.find((row) => row.id === id);
      if (!found) {
        return;
      }
      found.status = "PENDING";
      found.score = null;
      found.rubricScores = [];
      found.feedback = null;
      found.reviewedBy = null;
      found.reviewedAt = null;
    },
    async remove(id) {
      const index = rows.findIndex((row) => row.id === id);
      if (index >= 0) {
        rows.splice(index, 1);
      }
    },
  };
}

const rubricScoreSchema = new Schema(
  {
    criterion: { type: String, required: true },
    points: { type: Number, required: true },
  },
  { _id: false },
);

const revisionSchema = new Schema(
  {
    recipientId: { type: Schema.Types.ObjectId, required: true },
    studentId: { type: Schema.Types.ObjectId, required: true },
    revisionNo: { type: Number, required: true },
    submissionType: { type: String, required: true, enum: ["TEXT", "FILE", "REPOSITORY", "EDITOR_LINK", "NONE"] },
    textAnswer: { type: String, default: null },
    fileKey: { type: String, default: null },
    fileName: { type: String, default: null },
    mimeType: { type: String, default: null },
    repositoryUrl: { type: String, default: null },
    editorUrl: { type: String, default: null },
    resourceVersion: { type: Number, default: null },
    submittedAt: { type: Date, required: true },
    status: { type: String, required: true, enum: ["PENDING", "APPROVED", "REVISION_REQUESTED"] },
    score: { type: Number, default: null },
    rubricScores: { type: [rubricScoreSchema], default: [] },
    feedback: { type: String, default: null },
    reviewedBy: { type: Schema.Types.ObjectId, default: null },
    reviewedAt: { type: Date, default: null },
    idempotencyKey: { type: String, required: true },
    bodyHash: { type: String, required: true },
  },
  { timestamps: true },
);
revisionSchema.index({ recipientId: 1, revisionNo: 1 }, { unique: true });
revisionSchema.index({ recipientId: 1, idempotencyKey: 1 }, { unique: true });

type RevisionDoc = {
  _id: { toString(): string };
  recipientId: { toString(): string };
  studentId: { toString(): string };
  revisionNo: number;
  submissionType: SubmissionType;
  textAnswer?: string | null;
  fileKey?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  repositoryUrl?: string | null;
  editorUrl?: string | null;
  resourceVersion?: number | null;
  submittedAt: Date;
  status: SubmissionStatus;
  score?: number | null;
  rubricScores?: RubricScoreRecord[];
  feedback?: string | null;
  reviewedBy?: { toString(): string } | null;
  reviewedAt?: Date | null;
  idempotencyKey: string;
  bodyHash: string;
};

const RevisionModel = (mongoose.models.SubmissionRevision ??
  mongoose.model("SubmissionRevision", revisionSchema)) as mongoose.Model<RevisionDoc>;

function toRevision(doc: RevisionDoc): RevisionRecord {
  return {
    id: doc._id.toString(),
    recipientId: doc.recipientId.toString(),
    studentId: doc.studentId.toString(),
    revisionNo: doc.revisionNo,
    submissionType: doc.submissionType,
    textAnswer: doc.textAnswer ?? null,
    fileKey: doc.fileKey ?? null,
    fileName: doc.fileName ?? null,
    mimeType: doc.mimeType ?? null,
    repositoryUrl: doc.repositoryUrl ?? null,
    editorUrl: doc.editorUrl ?? null,
    resourceVersion: doc.resourceVersion ?? null,
    submittedAt: doc.submittedAt,
    status: doc.status,
    score: doc.score ?? null,
    rubricScores: (doc.rubricScores ?? []).map((item) => ({ ...item })),
    feedback: doc.feedback ?? null,
    reviewedBy: doc.reviewedBy ? doc.reviewedBy.toString() : null,
    reviewedAt: doc.reviewedAt ?? null,
    idempotencyKey: doc.idempotencyKey,
    bodyHash: doc.bodyHash,
  };
}

export function createMongoSubmissionRepository(): SubmissionRepository {
  return {
    async listForRecipient(recipientId) {
      if (!mongoose.isValidObjectId(recipientId)) {
        return [];
      }
      const docs = await RevisionModel.find({ recipientId }).sort({ revisionNo: 1 }).lean();
      return docs.map((doc) => toRevision(doc));
    },
    async findById(id) {
      if (!mongoose.isValidObjectId(id)) {
        return null;
      }
      const doc = await RevisionModel.findById(id).lean();
      return doc ? toRevision(doc) : null;
    },
    async findByKey(recipientId, idempotencyKey) {
      if (!mongoose.isValidObjectId(recipientId)) {
        return null;
      }
      const doc = await RevisionModel.findOne({ recipientId, idempotencyKey }).lean();
      return doc ? toRevision(doc) : null;
    },
    async insert(input) {
      try {
        const doc = await RevisionModel.create({
          ...input,
          status: "PENDING",
          score: null,
          rubricScores: [],
          feedback: null,
          reviewedBy: null,
          reviewedAt: null,
        });
        return { kind: "created", revision: toRevision(doc) };
      } catch (error) {
        const field = duplicateField(error);
        if (!field) {
          throw error;
        }
        if (field === "key") {
          const existing = await RevisionModel.findOne({
            recipientId: input.recipientId,
            idempotencyKey: input.idempotencyKey,
          }).lean();
          return { kind: "duplicate", field, revision: existing ? toRevision(existing) : null };
        }
        return { kind: "duplicate", field, revision: null };
      }
    },
    async markReviewed(id, patch) {
      if (!mongoose.isValidObjectId(id)) {
        return null;
      }
      const doc = await RevisionModel.findOneAndUpdate({ _id: id, status: "PENDING" }, { $set: patch }, { new: true }).lean();
      if (doc) {
        return toRevision(doc);
      }
      const current = await RevisionModel.findById(id).lean();
      return current ? "stale" : null;
    },
    async revertReview(id) {
      if (!mongoose.isValidObjectId(id)) {
        return;
      }
      await RevisionModel.updateOne(
        { _id: id },
        { $set: { status: "PENDING", score: null, rubricScores: [], feedback: null, reviewedBy: null, reviewedAt: null } },
      );
    },
    async remove(id) {
      if (!mongoose.isValidObjectId(id)) {
        return;
      }
      await RevisionModel.deleteOne({ _id: id });
    },
  };
}
