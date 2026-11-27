import {
  DOWNLOAD_URL_TTL_SECONDS,
  editorLinkSchema,
  githubRepositorySchema,
  UPLOAD_URL_TTL_SECONDS,
  type ReviewSubmissionInput,
  type Role,
  type SubmissionType,
  type SubmissionUploadInput,
  type UserStatus,
} from "@dhruva/shared";
import { createHash, randomUUID } from "node:crypto";
import { z, type ZodError } from "zod";
import type { EventBus } from "../../events/bus.js";
import { AppError } from "../../middleware/errors.js";
import { presentRecipient } from "../learning/serialize.js";
import { isOverdue } from "../learning/state.js";
import type { RecipientRecord, WorkRecord, WorkRepository } from "../learning/work.js";
import type { AssignmentRepository } from "../mentors/assignments.js";
import { stripHtml } from "../resources/markdown.js";
import type { ResourceRepository } from "../resources/repository.js";
import type { UploadIntentRepository } from "../resources/uploads.js";
import type { ObjectStorage } from "../../platform/storage.js";
import type { UserRepository } from "../users/repository.js";
import type { RevisionRecord, SubmissionRepository } from "./repository.js";
import { MANUAL_RUN_LIMITS, type CodeRunner, type ExecutionGate } from "./runner.js";
import { presentRevision } from "./serialize.js";

const textBody = z.object({ textAnswer: z.string().trim().min(1).max(100_000) }).strict();
const fileBody = z.object({ fileKey: z.string().trim().min(1).max(300) }).strict();
const repositoryBody = z.object({ repositoryUrl: githubRepositorySchema }).strict();
const editorBody = z.object({ editorUrl: editorLinkSchema }).strict();

const SUBMITTABLE = ["IN_PROGRESS", "REVISION_REQUESTED"] as const;

type Actor = {
  id: string;
  role: Role;
  status: UserStatus;
};

type Access = {
  actor: Actor;
  recipient: RecipientRecord;
  assignment: WorkRecord;
  kind: "owner" | "reviewer";
};

type StoredAnswer = {
  submissionType: Exclude<SubmissionType, "NONE">;
  textAnswer: string | null;
  fileKey: string | null;
  fileName: string | null;
  mimeType: string | null;
  repositoryUrl: string | null;
  editorUrl: string | null;
};

export type SubmissionServiceDeps = {
  users: UserRepository;
  mentorAssignments: AssignmentRepository;
  resources: ResourceRepository;
  work: WorkRepository;
  revisions: SubmissionRepository;
  uploads: UploadIntentRepository;
  storage: ObjectStorage;
  bus: EventBus;
  runner: CodeRunner;
  execution: ExecutionGate;
  now?: () => Date;
};

function fieldErrors(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join(".") : "(root)",
    message: issue.message,
  }));
}

function bodyHash(answer: StoredAnswer): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        submissionType: answer.submissionType,
        textAnswer: answer.textAnswer,
        fileKey: answer.fileKey,
        repositoryUrl: answer.repositoryUrl,
        editorUrl: answer.editorUrl,
      }),
    )
    .digest("hex");
}

function safeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "file";
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/u, "").slice(0, 80);
  return cleaned || "file";
}

function mimeMatches(actual: string | null, expected: string): boolean {
  if (!actual) {
    return true;
  }
  return actual.split(";")[0]?.trim().toLowerCase() === expected.toLowerCase();
}

function expectation(type: SubmissionType): string {
  if (type === "TEXT") {
    return "This assignment expects a text answer.";
  }
  if (type === "FILE") {
    return "This assignment expects an uploaded file.";
  }
  if (type === "REPOSITORY") {
    return "This assignment expects a GitHub repository link.";
  }
  if (type === "EDITOR_LINK") {
    return "This assignment expects an editor link.";
  }
  return "This assignment does not accept a submission.";
}

export function createSubmissionService(deps: SubmissionServiceDeps) {
  const now = deps.now ?? (() => new Date());

  async function actorFor(userId: string): Promise<Actor> {
    const user = await deps.users.findById(userId);
    if (!user || user.status !== "ACTIVE") {
      throw new AppError(401, "UNAUTHENTICATED", "Sign in to continue.");
    }
    return { id: user.id, role: user.role, status: user.status };
  }

  async function forbid(actorId: string, subjectId: string | null, requestId: string | undefined): Promise<never> {
    await deps.bus.emit({
      action: "security.access_denied",
      actorId,
      subjectType: "Submission",
      subjectId,
      requestId: requestId ?? null,
    });
    throw new AppError(403, "FORBIDDEN", "You do not have access to this.");
  }

  async function load(userId: string, recipientId: string, requestId: string | undefined): Promise<Access> {
    const actor = await actorFor(userId);
    const recipient = await deps.work.findRecipient(recipientId);
    if (!recipient) {
      if (actor.role === "ADMIN") {
        throw new AppError(404, "NOT_FOUND", "That assignment was not found.");
      }
      return forbid(actor.id, recipientId, requestId);
    }
    const assignment = await deps.work.findById(recipient.assignmentId);
    if (!assignment || assignment.status === "DRAFT") {
      if (actor.role === "ADMIN") {
        throw new AppError(404, "NOT_FOUND", "That assignment was not found.");
      }
      return forbid(actor.id, recipientId, requestId);
    }
    if (actor.role === "STUDENT" && actor.id === recipient.studentId) {
      return { actor, recipient, assignment, kind: "owner" };
    }
    if (actor.role === "ADMIN") {
      return { actor, recipient, assignment, kind: "reviewer" };
    }
    if (actor.role === "MENTOR") {
      const active = await deps.mentorAssignments.findActiveByStudent(recipient.studentId);
      if (active?.mentorId === actor.id) {
        return { actor, recipient, assignment, kind: "reviewer" };
      }
    }
    return forbid(actor.id, recipientId, requestId);
  }

  function view(access: Access, recipient: RecipientRecord) {
    return presentRecipient(
      recipient,
      access.assignment,
      isOverdue(access.assignment.dueDate, recipient.state, now()),
      access.kind === "reviewer",
    );
  }

  function outcome(access: Access, revision: RevisionRecord, recipient: RecipientRecord) {
    return { revision: presentRevision(revision), recipient: view(access, recipient) };
  }

  async function resourceVersion(assignment: WorkRecord): Promise<number | null> {
    if (!assignment.resourceId) {
      return null;
    }
    const resource = await deps.resources.findById(assignment.resourceId);
    return resource?.version ?? null;
  }

  async function parseAnswer(assignment: WorkRecord, body: unknown): Promise<StoredAnswer> {
    if (assignment.submissionType === "NONE") {
      throw new AppError(422, "UNPROCESSABLE", expectation("NONE"));
    }
    const type = assignment.submissionType;
    const parsed =
      type === "TEXT"
        ? textBody.safeParse(body)
        : type === "FILE"
          ? fileBody.safeParse(body)
          : type === "REPOSITORY"
            ? repositoryBody.safeParse(body)
            : editorBody.safeParse(body);
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", expectation(type), fieldErrors(parsed.error));
    }
    const empty: StoredAnswer = {
      submissionType: type,
      textAnswer: null,
      fileKey: null,
      fileName: null,
      mimeType: null,
      repositoryUrl: null,
      editorUrl: null,
    };
    if ("textAnswer" in parsed.data) {
      const textAnswer = stripHtml(parsed.data.textAnswer).trim();
      if (!textAnswer) {
        throw new AppError(400, "VALIDATION_ERROR", expectation(type), [
          { path: "textAnswer", message: "Write an answer." },
        ]);
      }
      return { ...empty, textAnswer };
    }
    if ("fileKey" in parsed.data) {
      return { ...empty, fileKey: parsed.data.fileKey };
    }
    if ("repositoryUrl" in parsed.data) {
      return { ...empty, repositoryUrl: parsed.data.repositoryUrl };
    }
    return { ...empty, editorUrl: parsed.data.editorUrl };
  }

  async function confirmFile(actorId: string, fileKey: string): Promise<{ fileName: string; mimeType: string; intentId: string }> {
    const intent = await deps.uploads.findByKey(fileKey);
    if (!intent || intent.createdBy !== actorId) {
      throw new AppError(422, "UNPROCESSABLE", "Upload the file before submitting it.");
    }
    if (intent.consumedAt) {
      throw new AppError(409, "CONFLICT", "That file is already part of a submission.");
    }
    if (intent.expiresAt.getTime() <= now().getTime()) {
      throw new AppError(422, "UNPROCESSABLE", "That upload slot has expired. Request a new one.");
    }
    if (!deps.storage.configured) {
      throw new AppError(422, "UNPROCESSABLE", "File storage is not configured.");
    }
    let remote: { sizeBytes: number; mimeType: string | null } | null;
    try {
      remote = await deps.storage.confirm(fileKey);
    } catch {
      throw new AppError(500, "INTERNAL", "The uploaded file could not be confirmed.");
    }
    if (!remote) {
      throw new AppError(422, "UNPROCESSABLE", "That file is not in storage yet.");
    }
    if (remote.sizeBytes !== intent.sizeBytes || !mimeMatches(remote.mimeType, intent.mimeType)) {
      throw new AppError(422, "UNPROCESSABLE", "The uploaded file does not match the file you declared.");
    }
    return { fileName: intent.fileName, mimeType: intent.mimeType, intentId: intent.id };
  }

  async function freshRecipient(access: Access): Promise<RecipientRecord> {
    const current = await deps.work.findRecipient(access.recipient.id);
    if (!current) {
      throw new AppError(404, "NOT_FOUND", "That assignment was not found.");
    }
    return current;
  }

  async function replay(access: Access, existing: RevisionRecord, hash: string, requestId: string | undefined) {
    if (existing.bodyHash !== hash) {
      throw new AppError(409, "CONFLICT", "This Idempotency-Key was already used for a different submission.");
    }
    let recipient = await freshRecipient(access);
    if (recipient.state === "IN_PROGRESS" || recipient.state === "REVISION_REQUESTED") {
      const moved = await deps.work.transitionRecipient(recipient.id, [...SUBMITTABLE], {
        state: "SUBMITTED",
        submittedAt: existing.submittedAt,
      });
      if (moved && moved !== "stale") {
        recipient = moved;
        if (existing.fileKey) {
          const intent = await deps.uploads.findByKey(existing.fileKey);
          if (intent && !intent.consumedAt) {
            await deps.uploads.consume(intent.id);
          }
        }
        await emitCreated(access, existing, requestId);
      } else {
        recipient = await freshRecipient(access);
      }
    }
    return outcome(access, existing, recipient);
  }

  async function emitCreated(access: Access, revision: RevisionRecord, requestId: string | undefined) {
    await deps.bus.emit({
      action: "submission.created",
      actorId: access.actor.id,
      subjectType: "SubmissionRevision",
      subjectId: revision.id,
      after: {
        recipientId: access.recipient.id,
        studentId: access.recipient.studentId,
        assignmentId: access.assignment.id,
        revisionNo: revision.revisionNo,
        resourceVersion: revision.resourceVersion,
      },
      requestId: requestId ?? null,
    });
  }

  async function judge(access: Access, answer: StoredAnswer) {
    if (!deps.execution.enabled() || !access.assignment.language) {
      return;
    }
    const source = answer.textAnswer ?? answer.repositoryUrl ?? answer.editorUrl ?? answer.fileKey ?? "";
    try {
      await deps.runner.run({
        source,
        language: access.assignment.language,
        tests: access.assignment.testCases.map((item) => ({
          name: item.name,
          input: item.input,
          expectedOutput: item.expectedOutput,
        })),
        limits: MANUAL_RUN_LIMITS,
      });
    } catch {
      // Judging is optional. The revision stays pending for a mentor either way.
    }
  }

  async function latest(recipientId: string): Promise<RevisionRecord | null> {
    const history = await deps.revisions.listForRecipient(recipientId);
    return history.at(-1) ?? null;
  }

  function scoresFor(assignment: WorkRecord, input: ReviewSubmissionInput) {
    const scores = [];
    const seen = new Set<string>();
    for (const row of input.rubricScores) {
      const name = stripHtml(row.criterion).trim();
      const criterion = assignment.rubric.find((item) => item.criterion === name);
      if (!criterion) {
        throw new AppError(422, "UNPROCESSABLE", "That rubric criterion is not on this assignment.");
      }
      if (seen.has(criterion.criterion)) {
        throw new AppError(422, "UNPROCESSABLE", "Score each rubric criterion once.");
      }
      if (row.points > criterion.maxPoints) {
        throw new AppError(422, "UNPROCESSABLE", "A rubric score cannot exceed its maximum.");
      }
      seen.add(criterion.criterion);
      scores.push({ criterion: criterion.criterion, points: row.points });
    }
    return scores;
  }

  return {
    async start(userId: string, recipientId: string, requestId?: string) {
      const access = await load(userId, recipientId, requestId);
      if (access.kind !== "owner") {
        return forbid(access.actor.id, recipientId, requestId);
      }
      if (access.assignment.status === "ARCHIVED" && access.recipient.state === "NOT_STARTED") {
        throw new AppError(409, "INVALID_STATE", "This assignment is archived.");
      }
      if (access.recipient.state === "IN_PROGRESS") {
        return view(access, access.recipient);
      }
      if (access.recipient.state !== "NOT_STARTED") {
        throw new AppError(409, "INVALID_STATE", "This assignment cannot be started from its current state.");
      }
      const moved = await deps.work.transitionRecipient(access.recipient.id, ["NOT_STARTED"], {
        state: "IN_PROGRESS",
        startedAt: now(),
      });
      if (moved === "stale") {
        const current = await freshRecipient(access);
        if (current.state === "IN_PROGRESS") {
          return view(access, current);
        }
        throw new AppError(409, "INVALID_STATE", "This assignment cannot be started from its current state.");
      }
      if (!moved) {
        throw new AppError(404, "NOT_FOUND", "That assignment was not found.");
      }
      await deps.bus.emit({
        action: "assignment.started",
        actorId: access.actor.id,
        subjectType: "Assignment",
        subjectId: access.assignment.id,
        after: { studentId: access.recipient.studentId, assignmentId: access.assignment.id, recipientId: moved.id },
        requestId: requestId ?? null,
      });
      return view(access, moved);
    },

    async list(userId: string, recipientId: string, requestId?: string) {
      const access = await load(userId, recipientId, requestId);
      const rows = await deps.revisions.listForRecipient(access.recipient.id);
      return rows.map((row) => presentRevision(row));
    },

    async submit(userId: string, recipientId: string, body: unknown, idempotencyKey: string, requestId?: string) {
      const access = await load(userId, recipientId, requestId);
      if (access.kind !== "owner") {
        return forbid(access.actor.id, recipientId, requestId);
      }
      const answer = await parseAnswer(access.assignment, body);
      const hash = bodyHash(answer);
      const existing = await deps.revisions.findByKey(access.recipient.id, idempotencyKey);
      if (existing) {
        return replay(access, existing, hash, requestId);
      }
      if (access.assignment.status === "ARCHIVED") {
        throw new AppError(409, "INVALID_STATE", "This assignment is archived.");
      }
      const recipient = await freshRecipient(access);
      if (recipient.state !== "IN_PROGRESS" && recipient.state !== "REVISION_REQUESTED") {
        throw new AppError(409, "INVALID_STATE", "Open the assignment before submitting it.");
      }
      let intentId: string | null = null;
      if (answer.fileKey) {
        const file = await confirmFile(access.actor.id, answer.fileKey);
        answer.fileName = file.fileName;
        answer.mimeType = file.mimeType;
        intentId = file.intentId;
      }
      const history = await deps.revisions.listForRecipient(recipient.id);
      let revisionNo = history.reduce((max, row) => Math.max(max, row.revisionNo), 0) + 1;
      const submittedAt = now();
      const version = await resourceVersion(access.assignment);
      let created: RevisionRecord | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const inserted = await deps.revisions.insert({
          recipientId: recipient.id,
          studentId: recipient.studentId,
          revisionNo,
          submissionType: answer.submissionType,
          textAnswer: answer.textAnswer,
          fileKey: answer.fileKey,
          fileName: answer.fileName,
          mimeType: answer.mimeType,
          repositoryUrl: answer.repositoryUrl,
          editorUrl: answer.editorUrl,
          resourceVersion: version,
          submittedAt,
          idempotencyKey,
          bodyHash: hash,
        });
        if (inserted.kind === "created") {
          created = inserted.revision;
          break;
        }
        if (inserted.field === "key") {
          if (!inserted.revision) {
            throw new AppError(409, "CONFLICT", "This Idempotency-Key was already used for a different submission.");
          }
          return replay(access, inserted.revision, hash, requestId);
        }
        revisionNo += 1;
      }
      if (!created) {
        throw new AppError(409, "CONFLICT", "The submission could not be stored. Try again.");
      }
      const moved = await deps.work.transitionRecipient(recipient.id, [...SUBMITTABLE], {
        state: "SUBMITTED",
        submittedAt,
      });
      if (!moved || moved === "stale") {
        await deps.revisions.remove(created.id);
        if (!moved) {
          throw new AppError(404, "NOT_FOUND", "That assignment was not found.");
        }
        throw new AppError(409, "INVALID_STATE", "Open the assignment before submitting it.");
      }
      if (intentId) {
        await deps.uploads.consume(intentId);
      }
      await judge(access, answer);
      await emitCreated(access, created, requestId);
      return outcome(access, created, moved);
    },

    async requestUpload(userId: string, recipientId: string, input: SubmissionUploadInput, requestId?: string) {
      const access = await load(userId, recipientId, requestId);
      if (access.kind !== "owner") {
        return forbid(access.actor.id, recipientId, requestId);
      }
      if (access.assignment.submissionType !== "FILE") {
        throw new AppError(422, "UNPROCESSABLE", "This assignment does not accept a file.");
      }
      if (access.assignment.status === "ARCHIVED") {
        throw new AppError(409, "INVALID_STATE", "This assignment is archived.");
      }
      const recipient = await freshRecipient(access);
      if (recipient.state !== "IN_PROGRESS" && recipient.state !== "REVISION_REQUESTED") {
        throw new AppError(409, "INVALID_STATE", "Open the assignment before uploading a file.");
      }
      if (!deps.storage.configured) {
        throw new AppError(422, "UNPROCESSABLE", "File storage is not configured.");
      }
      const storageKey = `submissions_${access.actor.id}_${randomUUID().replace(/-/g, "")}`;
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
        createdBy: access.actor.id,
        expiresAt,
      });
      return { ...slot, expiresAt: expiresAt.toISOString() };
    },

    async openReview(userId: string, revisionId: string, requestId?: string) {
      const revision = await deps.revisions.findById(revisionId);
      if (!revision) {
        const actor = await actorFor(userId);
        if (actor.role === "ADMIN") {
          throw new AppError(404, "NOT_FOUND", "That submission was not found.");
        }
        return forbid(actor.id, revisionId, requestId);
      }
      const access = await load(userId, revision.recipientId, requestId);
      if (access.kind !== "reviewer") {
        return forbid(access.actor.id, revision.id, requestId);
      }
      const currentLatest = await latest(access.recipient.id);
      if (!currentLatest || currentLatest.id !== revision.id || revision.status !== "PENDING") {
        throw new AppError(409, "INVALID_STATE", "Review the latest revision.");
      }
      const recipient = await freshRecipient(access);
      if (recipient.state === "UNDER_REVIEW") {
        return outcome(access, revision, recipient);
      }
      if (recipient.state !== "SUBMITTED") {
        throw new AppError(409, "INVALID_STATE", "This submission is not waiting for review.");
      }
      const moved = await deps.work.transitionRecipient(recipient.id, ["SUBMITTED"], { state: "UNDER_REVIEW" });
      if (moved === "stale") {
        const again = await freshRecipient(access);
        if (again.state === "UNDER_REVIEW") {
          return outcome(access, revision, again);
        }
        throw new AppError(409, "INVALID_STATE", "This submission is not waiting for review.");
      }
      if (!moved) {
        throw new AppError(404, "NOT_FOUND", "That assignment was not found.");
      }
      return outcome(access, revision, moved);
    },

    async review(userId: string, revisionId: string, input: ReviewSubmissionInput, requestId?: string) {
      const revision = await deps.revisions.findById(revisionId);
      if (!revision) {
        const actor = await actorFor(userId);
        if (actor.role === "ADMIN") {
          throw new AppError(404, "NOT_FOUND", "That submission was not found.");
        }
        return forbid(actor.id, revisionId, requestId);
      }
      const access = await load(userId, revision.recipientId, requestId);
      if (access.kind !== "reviewer") {
        return forbid(access.actor.id, revision.id, requestId);
      }
      const currentLatest = await latest(access.recipient.id);
      if (!currentLatest || currentLatest.id !== revision.id || revision.status !== "PENDING") {
        throw new AppError(409, "INVALID_STATE", "Review the latest revision.");
      }
      const recipient = await freshRecipient(access);
      if (recipient.state !== "UNDER_REVIEW") {
        throw new AppError(409, "INVALID_STATE", "Open the submission before reviewing it.");
      }
      const feedback = stripHtml(input.feedback).trim();
      if (!feedback) {
        throw new AppError(400, "VALIDATION_ERROR", "Write feedback.", [{ path: "feedback", message: "Write feedback." }]);
      }
      const rubricScores = scoresFor(access.assignment, input);
      const approving = input.decision === "APPROVE";
      const marked = await deps.revisions.markReviewed(revision.id, {
        status: approving ? "APPROVED" : "REVISION_REQUESTED",
        score: approving ? input.score : null,
        rubricScores,
        feedback,
        reviewedBy: access.actor.id,
        reviewedAt: now(),
      });
      if (marked === "stale") {
        throw new AppError(409, "INVALID_STATE", "This revision was already reviewed.");
      }
      if (!marked) {
        throw new AppError(404, "NOT_FOUND", "That submission was not found.");
      }
      const moved = await deps.work.transitionRecipient(
        recipient.id,
        ["UNDER_REVIEW"],
        approving
          ? { state: "COMPLETED", completedAt: marked.reviewedAt, score: input.score }
          : { state: "REVISION_REQUESTED" },
      );
      if (!moved || moved === "stale") {
        await deps.revisions.revertReview(revision.id);
        throw new AppError(409, "INVALID_STATE", "Open the submission before reviewing it.");
      }
      await deps.bus.emit({
        action: "submission.reviewed",
        actorId: access.actor.id,
        subjectType: "SubmissionRevision",
        subjectId: marked.id,
        after: {
          recipientId: recipient.id,
          studentId: recipient.studentId,
          decision: input.decision,
          state: moved.state,
        },
        requestId: requestId ?? null,
      });
      return outcome(access, marked, moved);
    },

    async download(userId: string, revisionId: string, requestId?: string) {
      const revision = await deps.revisions.findById(revisionId);
      if (!revision) {
        const actor = await actorFor(userId);
        if (actor.role === "ADMIN") {
          throw new AppError(404, "NOT_FOUND", "That submission was not found.");
        }
        return forbid(actor.id, revisionId, requestId);
      }
      await load(userId, revision.recipientId, requestId);
      if (!revision.fileKey) {
        throw new AppError(404, "NOT_FOUND", "That submission has no file.");
      }
      if (!deps.storage.configured) {
        throw new AppError(422, "UNPROCESSABLE", "File storage is not configured.");
      }
      return deps.storage.createDownloadUrl({
        storageKey: revision.fileKey,
        fileName: revision.fileName ?? "submission",
        mimeType: revision.mimeType ?? "application/octet-stream",
        expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
      });
    },
  };
}

export type SubmissionService = ReturnType<typeof createSubmissionService>;
