import type { ConversationPurpose, OpenConversationInput, Role, SendMessageInput } from "@dhruva/shared";
import type { EventBus } from "../../events/bus.js";
import { AppError } from "../../middleware/errors.js";
import type { Delivery } from "../../realtime/delivery.js";
import { stripHtml } from "../resources/markdown.js";
import type { AssignmentRepository } from "../mentors/assignments.js";
import type { UploadIntentRepository } from "../resources/uploads.js";
import type { ObjectStorage } from "../../platform/storage.js";
import type { SettingsRepository } from "../settings/repository.js";
import type { UserRecord, UserRepository } from "../users/repository.js";
import type { ConversationRecord, MessageAttachmentRecord, MessageRecord, MessagingRepository } from "./repository.js";

export type Actor = {
  id: string;
  role: Role;
  name: string;
};

type PairDecision = { purpose: "MENTORSHIP" | "PEER"; other: UserRecord };

function mimeMatches(actual: string | null, expected: string): boolean {
  if (!actual) {
    return true;
  }
  return actual.split(";")[0]?.trim().toLowerCase() === expected.toLowerCase();
}

export function createMessagingService(deps: {
  users: UserRepository;
  assignments: AssignmentRepository;
  settings: SettingsRepository;
  messaging: MessagingRepository;
  bus: EventBus;
  delivery: Delivery;
  uploads?: UploadIntentRepository;
  storage?: ObjectStorage;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());

  async function actorFor(userId: string): Promise<Actor & { status: string }> {
    const user = await deps.users.findById(userId);
    if (!user || user.status !== "ACTIVE") {
      throw new AppError(401, "UNAUTHENTICATED", "Sign in to continue.");
    }
    return { id: user.id, role: user.role, name: user.name, status: user.status };
  }

  async function forbid(actorId: string, subjectId: string | null, requestId: string | undefined, message?: string): Promise<never> {
    await deps.bus.emit({
      action: "security.access_denied",
      actorId,
      subjectType: "Conversation",
      subjectId,
      requestId: requestId ?? null,
    });
    throw new AppError(403, "FORBIDDEN", message ?? "You do not have access to this.");
  }

  async function names(ids: string[]): Promise<Map<string, UserRecord>> {
    const found = new Map<string, UserRecord>();
    await Promise.all(
      [...new Set(ids)].map(async (id) => {
        const user = await deps.users.findById(id);
        if (user) {
          found.set(id, user);
        }
      }),
    );
    return found;
  }

  async function present(viewerId: string, conversation: ConversationRecord) {
    const people = await names(conversation.participantIds);
    const writable = await canWrite(viewerId, conversation);
    return {
      id: conversation.id,
      type: conversation.type,
      purpose: conversation.purpose,
      title: conversation.title,
      participants: conversation.participantIds.map((id) => {
        const person = people.get(id);
        return { id, name: person?.name ?? "Unknown", role: person?.role ?? "STUDENT" };
      }),
      lastMessageAt: conversation.lastMessageAt ? conversation.lastMessageAt.toISOString() : null,
      unreadCount: await deps.messaging.unreadCount(conversation.id, viewerId),
      writable,
    };
  }

  function presentMessage(message: MessageRecord, people: Map<string, UserRecord>) {
    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      senderName: people.get(message.senderId)?.name ?? "Unknown",
      body: message.body,
      attachments: message.attachments,
      sentAt: message.sentAt.toISOString(),
      readBy: message.readBy.map((receipt) => ({ userId: receipt.userId, readAt: receipt.readAt.toISOString() })),
    };
  }

  async function pairDecision(actor: Actor, other: UserRecord | null): Promise<PairDecision | null> {
    if (!other || other.status !== "ACTIVE" || other.id === actor.id) {
      return null;
    }
    if (actor.role === "STUDENT" && other.role === "MENTOR") {
      const active = await deps.assignments.findActiveByStudent(actor.id);
      return active?.mentorId === other.id ? { purpose: "MENTORSHIP", other } : null;
    }
    if (actor.role === "MENTOR" && other.role === "STUDENT") {
      const active = await deps.assignments.findActiveByStudent(other.id);
      return active?.mentorId === actor.id ? { purpose: "MENTORSHIP", other } : null;
    }
    if (actor.role === "STUDENT" && other.role === "STUDENT") {
      const settings = await deps.settings.get();
      return settings.studentDirectMessages ? { purpose: "PEER", other } : null;
    }
    return null;
  }

  async function canWrite(userId: string, conversation: ConversationRecord): Promise<boolean> {
    if (!conversation.participantIds.includes(userId)) {
      return false;
    }
    const settings = await deps.settings.get();
    if (conversation.purpose === "PEER") {
      return settings.studentDirectMessages;
    }
    if (conversation.purpose === "GROUP") {
      const actor = await deps.users.findById(userId);
      return settings.groupChat && (actor?.role === "STUDENT" || actor?.role === "MENTOR");
    }
    const people = await names(conversation.participantIds);
    const student = [...people.values()].find((person) => person.role === "STUDENT");
    const mentor = [...people.values()].find((person) => person.role === "MENTOR");
    if (!student || !mentor) {
      return false;
    }
    const active = await deps.assignments.findActiveByStudent(student.id);
    return active?.mentorId === mentor.id;
  }

  async function requireReadable(userId: string, conversationId: string, requestId?: string): Promise<ConversationRecord> {
    const actor = await actorFor(userId);
    const conversation = await deps.messaging.findById(conversationId);
    if (!conversation || !conversation.participantIds.includes(actor.id)) {
      return forbid(actor.id, conversationId, requestId);
    }
    return conversation;
  }

  async function confirmAttachments(actorId: string, keys: string[]): Promise<MessageAttachmentRecord[]> {
    if (keys.length === 0) {
      return [];
    }
    if (!deps.uploads || !deps.storage) {
      throw new AppError(422, "UNPROCESSABLE", "Upload the file before sending it.");
    }
    const confirmed: MessageAttachmentRecord[] = [];
    const intentIds: string[] = [];
    for (const storageKey of keys) {
      const intent = await deps.uploads.findByKey(storageKey);
      if (!intent || intent.createdBy !== actorId) {
        throw new AppError(422, "UNPROCESSABLE", "Upload the file before sending it.");
      }
      if (intent.consumedAt) {
        throw new AppError(409, "CONFLICT", "That file is already attached to a message.");
      }
      if (intent.expiresAt.getTime() <= now().getTime()) {
        throw new AppError(422, "UNPROCESSABLE", "That upload slot has expired. Request a new one.");
      }
      if (!deps.storage.configured) {
        throw new AppError(422, "UNPROCESSABLE", "File storage is not configured.");
      }
      let remote: { sizeBytes: number; mimeType: string | null } | null;
      try {
        remote = await deps.storage.confirm(storageKey);
      } catch {
        throw new AppError(500, "INTERNAL", "The uploaded file could not be confirmed.");
      }
      if (!remote || remote.sizeBytes !== intent.sizeBytes || !mimeMatches(remote.mimeType, intent.mimeType)) {
        throw new AppError(422, "UNPROCESSABLE", "The uploaded file does not match the file you declared.");
      }
      confirmed.push({
        storageKey,
        fileName: intent.fileName,
        mimeType: intent.mimeType,
        sizeBytes: intent.sizeBytes,
      });
      intentIds.push(intent.id);
    }
    for (const intentId of intentIds) {
      await deps.uploads.consume(intentId);
    }
    return confirmed;
  }

  async function openBetween(actor: Actor, other: UserRecord, purpose: ConversationPurpose) {
    const pairKey = [actor.id, other.id].sort().join(":");
    const existing = await deps.messaging.findDirect(pairKey);
    if (existing) {
      return { conversation: await present(actor.id, existing), created: false };
    }
    const stored = await deps.messaging.insert({
      type: "DIRECT",
      purpose,
      participantIds: [actor.id, other.id].sort(),
      pairKey,
      title: null,
      createdBy: actor.id,
      createdAt: now(),
    });
    return { conversation: await present(actor.id, stored.conversation), created: stored.created };
  }

  return {
    async list(userId: string) {
      const actor = await actorFor(userId);
      const rows = await deps.messaging.listForParticipant(actor.id);
      return { data: await Promise.all(rows.map((row) => present(actor.id, row))) };
    },

    async open(userId: string, input: OpenConversationInput, requestId?: string) {
      const actor = await actorFor(userId);
      if (input.type === "DIRECT") {
        if ("withMentor" in input) {
          if (actor.role !== "STUDENT") {
            return forbid(actor.id, null, requestId, "You can only message your assigned mentor.");
          }
          const active = await deps.assignments.findActiveByStudent(actor.id);
          const mentor = active ? await deps.users.findById(active.mentorId) : null;
          if (!mentor || mentor.status !== "ACTIVE" || mentor.role !== "MENTOR") {
            throw new AppError(422, "UNPROCESSABLE", "You do not have a mentor yet.");
          }
          return openBetween(actor, mentor, "MENTORSHIP");
        }
        const other =
          "email" in input ? await deps.users.findByEmail(input.email) : await deps.users.findById(input.participantId);
        const decision = await pairDecision(actor, other);
        if (!decision) {
          return forbid(actor.id, other?.id ?? null, requestId, "You cannot message this person.");
        }
        return openBetween(actor, decision.other, decision.purpose);
      }

      const settings = await deps.settings.get();
      if (!settings.groupChat || (actor.role !== "STUDENT" && actor.role !== "MENTOR")) {
        return forbid(actor.id, null, requestId, "Group chat is turned off.");
      }
      const requested = "emails" in input ? input.emails : input.participantIds;
      const resolved: UserRecord[] = [];
      for (const token of requested) {
        const person = "emails" in input ? await deps.users.findByEmail(token) : await deps.users.findById(token);
        if (!person || person.status !== "ACTIVE" || (person.role !== "STUDENT" && person.role !== "MENTOR")) {
          return forbid(actor.id, person?.id ?? null, requestId, "That group cannot be created.");
        }
        resolved.push(person);
      }
      const participantIds = [...new Set([actor.id, ...resolved.map((person) => person.id)])];
      if (participantIds.length < 3) {
        throw new AppError(422, "UNPROCESSABLE", "A group needs at least three people.");
      }
      const title = stripHtml(input.title ?? "Group chat").trim() || "Group chat";
      const stored = await deps.messaging.insert({
        type: "GROUP",
        purpose: "GROUP",
        participantIds,
        pairKey: null,
        title,
        createdBy: actor.id,
        createdAt: now(),
      });
      return { conversation: await present(actor.id, stored.conversation), created: true };
    },

    async messages(userId: string, conversationId: string, page: number, limit: number, requestId?: string) {
      const conversation = await requireReadable(userId, conversationId, requestId);
      const pageResult = await deps.messaging.listMessages(conversation.id, page, limit);
      const people = await names(pageResult.rows.map((row) => row.senderId));
      return {
        data: pageResult.rows.map((row) => presentMessage(row, people)),
        page,
        limit,
        total: pageResult.total,
      };
    },

    async send(userId: string, conversationId: string, input: SendMessageInput, requestId?: string) {
      const actor = await actorFor(userId);
      const conversation = await deps.messaging.findById(conversationId);
      if (!conversation || !conversation.participantIds.includes(actor.id)) {
        return forbid(actor.id, conversationId, requestId);
      }
      if (!(await canWrite(actor.id, conversation))) {
        return forbid(actor.id, conversation.id, requestId, "This conversation is closed to new messages.");
      }
      const body = stripHtml(input.body).trim();
      if (!body) {
        throw new AppError(400, "VALIDATION_ERROR", "Write a message.", [{ path: "body", message: "Write a message." }]);
      }
      const attachments = await confirmAttachments(actor.id, input.attachments ?? []);
      const sentAt = now();
      const message = await deps.messaging.insertMessage({
        conversationId: conversation.id,
        senderId: actor.id,
        body,
        attachments,
        sentAt,
      });
      await deps.messaging.touch(conversation.id, sentAt);
      await deps.bus.emit({
        action: "message.created",
        actorId: actor.id,
        subjectType: "Message",
        subjectId: message.id,
        after: {
          conversationId: conversation.id,
          messageId: message.id,
          senderId: actor.id,
          participantIds: conversation.participantIds,
        },
        requestId: requestId ?? null,
      });
      const people = await names([actor.id]);
      return presentMessage(message, people);
    },

    async markRead(userId: string, conversationId: string, messageId: string, requestId?: string) {
      const conversation = await requireReadable(userId, conversationId, requestId);
      const message = await deps.messaging.findMessage(messageId);
      if (!message || message.conversationId !== conversation.id) {
        throw new AppError(404, "NOT_FOUND", "That message was not found.");
      }
      const readAt = now();
      await deps.messaging.markRead(conversation.id, userId, message.sentAt, readAt);
      deps.delivery.messageRead(conversation.id, userId, message.id);
      return { messageId: message.id, readAt: readAt.toISOString() };
    },

    async breakGlass(userId: string, conversationId: string, reason: string, requestId?: string) {
      const actor = await actorFor(userId);
      if (actor.role !== "ADMIN") {
        return forbid(actor.id, conversationId, requestId);
      }
      const trimmed = reason.trim();
      if (!trimmed) {
        throw new AppError(400, "VALIDATION_ERROR", "A reason is required.", [
          { path: "reason", message: "A reason is required." },
        ]);
      }
      const conversation = await deps.messaging.findById(conversationId);
      if (!conversation) {
        throw new AppError(404, "NOT_FOUND", "That conversation was not found.");
      }
      await deps.bus.emit({
        action: "security.break_glass",
        actorId: actor.id,
        subjectType: "Conversation",
        subjectId: conversation.id,
        reason: trimmed,
        after: { participantCount: String(conversation.participantIds.length) },
        requestId: requestId ?? null,
      });
      const pageResult = await deps.messaging.listMessages(conversation.id, 1, 50);
      const people = await names([...pageResult.rows.map((row) => row.senderId), ...conversation.participantIds]);
      return {
        data: pageResult.rows.map((row) => presentMessage(row, people)),
        page: 1,
        limit: 50,
        total: pageResult.total,
      };
    },

    requireParticipant(userId: string, conversationId: string, requestId?: string) {
      return requireReadable(userId, conversationId, requestId);
    },
  };
}

export type MessagingService = ReturnType<typeof createMessagingService>;
