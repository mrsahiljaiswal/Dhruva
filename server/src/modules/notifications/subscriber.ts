import type { DomainEvent, EventBus } from "../../events/bus.js";
import type { AppLogger } from "../../platform/logger.js";
import type { Mailer } from "../../platform/mail.js";
import type { Delivery } from "../../realtime/delivery.js";
import type { UserRepository } from "../users/repository.js";
import { deliverNotification } from "./dispatch.js";
import type { PreferenceRepository } from "./preferences.js";
import type { NewNotification, NotificationRepository } from "./repository.js";

export type NotificationDeps = {
  users: UserRepository;
  notifications: NotificationRepository;
  preferences: PreferenceRepository;
  mailer?: Mailer;
  delivery: Delivery;
  logger: AppLogger;
  now?: () => Date;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function payload(fields: Record<string, string | null | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value) {
      result[key] = value;
    }
  }
  return result;
}

export function registerNotificationSubscriber(bus: EventBus, deps: NotificationDeps): void {
  const now = deps.now ?? (() => new Date());

  async function notify(input: Omit<NewNotification, "createdAt">): Promise<void> {
    await deliverNotification(deps, { ...input, createdAt: now() });
  }

  bus.on("message.created", async (event) => {
    const conversationId = asString(event.after?.conversationId);
    const senderId = asString(event.after?.senderId) ?? event.actorId ?? null;
    if (!conversationId || !senderId) {
      return;
    }
    const messageId = asString(event.after?.messageId) ?? event.subjectId ?? null;
    const open = new Set(deps.delivery.listeners(conversationId));
    deps.delivery.messageNew(conversationId);
    for (const userId of asStrings(event.after?.participantIds)) {
      if (userId === senderId || open.has(userId)) {
        continue;
      }
      await notify({
        userId,
        type: "MESSAGE",
        text: "You have a new message.",
        payload: payload({ conversationId, messageId }),
        dedupeKey: messageId ? `message:${messageId}` : null,
      });
    }
  });

  bus.on("assignment.published", async (event) => {
    const assignmentId = event.subjectId ?? null;
    for (const userId of asStrings(event.after?.studentIds)) {
      await notify({
        userId,
        type: "ASSIGNMENT_PUBLISHED",
        text: "A new assignment is available.",
        payload: payload({ assignmentId }),
        dedupeKey: assignmentId ? `assignment:${assignmentId}` : null,
      });
    }
  });

  bus.on("submission.reviewed", async (event) => {
    const studentId = asString(event.after?.studentId);
    if (!studentId || studentId === event.actorId) {
      return;
    }
    await notify({
      userId: studentId,
      type: "MENTOR_FEEDBACK",
      text: "Your mentor left feedback.",
      payload: payload({ revisionId: event.subjectId, recipientId: asString(event.after?.recipientId) }),
      dedupeKey: event.subjectId ? `review:${event.subjectId}` : null,
    });
  });

  bus.on("doubt.asked", async (event) => {
    const mentorId = asString(event.after?.mentorId);
    if (!mentorId || mentorId === event.actorId) {
      return;
    }
    await notify({
      userId: mentorId,
      type: "DOUBT_ASKED",
      text: "A student asked a doubt.",
      payload: payload({ postId: event.subjectId, resourceId: asString(event.after?.resourceId) }),
      dedupeKey: event.subjectId ? `doubt:${event.subjectId}` : null,
    });
  });

  bus.on("doubt.replied", async (event) => {
    const authorId = asString(event.after?.authorId);
    const mentorId = asString(event.after?.mentorId);
    const commentId = event.subjectId ?? asString(event.after?.commentId);
    const postId = asString(event.after?.postId);
    if (authorId && authorId !== event.actorId) {
      await notify({
        userId: authorId,
        type: "DOUBT_REPLY",
        text: "Someone replied to your doubt.",
        payload: payload({ postId, commentId }),
        dedupeKey: commentId ? `reply:${commentId}:author` : null,
      });
    }
    if (mentorId && mentorId !== event.actorId && mentorId !== authorId) {
      await notify({
        userId: mentorId,
        type: "DOUBT_REPLY",
        text: "There is a new reply in a doubt thread.",
        payload: payload({ postId, commentId }),
        dedupeKey: commentId ? `reply:${commentId}:mentor` : null,
      });
    }
  });

  bus.on("discussion.reported", async (event) => {
    const admins = await deps.users.list({ role: "ADMIN", status: "ACTIVE" });
    for (const admin of admins) {
      if (admin.id === event.actorId) {
        continue;
      }
      await notify({
        userId: admin.id,
        type: "DISCUSSION_REPORTED",
        text: "A report was filed.",
        payload: payload({ reportId: event.subjectId, targetType: asString(event.after?.targetType) }),
        dedupeKey: event.subjectId ? `report:${event.subjectId}` : null,
      });
    }
  });

  bus.on("mentor.reassigned", async (event) => {
    const studentId = event.subjectId ?? null;
    const previousMentorId = asString(event.before?.mentorId);
    const mentorId = asString(event.after?.mentorId);
    const stamp = mentorId ?? "none";
    if (studentId) {
      await notify({
        userId: studentId,
        type: "MENTOR_REASSIGNED",
        text: "Your mentor has changed.",
        payload: payload({ mentorId }),
        dedupeKey: `reassign:${studentId}:${stamp}:student`,
      });
    }
    if (mentorId) {
      await notify({
        userId: mentorId,
        type: "MENTOR_REASSIGNED",
        text: "A student was reassigned to you.",
        payload: payload({ studentId }),
        dedupeKey: studentId ? `reassign:${studentId}:${stamp}:next` : null,
      });
    }
    if (previousMentorId && previousMentorId !== mentorId) {
      await notify({
        userId: previousMentorId,
        type: "MENTOR_REASSIGNED",
        text: "A student you mentored was reassigned.",
        payload: payload({ studentId }),
        dedupeKey: studentId ? `reassign:${studentId}:${stamp}:previous` : null,
      });
    }
  });

  bus.on("announcement.published", async (event) => {
    const title = asString(event.after?.title);
    const text = title ? title.slice(0, 140) : "A new announcement was published.";
    for (const userId of asStrings(event.after?.userIds)) {
      await notify({
        userId,
        type: "ANNOUNCEMENT",
        text,
        payload: payload({ announcementId: event.subjectId }),
        dedupeKey: event.subjectId ? `announcement:${event.subjectId}` : null,
      });
    }
  });

  bus.on("moderation.action_taken", async (event) => {
    const userId = asString(event.after?.userId);
    const action = asString(event.after?.action);
    if (!userId || userId === event.actorId || action === "DISMISS" || !action) {
      return;
    }
    const note = asString(event.reason);
    if (action === "HIDE") {
      await notify({
        userId,
        type: "CONTENT_HIDDEN",
        text: "An administrator hid content you posted.",
        payload: payload({ reportId: event.subjectId }),
        dedupeKey: event.subjectId ? `moderation:${event.subjectId}` : null,
      });
    } else if (action === "WARN") {
      await notify({
        userId,
        type: "ACCOUNT_WARNING",
        text: note ? note.slice(0, 140) : "An administrator sent you a warning.",
        payload: payload({ reportId: event.subjectId }),
        dedupeKey: event.subjectId ? `moderation:${event.subjectId}` : null,
      });
    } else if (action === "SUSPEND") {
      await notify({
        userId,
        type: "ACCOUNT_SUSPENDED",
        text: "Your account was suspended.",
        payload: payload({ reportId: event.subjectId }),
        dedupeKey: event.subjectId ? `moderation:${event.subjectId}` : null,
      });
    }
  });

  bus.on("security.break_glass", async (event: DomainEvent) => {
    const admins = await deps.users.list({ role: "ADMIN", status: "ACTIVE" });
    for (const admin of admins) {
      if (admin.id === event.actorId) {
        continue;
      }
      await notify({
        userId: admin.id,
        type: "BREAK_GLASS",
        text: "An administrator opened a private conversation.",
        payload: payload({ conversationId: event.subjectId }),
        dedupeKey: event.requestId ? `break-glass:${event.requestId}` : null,
      });
    }
  });
}
