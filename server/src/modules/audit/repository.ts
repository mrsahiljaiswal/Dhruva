import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import type { AuditRecord } from "./subscriber.js";
import { AuditLog } from "./model.js";

export type StoredAudit = AuditRecord & {
  id: string;
  createdAt: Date;
};

export type AuditQuery = {
  actorId?: string;
  action?: string;
  subjectType?: string;
  subjectId?: string;
  from?: Date;
  to?: Date;
  page: number;
  limit: number;
};

export interface AuditLogRepository {
  write(record: AuditRecord): Promise<void>;
  query(filter: AuditQuery): Promise<{ rows: StoredAudit[]; total: number }>;
  history(subjectType: string, subjectId: string): Promise<StoredAudit[]>;
}

function clone(row: StoredAudit): StoredAudit {
  return {
    ...row,
    before: row.before ? { ...row.before } : null,
    after: row.after ? { ...row.after } : null,
    createdAt: new Date(row.createdAt),
  };
}

export function createMemoryAuditLogRepository(): AuditLogRepository {
  const rows: StoredAudit[] = [];
  return {
    async write(record) {
      rows.push({
        ...record,
        before: record.before ? { ...record.before } : null,
        after: record.after ? { ...record.after } : null,
        id: randomUUID(),
        createdAt: new Date(),
      });
    },
    async query(filter) {
      const matched = rows.filter((row) => {
        if (filter.actorId && row.actorId !== filter.actorId) return false;
        if (filter.action && row.action !== filter.action) return false;
        if (filter.subjectType && row.subjectType !== filter.subjectType) return false;
        if (filter.subjectId && row.subjectId !== filter.subjectId) return false;
        if (filter.from && row.createdAt.getTime() < filter.from.getTime()) return false;
        if (filter.to && row.createdAt.getTime() > filter.to.getTime()) return false;
        return true;
      });
      matched.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
      const start = (filter.page - 1) * filter.limit;
      return { rows: matched.slice(start, start + filter.limit).map(clone), total: matched.length };
    },
    async history(subjectType, subjectId) {
      return rows
        .filter((row) => row.subjectType === subjectType && row.subjectId === subjectId)
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
        .slice(0, 200)
        .map(clone);
    },
  };
}

type AuditDoc = {
  _id: mongoose.Types.ObjectId;
  actorId?: mongoose.Types.ObjectId | null;
  action: string;
  subjectType: string;
  subjectId?: mongoose.Types.ObjectId | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
  requestId?: string | null;
  ip?: string | null;
  createdAt: Date;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toStored(doc: AuditDoc): StoredAudit {
  return {
    id: doc._id.toString(),
    action: doc.action,
    actorId: doc.actorId ? doc.actorId.toString() : null,
    subjectType: doc.subjectType,
    subjectId: doc.subjectId ? doc.subjectId.toString() : null,
    before: asObject(doc.before),
    after: asObject(doc.after),
    reason: doc.reason ?? null,
    requestId: doc.requestId ?? null,
    ip: doc.ip ?? null,
    createdAt: doc.createdAt,
  };
}

function objectId(value: string | undefined): mongoose.Types.ObjectId | null | undefined {
  if (!value) {
    return undefined;
  }
  if (!mongoose.isValidObjectId(value)) {
    return null;
  }
  return new mongoose.Types.ObjectId(value);
}

export function createMongoAuditLogRepository(): AuditLogRepository {
  return {
    async write(record) {
      await AuditLog.create({
        ...record,
        actorId: record.actorId && mongoose.isValidObjectId(record.actorId) ? record.actorId : null,
        subjectId: record.subjectId && mongoose.isValidObjectId(record.subjectId) ? record.subjectId : null,
        createdAt: new Date(),
      });
    },
    async query(filter) {
      const actorId = objectId(filter.actorId);
      const subjectId = objectId(filter.subjectId);
      if (actorId === null || subjectId === null) {
        return { rows: [], total: 0 };
      }
      const query: Record<string, unknown> = {};
      if (actorId) query.actorId = actorId;
      if (filter.action) query.action = filter.action;
      if (filter.subjectType) query.subjectType = filter.subjectType;
      if (subjectId) query.subjectId = subjectId;
      if (filter.from || filter.to) {
        const createdAt: Record<string, Date> = {};
        if (filter.from) createdAt.$gte = filter.from;
        if (filter.to) createdAt.$lte = filter.to;
        query.createdAt = createdAt;
      }
      const total = await AuditLog.countDocuments(query);
      const docs = await AuditLog.find(query)
        .sort({ createdAt: -1 })
        .skip((filter.page - 1) * filter.limit)
        .limit(filter.limit)
        .lean<AuditDoc[]>();
      return { rows: docs.map(toStored), total };
    },
    async history(subjectType, subjectId) {
      const id = objectId(subjectId);
      if (!id) {
        return [];
      }
      const docs = await AuditLog.find({ subjectType, subjectId: id }).sort({ createdAt: -1 }).limit(200).lean<AuditDoc[]>();
      return docs.map(toStored);
    },
  };
}
