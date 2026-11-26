import type {
  CreateCommentInput,
  CreateDoubtInput,
  CreateForumPostInput,
  CreateReportInput,
  DiscussionComment,
  DiscussionPost,
  DiscussionThread,
  ForumListQuery,
  ReactionResult,
  ReactionWrite,
  ReasonInput,
  ReportView,
  ResourcePostQuery,
  Role,
} from "@dhruva/shared";
import type { EventBus } from "../../events/bus.js";
import { AppError } from "../../middleware/errors.js";
import type { AssignmentRepository } from "../mentors/assignments.js";
import { stripHtml } from "../resources/markdown.js";
import { canViewResource, type ResourceViewer } from "../resources/access.js";
import type { ResourceRepository } from "../resources/repository.js";
import type { UserRepository } from "../users/repository.js";
import type { CommentRecord, DiscussionRepository, PostRecord } from "./repository.js";
import { presentPost, presentReport, presentThread } from "./serialize.js";

type Actor = ResourceViewer;

export type DiscussionGrantSource = {
  resourceIdsFor(viewer: { id: string; role: Role }): Promise<Set<string>>;
};

export type DiscussionServiceDeps = {
  users: UserRepository;
  resources: ResourceRepository;
  assignments: AssignmentRepository;
  discussions: DiscussionRepository;
  bus: EventBus;
  grants?: DiscussionGrantSource;
  now?: () => Date;
};

function plain(value: string): string {
  return stripHtml(value).trim();
}

function snippet(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const text = value.replace(/\r\n/g, "\n").trim();
  return text.length > 0 ? text : null;
}

export function createDiscussionService(deps: DiscussionServiceDeps) {
  const now = deps.now ?? (() => new Date());

  async function actorFor(userId: string): Promise<Actor> {
    const user = await deps.users.findById(userId);
    if (!user || user.status !== "ACTIVE") {
      throw new AppError(401, "UNAUTHENTICATED", "Sign in to continue.");
    }
    const assignment = user.role === "STUDENT" ? await deps.assignments.findActiveByStudent(user.id) : null;
    return {
      id: user.id,
      role: user.role,
      status: user.status,
      cohortId: user.cohortId,
      activeMentorId: assignment?.mentorId ?? null,
    };
  }

  async function forbid(actorId: string, subjectId: string | null, requestId: string | undefined, message?: string): Promise<never> {
    await deps.bus.emit({
      action: "security.access_denied",
      actorId,
      subjectType: "DiscussionPost",
      subjectId,
      requestId: requestId ?? null,
    });
    throw new AppError(403, "FORBIDDEN", message ?? "You do not have access to this.");
  }

  async function grantSet(actor: Actor): Promise<Set<string>> {
    if (!deps.grants || actor.role === "ADMIN") {
      return new Set();
    }
    return deps.grants.resourceIdsFor(actor);
  }

  async function mentorOf(userId: string): Promise<string | null> {
    const user = await deps.users.findById(userId);
    if (!user || user.role !== "STUDENT") {
      return null;
    }
    const assignment = await deps.assignments.findActiveByStudent(user.id);
    return assignment?.mentorId ?? null;
  }

  async function namesFor(ids: string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    await Promise.all(
      [...new Set(ids)].map(async (id) => {
        const user = await deps.users.findById(id);
        names.set(id, user?.name ?? "Unknown");
      }),
    );
    return names;
  }

  async function canReadResource(actor: Actor, resourceId: string): Promise<boolean> {
    const resource = await deps.resources.findById(resourceId);
    if (!resource) {
      return false;
    }
    const grants = await grantSet(actor);
    return canViewResource(actor, resource, { viaAssignment: grants.has(resource.id) });
  }

  async function canReadPost(actor: Actor, post: PostRecord): Promise<boolean> {
    if (post.deletedAt) {
      return false;
    }
    if (actor.role === "ADMIN" || post.scope === "FORUM") {
      return true;
    }
    if (!post.resourceId) {
      return false;
    }
    if (await canReadResource(actor, post.resourceId)) {
      return true;
    }
    if (actor.role !== "MENTOR") {
      return false;
    }
    return (await mentorOf(post.authorId)) === actor.id;
  }

  function canModerate(actor: Actor): boolean {
    return actor.role === "MENTOR" || actor.role === "ADMIN";
  }

  async function requireResource(actor: Actor, resourceId: string, requestId: string | undefined) {
    const resource = await deps.resources.findById(resourceId);
    if (!resource) {
      if (actor.role === "ADMIN") {
        throw new AppError(404, "NOT_FOUND", "That resource was not found.");
      }
      return forbid(actor.id, resourceId, requestId);
    }
    const grants = await grantSet(actor);
    if (!canViewResource(actor, resource, { viaAssignment: grants.has(resource.id) })) {
      return forbid(actor.id, resource.id, requestId);
    }
    return resource;
  }

  async function requirePost(actor: Actor, postId: string, requestId: string | undefined): Promise<PostRecord> {
    const post = await deps.discussions.findPost(postId);
    if (!post || post.deletedAt) {
      if (actor.role === "ADMIN") {
        throw new AppError(404, "NOT_FOUND", "That post was not found.");
      }
      return forbid(actor.id, postId, requestId);
    }
    if (!(await canReadPost(actor, post))) {
      return forbid(actor.id, post.id, requestId);
    }
    return post;
  }

  async function requireComment(actor: Actor, commentId: string, requestId: string | undefined): Promise<CommentRecord> {
    const comment = await deps.discussions.findComment(commentId);
    if (!comment || comment.deletedAt) {
      if (actor.role === "ADMIN") {
        throw new AppError(404, "NOT_FOUND", "That comment was not found.");
      }
      return forbid(actor.id, commentId, requestId);
    }
    await requirePost(actor, comment.postId, requestId);
    return comment;
  }

  async function decorate(actor: Actor, rows: PostRecord[]): Promise<DiscussionPost[]> {
    const [names, reactions] = await Promise.all([
      namesFor(rows.map((row) => row.authorId)),
      deps.discussions.listReactions(
        "POST",
        rows.map((row) => row.id),
      ),
    ]);
    return rows.map((row) => presentPost(row, names.get(row.authorId) ?? "Unknown", reactions, actor.id));
  }

  async function threadFor(actor: Actor, post: PostRecord): Promise<DiscussionThread> {
    const comments = await deps.discussions.listComments(post.id);
    const [names, postReactions, commentReactions] = await Promise.all([
      namesFor([post.authorId, ...comments.map((comment) => comment.authorId)]),
      deps.discussions.listReactions("POST", [post.id]),
      deps.discussions.listReactions(
        "COMMENT",
        comments.map((comment) => comment.id),
      ),
    ]);
    return presentThread(post, comments, names, postReactions, commentReactions, actor.id);
  }

  function written(title: string, body: string): { title: string; body: string } {
    const cleanTitle = plain(title);
    const cleanBody = plain(body);
    if (!cleanTitle || !cleanBody) {
      throw new AppError(400, "VALIDATION_ERROR", "Write the post in text.", [
        { path: cleanTitle ? "body" : "title", message: "Write the post in text." },
      ]);
    }
    return { title: cleanTitle, body: cleanBody };
  }

  async function fileReport(
    actor: Actor,
    input: { targetType: CreateReportInput["targetType"]; targetId: string; reason: string },
    via: "report" | "escalation",
    requestId: string | undefined,
  ): Promise<{ report: ReportView; created: boolean }> {
    const reason = plain(input.reason);
    if (!reason) {
      throw new AppError(400, "VALIDATION_ERROR", "Write the reason in text.", [
        { path: "reason", message: "Write the reason in text." },
      ]);
    }
    const stored = await deps.discussions.insertReport({
      targetType: input.targetType,
      targetId: input.targetId,
      reportedBy: actor.id,
      reason,
      createdAt: now(),
    });
    if (stored.created) {
      await deps.bus.emit({
        action: "discussion.reported",
        actorId: actor.id,
        subjectType: "Report",
        subjectId: stored.report.id,
        after: {
          targetType: input.targetType,
          targetId: input.targetId,
          reason: stored.report.reason,
          via,
        },
        requestId: requestId ?? null,
      });
    }
    return { report: presentReport(stored.report), created: stored.created };
  }

  return {
    async listResourcePosts(userId: string, resourceId: string, query: ResourcePostQuery, requestId?: string) {
      const actor = await actorFor(userId);
      await requireResource(actor, resourceId, requestId);
      const page = await deps.discussions.listPosts({
        scope: "RESOURCE",
        resourceId,
        status: query.status,
        q: query.q,
        page: query.page,
        limit: query.limit,
      });
      return { data: await decorate(actor, page.rows), page: query.page, limit: query.limit, total: page.total };
    },

    async createDoubt(userId: string, resourceId: string, input: CreateDoubtInput, requestId?: string): Promise<DiscussionPost> {
      const actor = await actorFor(userId);
      await requireResource(actor, resourceId, requestId);
      const text = written(input.title, input.body);
      const post = await deps.discussions.insertPost({
        scope: "RESOURCE",
        resourceId,
        category: null,
        authorId: actor.id,
        title: text.title,
        body: text.body,
        codeSnippet: snippet(input.codeSnippet),
        createdAt: now(),
      });
      await deps.bus.emit({
        action: "doubt.asked",
        actorId: actor.id,
        subjectType: "DiscussionPost",
        subjectId: post.id,
        after: { resourceId, authorId: actor.id, mentorId: await mentorOf(actor.id) },
        requestId: requestId ?? null,
      });
      const [view] = await decorate(actor, [post]);
      return view!;
    },

    async listForumPosts(userId: string, query: ForumListQuery) {
      const actor = await actorFor(userId);
      const page = await deps.discussions.listPosts({
        scope: "FORUM",
        category: query.category,
        status: query.status,
        q: query.q,
        page: query.page,
        limit: query.limit,
      });
      return { data: await decorate(actor, page.rows), page: query.page, limit: query.limit, total: page.total };
    },

    async createForumPost(userId: string, input: CreateForumPostInput): Promise<DiscussionPost> {
      const actor = await actorFor(userId);
      const text = written(input.title, input.body);
      const post = await deps.discussions.insertPost({
        scope: "FORUM",
        resourceId: null,
        category: input.category,
        authorId: actor.id,
        title: text.title,
        body: text.body,
        codeSnippet: snippet(input.codeSnippet),
        createdAt: now(),
      });
      const [view] = await decorate(actor, [post]);
      return view!;
    },

    async getPost(userId: string, postId: string, requestId?: string): Promise<DiscussionThread> {
      const actor = await actorFor(userId);
      const post = await requirePost(actor, postId, requestId);
      return threadFor(actor, post);
    },

    async comment(userId: string, postId: string, input: CreateCommentInput, requestId?: string): Promise<DiscussionComment> {
      const actor = await actorFor(userId);
      const post = await requirePost(actor, postId, requestId);
      const parentId = input.parentCommentId ?? null;
      if (parentId) {
        const parent = await deps.discussions.findComment(parentId);
        if (!parent || parent.deletedAt || parent.postId !== post.id) {
          throw new AppError(422, "UNPROCESSABLE", "Reply to a comment on this post.");
        }
        if (parent.parentCommentId) {
          throw new AppError(422, "UNPROCESSABLE", "Replies only nest one level.");
        }
      }
      const body = plain(input.body);
      if (!body) {
        throw new AppError(400, "VALIDATION_ERROR", "Write the reply in text.", [
          { path: "body", message: "Write the reply in text." },
        ]);
      }
      const createdAt = now();
      const comment = await deps.discussions.insertComment({
        postId: post.id,
        parentCommentId: parentId,
        authorId: actor.id,
        body,
        createdAt,
      });
      await deps.discussions.incrementReplyCount(post.id, createdAt);
      await deps.bus.emit({
        action: "doubt.replied",
        actorId: actor.id,
        subjectType: "Comment",
        subjectId: comment.id,
        after: {
          postId: post.id,
          scope: post.scope,
          resourceId: post.resourceId,
          authorId: post.authorId,
          mentorId: await mentorOf(post.authorId),
          commentId: comment.id,
        },
        requestId: requestId ?? null,
      });
      const names = await namesFor([actor.id]);
      const thread = await threadFor(actor, (await deps.discussions.findPost(post.id)) ?? post);
      return thread.comments.find((item) => item.id === comment.id) ?? {
        id: comment.id,
        postId: comment.postId,
        parentCommentId: comment.parentCommentId,
        authorId: comment.authorId,
        authorName: names.get(actor.id) ?? "Unknown",
        body: comment.body,
        helpfulCount: 0,
        likeCount: 0,
        viewerHelpful: false,
        viewerLike: false,
        accepted: false,
        createdAt: comment.createdAt.toISOString(),
      };
    },

    async accept(userId: string, postId: string, commentId: string, requestId?: string): Promise<DiscussionThread> {
      const actor = await actorFor(userId);
      const post = await requirePost(actor, postId, requestId);
      if (actor.id !== post.authorId && !canModerate(actor)) {
        return forbid(actor.id, post.id, requestId, "Only the author, a mentor, or an administrator can accept an answer.");
      }
      const comment = await deps.discussions.findComment(commentId);
      if (!comment || comment.deletedAt || comment.postId !== post.id) {
        throw new AppError(422, "UNPROCESSABLE", "That reply is not on this post.");
      }
      const updated = await deps.discussions.updatePost(post.id, { acceptedCommentId: comment.id, updatedAt: now() });
      if (!updated) {
        throw new AppError(404, "NOT_FOUND", "That post was not found.");
      }
      return threadFor(actor, updated);
    },

    async resolve(userId: string, postId: string, requestId?: string): Promise<DiscussionThread> {
      const actor = await actorFor(userId);
      const post = await requirePost(actor, postId, requestId);
      if (!canModerate(actor)) {
        return forbid(actor.id, post.id, requestId, "A mentor or an administrator marks a thread resolved.");
      }
      const updated = await deps.discussions.updatePost(post.id, { status: "RESOLVED", updatedAt: now() });
      if (!updated) {
        throw new AppError(404, "NOT_FOUND", "That post was not found.");
      }
      return threadFor(actor, updated);
    },

    async highlight(userId: string, postId: string, requestId?: string): Promise<DiscussionThread> {
      const actor = await actorFor(userId);
      const post = await requirePost(actor, postId, requestId);
      if (!canModerate(actor)) {
        return forbid(actor.id, post.id, requestId, "A mentor or an administrator highlights a thread.");
      }
      const updated = await deps.discussions.updatePost(post.id, { highlighted: !post.highlighted, updatedAt: now() });
      if (!updated) {
        throw new AppError(404, "NOT_FOUND", "That post was not found.");
      }
      return threadFor(actor, updated);
    },

    async escalate(userId: string, postId: string, input: ReasonInput, requestId?: string) {
      const actor = await actorFor(userId);
      const post = await requirePost(actor, postId, requestId);
      if (!canModerate(actor)) {
        return forbid(actor.id, post.id, requestId, "A mentor or an administrator escalates a thread.");
      }
      return fileReport(actor, { targetType: "POST", targetId: post.id, reason: input.reason }, "escalation", requestId);
    },

    async react(userId: string, input: ReactionWrite, requestId?: string): Promise<ReactionResult> {
      const actor = await actorFor(userId);
      if (input.targetType === "POST") {
        await requirePost(actor, input.targetId, requestId);
      } else {
        await requireComment(actor, input.targetId, requestId);
      }
      const active = await deps.discussions.toggleReaction({
        targetType: input.targetType,
        targetId: input.targetId,
        userId: actor.id,
        kind: input.kind,
      });
      return { targetType: input.targetType, targetId: input.targetId, kind: input.kind, active };
    },

    async report(userId: string, input: CreateReportInput, requestId?: string) {
      const actor = await actorFor(userId);
      if (input.targetType === "POST") {
        await requirePost(actor, input.targetId, requestId);
      } else if (input.targetType === "COMMENT") {
        await requireComment(actor, input.targetId, requestId);
      } else {
        if (input.targetId === actor.id) {
          throw new AppError(422, "UNPROCESSABLE", "You cannot report your own account.");
        }
        const target = await deps.users.findById(input.targetId);
        if (!target) {
          throw new AppError(404, "NOT_FOUND", "That person was not found.");
        }
      }
      return fileReport(actor, input, "report", requestId);
    },
  };
}
