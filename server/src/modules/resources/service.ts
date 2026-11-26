import {
  DOWNLOAD_URL_TTL_SECONDS,
  UPLOAD_URL_TTL_SECONDS,
  createResourceSchema,
  type CreateResourceInput,
  type PublishResourceInput,
  type ResourceListQuery,
  type UpdateResourceInput,
  type Visibility,
} from "@dhruva/shared";
import { randomUUID } from "node:crypto";
import type { EventBus } from "../../events/bus.js";
import { AppError } from "../../middleware/errors.js";
import type { ObjectStorage } from "../../platform/storage.js";
import type { CohortRepository } from "../cohorts/repository.js";
import type { AssignmentRepository } from "../mentors/assignments.js";
import type { UserRepository } from "../users/repository.js";
import { canViewResource, type ResourceViewer } from "./access.js";

export type ResourceGrantSource = {
  resourceIdsFor(viewer: Pick<ResourceViewer, "id" | "role">): Promise<Set<string>>;
};
import { stripHtml } from "./markdown.js";
import type { ResourceRecord, ResourceRepository, ResourceUpdate } from "./repository.js";
import { presentResource, summarizeResource } from "./serialize.js";
import type { UploadIntentRepository } from "./uploads.js";

const MAX_ATTACHMENTS = 20;

type Actor = ResourceViewer & {
  capabilities: { canCreateResources: boolean };
};

export type ResourceServiceDeps = {
  resources: ResourceRepository;
  uploads: UploadIntentRepository;
  storage: ObjectStorage;
  users: UserRepository;
  cohorts: CohortRepository;
  assignments: AssignmentRepository;
  bus: EventBus;
  grants?: ResourceGrantSource;
  now?: () => Date;
};

function safeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "file";
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/u, "").slice(0, 80);
  return cleaned || "file";
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

function mimeMatches(actual: string | null, expected: string): boolean {
  if (!actual) {
    return true;
  }
  return actual.split(";")[0]?.trim().toLowerCase() === expected.toLowerCase();
}

function normalize(value: CreateResourceInput): CreateResourceInput {
  const coding = value.type === "CODING_EXERCISE";
  return createResourceSchema.parse({
    title: stripHtml(value.title),
    description: stripHtml(value.description),
    type: value.type,
    content: stripHtml(value.content),
    externalLink: value.externalLink,
    topic: stripHtml(value.topic),
    tags: value.tags.map((tag) => stripHtml(tag).trim()).filter((tag) => tag.length > 0),
    difficulty: value.difficulty,
    estimatedDurationMin: value.estimatedDurationMin,
    language: coding && value.language ? stripHtml(value.language) : null,
    testCases: coding
      ? value.testCases.map((item) => ({
          name: stripHtml(item.name),
          input: stripHtml(item.input),
          expectedOutput: stripHtml(item.expectedOutput),
          hidden: item.hidden,
        }))
      : [],
  });
}

function sortResources(rows: ResourceRecord[], sort: ResourceListQuery["sort"]): ResourceRecord[] {
  const descending = sort.startsWith("-");
  const field = (descending ? sort.slice(1) : sort) as "title" | "createdAt" | "updatedAt";
  const direction = descending ? -1 : 1;
  return [...rows].sort((left, right) => {
    const a = field === "title" ? left.title.toLowerCase() : left[field].getTime();
    const b = field === "title" ? right.title.toLowerCase() : right[field].getTime();
    if (a < b) {
      return -1 * direction;
    }
    if (a > b) {
      return 1 * direction;
    }
    return 0;
  });
}

export function createResourceService(deps: ResourceServiceDeps) {
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
      capabilities: user.capabilities,
    };
  }

  async function forbid(actorId: string, subjectId: string | null, requestId: string | undefined, message?: string): Promise<never> {
    await deps.bus.emit({
      action: "security.access_denied",
      actorId,
      subjectType: "Resource",
      subjectId,
      requestId: requestId ?? null,
    });
    throw new AppError(403, "FORBIDDEN", message ?? "You do not have access to this.");
  }

  function canAuthor(actor: Actor): boolean {
    return actor.role === "ADMIN" || (actor.role === "MENTOR" && actor.capabilities.canCreateResources);
  }

  function canEdit(actor: Actor, resource: ResourceRecord): boolean {
    if (actor.role === "ADMIN") {
      return true;
    }
    return actor.role === "MENTOR" && actor.capabilities.canCreateResources && resource.createdBy === actor.id;
  }

  async function grantSet(actor: Actor): Promise<Set<string>> {
    if (!deps.grants || actor.role === "ADMIN") {
      return new Set();
    }
    return deps.grants.resourceIdsFor(actor);
  }

  async function visibleResource(id: string, actor: Actor, requestId: string | undefined): Promise<ResourceRecord> {
    const resource = await deps.resources.findById(id);
    if (!resource) {
      if (actor.role === "ADMIN") {
        throw new AppError(404, "NOT_FOUND", "That resource was not found.");
      }
      return forbid(actor.id, null, requestId);
    }
    const grants = await grantSet(actor);
    if (!canViewResource(actor, resource, { viaAssignment: grants.has(resource.id) })) {
      return forbid(actor.id, resource.id, requestId);
    }
    return resource;
  }

  async function editableResource(
    id: string,
    actor: Actor,
    requestId: string | undefined,
  ): Promise<ResourceRecord> {
    const resource = await deps.resources.findById(id);
    if (!resource) {
      if (actor.role === "ADMIN") {
        throw new AppError(404, "NOT_FOUND", "That resource was not found.");
      }
      return forbid(actor.id, null, requestId);
    }
    if (!canEdit(actor, resource)) {
      return forbid(actor.id, resource.id, requestId);
    }
    return resource;
  }

  async function save(resource: ResourceRecord, expectedRevision: number, patch: ResourceUpdate): Promise<ResourceRecord> {
    const updated = await deps.resources.update(resource.id, expectedRevision, patch);
    if (updated === "conflict") {
      throw new AppError(409, "CONFLICT", "This resource changed. Reload it and try again.");
    }
    if (!updated) {
      throw new AppError(404, "NOT_FOUND", "That resource was not found.");
    }
    return updated;
  }

  function contentOf(resource: ResourceRecord, patch: UpdateResourceInput = {}): CreateResourceInput {
    return normalize({
      title: patch.title ?? resource.title,
      description: patch.description ?? resource.description,
      type: patch.type ?? resource.type,
      content: patch.content ?? resource.content,
      externalLink: patch.externalLink === undefined ? resource.externalLink : patch.externalLink,
      topic: patch.topic ?? resource.topic,
      tags: patch.tags ?? resource.tags,
      difficulty: patch.difficulty ?? resource.difficulty,
      estimatedDurationMin: patch.estimatedDurationMin ?? resource.estimatedDurationMin,
      language: patch.language === undefined ? resource.language : patch.language,
      testCases: patch.testCases ?? resource.testCases,
    });
  }

  async function assertTargets(actor: Actor, visibility: Visibility, targetIds: string[], requestId: string | undefined) {
    const targets = unique(targetIds);
    if (actor.role === "ADMIN") {
      if (visibility === "GLOBAL") {
        return targets;
      }
      if (visibility === "COHORT") {
        for (const id of targets) {
          const cohort = await deps.cohorts.findById(id);
          if (!cohort) {
            throw new AppError(400, "VALIDATION_ERROR", "One of the cohorts does not exist.");
          }
        }
        return targets;
      }
      for (const id of targets) {
        const person = await deps.users.findById(id);
        if (!person) {
          throw new AppError(400, "VALIDATION_ERROR", "One of the people does not exist.");
        }
        if (visibility === "MENTOR_GROUP" && person.role !== "MENTOR") {
          throw new AppError(400, "VALIDATION_ERROR", "Mentor group targets must be mentors.");
        }
        if (visibility === "INDIVIDUAL" && person.role !== "STUDENT") {
          throw new AppError(400, "VALIDATION_ERROR", "Individual targets must be students.");
        }
      }
      return targets;
    }

    if (visibility === "GLOBAL" || visibility === "COHORT") {
      return forbid(
        actor.id,
        null,
        requestId,
        "Cohort-wide and global publishing is limited to an administrator.",
      );
    }
    if (visibility === "MENTOR_GROUP") {
      if (targets.length !== 1 || targets[0] !== actor.id) {
        return forbid(actor.id, null, requestId, "You can publish only to your own mentor group.");
      }
      return targets;
    }
    const assigned = await deps.assignments.listActiveByMentor(actor.id);
    const allowed = new Set(assigned.map((row) => row.studentId));
    if (targets.some((id) => !allowed.has(id))) {
      return forbid(actor.id, null, requestId, "You can publish only to students assigned to you.");
    }
    return targets;
  }

  return {
    async list(userId: string, query: ResourceListQuery) {
      const actor = await actorFor(userId);
      const grants = await grantSet(actor);
      const visible = (await deps.resources.list()).filter((resource) =>
        canViewResource(actor, resource, { viaAssignment: grants.has(resource.id) }),
      );
      const filtered = visible.filter((resource) => {
        if (query.status && resource.status !== query.status) {
          return false;
        }
        if (query.topic && resource.topic.toLowerCase() !== query.topic.toLowerCase()) {
          return false;
        }
        if (query.difficulty && resource.difficulty !== query.difficulty) {
          return false;
        }
        if (query.type && resource.type !== query.type) {
          return false;
        }
        return true;
      });
      const sorted = sortResources(filtered, query.sort);
      const start = (query.page - 1) * query.limit;
      return {
        data: sorted.slice(start, start + query.limit).map((resource) => summarizeResource(resource, actor)),
        page: query.page,
        limit: query.limit,
        total: sorted.length,
      };
    },

    async get(userId: string, id: string, requestId?: string) {
      const actor = await actorFor(userId);
      const resource = await visibleResource(id, actor, requestId);
      return { resource, body: presentResource(resource, actor) };
    },

    async create(userId: string, input: CreateResourceInput, requestId?: string) {
      const actor = await actorFor(userId);
      if (!canAuthor(actor)) {
        return forbid(actor.id, null, requestId);
      }
      const content = normalize(input);
      const resource = await deps.resources.create({
        ...content,
        attachments: [],
        visibility: null,
        targetIds: [],
        version: 1,
        status: "DRAFT",
        createdBy: actor.id,
        publishedAt: null,
      });
      return { resource, body: presentResource(resource, actor) };
    },

    async update(userId: string, id: string, expectedRevision: number, input: UpdateResourceInput, requestId?: string) {
      const actor = await actorFor(userId);
      const resource = await editableResource(id, actor, requestId);
      if (resource.status === "ARCHIVED") {
        throw new AppError(409, "INVALID_STATE", "An archived resource cannot be edited.");
      }
      if (resource.revision !== expectedRevision) {
        throw new AppError(409, "CONFLICT", "This resource changed. Reload it and try again.");
      }
      const content = contentOf(resource, input);
      const saved = await save(resource, expectedRevision, {
        ...content,
        attachments: resource.attachments,
        visibility: resource.visibility,
        targetIds: resource.targetIds,
        version: resource.status === "PUBLISHED" ? resource.version + 1 : resource.version,
        status: resource.status,
        publishedAt: resource.publishedAt,
      });
      return { resource: saved, body: presentResource(saved, actor) };
    },

    async publish(userId: string, id: string, expectedRevision: number, input: PublishResourceInput, requestId?: string) {
      const actor = await actorFor(userId);
      const resource = await editableResource(id, actor, requestId);
      if (resource.status === "ARCHIVED") {
        throw new AppError(409, "INVALID_STATE", "An archived resource cannot be published.");
      }
      const targetIds = await assertTargets(actor, input.visibility, input.targetIds, requestId);
      const saved = await save(resource, expectedRevision, {
        ...contentOf(resource),
        attachments: resource.attachments,
        visibility: input.visibility,
        targetIds,
        version: resource.version,
        status: "PUBLISHED",
        publishedAt: resource.publishedAt ?? now(),
      });
      await deps.bus.emit({
        action: "resource.published",
        actorId: actor.id,
        subjectType: "Resource",
        subjectId: saved.id,
        after: { visibility: saved.visibility, targetIds: saved.targetIds, version: saved.version },
        requestId: requestId ?? null,
      });
      return { resource: saved, body: presentResource(saved, actor) };
    },

    async archive(userId: string, id: string, expectedRevision: number, requestId?: string) {
      const actor = await actorFor(userId);
      const resource = await editableResource(id, actor, requestId);
      if (resource.status === "ARCHIVED") {
        throw new AppError(409, "INVALID_STATE", "This resource is already archived.");
      }
      const saved = await save(resource, expectedRevision, {
        ...contentOf(resource),
        attachments: resource.attachments,
        visibility: resource.visibility,
        targetIds: resource.targetIds,
        version: resource.version,
        status: "ARCHIVED",
        publishedAt: resource.publishedAt,
      });
      await deps.bus.emit({
        action: "resource.archived",
        actorId: actor.id,
        subjectType: "Resource",
        subjectId: saved.id,
        before: { status: resource.status },
        after: { status: "ARCHIVED", version: saved.version },
        requestId: requestId ?? null,
      });
      return { resource: saved, body: presentResource(saved, actor) };
    },

    async requestUpload(
      userId: string,
      input: { fileName: string; mimeType: string; sizeBytes: number },
      requestId?: string,
    ) {
      const actor = await actorFor(userId);
      if (!canAuthor(actor)) {
        return forbid(actor.id, null, requestId);
      }
      if (!deps.storage.configured) {
        throw new AppError(422, "UNPROCESSABLE", "File storage is not configured.");
      }
      const storageKey = `resources_${actor.id}_${randomUUID().replace(/-/g, "")}`;
      const slot = await deps.storage.createUploadSlot({
        storageKey,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
      });
      const expiresAt = new Date(now().getTime() + UPLOAD_URL_TTL_SECONDS * 1000);
      await deps.uploads.create({
        storageKey,
        fileName: safeFileName(input.fileName),
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        createdBy: actor.id,
        expiresAt,
      });
      return { ...slot, expiresAt: expiresAt.toISOString() };
    },

    async attach(userId: string, id: string, expectedRevision: number, storageKey: string, requestId?: string) {
      const actor = await actorFor(userId);
      const resource = await editableResource(id, actor, requestId);
      if (resource.status === "ARCHIVED") {
        throw new AppError(409, "INVALID_STATE", "An archived resource cannot be edited.");
      }
      const intent = await deps.uploads.findByKey(storageKey);
      if (!intent || intent.createdBy !== actor.id) {
        throw new AppError(422, "UNPROCESSABLE", "Upload the file before attaching it.");
      }
      if (intent.consumedAt || resource.attachments.some((file) => file.storageKey === storageKey)) {
        throw new AppError(409, "CONFLICT", "That file is already attached.");
      }
      if (intent.expiresAt.getTime() <= now().getTime()) {
        throw new AppError(422, "UNPROCESSABLE", "That upload slot has expired. Request a new one.");
      }
      if (resource.attachments.length >= MAX_ATTACHMENTS) {
        throw new AppError(422, "UNPROCESSABLE", "A resource can have at most 20 files.");
      }
      let remote: { sizeBytes: number; mimeType: string | null } | null;
      try {
        remote = await deps.storage.confirm(storageKey);
      } catch {
        throw new AppError(500, "INTERNAL", "The uploaded file could not be confirmed.");
      }
      if (!remote) {
        throw new AppError(422, "UNPROCESSABLE", "That file is not in storage yet.");
      }
      if (remote.sizeBytes !== intent.sizeBytes || !mimeMatches(remote.mimeType, intent.mimeType)) {
        throw new AppError(422, "UNPROCESSABLE", "The uploaded file does not match the file you declared.");
      }
      const saved = await save(resource, expectedRevision, {
        ...contentOf(resource),
        attachments: [
          ...resource.attachments,
          {
            storageKey,
            fileName: intent.fileName,
            mimeType: intent.mimeType,
            sizeBytes: intent.sizeBytes,
          },
        ],
        visibility: resource.visibility,
        targetIds: resource.targetIds,
        version: resource.status === "PUBLISHED" ? resource.version + 1 : resource.version,
        status: resource.status,
        publishedAt: resource.publishedAt,
      });
      await deps.uploads.consume(intent.id);
      return { resource: saved, body: presentResource(saved, actor) };
    },

    async download(userId: string, id: string, storageKey: string, requestId?: string) {
      const actor = await actorFor(userId);
      const resource = await visibleResource(id, actor, requestId);
      const file = resource.attachments.find((item) => item.storageKey === storageKey);
      if (!file) {
        throw new AppError(404, "NOT_FOUND", "That file was not found.");
      }
      if (!deps.storage.configured) {
        throw new AppError(422, "UNPROCESSABLE", "File storage is not configured.");
      }
      return deps.storage.createDownloadUrl({
        storageKey: file.storageKey,
        fileName: file.fileName,
        mimeType: file.mimeType,
        expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
      });
    },
  };
}

export type ResourceService = ReturnType<typeof createResourceService>;
