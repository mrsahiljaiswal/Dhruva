import type { AnnouncementAudience, AnnouncementStatus } from "@dhruva/shared";
import { randomUUID } from "node:crypto";
import mongoose, { Schema } from "mongoose";

export type AnnouncementRecord = {
  id: string;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  targetIds: string[];
  publishAt: Date;
  expiresAt: Date | null;
  createdBy: string;
  status: AnnouncementStatus;
  createdAt: Date;
};

export type NewAnnouncement = Omit<AnnouncementRecord, "id">;

export type AnnouncementPatch = Partial<
  Pick<AnnouncementRecord, "title" | "body" | "audience" | "targetIds" | "publishAt" | "expiresAt" | "status">
>;

export interface AnnouncementRepository {
  insert(input: NewAnnouncement): Promise<AnnouncementRecord>;
  findById(id: string): Promise<AnnouncementRecord | null>;
  list(): Promise<AnnouncementRecord[]>;
  update(id: string, patch: AnnouncementPatch): Promise<AnnouncementRecord | null>;
  dueToPublish(now: Date): Promise<AnnouncementRecord[]>;
  dueToExpire(now: Date): Promise<AnnouncementRecord[]>;
  claimPublish(id: string, now: Date): Promise<AnnouncementRecord | null>;
  claimExpire(id: string, now: Date): Promise<AnnouncementRecord | null>;
}

function clone(row: AnnouncementRecord): AnnouncementRecord {
  return {
    ...row,
    targetIds: [...row.targetIds],
    publishAt: new Date(row.publishAt),
    expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
    createdAt: new Date(row.createdAt),
  };
}

export function createMemoryAnnouncementRepository(): AnnouncementRepository {
  const rows: AnnouncementRecord[] = [];
  return {
    async insert(input) {
      const row: AnnouncementRecord = { ...input, id: randomUUID(), targetIds: [...input.targetIds] };
      rows.push(row);
      return clone(row);
    },
    async findById(id) {
      const row = rows.find((item) => item.id === id);
      return row ? clone(row) : null;
    },
    async list() {
      return rows.map(clone).sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
    },
    async update(id, patch) {
      const row = rows.find((item) => item.id === id);
      if (!row) {
        return null;
      }
      if (patch.title !== undefined) row.title = patch.title;
      if (patch.body !== undefined) row.body = patch.body;
      if (patch.audience !== undefined) row.audience = patch.audience;
      if (patch.targetIds !== undefined) row.targetIds = [...patch.targetIds];
      if (patch.publishAt !== undefined) row.publishAt = new Date(patch.publishAt);
      if (patch.expiresAt !== undefined) row.expiresAt = patch.expiresAt ? new Date(patch.expiresAt) : null;
      if (patch.status !== undefined) row.status = patch.status;
      return clone(row);
    },
    async dueToPublish(now) {
      return rows.filter((row) => row.status === "SCHEDULED" && row.publishAt.getTime() <= now.getTime()).map(clone);
    },
    async dueToExpire(now) {
      return rows
        .filter((row) => row.status === "PUBLISHED" && row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime())
        .map(clone);
    },
    async claimPublish(id, now) {
      const row = rows.find((item) => item.id === id && item.status === "SCHEDULED" && item.publishAt.getTime() <= now.getTime());
      if (!row) {
        return null;
      }
      row.status = "PUBLISHED";
      return clone(row);
    },
    async claimExpire(id, now) {
      const row = rows.find(
        (item) => item.id === id && item.status === "PUBLISHED" && item.expiresAt !== null && item.expiresAt.getTime() <= now.getTime(),
      );
      if (!row) {
        return null;
      }
      row.status = "EXPIRED";
      return clone(row);
    },
  };
}

type AnnouncementDoc = {
  _id: mongoose.Types.ObjectId;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  targetIds: string[];
  publishAt: Date;
  expiresAt?: Date | null;
  createdBy: mongoose.Types.ObjectId;
  status: AnnouncementStatus;
  createdAt: Date;
};

const announcementSchema = new Schema(
  {
    title: { type: String, required: true },
    body: { type: String, required: true },
    audience: { type: String, required: true, enum: ["ALL", "COHORT", "BRANCH", "MENTOR_GROUP"] },
    targetIds: { type: [String], required: true, default: [] },
    publishAt: { type: Date, required: true },
    expiresAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, required: true, enum: ["SCHEDULED", "PUBLISHED", "EXPIRED"] },
    createdAt: { type: Date, required: true },
  },
  { versionKey: false, timestamps: false },
);
announcementSchema.index({ status: 1, publishAt: 1 });

const AnnouncementModel = (mongoose.models.Announcement ??
  mongoose.model("Announcement", announcementSchema)) as mongoose.Model<AnnouncementDoc>;

function toRecord(doc: AnnouncementDoc): AnnouncementRecord {
  return {
    id: doc._id.toString(),
    title: doc.title,
    body: doc.body,
    audience: doc.audience,
    targetIds: doc.targetIds ?? [],
    publishAt: doc.publishAt,
    expiresAt: doc.expiresAt ?? null,
    createdBy: doc.createdBy.toString(),
    status: doc.status,
    createdAt: doc.createdAt,
  };
}

export function createMongoAnnouncementRepository(): AnnouncementRepository {
  return {
    async insert(input) {
      const doc = await AnnouncementModel.create(input);
      return toRecord(doc.toObject() as AnnouncementDoc);
    },
    async findById(id) {
      if (!mongoose.isValidObjectId(id)) {
        return null;
      }
      const doc = await AnnouncementModel.findById(id).lean<AnnouncementDoc | null>();
      return doc ? toRecord(doc) : null;
    },
    async list() {
      const docs = await AnnouncementModel.find().sort({ createdAt: -1 }).lean<AnnouncementDoc[]>();
      return docs.map(toRecord);
    },
    async update(id, patch) {
      if (!mongoose.isValidObjectId(id)) {
        return null;
      }
      const doc = await AnnouncementModel.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean<AnnouncementDoc | null>();
      return doc ? toRecord(doc) : null;
    },
    async dueToPublish(now) {
      const docs = await AnnouncementModel.find({ status: "SCHEDULED", publishAt: { $lte: now } }).lean<AnnouncementDoc[]>();
      return docs.map(toRecord);
    },
    async dueToExpire(now) {
      const docs = await AnnouncementModel.find({
        status: "PUBLISHED",
        expiresAt: { $ne: null, $lte: now },
      }).lean<AnnouncementDoc[]>();
      return docs.map(toRecord);
    },
    async claimPublish(id, now) {
      if (!mongoose.isValidObjectId(id)) {
        return null;
      }
      const doc = await AnnouncementModel.findOneAndUpdate(
        { _id: id, status: "SCHEDULED", publishAt: { $lte: now } },
        { $set: { status: "PUBLISHED" } },
        { new: true },
      ).lean<AnnouncementDoc | null>();
      return doc ? toRecord(doc) : null;
    },
    async claimExpire(id, now) {
      if (!mongoose.isValidObjectId(id)) {
        return null;
      }
      const doc = await AnnouncementModel.findOneAndUpdate(
        { _id: id, status: "PUBLISHED", expiresAt: { $ne: null, $lte: now } },
        { $set: { status: "EXPIRED" } },
        { new: true },
      ).lean<AnnouncementDoc | null>();
      return doc ? toRecord(doc) : null;
    },
  };
}
