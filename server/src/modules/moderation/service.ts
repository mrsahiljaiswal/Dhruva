import type {
  Announcement,
  AnnouncementAudience,
  CreateAnnouncementInput,
  ModerationAction,
  PatchAnnouncementInput,
  ReportQueueItem,
  ReportStatus,
} from "@dhruva/shared";
import { BRANCHES } from "@dhruva/shared";
import type { EventBus } from "../../events/bus.js";
import { AppError } from "../../middleware/errors.js";
import type { CohortRepository } from "../cohorts/repository.js";
import type { DiscussionRepository, ReportRecord } from "../discussions/repository.js";
import type { AssignmentRepository } from "../mentors/assignments.js";
import type { MessagingRepository } from "../messaging/repository.js";
import { stripHtml } from "../resources/markdown.js";
import { deactivateAccount } from "../users/deactivate.js";
import type { UserRecord, UserRepository } from "../users/repository.js";
import type { AnnouncementRecord, AnnouncementRepository } from "./repository.js";

export type ScheduleDeps = {
  announcements: AnnouncementRepository;
  users: UserRepository;
  assignments: AssignmentRepository;
  bus: EventBus;
  now?: () => Date;
};

export type ModerationDeps = ScheduleDeps & {
  cohorts: CohortRepository;
  discussions: DiscussionRepository;
  messaging: MessagingRepository;
  revokeSessions?: (userId: string) => Promise<void>;
};

const branches = new Set<string>(BRANCHES);

function text(value: string, path: string): string {
  const clean = stripHtml(value).trim();
  if (!clean) {
    throw new AppError(400, "VALIDATION_ERROR", "Write this in text.", [{ path, message: "Write this in text." }]);
  }
  return clean;
}

function presentAnnouncement(row: AnnouncementRecord): Announcement {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    audience: row.audience,
    targetIds: row.targetIds,
    publishAt: row.publishAt.toISOString(),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    createdBy: row.createdBy,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

function isLive(row: AnnouncementRecord, now: Date): boolean {
  return row.status === "PUBLISHED" && row.publishAt.getTime() <= now.getTime() && (row.expiresAt === null || row.expiresAt.getTime() > now.getTime());
}

async function inAudience(user: UserRecord, row: AnnouncementRecord, assignments: AssignmentRepository): Promise<boolean> {
  if (row.audience === "ALL") {
    return true;
  }
  if (row.audience === "COHORT") {
    return user.cohortId !== null && row.targetIds.includes(user.cohortId);
  }
  if (row.audience === "BRANCH") {
    return user.branch !== null && row.targetIds.includes(user.branch);
  }
  if (user.role === "MENTOR" && row.targetIds.includes(user.id)) {
    return true;
  }
  if (user.role === "STUDENT") {
    const link = await assignments.findActiveByStudent(user.id);
    return link !== null && row.targetIds.includes(link.mentorId);
  }
  return false;
}

async function recipientIds(deps: ScheduleDeps, row: AnnouncementRecord): Promise<string[]> {
  const people = await deps.users.list({ status: "ACTIVE" });
  const ids: string[] = [];
  for (const person of people) {
    if (await inAudience(person, row, deps.assignments)) {
      ids.push(person.id);
    }
  }
  return ids;
}

async function publishEvent(deps: ScheduleDeps, row: AnnouncementRecord, actorId: string | null, requestId?: string | null): Promise<void> {
  const userIds = await recipientIds(deps, row);
  await deps.bus.emit({
    action: "announcement.published",
    actorId,
    subjectType: "Announcement",
    subjectId: row.id,
    after: { title: row.title, userIds, audience: row.audience },
    requestId: requestId ?? null,
  });
}

export async function runAnnouncementSchedule(deps: ScheduleDeps, now = new Date()): Promise<{ published: number; expired: number }> {
  let published = 0;
  let expired = 0;
  for (const row of await deps.announcements.dueToPublish(now)) {
    const claimed = await deps.announcements.claimPublish(row.id, now);
    if (!claimed) {
      continue;
    }
    await publishEvent(deps, claimed, null);
    published += 1;
  }
  for (const row of await deps.announcements.dueToExpire(now)) {
    const claimed = await deps.announcements.claimExpire(row.id, now);
    if (claimed) {
      expired += 1;
    }
  }
  return { published, expired };
}

function excerpt(value: string): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > 180 ? `${clean.slice(0, 177)}...` : clean;
}

function asAction(value: string | null): ModerationAction | null {
  if (value === "DISMISS" || value === "HIDE" || value === "WARN" || value === "SUSPEND") {
    return value;
  }
  return null;
}

export function createModerationService(deps: ModerationDeps) {
  const now = deps.now ?? (() => new Date());

  async function requireTargets(audience: AnnouncementAudience, targetIds: string[]): Promise<void> {
    if (audience === "ALL") {
      return;
    }
    if (audience === "BRANCH") {
      const invalid = targetIds.find((id) => !branches.has(id));
      if (invalid) {
        throw new AppError(422, "UNPROCESSABLE", "Choose a branch that exists.", [
          { path: "targetIds", message: "Choose a branch that exists." },
        ]);
      }
      return;
    }
    if (audience === "COHORT") {
      for (const id of targetIds) {
        const cohort = await deps.cohorts.findById(id);
        if (!cohort) {
          throw new AppError(422, "UNPROCESSABLE", "Choose a cohort that exists.", [
            { path: "targetIds", message: "Choose a cohort that exists." },
          ]);
        }
      }
      return;
    }
    for (const id of targetIds) {
      const mentor = await deps.users.findById(id);
      if (!mentor || mentor.role !== "MENTOR") {
        throw new AppError(422, "UNPROCESSABLE", "Choose a mentor group that exists.", [
          { path: "targetIds", message: "Choose a mentor group that exists." },
        ]);
      }
    }
  }

  async function actor(userId: string): Promise<UserRecord> {
    const user = await deps.users.findById(userId);
    if (!user || user.status !== "ACTIVE") {
      throw new AppError(401, "UNAUTHENTICATED", "Sign in to continue.");
    }
    return user;
  }

  async function targetOf(report: ReportRecord): Promise<{ authorId: string | null; authorName: string | null; excerpt: string; hidden: boolean } | null> {
    if (report.targetType === "POST") {
      const post = await deps.discussions.findPost(report.targetId);
      if (!post) {
        return null;
      }
      const author = await deps.users.findById(post.authorId);
      return {
        authorId: post.authorId,
        authorName: author?.name ?? null,
        excerpt: excerpt(post.title),
        hidden: post.deletedAt !== null,
      };
    }
    if (report.targetType === "COMMENT") {
      const comment = await deps.discussions.findComment(report.targetId);
      if (!comment) {
        return null;
      }
      const author = await deps.users.findById(comment.authorId);
      return {
        authorId: comment.authorId,
        authorName: author?.name ?? null,
        excerpt: excerpt(comment.body),
        hidden: comment.deletedAt !== null,
      };
    }
    if (report.targetType === "MESSAGE") {
      const message = await deps.messaging.findMessageById(report.targetId);
      if (!message) {
        return null;
      }
      const author = await deps.users.findById(message.senderId);
      return {
        authorId: message.senderId,
        authorName: author?.name ?? null,
        excerpt: excerpt(message.body),
        hidden: message.deletedAt !== null,
      };
    }
    const person = await deps.users.findById(report.targetId);
    if (!person) {
      return null;
    }
    return {
      authorId: person.id,
      authorName: person.name,
      excerpt: person.name,
      hidden: false,
    };
  }

  async function presentReport(report: ReportRecord): Promise<ReportQueueItem> {
    const reporter = await deps.users.findById(report.reportedBy);
    return {
      id: report.id,
      targetType: report.targetType,
      targetId: report.targetId,
      reportedBy: report.reportedBy,
      reportedByName: reporter?.name ?? "Unknown",
      reason: report.reason,
      status: report.status,
      resolution: asAction(report.resolution),
      resolvedBy: report.resolvedBy,
      resolvedAt: report.resolvedAt ? report.resolvedAt.toISOString() : null,
      createdAt: report.createdAt.toISOString(),
      target: await targetOf(report),
    };
  }

  async function affectedUserId(report: ReportRecord): Promise<string> {
    if (report.targetType === "POST") {
      const post = await deps.discussions.findPost(report.targetId);
      if (!post) {
        throw new AppError(404, "NOT_FOUND", "That post was not found.");
      }
      return post.authorId;
    }
    if (report.targetType === "COMMENT") {
      const comment = await deps.discussions.findComment(report.targetId);
      if (!comment) {
        throw new AppError(404, "NOT_FOUND", "That comment was not found.");
      }
      return comment.authorId;
    }
    if (report.targetType === "MESSAGE") {
      const message = await deps.messaging.findMessageById(report.targetId);
      if (!message) {
        throw new AppError(404, "NOT_FOUND", "That message was not found.");
      }
      return message.senderId;
    }
    const person = await deps.users.findById(report.targetId);
    if (!person) {
      throw new AppError(404, "NOT_FOUND", "That person was not found.");
    }
    return person.id;
  }

  return {
    async listAnnouncements(userId: string): Promise<Announcement[]> {
      const user = await actor(userId);
      const rows = await deps.announcements.list();
      const clock = now();
      if (user.role === "ADMIN") {
        return rows.map(presentAnnouncement);
      }
      const visible: AnnouncementRecord[] = [];
      for (const row of rows) {
        if (isLive(row, clock) && (await inAudience(user, row, deps.assignments))) {
          visible.push(row);
        }
      }
      return visible.map(presentAnnouncement);
    },

    async createAnnouncement(userId: string, input: CreateAnnouncementInput, requestId?: string): Promise<Announcement> {
      const user = await actor(userId);
      const title = text(input.title, "title");
      const body = text(input.body, "body");
      const publishAt = input.publishAt ? new Date(input.publishAt) : now();
      const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
      if (expiresAt && expiresAt.getTime() <= publishAt.getTime()) {
        throw new AppError(422, "UNPROCESSABLE", "Expiry must be after publishing.", [
          { path: "expiresAt", message: "Expiry must be after publishing." },
        ]);
      }
      if (expiresAt && expiresAt.getTime() <= now().getTime()) {
        throw new AppError(422, "UNPROCESSABLE", "Expiry must be in the future.", [
          { path: "expiresAt", message: "Expiry must be in the future." },
        ]);
      }
      await requireTargets(input.audience, input.targetIds);
      const status = publishAt.getTime() > now().getTime() ? "SCHEDULED" : "PUBLISHED";
      const created = await deps.announcements.insert({
        title,
        body,
        audience: input.audience,
        targetIds: input.audience === "ALL" ? [] : input.targetIds,
        publishAt,
        expiresAt,
        createdBy: user.id,
        status,
        createdAt: now(),
      });
      if (created.status === "PUBLISHED") {
        await publishEvent(deps, created, user.id, requestId);
      }
      return presentAnnouncement(created);
    },

    async updateAnnouncement(userId: string, id: string, input: PatchAnnouncementInput, requestId?: string): Promise<Announcement> {
      await actor(userId);
      const current = await deps.announcements.findById(id);
      if (!current) {
        throw new AppError(404, "NOT_FOUND", "That announcement was not found.");
      }
      const audience = input.audience ?? current.audience;
      const targetIds = input.targetIds ?? current.targetIds;
      const title = input.title !== undefined ? text(input.title, "title") : current.title;
      const body = input.body !== undefined ? text(input.body, "body") : current.body;
      let publishAt = current.status === "SCHEDULED" && input.publishAt ? new Date(input.publishAt) : current.publishAt;
      let expiresAt = input.expiresAt !== undefined ? (input.expiresAt ? new Date(input.expiresAt) : null) : current.expiresAt;
      let status = current.status;
      if (input.expireNow) {
        status = "EXPIRED";
        expiresAt = now();
      }
      if (expiresAt && expiresAt.getTime() <= publishAt.getTime() && status !== "EXPIRED") {
        throw new AppError(422, "UNPROCESSABLE", "Expiry must be after publishing.", [
          { path: "expiresAt", message: "Expiry must be after publishing." },
        ]);
      }
      if (audience === "ALL" && input.targetIds && input.targetIds.length > 0) {
        throw new AppError(422, "UNPROCESSABLE", "An announcement for everyone has no extra targets.", [
          { path: "targetIds", message: "An announcement for everyone has no extra targets." },
        ]);
      }
      if (audience !== "ALL" && targetIds.length === 0) {
        throw new AppError(422, "UNPROCESSABLE", "Choose who should see this.", [
          { path: "targetIds", message: "Choose who should see this." },
        ]);
      }
      await requireTargets(audience, audience === "ALL" ? [] : targetIds);
      const becameDue = status === "SCHEDULED" && publishAt.getTime() <= now().getTime();
      if (becameDue) {
        status = "PUBLISHED";
      }
      if (status === "PUBLISHED" && expiresAt && expiresAt.getTime() <= now().getTime()) {
        status = "EXPIRED";
      }
      const updated = await deps.announcements.update(current.id, {
        title,
        body,
        audience,
        targetIds: audience === "ALL" ? [] : targetIds,
        publishAt,
        expiresAt,
        status,
      });
      if (!updated) {
        throw new AppError(404, "NOT_FOUND", "That announcement was not found.");
      }
      if (current.status === "SCHEDULED" && updated.status === "PUBLISHED") {
        await publishEvent(deps, updated, userId, requestId);
      }
      return presentAnnouncement(updated);
    },

    async listReports(status?: ReportStatus): Promise<ReportQueueItem[]> {
      const rows = await deps.discussions.listReports({ status, limit: 100 });
      return Promise.all(rows.map((row) => presentReport(row)));
    },

    async resolveReport(
      userId: string,
      reportId: string,
      action: ModerationAction,
      note: string,
      requestId?: string,
    ): Promise<ReportQueueItem> {
      const admin = await actor(userId);
      const cleanNote = text(note, "note");
      const report = await deps.discussions.findReport(reportId);
      if (!report) {
        throw new AppError(404, "NOT_FOUND", "That report was not found.");
      }
      if (report.status !== "OPEN") {
        throw new AppError(409, "CONFLICT", "This report is already closed.");
      }
      if (action === "HIDE" && report.targetType === "USER") {
        throw new AppError(422, "UNPROCESSABLE", "Hiding applies to content. Warn or suspend the account instead.");
      }
      const affectedId = await affectedUserId(report);
      if (action === "SUSPEND" && affectedId === admin.id) {
        throw new AppError(400, "VALIDATION_ERROR", "You cannot deactivate your own account.");
      }
      const clock = now();
      if (action === "HIDE") {
        if (report.targetType === "POST") {
          await deps.discussions.hidePost(report.targetId, clock);
        } else if (report.targetType === "COMMENT") {
          await deps.discussions.hideComment(report.targetId, clock);
        } else if (report.targetType === "MESSAGE") {
          await deps.messaging.hideMessage(report.targetId, clock);
        }
      }
      const resolved = await deps.discussions.resolveReport(report.id, {
        status: action === "DISMISS" ? "DISMISSED" : "ACTION_TAKEN",
        resolution: action,
        resolvedBy: admin.id,
        resolvedAt: clock,
      });
      if (!resolved) {
        throw new AppError(409, "CONFLICT", "This report is already closed.");
      }
      await deps.bus.emit({
        action: "moderation.action_taken",
        actorId: admin.id,
        subjectType: "Report",
        subjectId: resolved.id,
        reason: cleanNote,
        before: { status: "OPEN" },
        after: {
          action,
          note: cleanNote,
          status: resolved.status,
          targetType: report.targetType,
          targetId: report.targetId,
          userId: affectedId,
        },
        requestId: requestId ?? null,
      });
      if (action === "SUSPEND") {
        await deactivateAccount({
          users: deps.users,
          bus: deps.bus,
          actorId: admin.id,
          userId: affectedId,
          requestId,
          revokeSessions: deps.revokeSessions,
        });
      }
      return presentReport(resolved);
    },
  };
}
