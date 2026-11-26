import type { NotificationType } from "@dhruva/shared";
import { randomUUID } from "node:crypto";
import mongoose, { Schema } from "mongoose";

export type NotificationRecord = {
  id: string;
  userId: string;
  type: NotificationType;
  text: string;
  payload: Record<string, string>;
  dedupeKey: string | null;
  readAt: Date | null;
  createdAt: Date;
  emailSentAt: Date | null;
};

export type NewNotification = {
  userId: string;
  type: NotificationType;
  text: string;
  payload: Record<string, string>;
  dedupeKey: string | null;
  createdAt: Date;
};

export interface NotificationRepository {
  insert(input: NewNotification): Promise<NotificationRecord | null>;
  listForUser(userId: string, limit: number): Promise<{ rows: NotificationRecord[]; unread: number }>;
  markRead(userId: string, id: string, readAt: Date): Promise<NotificationRecord | null>;
  markAllRead(userId: string, readAt: Date): Promise<number>;
  markEmailed(id: string, sentAt: Date): Promise<void>;
}

function dedupeKeyOf(input: NewNotification): string | null {
  return input.dedupeKey;
}

export function createMemoryNotificationRepository(): NotificationRepository {
  const rows: NotificationRecord[] = [];
  return {
    async insert(input) {
      const key = dedupeKeyOf(input);
      if (key && rows.some((row) => row.userId === input.userId && row.type === input.type && row.dedupeKey === key)) {
        return null;
      }
      const record: NotificationRecord = {
        ...input,
        payload: { ...input.payload },
        id: randomUUID(),
        readAt: null,
        emailSentAt: null,
      };
      rows.push(record);
      return { ...record, payload: { ...record.payload } };
    },
    async listForUser(userId, limit) {
      const mine = rows
        .filter((row) => row.userId === userId)
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
      return {
        rows: mine.slice(0, limit).map((row) => ({ ...row, payload: { ...row.payload } })),
        unread: mine.filter((row) => !row.readAt).length,
      };
    },
    async markRead(userId, id, readAt) {
      const row = rows.find((item) => item.id === id && item.userId === userId);
      if (!row) {
        return null;
      }
      if (!row.readAt) {
        row.readAt = readAt;
      }
      return { ...row, payload: { ...row.payload } };
    },
    async markAllRead(userId, readAt) {
      let count = 0;
      for (const row of rows) {
        if (row.userId === userId && !row.readAt) {
          row.readAt = readAt;
          count += 1;
        }
      }
      return count;
    },
    async markEmailed(id, sentAt) {
      const row = rows.find((item) => item.id === id);
      if (row) {
        row.emailSentAt = sentAt;
      }
    },
  };
}

const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    type: { type: String, required: true },
    text: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    dedupeKey: { type: String, default: null },
    readAt: { type: Date, default: null },
    emailSentAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

notificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
notificationSchema.index(
  { userId: 1, type: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } },
);

type NotificationDoc = {
  _id: { toString(): string };
  userId: { toString(): string };
  type: NotificationType;
  text: string;
  payload?: Record<string, string> | null;
  dedupeKey?: string | null;
  readAt?: Date | null;
  createdAt: Date;
  emailSentAt?: Date | null;
};

const NotificationModel = (mongoose.models.Notification ??
  mongoose.model("Notification", notificationSchema)) as mongoose.Model<NotificationDoc>;

function toRecord(doc: NotificationDoc): NotificationRecord {
  const payload: Record<string, string> = {};
  for (const [key, value] of Object.entries(doc.payload ?? {})) {
    if (typeof value === "string") {
      payload[key] = value;
    }
  }
  return {
    id: doc._id.toString(),
    userId: doc.userId.toString(),
    type: doc.type,
    text: doc.text,
    payload,
    dedupeKey: doc.dedupeKey ?? null,
    readAt: doc.readAt ?? null,
    createdAt: doc.createdAt,
    emailSentAt: doc.emailSentAt ?? null,
  };
}

function isDuplicate(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

export function createMongoNotificationRepository(): NotificationRepository {
  return {
    async insert(input) {
      try {
        const doc = await NotificationModel.create({
          ...input,
          userId: input.userId,
        });
        return toRecord(doc);
      } catch (error) {
        if (isDuplicate(error)) {
          return null;
        }
        throw error;
      }
    },
    async listForUser(userId, limit) {
      if (!mongoose.isValidObjectId(userId)) {
        return { rows: [], unread: 0 };
      }
      const [docs, unread] = await Promise.all([
        NotificationModel.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean(),
        NotificationModel.countDocuments({ userId, readAt: null }),
      ]);
      return { rows: docs.map((doc) => toRecord(doc)), unread };
    },
    async markRead(userId, id, readAt) {
      if (!mongoose.isValidObjectId(userId) || !mongoose.isValidObjectId(id)) {
        return null;
      }
      const updated = await NotificationModel.findOneAndUpdate(
        { _id: id, userId, readAt: null },
        { $set: { readAt } },
        { new: true },
      ).lean();
      if (updated) {
        return toRecord(updated);
      }
      const existing = await NotificationModel.findOne({ _id: id, userId }).lean();
      return existing ? toRecord(existing) : null;
    },
    async markAllRead(userId, readAt) {
      if (!mongoose.isValidObjectId(userId)) {
        return 0;
      }
      const result = await NotificationModel.updateMany({ userId, readAt: null }, { $set: { readAt } });
      return result.modifiedCount;
    },
    async markEmailed(id, sentAt) {
      if (!mongoose.isValidObjectId(id)) {
        return;
      }
      await NotificationModel.updateOne({ _id: id }, { $set: { emailSentAt: sentAt } });
    },
  };
}
