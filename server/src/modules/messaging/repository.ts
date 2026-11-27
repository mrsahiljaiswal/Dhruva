import type { ConversationPurpose, ConversationType } from "@dhruva/shared";
import { randomUUID } from "node:crypto";
import mongoose, { Schema } from "mongoose";

export type MessageAttachmentRecord = {
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

export type ReadReceipt = {
  userId: string;
  readAt: Date;
};

export type ConversationRecord = {
  id: string;
  type: ConversationType;
  purpose: ConversationPurpose;
  participantIds: string[];
  pairKey: string | null;
  title: string | null;
  createdBy: string;
  lastMessageAt: Date | null;
  createdAt: Date;
};

export type NewConversation = {
  type: ConversationType;
  purpose: ConversationPurpose;
  participantIds: string[];
  pairKey: string | null;
  title: string | null;
  createdBy: string;
  createdAt: Date;
};

export type MessageRecord = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  attachments: MessageAttachmentRecord[];
  sentAt: Date;
  readBy: ReadReceipt[];
  deletedAt: Date | null;
};

export type NewMessage = {
  conversationId: string;
  senderId: string;
  body: string;
  attachments: MessageAttachmentRecord[];
  sentAt: Date;
};

export interface MessagingRepository {
  findById(id: string): Promise<ConversationRecord | null>;
  findDirect(pairKey: string): Promise<ConversationRecord | null>;
  listForParticipant(userId: string): Promise<ConversationRecord[]>;
  insert(input: NewConversation): Promise<{ conversation: ConversationRecord; created: boolean }>;
  touch(id: string, lastMessageAt: Date): Promise<void>;
  insertMessage(input: NewMessage): Promise<MessageRecord>;
  listMessages(conversationId: string, page: number, limit: number): Promise<{ rows: MessageRecord[]; total: number }>;
  findMessage(id: string): Promise<MessageRecord | null>;
  findMessageById(id: string): Promise<MessageRecord | null>;
  hideMessage(id: string, deletedAt: Date): Promise<MessageRecord | null>;
  markRead(conversationId: string, userId: string, upTo: Date, readAt: Date): Promise<void>;
  unreadCount(conversationId: string, userId: string): Promise<number>;
}

function cloneConversation(record: ConversationRecord): ConversationRecord {
  return { ...record, participantIds: [...record.participantIds] };
}

function cloneMessage(record: MessageRecord): MessageRecord {
  return {
    ...record,
    attachments: record.attachments.map((item) => ({ ...item })),
    readBy: record.readBy.map((item) => ({ ...item })),
  };
}

export function createMemoryMessagingRepository(): MessagingRepository {
  const conversations = new Map<string, ConversationRecord>();
  const messages: MessageRecord[] = [];

  return {
    async findById(id) {
      const found = conversations.get(id);
      return found ? cloneConversation(found) : null;
    },
    async findDirect(pairKey) {
      const found = [...conversations.values()].find((row) => row.pairKey === pairKey);
      return found ? cloneConversation(found) : null;
    },
    async listForParticipant(userId) {
      return [...conversations.values()]
        .filter((row) => row.participantIds.includes(userId))
        .sort((left, right) => (right.lastMessageAt?.getTime() ?? 0) - (left.lastMessageAt?.getTime() ?? 0))
        .map(cloneConversation);
    },
    async insert(input) {
      if (input.pairKey) {
        const existing = [...conversations.values()].find((row) => row.pairKey === input.pairKey);
        if (existing) {
          return { conversation: cloneConversation(existing), created: false };
        }
      }
      const record: ConversationRecord = {
        ...input,
        participantIds: [...input.participantIds],
        id: randomUUID(),
        lastMessageAt: null,
      };
      conversations.set(record.id, record);
      return { conversation: cloneConversation(record), created: true };
    },
    async touch(id, lastMessageAt) {
      const current = conversations.get(id);
      if (current) {
        current.lastMessageAt = lastMessageAt;
      }
    },
    async insertMessage(input) {
      const record: MessageRecord = {
        ...input,
        attachments: input.attachments.map((item) => ({ ...item })),
        id: randomUUID(),
        readBy: [{ userId: input.senderId, readAt: input.sentAt }],
        deletedAt: null,
      };
      messages.push(record);
      return cloneMessage(record);
    },
    async listMessages(conversationId, page, limit) {
      const visible = messages
        .filter((row) => row.conversationId === conversationId && !row.deletedAt)
        .sort((left, right) => right.sentAt.getTime() - left.sentAt.getTime());
      const start = (page - 1) * limit;
      return { rows: visible.slice(start, start + limit).map(cloneMessage), total: visible.length };
    },
    async findMessage(id) {
      const found = messages.find((row) => row.id === id && !row.deletedAt);
      return found ? cloneMessage(found) : null;
    },
    async findMessageById(id) {
      const found = messages.find((row) => row.id === id);
      return found ? cloneMessage(found) : null;
    },
    async hideMessage(id, deletedAt) {
      const found = messages.find((row) => row.id === id);
      if (!found) {
        return null;
      }
      found.deletedAt = new Date(deletedAt);
      return cloneMessage(found);
    },
    async markRead(conversationId, userId, upTo, readAt) {
      for (const row of messages) {
        if (row.conversationId !== conversationId || row.deletedAt || row.sentAt.getTime() > upTo.getTime()) {
          continue;
        }
        if (!row.readBy.some((receipt) => receipt.userId === userId)) {
          row.readBy.push({ userId, readAt });
        }
      }
    },
    async unreadCount(conversationId, userId) {
      return messages.filter(
        (row) =>
          row.conversationId === conversationId &&
          !row.deletedAt &&
          row.senderId !== userId &&
          !row.readBy.some((receipt) => receipt.userId === userId),
      ).length;
    },
  };
}

const conversationSchema = new Schema(
  {
    type: { type: String, required: true, enum: ["DIRECT", "GROUP"] },
    purpose: { type: String, required: true, enum: ["MENTORSHIP", "PEER", "GROUP"] },
    participantIds: { type: [Schema.Types.ObjectId], required: true },
    pairKey: { type: String, default: null },
    title: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    lastMessageAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

conversationSchema.index({ participantIds: 1, lastMessageAt: -1 });
conversationSchema.index({ pairKey: 1 }, { unique: true, partialFilterExpression: { pairKey: { $type: "string" } } });

const messageSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, required: true },
    senderId: { type: Schema.Types.ObjectId, required: true },
    body: { type: String, required: true },
    attachments: {
      type: [
        {
          storageKey: String,
          fileName: String,
          mimeType: String,
          sizeBytes: Number,
        },
      ],
      default: [],
    },
    sentAt: { type: Date, required: true },
    readBy: {
      type: [{ userId: Schema.Types.ObjectId, readAt: Date }],
      default: [],
    },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: false },
);

messageSchema.index({ conversationId: 1, sentAt: -1 });

type ConversationDoc = {
  _id: { toString(): string };
  type: ConversationType;
  purpose: ConversationPurpose;
  participantIds: { toString(): string }[];
  pairKey?: string | null;
  title?: string | null;
  createdBy: { toString(): string };
  lastMessageAt?: Date | null;
  createdAt: Date;
};

type MessageDoc = {
  _id: { toString(): string };
  conversationId: { toString(): string };
  senderId: { toString(): string };
  body: string;
  attachments?: MessageAttachmentRecord[];
  sentAt: Date;
  readBy?: { userId: { toString(): string }; readAt: Date }[];
  deletedAt?: Date | null;
};

const ConversationModel = (mongoose.models.Conversation ??
  mongoose.model("Conversation", conversationSchema)) as mongoose.Model<ConversationDoc>;
const MessageModel = (mongoose.models.Message ?? mongoose.model("Message", messageSchema)) as mongoose.Model<MessageDoc>;

function toConversation(doc: ConversationDoc): ConversationRecord {
  return {
    id: doc._id.toString(),
    type: doc.type,
    purpose: doc.purpose,
    participantIds: doc.participantIds.map((id) => id.toString()),
    pairKey: doc.pairKey ?? null,
    title: doc.title ?? null,
    createdBy: doc.createdBy.toString(),
    lastMessageAt: doc.lastMessageAt ?? null,
    createdAt: doc.createdAt,
  };
}

function toMessage(doc: MessageDoc): MessageRecord {
  return {
    id: doc._id.toString(),
    conversationId: doc.conversationId.toString(),
    senderId: doc.senderId.toString(),
    body: doc.body,
    attachments: (doc.attachments ?? []).map((item) => ({ ...item })),
    sentAt: doc.sentAt,
    readBy: (doc.readBy ?? []).map((item) => ({ userId: item.userId.toString(), readAt: item.readAt })),
    deletedAt: doc.deletedAt ?? null,
  };
}

function isDuplicate(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

export function createMongoMessagingRepository(): MessagingRepository {
  return {
    async findById(id) {
      if (!mongoose.isValidObjectId(id)) {
        return null;
      }
      const doc = await ConversationModel.findById(id).lean();
      return doc ? toConversation(doc) : null;
    },
    async findDirect(pairKey) {
      const doc = await ConversationModel.findOne({ pairKey }).lean();
      return doc ? toConversation(doc) : null;
    },
    async listForParticipant(userId) {
      if (!mongoose.isValidObjectId(userId)) {
        return [];
      }
      const docs = await ConversationModel.find({ participantIds: userId }).sort({ lastMessageAt: -1 }).lean();
      return docs.map((doc) => toConversation(doc));
    },
    async insert(input) {
      try {
        const doc = await ConversationModel.create(input);
        return { conversation: toConversation(doc), created: true };
      } catch (error) {
        if (isDuplicate(error) && input.pairKey) {
          const existing = await ConversationModel.findOne({ pairKey: input.pairKey }).lean();
          if (existing) {
            return { conversation: toConversation(existing), created: false };
          }
        }
        throw error;
      }
    },
    async touch(id, lastMessageAt) {
      if (!mongoose.isValidObjectId(id)) {
        return;
      }
      await ConversationModel.updateOne({ _id: id }, { $set: { lastMessageAt } });
    },
    async insertMessage(input) {
      const doc = await MessageModel.create({
        ...input,
        readBy: [{ userId: input.senderId, readAt: input.sentAt }],
        deletedAt: null,
      });
      return toMessage(doc);
    },
    async listMessages(conversationId, page, limit) {
      if (!mongoose.isValidObjectId(conversationId)) {
        return { rows: [], total: 0 };
      }
      const filter = { conversationId, deletedAt: null };
      const [docs, total] = await Promise.all([
        MessageModel.find(filter)
          .sort({ sentAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        MessageModel.countDocuments(filter),
      ]);
      return { rows: docs.map((doc) => toMessage(doc)), total };
    },
    async findMessage(id) {
      if (!mongoose.isValidObjectId(id)) {
        return null;
      }
      const doc = await MessageModel.findOne({ _id: id, deletedAt: null }).lean();
      return doc ? toMessage(doc) : null;
    },
    async findMessageById(id) {
      if (!mongoose.isValidObjectId(id)) {
        return null;
      }
      const doc = await MessageModel.findById(id).lean();
      return doc ? toMessage(doc) : null;
    },
    async hideMessage(id, deletedAt) {
      if (!mongoose.isValidObjectId(id)) {
        return null;
      }
      const doc = await MessageModel.findByIdAndUpdate(id, { $set: { deletedAt } }, { new: true }).lean();
      return doc ? toMessage(doc) : null;
    },
    async markRead(conversationId, userId, upTo, readAt) {
      if (!mongoose.isValidObjectId(conversationId) || !mongoose.isValidObjectId(userId)) {
        return;
      }
      await MessageModel.updateMany(
        {
          conversationId,
          deletedAt: null,
          sentAt: { $lte: upTo },
          "readBy.userId": { $ne: userId },
        },
        { $push: { readBy: { userId, readAt } } },
      );
    },
    async unreadCount(conversationId, userId) {
      if (!mongoose.isValidObjectId(conversationId) || !mongoose.isValidObjectId(userId)) {
        return 0;
      }
      return MessageModel.countDocuments({
        conversationId,
        deletedAt: null,
        senderId: { $ne: userId },
        "readBy.userId": { $ne: userId },
      });
    },
  };
}
