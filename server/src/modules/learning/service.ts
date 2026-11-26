import {
  createAssignmentSchema,
  type CreateAssignmentInput,
  type LearningPathWrite,
  type UpdateAssignmentInput,
} from "@dhruva/shared";
import type { EventBus } from "../../events/bus.js";
import { AppError } from "../../middleware/errors.js";
import type { CohortRepository } from "../cohorts/repository.js";
import type { AssignmentRepository } from "../mentors/assignments.js";
import { canViewResource, type ResourceViewer } from "../resources/access.js";
import { stripHtml } from "../resources/markdown.js";
import type { ResourceRepository } from "../resources/repository.js";
import type { UserRecord, UserRepository } from "../users/repository.js";
import type { Role, UserStatus } from "@dhruva/shared";
import { buildDailyPlan } from "./plan.js";
import type { LearningPathRepository, PathRecord, PathWrite } from "./paths.js";
import { presentAssignment, presentPath, presentRecipient, summarizePath } from "./serialize.js";
import { isOverdue, utcDay } from "./state.js";
import { resolveTargetStudents, type TargetSpec } from "./targets.js";
import type { WorkRecord, WorkRepository, WorkWrite } from "./work.js";

type Actor = {
  id: string;
  role: Role;
  status: UserStatus;
  cohortId: string | null;
};

export type LearningServiceDeps = {
  users: UserRepository;
  cohorts: CohortRepository;
  mentorAssignments: AssignmentRepository;
  resources: ResourceRepository;
  paths: LearningPathRepository;
  work: WorkRepository;
  bus: EventBus;
  now?: () => Date;
};

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function cleanPath(input: LearningPathWrite): PathWrite {
  return {
    title: stripHtml(input.title),
    description: stripHtml(input.description),
    cohortId: input.cohortId,
    durationDays: input.durationDays,
    modules: input.modules.map((module) => ({
      order: module.order,
      title: stripHtml(module.title),
      weeks: module.weeks.map((week) => ({
        weekNumber: week.weekNumber,
        title: stripHtml(week.title),
        days: week.days.map((day) => ({
          dayNumber: day.dayNumber,
          title: stripHtml(day.title),
          items: day.items.map((item) => ({ kind: item.kind, refId: item.refId, required: item.required })),
        })),
      })),
    })),
  };
}

function cleanAssignment(input: CreateAssignmentInput): WorkWrite {
  return {
    title: stripHtml(input.title),
    description: stripHtml(input.description),
    resourceId: input.resourceId,
    targetType: input.targetType,
    targetIds: unique(input.targetIds),
    branches: unique(input.branches),
    dueDate: new Date(input.dueDate),
    priority: input.priority,
    submissionType: input.submissionType,
    language: input.language ? stripHtml(input.language) : null,
    testCases: input.testCases.map((item) => ({
      name: stripHtml(item.name),
      input: stripHtml(item.input),
      expectedOutput: stripHtml(item.expectedOutput),
      hidden: item.hidden,
    })),
    rubric: input.rubric.map((item) => ({ criterion: stripHtml(item.criterion), maxPoints: item.maxPoints })),
  };
}

function mergedAssignment(current: WorkRecord, patch: UpdateAssignmentInput): CreateAssignmentInput {
  return createAssignmentSchema.parse({
    title: patch.title ?? current.title,
    description: patch.description ?? current.description,
    resourceId: patch.resourceId === undefined ? current.resourceId : patch.resourceId,
    targetType: patch.targetType ?? current.targetType,
    targetIds: patch.targetIds ?? current.targetIds,
    branches: patch.branches ?? current.branches,
    dueDate: patch.dueDate ?? current.dueDate.toISOString(),
    priority: patch.priority ?? current.priority,
    submissionType: patch.submissionType ?? current.submissionType,
    language: patch.language === undefined ? current.language : patch.language,
    testCases: patch.testCases ?? current.testCases,
    rubric: patch.rubric ?? current.rubric,
  });
}

export function createLearningService(deps: LearningServiceDeps) {
  const now = deps.now ?? (() => new Date());

  async function actorFor(userId: string): Promise<Actor> {
    const user = await deps.users.findById(userId);
    if (!user || user.status !== "ACTIVE") {
      throw new AppError(401, "UNAUTHENTICATED", "Sign in to continue.");
    }
    return { id: user.id, role: user.role, status: user.status, cohortId: user.cohortId };
  }

  async function forbid(actorId: string, subjectId: string | null, requestId: string | undefined, message?: string): Promise<never> {
    await deps.bus.emit({
      action: "security.access_denied",
      actorId,
      subjectType: "Assignment",
      subjectId,
      requestId: requestId ?? null,
    });
    throw new AppError(403, "FORBIDDEN", message ?? "You do not have access to this.");
  }

  async function viewer(actor: Actor): Promise<ResourceViewer> {
    const assignment = actor.role === "STUDENT" ? await deps.mentorAssignments.findActiveByStudent(actor.id) : null;
    return {
      id: actor.id,
      role: actor.role,
      status: actor.status,
      cohortId: actor.cohortId,
      activeMentorId: assignment?.mentorId ?? null,
    };
  }

  async function assertCohort(cohortId: string): Promise<void> {
    const cohort = await deps.cohorts.findById(cohortId);
    if (!cohort) {
      throw new AppError(400, "VALIDATION_ERROR", "That cohort does not exist.", [
        { path: "cohortId", message: "That cohort does not exist." },
      ]);
    }
  }

  async function assertPathRefs(path: PathWrite): Promise<void> {
    for (const module of path.modules) {
      for (const week of module.weeks) {
        for (const day of week.days) {
          for (const item of day.items) {
            if (item.kind !== "RESOURCE") {
              continue;
            }
            const resource = await deps.resources.findById(item.refId);
            if (!resource) {
              throw new AppError(400, "VALIDATION_ERROR", "One of the resources does not exist.", [
                { path: "modules", message: "One of the resources does not exist." },
              ]);
            }
          }
        }
      }
    }
  }

  async function assertTargets(actor: Actor, target: TargetSpec, requestId: string | undefined): Promise<void> {
    if (actor.role === "MENTOR") {
      if (target.targetType === "COHORT" || target.targetType === "BRANCH") {
        return forbid(actor.id, null, requestId, "You can assign work only to your own students.");
      }
      if (target.targetType === "MENTOR_GROUP") {
        if (target.targetIds.length !== 1 || target.targetIds[0] !== actor.id) {
          return forbid(actor.id, null, requestId, "You can assign work only to your own students.");
        }
        return;
      }
      const rows = await deps.mentorAssignments.listActiveByMentor(actor.id);
      const allowed = new Set(rows.map((row) => row.studentId));
      if (target.targetIds.some((id) => !allowed.has(id))) {
        return forbid(actor.id, null, requestId, "You can assign work only to your own students.");
      }
      return;
    }

    if (target.targetType === "COHORT" || target.targetType === "BRANCH") {
      for (const id of target.targetIds) {
        const cohort = await deps.cohorts.findById(id);
        if (!cohort) {
          throw new AppError(400, "VALIDATION_ERROR", "One of the cohorts does not exist.", [
            { path: "targetIds", message: "One of the cohorts does not exist." },
          ]);
        }
      }
      return;
    }
    for (const id of target.targetIds) {
      const person = await deps.users.findById(id);
      if (!person) {
        throw new AppError(400, "VALIDATION_ERROR", "One of the people does not exist.", [
          { path: "targetIds", message: "One of the people does not exist." },
        ]);
      }
      if (target.targetType === "MENTOR_GROUP" && person.role !== "MENTOR") {
        throw new AppError(400, "VALIDATION_ERROR", "Mentor group targets must be mentors.", [
          { path: "targetIds", message: "Mentor group targets must be mentors." },
        ]);
      }
      if (target.targetType === "INDIVIDUAL" && person.role !== "STUDENT") {
        throw new AppError(400, "VALIDATION_ERROR", "Individual targets must be students.", [
          { path: "targetIds", message: "Individual targets must be students." },
        ]);
      }
    }
  }

  async function assertResource(actor: Actor, resourceId: string | null, requestId: string | undefined): Promise<void> {
    if (!resourceId) {
      return;
    }
    const resource = await deps.resources.findById(resourceId);
    if (!resource) {
      throw new AppError(400, "VALIDATION_ERROR", "That resource does not exist.", [
        { path: "resourceId", message: "That resource does not exist." },
      ]);
    }
    if (!canViewResource(await viewer(actor), resource)) {
      return forbid(actor.id, resource.id, requestId, "You cannot attach a resource you cannot see.");
    }
  }

  async function editableAssignment(actor: Actor, id: string, requestId: string | undefined): Promise<WorkRecord> {
    const assignment = await deps.work.findById(id);
    if (!assignment) {
      if (actor.role === "ADMIN") {
        throw new AppError(404, "NOT_FOUND", "That assignment was not found.");
      }
      return forbid(actor.id, null, requestId);
    }
    if (actor.role !== "ADMIN" && assignment.assignedBy !== actor.id) {
      return forbid(actor.id, assignment.id, requestId);
    }
    return assignment;
  }

  async function visibleStudent(actor: Actor, studentId: string, requestId: string | undefined): Promise<UserRecord> {
    const student = await deps.users.findById(studentId);
    if (!student || student.role !== "STUDENT") {
      if (actor.role === "ADMIN") {
        throw new AppError(404, "NOT_FOUND", "That student was not found.");
      }
      return forbid(actor.id, studentId, requestId);
    }
    if (actor.role === "ADMIN") {
      return student;
    }
    const active = await deps.mentorAssignments.findActiveByStudent(studentId);
    if (actor.role !== "MENTOR" || active?.mentorId !== actor.id) {
      return forbid(actor.id, studentId, requestId, "You can only open work for a student assigned to you.");
    }
    return student;
  }

  function failMutation<T extends PathRecord | WorkRecord>(
    result: T | "conflict" | "invalid" | null,
    noun: string,
  ): asserts result is T {
    if (result === "conflict") {
      throw new AppError(409, "CONFLICT", `This ${noun} changed. Reload it and try again.`);
    }
    if (result === "invalid") {
      throw new AppError(409, "INVALID_STATE", `This ${noun} cannot be changed from its current state.`);
    }
    if (!result) {
      throw new AppError(404, "NOT_FOUND", `That ${noun} was not found.`);
    }
  }

  async function withCount(assignment: WorkRecord) {
    const recipients = await deps.work.listRecipients(assignment.id);
    return { assignment, body: presentAssignment(assignment, recipients.length) };
  }

  async function recipientViews(studentId: string, reveal: boolean) {
    const recipients = await deps.work.listRecipientsForStudent(studentId);
    const views = [];
    for (const recipient of recipients) {
      const assignment = await deps.work.findById(recipient.assignmentId);
      if (!assignment || assignment.status === "DRAFT") {
        continue;
      }
      views.push(presentRecipient(recipient, assignment, isOverdue(assignment.dueDate, recipient.state, now()), reveal));
    }
    views.sort((left, right) => left.assignment.dueDate.localeCompare(right.assignment.dueDate));
    return views;
  }

  async function planFor(student: UserRecord, date: string | undefined) {
    const day = date ?? utcDay(now());
    return buildDailyPlan({
      student,
      date: day,
      now: now(),
      paths: deps.paths,
      work: deps.work,
      cohorts: deps.cohorts,
      resources: deps.resources,
    });
  }

  return {
    async listPaths(userId: string) {
      await actorFor(userId);
      const paths = await deps.paths.list();
      paths.sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
      return { data: paths.map((path) => summarizePath(path)) };
    },

    async getPath(userId: string, id: string) {
      await actorFor(userId);
      const path = await deps.paths.findById(id);
      if (!path) {
        throw new AppError(404, "NOT_FOUND", "That learning path was not found.");
      }
      return { path, body: presentPath(path) };
    },

    async createPath(userId: string, input: LearningPathWrite, requestId?: string) {
      const actor = await actorFor(userId);
      if (actor.role !== "ADMIN") {
        return forbid(actor.id, null, requestId);
      }
      const path = cleanPath(input);
      await assertCohort(path.cohortId);
      await assertPathRefs(path);
      const created = await deps.paths.create({ ...path, createdBy: actor.id });
      return { path: created, body: presentPath(created) };
    },

    async updatePath(userId: string, id: string, expectedRevision: number, input: LearningPathWrite, requestId?: string) {
      const actor = await actorFor(userId);
      if (actor.role !== "ADMIN") {
        return forbid(actor.id, id, requestId);
      }
      const path = cleanPath(input);
      await assertCohort(path.cohortId);
      await assertPathRefs(path);
      const updated = await deps.paths.replace(id, expectedRevision, path);
      failMutation(updated, "learning path");
      return { path: updated, body: presentPath(updated) };
    },

    async publishPath(userId: string, id: string, expectedRevision: number, requestId?: string) {
      const actor = await actorFor(userId);
      if (actor.role !== "ADMIN") {
        return forbid(actor.id, id, requestId);
      }
      const updated = await deps.paths.setStatus(id, expectedRevision, "PUBLISHED", now());
      failMutation(updated, "learning path");
      await deps.bus.emit({
        action: "learning_path.published",
        actorId: actor.id,
        subjectType: "LearningPath",
        subjectId: updated.id,
        after: { cohortId: updated.cohortId, durationDays: updated.durationDays },
        requestId: requestId ?? null,
      });
      return { path: updated, body: presentPath(updated) };
    },

    async archivePath(userId: string, id: string, expectedRevision: number, requestId?: string) {
      const actor = await actorFor(userId);
      if (actor.role !== "ADMIN") {
        return forbid(actor.id, id, requestId);
      }
      const current = await deps.paths.findById(id);
      const updated = await deps.paths.setStatus(id, expectedRevision, "ARCHIVED", current?.publishedAt ?? null);
      failMutation(updated, "learning path");
      return { path: updated, body: presentPath(updated) };
    },

    async listAssignments(userId: string) {
      const actor = await actorFor(userId);
      const rows = (await deps.work.list()).filter((row) => actor.role === "ADMIN" || row.assignedBy === actor.id);
      rows.sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
      const data = [];
      for (const row of rows) {
        data.push((await withCount(row)).body);
      }
      return { data };
    },

    async getAssignment(userId: string, id: string, requestId?: string) {
      const actor = await actorFor(userId);
      const assignment = await editableAssignment(actor, id, requestId);
      return withCount(assignment);
    },

    async createAssignment(userId: string, input: CreateAssignmentInput, requestId?: string) {
      const actor = await actorFor(userId);
      if (actor.role === "STUDENT") {
        return forbid(actor.id, null, requestId);
      }
      const draft = cleanAssignment(input);
      await assertTargets(actor, draft, requestId);
      await assertResource(actor, draft.resourceId, requestId);
      const created = await deps.work.create({ ...draft, assignedBy: actor.id });
      return withCount(created);
    },

    async updateAssignment(userId: string, id: string, expectedRevision: number, input: UpdateAssignmentInput, requestId?: string) {
      const actor = await actorFor(userId);
      const current = await editableAssignment(actor, id, requestId);
      if (current.status !== "DRAFT") {
        throw new AppError(409, "INVALID_STATE", "Only a draft assignment can be edited.");
      }
      const draft = cleanAssignment(mergedAssignment(current, input));
      await assertTargets(actor, draft, requestId);
      await assertResource(actor, draft.resourceId, requestId);
      const updated = await deps.work.update(id, expectedRevision, draft);
      failMutation(updated, "assignment");
      return withCount(updated);
    },

    async publishAssignment(userId: string, id: string, expectedRevision: number, requestId?: string) {
      const actor = await actorFor(userId);
      const current = await editableAssignment(actor, id, requestId);
      if (current.status !== "DRAFT") {
        throw new AppError(409, "INVALID_STATE", "This assignment is already published.");
      }
      await assertTargets(actor, current, requestId);
      await assertResource(actor, current.resourceId, requestId);
      const students = await resolveTargetStudents(current, deps.users, deps.mentorAssignments);
      const publishedAt = now();
      const updated = await deps.work.publish(
        id,
        expectedRevision,
        publishedAt,
        students.map((student) => student.id),
      );
      failMutation(updated, "assignment");
      const studentIds = students.map((student) => student.id);
      await deps.bus.emit({
        action: "assignment.published",
        actorId: actor.id,
        subjectType: "Assignment",
        subjectId: updated.id,
        after: { studentIds, targetType: updated.targetType, dueDate: updated.dueDate.toISOString() },
        requestId: requestId ?? null,
      });
      return withCount(updated);
    },

    async archiveAssignment(userId: string, id: string, expectedRevision: number, requestId?: string) {
      const actor = await actorFor(userId);
      await editableAssignment(actor, id, requestId);
      const updated = await deps.work.archive(id, expectedRevision);
      failMutation(updated, "assignment");
      return withCount(updated);
    },

    async myPlan(userId: string, date: string | undefined) {
      const actor = await actorFor(userId);
      const student = await deps.users.findById(actor.id);
      if (!student) {
        throw new AppError(401, "UNAUTHENTICATED", "Sign in to continue.");
      }
      return { data: await planFor(student, date) };
    },

    async myAssignments(userId: string) {
      const actor = await actorFor(userId);
      return { data: await recipientViews(actor.id, false) };
    },

    async studentPlan(userId: string, studentId: string, date: string | undefined, requestId?: string) {
      const actor = await actorFor(userId);
      const student = await visibleStudent(actor, studentId, requestId);
      return { data: await planFor(student, date) };
    },

    async studentAssignments(userId: string, studentId: string, requestId?: string) {
      const actor = await actorFor(userId);
      await visibleStudent(actor, studentId, requestId);
      return { data: await recipientViews(studentId, true) };
    },
  };
}

export type LearningService = ReturnType<typeof createLearningService>;
