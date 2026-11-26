import type {
  DiscussionCategory,
  DiscussionFilter,
  DiscussionScope,
  DiscussionStatus,
  ReactionKind,
  ReactionTarget,
  ReportStatus,
  ReportTarget,
} from "@dhruva/shared";
import { randomUUID } from "node:crypto";
import mongoose, { Schema, type Types } from "mongoose";

export type PostRecord = {
  id: string;
  scope: DiscussionScope;
  resourceId: string | null;
  category: DiscussionCategory | null;
  authorId: string;
  title: string;
  body: string;
  codeSnippet: string | null;
  status: DiscussionStatus;
  acceptedCommentId: string | null;
  highlighted: boolean;
  replyCount: number;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type NewPost = {
  scope: DiscussionScope;
  resourceId: string | null;
  category: DiscussionCategory | null;
  authorId: string;
  title: string;
  body: string;
  codeSnippet: string | null;
  createdAt: Date;
};

export type PostPatch = {
  acceptedCommentId?: string | null;
  status?: DiscussionStatus;
  highlighted?: boolean;
  updatedAt: Date;
};

export type PostQuery = {
  scope: DiscussionScope;
  resourceId?: string;
  category?: DiscussionCategory;
  status?: DiscussionFilter;
  q?: string;
  page: number;
  limit: number;
};

export type CommentRecord = {
  id: string;
  postId: string;
  parentCommentId: string | null;
  authorId: string;
  body: string;
  deletedAt: Date | null;
  createdAt: Date;
};

export type NewComment = {
  postId: string;
  parentCommentId: string | null;
  authorId: string;
  body: string;
  createdAt: Date;
};

export type ReactionRecord = {
  id: string;
  targetType: ReactionTarget;
  targetId: string;
  userId: string;
  kind: ReactionKind;
};

export type ReportRecord = {
  id: string;
  targetType: ReportTarget | "MESSAGE";
  targetId: string;
  reportedBy: string;
  reason: string;
  status: ReportStatus;
  resolution: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
};

export type NewReport = {
  targetType: ReportTarget;
  targetId: string;
  reportedBy: string;
  reason: string;
  createdAt: Date;
};

export type StoredReport = { report: ReportRecord; created: boolean };

export interface DiscussionRepository {
  insertPost(input: NewPost): Promise<PostRecord>;
  listPosts(query: PostQuery): Promise<{ rows: PostRecord[]; total: number }>;
  findPost(id: string): Promise<PostRecord | null>;
  updatePost(id: string, patch: PostPatch): Promise<PostRecord | null>;
  incrementReplyCount(id: string, updatedAt: Date): Promise<void>;
  insertComment(input: NewComment): Promise<CommentRecord>;
  listComments(postId: string): Promise<CommentRecord[]>;
  findComment(id: string): Promise<CommentRecord | null>;
  listReactions(targetType: ReactionTarget, targetIds: string[]): Promise<ReactionRecord[]>;
  toggleReaction(input: Omit<ReactionRecord, "id">): Promise<boolean>;
  insertReport(input: NewReport): Promise<StoredReport>;
}

export function searchTerms(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((term) => term.length > 0);
}

function matchesPost(post: PostRecord, query: PostQuery): boolean {
  if (post.deletedAt || post.scope !== query.scope) {
    return false;
  }
  if (query.resourceId && post.resourceId !== query.resourceId) {
    return false;
  }
  if (query.category && post.category !== query.category) {
    return false;
  }
  if ((query.status === "OPEN" || query.status === "RESOLVED") && post.status !== query.status) {
    return false;
  }
  if (query.status === "UNANSWERED" && (post.status !== "OPEN" || post.acceptedCommentId)) {
    return false;
  }
  if (query.q) {
    const terms = searchTerms(query.q);
    if (terms.length === 0) {
      return false;
    }
    const haystack = `${post.title}\n${post.body}`.toLowerCase();
    if (!terms.every((term) => haystack.includes(term))) {
      return false;
    }
  }
  return true;
}

function byListing(left: PostRecord, right: PostRecord): number {
  if (left.highlighted !== right.highlighted) {
    return left.highlighted ? -1 : 1;
  }
  return right.createdAt.getTime() - left.createdAt.getTime();
}

function clonePost(row: PostRecord): PostRecord {
  return {
    ...row,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    deletedAt: row.deletedAt ? new Date(row.deletedAt) : null,
  };
}

function cloneComment(row: CommentRecord): CommentRecord {
  return {
    ...row,
    createdAt: new Date(row.createdAt),
    deletedAt: row.deletedAt ? new Date(row.deletedAt) : null,
  };
}

function cloneReport(row: ReportRecord): ReportRecord {
  return {
    ...row,
    createdAt: new Date(row.createdAt),
    resolvedAt: row.resolvedAt ? new Date(row.resolvedAt) : null,
  };
}

export function createMemoryDiscussionRepository(): DiscussionRepository {
  const posts: PostRecord[] = [];
  const comments: CommentRecord[] = [];
  const reactions: ReactionRecord[] = [];
  const reports: ReportRecord[] = [];

  return {
    async insertPost(input) {
      const row: PostRecord = {
        ...input,
        id: randomUUID(),
        status: "OPEN",
        acceptedCommentId: null,
        highlighted: false,
        replyCount: 0,
        deletedAt: null,
        updatedAt: new Date(input.createdAt),
      };
      posts.push(row);
      return clonePost(row);
    },
    async listPosts(query) {
      const rows = posts.filter((post) => matchesPost(post, query)).sort(byListing);
      const start = (query.page - 1) * query.limit;
      return { rows: rows.slice(start, start + query.limit).map(clonePost), total: rows.length };
    },
    async findPost(id) {
      const row = posts.find((post) => post.id === id);
      return row ? clonePost(row) : null;
    },
    async updatePost(id, patch) {
      const row = posts.find((post) => post.id === id && !post.deletedAt);
      if (!row) {
        return null;
      }
      if (patch.acceptedCommentId !== undefined) {
        row.acceptedCommentId = patch.acceptedCommentId;
      }
      if (patch.status) {
        row.status = patch.status;
      }
      if (patch.highlighted !== undefined) {
        row.highlighted = patch.highlighted;
      }
      row.updatedAt = new Date(patch.updatedAt);
      return clonePost(row);
    },
    async incrementReplyCount(id, updatedAt) {
      const row = posts.find((post) => post.id === id && !post.deletedAt);
      if (row) {
        row.replyCount += 1;
        row.updatedAt = new Date(updatedAt);
      }
    },
    async insertComment(input) {
      const row: CommentRecord = { ...input, id: randomUUID(), deletedAt: null };
      comments.push(row);
      return cloneComment(row);
    },
    async listComments(postId) {
      return comments
        .filter((comment) => comment.postId === postId && !comment.deletedAt)
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
        .map(cloneComment);
    },
    async findComment(id) {
      const row = comments.find((comment) => comment.id === id);
      return row ? cloneComment(row) : null;
    },
    async listReactions(targetType, targetIds) {
      const ids = new Set(targetIds);
      return reactions
        .filter((reaction) => reaction.targetType === targetType && ids.has(reaction.targetId))
        .map((reaction) => ({ ...reaction }));
    },
    async toggleReaction(input) {
      const index = reactions.findIndex(
        (reaction) =>
          reaction.targetType === input.targetType &&
          reaction.targetId === input.targetId &&
          reaction.userId === input.userId &&
          reaction.kind === input.kind,
      );
      if (index >= 0) {
        reactions.splice(index, 1);
        return false;
      }
      reactions.push({ ...input, id: randomUUID() });
      return true;
    },
    async insertReport(input) {
      const existing = reports.find(
        (report) =>
          report.status === "OPEN" &&
          report.targetType === input.targetType &&
          report.targetId === input.targetId &&
          report.reportedBy === input.reportedBy,
      );
      if (existing) {
        return { report: cloneReport(existing), created: false };
      }
      const row: ReportRecord = {
        ...input,
        id: randomUUID(),
        status: "OPEN",
        resolution: null,
        resolvedBy: null,
        resolvedAt: null,
      };
      reports.push(row);
      return { report: cloneReport(row), created: true };
    },
  };
}

type PostDoc = {
  _id: Types.ObjectId;
  scope: DiscussionScope;
  resourceId?: Types.ObjectId | null;
  category?: DiscussionCategory | null;
  authorId: Types.ObjectId;
  title: string;
  body: string;
  codeSnippet?: string | null;
  status: DiscussionStatus;
  acceptedCommentId?: Types.ObjectId | null;
  highlighted: boolean;
  replyCount: number;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type CommentDoc = {
  _id: Types.ObjectId;
  postId: Types.ObjectId;
  parentCommentId?: Types.ObjectId | null;
  authorId: Types.ObjectId;
  body: string;
  deletedAt?: Date | null;
  createdAt: Date;
};

type ReactionDoc = {
  _id: Types.ObjectId;
  targetType: ReactionTarget;
  targetId: Types.ObjectId;
  userId: Types.ObjectId;
  kind: ReactionKind;
};

type ReportDoc = {
  _id: Types.ObjectId;
  targetType: ReportRecord["targetType"];
  targetId: Types.ObjectId;
  reportedBy: Types.ObjectId;
  reason: string;
  status: ReportStatus;
  resolution?: string | null;
  resolvedBy?: Types.ObjectId | null;
  resolvedAt?: Date | null;
  createdAt: Date;
};

const postSchema = new Schema(
  {
    scope: { type: String, required: true, enum: ["RESOURCE", "FORUM"] },
    resourceId: { type: Schema.Types.ObjectId, default: null },
    category: { type: String, default: null },
    authorId: { type: Schema.Types.ObjectId, required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    codeSnippet: { type: String, default: null },
    status: { type: String, required: true, enum: ["OPEN", "RESOLVED"] },
    acceptedCommentId: { type: Schema.Types.ObjectId, default: null },
    highlighted: { type: Boolean, required: true },
    replyCount: { type: Number, required: true },
    deletedAt: { type: Date, default: null },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { timestamps: false },
);
postSchema.index({ scope: 1, resourceId: 1, createdAt: -1 });
postSchema.index({ category: 1, status: 1, createdAt: -1 });
postSchema.index({ title: "text", body: "text" });

const commentSchema = new Schema(
  {
    postId: { type: Schema.Types.ObjectId, required: true },
    parentCommentId: { type: Schema.Types.ObjectId, default: null },
    authorId: { type: Schema.Types.ObjectId, required: true },
    body: { type: String, required: true },
    deletedAt: { type: Date, default: null },
    createdAt: { type: Date, required: true },
  },
  { timestamps: false },
);
commentSchema.index({ postId: 1, createdAt: 1 });

const reactionSchema = new Schema(
  {
    targetType: { type: String, required: true, enum: ["POST", "COMMENT"] },
    targetId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    kind: { type: String, required: true, enum: ["HELPFUL", "LIKE"] },
  },
  { timestamps: false },
);
reactionSchema.index({ targetType: 1, targetId: 1, userId: 1, kind: 1 }, { unique: true });

const reportSchema = new Schema(
  {
    targetType: { type: String, required: true, enum: ["POST", "COMMENT", "MESSAGE", "USER"] },
    targetId: { type: Schema.Types.ObjectId, required: true },
    reportedBy: { type: Schema.Types.ObjectId, required: true },
    reason: { type: String, required: true },
    status: { type: String, required: true, enum: ["OPEN", "DISMISSED", "ACTION_TAKEN"] },
    resolution: { type: String, default: null },
    resolvedBy: { type: Schema.Types.ObjectId, default: null },
    resolvedAt: { type: Date, default: null },
    createdAt: { type: Date, required: true },
  },
  { timestamps: false },
);
reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index(
  { targetType: 1, targetId: 1, reportedBy: 1 },
  { unique: true, partialFilterExpression: { status: "OPEN" } },
);

const PostModel = mongoose.models.DiscussionPost ?? mongoose.model("DiscussionPost", postSchema);
const CommentModel = mongoose.models.DiscussionComment ?? mongoose.model("DiscussionComment", commentSchema);
const ReactionModel = mongoose.models.DiscussionReaction ?? mongoose.model("DiscussionReaction", reactionSchema);
const ReportModel = mongoose.models.DiscussionReport ?? mongoose.model("DiscussionReport", reportSchema);

function asId(value: string): Types.ObjectId | null {
  return mongoose.isValidObjectId(value) ? new mongoose.Types.ObjectId(value) : null;
}

function isDuplicate(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: number }).code === 11000;
}

function toPost(doc: PostDoc): PostRecord {
  return {
    id: doc._id.toString(),
    scope: doc.scope,
    resourceId: doc.resourceId ? doc.resourceId.toString() : null,
    category: doc.category ?? null,
    authorId: doc.authorId.toString(),
    title: doc.title,
    body: doc.body,
    codeSnippet: doc.codeSnippet ?? null,
    status: doc.status,
    acceptedCommentId: doc.acceptedCommentId ? doc.acceptedCommentId.toString() : null,
    highlighted: doc.highlighted,
    replyCount: doc.replyCount,
    deletedAt: doc.deletedAt ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toComment(doc: CommentDoc): CommentRecord {
  return {
    id: doc._id.toString(),
    postId: doc.postId.toString(),
    parentCommentId: doc.parentCommentId ? doc.parentCommentId.toString() : null,
    authorId: doc.authorId.toString(),
    body: doc.body,
    deletedAt: doc.deletedAt ?? null,
    createdAt: doc.createdAt,
  };
}

function toReaction(doc: ReactionDoc): ReactionRecord {
  return {
    id: doc._id.toString(),
    targetType: doc.targetType,
    targetId: doc.targetId.toString(),
    userId: doc.userId.toString(),
    kind: doc.kind,
  };
}

function toReport(doc: ReportDoc): ReportRecord {
  return {
    id: doc._id.toString(),
    targetType: doc.targetType,
    targetId: doc.targetId.toString(),
    reportedBy: doc.reportedBy.toString(),
    reason: doc.reason,
    status: doc.status,
    resolution: doc.resolution ?? null,
    resolvedBy: doc.resolvedBy ? doc.resolvedBy.toString() : null,
    resolvedAt: doc.resolvedAt ?? null,
    createdAt: doc.createdAt,
  };
}

function mongoFilter(query: PostQuery): Record<string, unknown> | null {
  const filter: Record<string, unknown> = { scope: query.scope, deletedAt: null };
  if (query.resourceId) {
    const resourceId = asId(query.resourceId);
    if (!resourceId) {
      return null;
    }
    filter.resourceId = resourceId;
  }
  if (query.category) {
    filter.category = query.category;
  }
  if (query.status === "OPEN" || query.status === "RESOLVED") {
    filter.status = query.status;
  }
  if (query.status === "UNANSWERED") {
    filter.status = "OPEN";
    filter.acceptedCommentId = null;
  }
  if (query.q) {
    const terms = searchTerms(query.q);
    if (terms.length === 0) {
      return null;
    }
    filter.$text = { $search: terms.join(" ") };
  }
  return filter;
}

export function createMongoDiscussionRepository(): DiscussionRepository {
  return {
    async insertPost(input) {
      const doc = await PostModel.create({
        ...input,
        resourceId: input.resourceId ? asId(input.resourceId) : null,
        authorId: asId(input.authorId),
        status: "OPEN",
        acceptedCommentId: null,
        highlighted: false,
        replyCount: 0,
        deletedAt: null,
        updatedAt: input.createdAt,
      });
      return toPost(doc.toObject() as PostDoc);
    },
    async listPosts(query) {
      const filter = mongoFilter(query);
      if (!filter) {
        return { rows: [], total: 0 };
      }
      const total = await PostModel.countDocuments(filter);
      const docs = await PostModel.find(filter)
        .sort({ highlighted: -1, createdAt: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean<PostDoc[]>();
      return { rows: docs.map(toPost), total };
    },
    async findPost(id) {
      if (!mongoose.isValidObjectId(id)) {
        return null;
      }
      const doc = await PostModel.findById(id).lean<PostDoc | null>();
      return doc ? toPost(doc) : null;
    },
    async updatePost(id, patch) {
      if (!mongoose.isValidObjectId(id)) {
        return null;
      }
      const doc = await PostModel.findOneAndUpdate({ _id: id, deletedAt: null }, { $set: patch }, { new: true }).lean<PostDoc | null>();
      return doc ? toPost(doc) : null;
    },
    async incrementReplyCount(id, updatedAt) {
      if (!mongoose.isValidObjectId(id)) {
        return;
      }
      await PostModel.updateOne({ _id: id, deletedAt: null }, { $inc: { replyCount: 1 }, $set: { updatedAt } });
    },
    async insertComment(input) {
      const doc = await CommentModel.create({
        postId: asId(input.postId),
        parentCommentId: input.parentCommentId ? asId(input.parentCommentId) : null,
        authorId: asId(input.authorId),
        body: input.body,
        deletedAt: null,
        createdAt: input.createdAt,
      });
      return toComment(doc.toObject() as CommentDoc);
    },
    async listComments(postId) {
      const id = asId(postId);
      if (!id) {
        return [];
      }
      const docs = await CommentModel.find({ postId: id, deletedAt: null }).sort({ createdAt: 1 }).lean<CommentDoc[]>();
      return docs.map(toComment);
    },
    async findComment(id) {
      if (!mongoose.isValidObjectId(id)) {
        return null;
      }
      const doc = await CommentModel.findById(id).lean<CommentDoc | null>();
      return doc ? toComment(doc) : null;
    },
    async listReactions(targetType, targetIds) {
      const ids = targetIds.map(asId).filter((id): id is Types.ObjectId => id !== null);
      if (ids.length === 0) {
        return [];
      }
      const docs = await ReactionModel.find({ targetType, targetId: { $in: ids } }).lean<ReactionDoc[]>();
      return docs.map(toReaction);
    },
    async toggleReaction(input) {
      const targetId = asId(input.targetId);
      const userId = asId(input.userId);
      if (!targetId || !userId) {
        return false;
      }
      const existing = await ReactionModel.findOne({ targetType: input.targetType, targetId, userId, kind: input.kind });
      if (existing) {
        await existing.deleteOne();
        return false;
      }
      try {
        await ReactionModel.create({ targetType: input.targetType, targetId, userId, kind: input.kind });
        return true;
      } catch (error) {
        if (!isDuplicate(error)) {
          throw error;
        }
        await ReactionModel.deleteOne({ targetType: input.targetType, targetId, userId, kind: input.kind });
        return false;
      }
    },
    async insertReport(input) {
      const targetId = asId(input.targetId);
      const reportedBy = asId(input.reportedBy);
      if (!targetId || !reportedBy) {
        throw new Error("A report needs a stored target.");
      }
      const existing = await ReportModel.findOne({
        status: "OPEN",
        targetType: input.targetType,
        targetId,
        reportedBy,
      }).lean<ReportDoc | null>();
      if (existing) {
        return { report: toReport(existing), created: false };
      }
      try {
        const doc = await ReportModel.create({
          targetType: input.targetType,
          targetId,
          reportedBy,
          reason: input.reason,
          status: "OPEN",
          resolution: null,
          resolvedBy: null,
          resolvedAt: null,
          createdAt: input.createdAt,
        });
        return { report: toReport(doc.toObject() as ReportDoc), created: true };
      } catch (error) {
        if (!isDuplicate(error)) {
          throw error;
        }
        const again = await ReportModel.findOne({
          status: "OPEN",
          targetType: input.targetType,
          targetId,
          reportedBy,
        }).lean<ReportDoc | null>();
        if (!again) {
          throw error;
        }
        return { report: toReport(again), created: false };
      }
    },
  };
}
