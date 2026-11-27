import { createHash } from "node:crypto";
import type { AssignmentTarget, Branch, CreateAssessmentInput, CreateQuestionInput, GradeAttemptInput, SaveAnswersInput } from "@dhruva/shared";
import type { EventBus } from "../../events/bus.js";
import { AppError } from "../../middleware/errors.js";
import { can, type AuthUser } from "../../policies/can.js";
import type { CohortRepository } from "../cohorts/repository.js";
import { resolveTargetStudents, type TargetSpec } from "../learning/targets.js";
import type { AssignmentRepository } from "../mentors/assignments.js";
import type { CodeRunner, ExecutionGate } from "../submissions/runner.js";
import type { UserRepository } from "../users/repository.js";
import { gradeSaved, manualTotal, type GradeKey, type SnapshotQuestion } from "./grade.js";
import type { AssessmentRecord, AssessmentRepository, AttemptRecord, FinalizePatch, QuestionRecord, StoredAnswer } from "./repository.js";
import { presentAssessment, presentAttempt, presentQuestion } from "./serialize.js";

export type AssessmentServiceDeps = {
  users: UserRepository;
  cohorts: CohortRepository;
  mentorAssignments: AssignmentRepository;
  assessments: AssessmentRepository;
  bus: EventBus;
  runner: CodeRunner;
  execution: ExecutionGate;
  now?: () => Date;
};

const SUBMIT_HASH = createHash("sha256").update("submit").digest("hex");

function snapshotOf(question: QuestionRecord): SnapshotQuestion {
  return {
    questionId: question.id,
    type: question.type,
    prompt: question.prompt,
    options: question.options.map((option) => ({ ...option })),
    marks: question.marks,
    topic: question.topic,
    difficulty: question.difficulty,
    language: question.language,
    testCases: question.testCases.map((item) => ({ name: item.name, input: item.input, hidden: item.hidden })),
  };
}

function keyOf(question: QuestionRecord): GradeKey {
  return {
    questionId: question.id,
    optionIds: [...question.answerKey.optionIds],
    text: question.answerKey.text,
    testCases: question.testCases.map((item) => ({ ...item })),
  };
}

function asTarget(input: { targetType: AssignmentTarget; targetIds: string[]; branches: Branch[] }): TargetSpec {
  return { targetType: input.targetType, targetIds: input.targetIds, branches: input.branches };
}

export function createAssessmentService(deps: AssessmentServiceDeps) {
  const now = deps.now ?? (() => new Date());

  function leaveCodingManual(): void {
    if (deps.execution.enabled() && deps.runner.mode === "automatic") {
      return;
    }
  }

  async function actorFor(userId: string): Promise<AuthUser> {
    const user = await deps.users.findById(userId);
    if (!user || user.status !== "ACTIVE") {
      throw new AppError(401, "UNAUTHENTICATED", "Sign in to continue.");
    }
    return { id: user.id, role: user.role, status: user.status, capabilities: user.capabilities };
  }

  async function forbid(
    actorId: string,
    subjectType: string,
    subjectId: string | null,
    requestId: string | undefined,
    message = "You do not have access to this.",
  ): Promise<never> {
    await deps.bus.emit({
      action: "security.access_denied",
      actorId,
      subjectType,
      subjectId,
      requestId: requestId ?? null,
    });
    throw new AppError(403, "FORBIDDEN", message);
  }

  async function namesFor(ids: string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    for (const id of [...new Set(ids)]) {
      const person = await deps.users.findById(id);
      names.set(id, person?.name ?? "Student");
    }
    return names;
  }

  async function summarize(assessment: AssessmentRecord, attempts: AttemptRecord[], attemptsUsed: number) {
    const names = await namesFor(attempts.map((attempt) => attempt.studentId));
    return presentAssessment(assessment, attempts, attemptsUsed, names);
  }

  async function loadQuestions(ids: string[]): Promise<QuestionRecord[]> {
    const questions: QuestionRecord[] = [];
    for (const id of ids) {
      const question = await deps.assessments.findQuestion(id);
      if (!question) {
        throw new AppError(400, "VALIDATION_ERROR", "One of the questions does not exist.", [
          { path: "questionIds", message: "One of the questions does not exist." },
        ]);
      }
      questions.push(question);
    }
    return questions;
  }

  function totalOf(questions: QuestionRecord[]): number {
    return questions.reduce((sum, question) => sum + question.marks, 0);
  }

  async function assertTargets(actor: AuthUser, target: TargetSpec, requestId: string | undefined): Promise<void> {
    if (actor.role === "MENTOR") {
      if (target.targetType === "COHORT" || target.targetType === "BRANCH") {
        return forbid(actor.id, "Assessment", null, requestId, "You can set a target only for your own students.");
      }
      if (target.targetType === "MENTOR_GROUP") {
        if (target.targetIds.length !== 1 || target.targetIds[0] !== actor.id) {
          return forbid(actor.id, "Assessment", null, requestId, "You can set a target only for your own students.");
        }
        return;
      }
      const rows = await deps.mentorAssignments.listActiveByMentor(actor.id);
      const allowed = new Set(rows.map((row) => row.studentId));
      if (target.targetIds.some((id) => !allowed.has(id))) {
        return forbid(actor.id, "Assessment", null, requestId, "You can set a target only for your own students.");
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

  function paperFrom(input: CreateAssessmentInput, questions: QuestionRecord[], createdBy: string) {
    return {
      title: input.title,
      description: input.description,
      questionIds: [...input.questionIds],
      durationMin: input.durationMin,
      totalMarks: totalOf(questions),
      passingMarks: input.passingMarks,
      attemptsAllowed: input.attemptsAllowed,
      availableFrom: new Date(input.availableFrom),
      availableUntil: new Date(input.availableUntil),
      answersReleaseAt: input.answersReleaseAt ? new Date(input.answersReleaseAt) : null,
      targetType: input.targetType,
      targetIds: [...input.targetIds],
      branches: [...input.branches],
      createdBy,
    };
  }

  function assertPassing(passingMarks: number, totalMarks: number): void {
    if (passingMarks > totalMarks) {
      throw new AppError(422, "UNPROCESSABLE", "Passing marks cannot exceed the total.");
    }
  }

  async function requireAssessment(actor: AuthUser, assessmentId: string, requestId: string | undefined): Promise<AssessmentRecord> {
    const assessment = await deps.assessments.findAssessment(assessmentId);
    if (!assessment) {
      if (actor.role === "ADMIN") {
        throw new AppError(404, "NOT_FOUND", "That assessment was not found.");
      }
      return forbid(actor.id, "Assessment", assessmentId, requestId);
    }
    return assessment;
  }

  async function requireAttempt(actor: AuthUser, attemptId: string, requestId: string | undefined): Promise<AttemptRecord> {
    const attempt = await deps.assessments.findAttempt(attemptId);
    if (!attempt) {
      if (actor.role === "ADMIN") {
        throw new AppError(404, "NOT_FOUND", "That attempt was not found.");
      }
      return forbid(actor.id, "AssessmentAttempt", attemptId, requestId);
    }
    return attempt;
  }

  async function viewAccess(userId: string, attemptId: string, requestId: string | undefined) {
    const actor = await actorFor(userId);
    const attempt = await requireAttempt(actor, attemptId, requestId);
    const assessment = await deps.assessments.findAssessment(attempt.assessmentId);
    if (!assessment) {
      if (actor.role === "ADMIN") {
        throw new AppError(404, "NOT_FOUND", "That assessment was not found.");
      }
      return forbid(actor.id, "AssessmentAttempt", attemptId, requestId);
    }
    if (actor.role === "STUDENT" && actor.id === attempt.studentId) {
      return { actor, attempt, assessment, kind: "owner" as const };
    }
    if (actor.role === "ADMIN") {
      return { actor, attempt, assessment, kind: "admin" as const };
    }
    if (actor.role === "MENTOR") {
      const active = await deps.mentorAssignments.findActiveByStudent(attempt.studentId);
      if (active?.mentorId === actor.id) {
        return { actor, attempt, assessment, kind: "mentor" as const };
      }
    }
    return forbid(actor.id, "AssessmentAttempt", attempt.id, requestId);
  }

  async function finalize(
    attempt: AttemptRecord,
    mode: "submit" | "expire",
    key: string | null,
    actorId: string | null,
    requestId: string | undefined,
  ): Promise<AttemptRecord> {
    leaveCodingManual();
    const graded = gradeSaved(attempt.questionSnapshot, attempt.gradingKeys, attempt.answers);
    const patch: FinalizePatch = {
      status: mode === "expire" ? "EXPIRED" : graded.pendingManual ? "SUBMITTED" : "GRADED",
      submittedAt: mode === "submit" ? now() : null,
      autoScore: graded.autoScore,
      manualScore: graded.pendingManual ? null : 0,
      totalScore: graded.autoScore,
      pendingManual: graded.pendingManual,
      idempotencyKey: mode === "submit" ? key : null,
      bodyHash: mode === "submit" ? SUBMIT_HASH : null,
    };
    const updated = await deps.assessments.finalizeAttempt(attempt.id, patch);
    if (updated === null) {
      throw new AppError(404, "NOT_FOUND", "That attempt was not found.");
    }
    if (updated === "stale") {
      const current = await deps.assessments.findAttempt(attempt.id);
      if (!current) {
        throw new AppError(404, "NOT_FOUND", "That attempt was not found.");
      }
      return current;
    }
    await deps.bus.emit({
      action: "attempt.finalized",
      actorId,
      subjectType: "AssessmentAttempt",
      subjectId: updated.id,
      requestId: requestId ?? null,
        after: { status: updated.status, autoScore: updated.autoScore, studentId: updated.studentId },
    });
    if (updated.status === "GRADED") {
      await deps.bus.emit({
        action: "attempt.graded",
        actorId,
        subjectType: "AssessmentAttempt",
        subjectId: updated.id,
        requestId: requestId ?? null,
        after: { totalScore: updated.totalScore, studentId: updated.studentId },
      });
    }
    return updated;
  }

  function mergeAnswers(attempt: AttemptRecord, incoming: SaveAnswersInput["answers"], clock: Date): StoredAnswer[] {
    const seen = new Set<string>();
    for (const answer of incoming) {
      if (seen.has(answer.questionId)) {
        throw new AppError(400, "VALIDATION_ERROR", "Each question is saved once.", [
          { path: "answers", message: "Each question is saved once." },
        ]);
      }
      seen.add(answer.questionId);
      const question = attempt.questionSnapshot.find((item) => item.questionId === answer.questionId);
      if (!question) {
        throw new AppError(400, "VALIDATION_ERROR", "That question is not on this attempt.", [
          { path: "answers", message: "That question is not on this attempt." },
        ]);
      }
      const wantsArray = question.type === "MULTI_SELECT";
      if (wantsArray !== Array.isArray(answer.value)) {
        throw new AppError(400, "VALIDATION_ERROR", "That answer does not match the question.", [
          { path: "answers", message: "That answer does not match the question." },
        ]);
      }
    }
    const next = new Map(attempt.answers.map((answer) => [answer.questionId, answer]));
    for (const answer of incoming) {
      next.set(answer.questionId, { questionId: answer.questionId, value: answer.value, autoSavedAt: clock });
    }
    return [...next.values()];
  }

  return {
    async listQuestions(userId: string, query: { page: number; limit: number; topic?: string; type?: CreateQuestionInput["type"]; q?: string }) {
      const actor = await actorFor(userId);
      if (!can(actor, "assessments.create")) {
        return forbid(actor.id, "Question", null, undefined);
      }
      const page = await deps.assessments.listQuestions(query);
      return { data: page.rows.map(presentQuestion), page: query.page, limit: query.limit, total: page.total };
    },

    async createQuestion(userId: string, input: CreateQuestionInput, requestId: string | undefined) {
      const actor = await actorFor(userId);
      if (!can(actor, "assessments.create")) {
        return forbid(actor.id, "Question", null, requestId);
      }
      const created = await deps.assessments.insertQuestion({ ...input, createdBy: actor.id });
      return presentQuestion(created);
    },

    async updateQuestion(userId: string, questionId: string, input: CreateQuestionInput, requestId: string | undefined) {
      const actor = await actorFor(userId);
      if (!can(actor, "assessments.create")) {
        return forbid(actor.id, "Question", questionId, requestId);
      }
      const current = await deps.assessments.findQuestion(questionId);
      if (!current) {
        if (actor.role === "ADMIN") {
          throw new AppError(404, "NOT_FOUND", "That question was not found.");
        }
        return forbid(actor.id, "Question", questionId, requestId);
      }
      if (actor.role !== "ADMIN" && current.createdBy !== actor.id) {
        return forbid(actor.id, "Question", questionId, requestId);
      }
      const updated = await deps.assessments.updateQuestion(questionId, { ...input, createdBy: current.createdBy });
      if (!updated) {
        throw new AppError(404, "NOT_FOUND", "That question was not found.");
      }
      return presentQuestion(updated);
    },

    async listAssessments(userId: string) {
      const actor = await actorFor(userId);
      const rows = await deps.assessments.listAssessments();
      if (actor.role === "ADMIN") {
        const data = [];
        for (const assessment of rows) {
          const attempts = await deps.assessments.listAttempts(assessment.id);
          data.push(await summarize(assessment, attempts, attempts.length));
        }
        return { data };
      }
      if (actor.role === "MENTOR") {
        const mine = new Set((await deps.mentorAssignments.listActiveByMentor(actor.id)).map((row) => row.studentId));
        const data = [];
        for (const assessment of rows) {
          const own = assessment.createdBy === actor.id;
          if (!own && assessment.status !== "PUBLISHED") {
            continue;
          }
          const targeted = assessment.status === "PUBLISHED" ? await resolveTargetStudents(assessment, deps.users, deps.mentorAssignments) : [];
          if (!own && !targeted.some((student) => mine.has(student.id))) {
            continue;
          }
          const attempts = (await deps.assessments.listAttempts(assessment.id)).filter((attempt) => mine.has(attempt.studentId));
          data.push(await summarize(assessment, attempts, attempts.length));
        }
        return { data };
      }
      const data = [];
      for (const assessment of rows) {
        if (assessment.status !== "PUBLISHED") {
          continue;
        }
        const targeted = await resolveTargetStudents(assessment, deps.users, deps.mentorAssignments);
        if (!targeted.some((student) => student.id === actor.id)) {
          continue;
        }
        const attempts = await deps.assessments.listForStudent(assessment.id, actor.id);
        data.push(await summarize(assessment, attempts, attempts.length));
      }
      return { data };
    },

    async createAssessment(userId: string, input: CreateAssessmentInput, requestId: string | undefined) {
      const actor = await actorFor(userId);
      if (!can(actor, "assessments.create")) {
        return forbid(actor.id, "Assessment", null, requestId);
      }
      await assertTargets(actor, asTarget(input), requestId);
      const questions = await loadQuestions(input.questionIds);
      assertPassing(input.passingMarks, totalOf(questions));
      const created = await deps.assessments.insertAssessment(paperFrom(input, questions, actor.id));
      return summarize(created, [], 0);
    },

    async updateAssessment(userId: string, assessmentId: string, expectedVersion: number, input: CreateAssessmentInput, requestId: string | undefined) {
      const actor = await actorFor(userId);
      if (!can(actor, "assessments.create")) {
        return forbid(actor.id, "Assessment", assessmentId, requestId);
      }
      const current = await requireAssessment(actor, assessmentId, requestId);
      if (actor.role !== "ADMIN" && current.createdBy !== actor.id) {
        return forbid(actor.id, "Assessment", assessmentId, requestId);
      }
      if (current.status === "ARCHIVED") {
        throw new AppError(409, "INVALID_STATE", "An archived assessment cannot be edited.");
      }
      await assertTargets(actor, asTarget(input), requestId);
      const questions = await loadQuestions(input.questionIds);
      assertPassing(input.passingMarks, totalOf(questions));
      const paper = paperFrom(input, questions, current.createdBy);
      const { createdBy: _createdBy, ...patch } = paper;
      const updated = await deps.assessments.updateAssessment(assessmentId, expectedVersion, patch);
      if (updated === null) {
        throw new AppError(404, "NOT_FOUND", "That assessment was not found.");
      }
      if (updated === "stale") {
        throw new AppError(409, "CONFLICT", "The assessment was updated. Reload and try again.");
      }
      const attempts = await deps.assessments.listAttempts(updated.id);
      return summarize(updated, attempts, attempts.length);
    },

    async publishAssessment(userId: string, assessmentId: string, expectedVersion: number, requestId: string | undefined) {
      const actor = await actorFor(userId);
      if (!can(actor, "assessments.publish")) {
        return forbid(actor.id, "Assessment", assessmentId, requestId);
      }
      const current = await requireAssessment(actor, assessmentId, requestId);
      const questions = await loadQuestions(current.questionIds);
      const published = await deps.assessments.publishAssessment(assessmentId, expectedVersion, now(), totalOf(questions));
      if (published === null) {
        throw new AppError(404, "NOT_FOUND", "That assessment was not found.");
      }
      if (published === "stale") {
        throw new AppError(409, "CONFLICT", "The assessment was updated. Reload and try again.");
      }
      if (published === "invalid") {
        throw new AppError(409, "INVALID_STATE", "Only a draft can be published.");
      }
      return summarize(published, [], 0);
    },

    async startAttempt(userId: string, assessmentId: string, requestId: string | undefined) {
      const actor = await actorFor(userId);
      const assessment = await requireAssessment(actor, assessmentId, requestId);
      if (assessment.status !== "PUBLISHED" || actor.role !== "STUDENT") {
        return forbid(actor.id, "Assessment", assessment.id, requestId);
      }
      const targeted = await resolveTargetStudents(assessment, deps.users, deps.mentorAssignments);
      if (!targeted.some((student) => student.id === actor.id)) {
        return forbid(actor.id, "Assessment", assessment.id, requestId);
      }
      const clock = now();
      if (clock.getTime() < assessment.availableFrom.getTime() || clock.getTime() > assessment.availableUntil.getTime()) {
        throw new AppError(422, "UNPROCESSABLE", "This assessment is not open.");
      }
      const existing = await deps.assessments.listForStudent(assessment.id, actor.id);
      if (existing.some((attempt) => attempt.status === "IN_PROGRESS")) {
        throw new AppError(422, "UNPROCESSABLE", "An attempt is already open.");
      }
      const attemptNo = existing.length + 1;
      if (attemptNo > assessment.attemptsAllowed) {
        throw new AppError(422, "UNPROCESSABLE", "No attempts remain.");
      }
      const questions = await loadQuestions(assessment.questionIds);
      const inserted = await deps.assessments.insertAttempt({
        assessmentId: assessment.id,
        studentId: actor.id,
        attemptNo,
        assessmentVersion: assessment.version,
        questionSnapshot: questions.map(snapshotOf),
        gradingKeys: questions.map(keyOf),
        startedAt: clock,
        expiresAt: new Date(clock.getTime() + assessment.durationMin * 60_000),
      });
      if (inserted.kind === "duplicate") {
        throw new AppError(422, "UNPROCESSABLE", "The attempt could not be started. Try again.");
      }
      await deps.bus.emit({
        action: "attempt.started",
        actorId: actor.id,
        subjectType: "AssessmentAttempt",
        subjectId: inserted.attempt.id,
        requestId: requestId ?? null,
        after: { assessmentId: assessment.id, attemptNo },
      });
      return presentAttempt(inserted.attempt, assessment, clock);
    },

    async saveAnswers(userId: string, attemptId: string, input: SaveAnswersInput, requestId: string | undefined) {
      const access = await viewAccess(userId, attemptId, requestId);
      if (access.kind !== "owner") {
        return forbid(access.actor.id, "AssessmentAttempt", access.attempt.id, requestId);
      }
      const clock = now();
      if (access.attempt.status === "IN_PROGRESS" && clock.getTime() >= access.attempt.expiresAt.getTime()) {
        await finalize(access.attempt, "expire", null, null, requestId);
        throw new AppError(422, "UNPROCESSABLE", "The attempt has ended.");
      }
      if (access.attempt.status !== "IN_PROGRESS") {
        throw new AppError(409, "INVALID_STATE", "This attempt is already finished.");
      }
      const saved = await deps.assessments.saveAnswers(access.attempt.id, mergeAnswers(access.attempt, input.answers, clock));
      if (saved === null) {
        throw new AppError(404, "NOT_FOUND", "That attempt was not found.");
      }
      if (saved === "closed") {
        throw new AppError(409, "INVALID_STATE", "This attempt is already finished.");
      }
      return presentAttempt(saved, access.assessment, clock);
    },

    async submitAttempt(userId: string, attemptId: string, key: string, requestId: string | undefined) {
      const access = await viewAccess(userId, attemptId, requestId);
      if (access.kind !== "owner") {
        return forbid(access.actor.id, "AssessmentAttempt", access.attempt.id, requestId);
      }
      if (access.attempt.status !== "IN_PROGRESS") {
        if (access.attempt.idempotencyKey === key && access.attempt.bodyHash === SUBMIT_HASH) {
          return presentAttempt(access.attempt, access.assessment, now());
        }
        throw new AppError(409, "INVALID_STATE", "This attempt is already finished.");
      }
      const clock = now();
      if (clock.getTime() >= access.attempt.expiresAt.getTime()) {
        await finalize(access.attempt, "expire", null, null, requestId);
        throw new AppError(422, "UNPROCESSABLE", "The attempt has ended.");
      }
      const finalized = await finalize(access.attempt, "submit", key, access.actor.id, requestId);
      if (finalized.idempotencyKey && finalized.idempotencyKey !== key) {
        throw new AppError(409, "INVALID_STATE", "This attempt is already finished.");
      }
      return presentAttempt(finalized, access.assessment, clock);
    },

    async getAttempt(userId: string, attemptId: string, requestId: string | undefined) {
      const access = await viewAccess(userId, attemptId, requestId);
      let attempt = access.attempt;
      const clock = now();
      if (attempt.status === "IN_PROGRESS" && clock.getTime() >= attempt.expiresAt.getTime()) {
        attempt = await finalize(attempt, "expire", null, null, requestId);
      }
      return presentAttempt(attempt, access.assessment, clock);
    },

    async gradeAttempt(userId: string, attemptId: string, input: GradeAttemptInput, requestId: string | undefined) {
      const access = await viewAccess(userId, attemptId, requestId);
      if (access.kind === "owner") {
        return forbid(access.actor.id, "AssessmentAttempt", access.attempt.id, requestId);
      }
      if (access.kind === "mentor" && !access.actor.capabilities.canGradeAssessments) {
        return forbid(access.actor.id, "AssessmentAttempt", access.attempt.id, requestId);
      }
      if (access.attempt.status === "IN_PROGRESS") {
        throw new AppError(409, "INVALID_STATE", "This attempt is still open.");
      }
      if (!access.attempt.pendingManual) {
        throw new AppError(409, "INVALID_STATE", "This attempt has no answers waiting for a mark.");
      }
      const awarded = manualTotal(access.attempt.questionSnapshot, input.marks);
      if (awarded === "invalid") {
        throw new AppError(422, "UNPROCESSABLE", "Those marks do not match the questions.");
      }
      const updated = await deps.assessments.gradeAttempt(access.attempt.id, {
        manualScore: awarded,
        totalScore: (access.attempt.autoScore ?? 0) + awarded,
        pendingManual: false,
        status: "GRADED",
        gradedBy: access.actor.id,
      });
      if (updated === null) {
        throw new AppError(404, "NOT_FOUND", "That attempt was not found.");
      }
      if (updated === "stale") {
        throw new AppError(409, "INVALID_STATE", "This attempt is already graded.");
      }
      await deps.bus.emit({
        action: "attempt.graded",
        actorId: access.actor.id,
        subjectType: "AssessmentAttempt",
        subjectId: updated.id,
        requestId: requestId ?? null,
        after: { totalScore: updated.totalScore, studentId: updated.studentId },
      });
      return presentAttempt(updated, access.assessment, now());
    },

    async expireDue(): Promise<string[]> {
      const due = await deps.assessments.listDue(now());
      const ids: string[] = [];
      for (const attempt of due) {
        const current = await deps.assessments.findAttempt(attempt.id);
        if (!current || current.status !== "IN_PROGRESS" || current.expiresAt.getTime() > now().getTime()) {
          continue;
        }
        const finalized = await finalize(current, "expire", null, null, undefined);
        if (finalized.status !== "IN_PROGRESS") {
          ids.push(finalized.id);
        }
      }
      return ids;
    },
  };
}

export type AssessmentService = ReturnType<typeof createAssessmentService>;
