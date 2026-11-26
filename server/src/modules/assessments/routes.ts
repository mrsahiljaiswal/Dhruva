import {
  createAssessmentSchema,
  createQuestionSchema,
  gradeAttemptSchema,
  questionListQuerySchema,
  saveAnswersSchema,
} from "@dhruva/shared";
import { Router } from "express";
import { z } from "zod";
import type { EventBus } from "../../events/bus.js";
import { AppError } from "../../middleware/errors.js";
import { validateBody } from "../../middleware/validate.js";
import { authenticate, authorize } from "../../policies/authenticate.js";
import type { CohortRepository } from "../cohorts/repository.js";
import type { AssignmentRepository } from "../mentors/assignments.js";
import { asyncRoute } from "../auth/session.js";
import { codeExecutionOff, type CodeRunner, type ExecutionGate } from "../submissions/runner.js";
import type { UserRepository } from "../users/repository.js";
import type { AssessmentRepository } from "./repository.js";
import { createAssessmentService } from "./service.js";

const idempotencyKeySchema = z.string().uuid("Send a UUID in the Idempotency-Key header.");

function idempotencyKey(header: string | undefined): string {
  const parsed = idempotencyKeySchema.safeParse(header?.trim() ?? "");
  if (!parsed.success) {
    throw new AppError(400, "VALIDATION_ERROR", "Idempotency-Key is required.", [
      { path: "idempotency-key", message: "Send a UUID in the Idempotency-Key header." },
    ]);
  }
  return parsed.data;
}

function expectedVersion(header: string | undefined): number {
  if (!header) {
    throw new AppError(400, "VALIDATION_ERROR", "If-Match is required.", [
      { path: "if-match", message: "If-Match is required." },
    ]);
  }
  const value = header.trim().replace(/^W\//, "").replaceAll('"', "");
  if (!/^\d+$/.test(value)) {
    throw new AppError(400, "VALIDATION_ERROR", "If-Match is invalid.", [
      { path: "if-match", message: "If-Match must be the revision." },
    ]);
  }
  return Number(value);
}

function sendVersion(
  res: { set: (name: string, value: string) => void; status: (code: number) => { json: (body: unknown) => void } },
  status: number,
  version: number,
  body: unknown,
) {
  res.set("ETag", `"${version}"`);
  res.status(status).json({ data: body });
}

export function createAssessmentRouter(options: {
  users: UserRepository;
  cohorts: CohortRepository;
  mentorAssignments: AssignmentRepository;
  assessments: AssessmentRepository;
  bus: EventBus;
  runner: CodeRunner;
  execution?: ExecutionGate;
  now?: () => Date;
}): Router {
  const router = Router();
  const guard = authenticate(options.users);
  const assessments = createAssessmentService({
    users: options.users,
    cohorts: options.cohorts,
    mentorAssignments: options.mentorAssignments,
    assessments: options.assessments,
    bus: options.bus,
    runner: options.runner,
    execution: options.execution ?? codeExecutionOff,
    now: options.now,
  });

  router.get(
    "/questions",
    guard,
    authorize("assessments.create"),
    asyncRoute(async (req, res) => {
      const parsed = questionListQuerySchema.safeParse({
        ...(req.query.page === undefined ? {} : { page: req.query.page }),
        ...(req.query.limit === undefined ? {} : { limit: req.query.limit }),
        ...(req.query.topic === undefined ? {} : { topic: req.query.topic }),
        ...(req.query.type === undefined ? {} : { type: req.query.type }),
        ...(req.query.q === undefined ? {} : { q: req.query.q }),
      });
      if (!parsed.success) {
        throw parsed.error;
      }
      res.json(await assessments.listQuestions(req.user!.id, parsed.data));
    }),
  );

  router.post(
    "/questions",
    guard,
    authorize("assessments.create"),
    validateBody(createQuestionSchema),
    asyncRoute(async (req, res) => {
      res.status(201).json({ data: await assessments.createQuestion(req.user!.id, req.body, req.id) });
    }),
  );

  router.patch(
    "/questions/:id",
    guard,
    authorize("assessments.create"),
    validateBody(createQuestionSchema),
    asyncRoute(async (req, res) => {
      res.json({ data: await assessments.updateQuestion(req.user!.id, req.params.id, req.body, req.id) });
    }),
  );

  router.get(
    "/assessments",
    guard,
    asyncRoute(async (req, res) => {
      res.json(await assessments.listAssessments(req.user!.id));
    }),
  );

  router.post(
    "/assessments",
    guard,
    authorize("assessments.create"),
    validateBody(createAssessmentSchema),
    asyncRoute(async (req, res) => {
      const created = await assessments.createAssessment(req.user!.id, req.body, req.id);
      sendVersion(res, 201, created.version, created);
    }),
  );

  router.patch(
    "/assessments/:id",
    guard,
    authorize("assessments.create"),
    validateBody(createAssessmentSchema),
    asyncRoute(async (req, res) => {
      const updated = await assessments.updateAssessment(
        req.user!.id,
        req.params.id,
        expectedVersion(req.get("if-match")),
        req.body,
        req.id,
      );
      sendVersion(res, 200, updated.version, updated);
    }),
  );

  router.post(
    "/assessments/:id/publish",
    guard,
    authorize("assessments.publish"),
    asyncRoute(async (req, res) => {
      const published = await assessments.publishAssessment(req.user!.id, req.params.id, expectedVersion(req.get("if-match")), req.id);
      sendVersion(res, 200, published.version, published);
    }),
  );

  router.post(
    "/assessments/:id/attempts",
    guard,
    asyncRoute(async (req, res) => {
      res.status(201).json({ data: await assessments.startAttempt(req.user!.id, req.params.id, req.id) });
    }),
  );

  router.patch(
    "/attempts/:id/answers",
    guard,
    validateBody(saveAnswersSchema),
    asyncRoute(async (req, res) => {
      res.json({ data: await assessments.saveAnswers(req.user!.id, req.params.id, req.body, req.id) });
    }),
  );

  router.post(
    "/attempts/:id/submit",
    guard,
    asyncRoute(async (req, res) => {
      res.json({ data: await assessments.submitAttempt(req.user!.id, req.params.id, idempotencyKey(req.get("idempotency-key")), req.id) });
    }),
  );

  router.get(
    "/attempts/:id",
    guard,
    asyncRoute(async (req, res) => {
      res.json({ data: await assessments.getAttempt(req.user!.id, req.params.id, req.id) });
    }),
  );

  router.post(
    "/attempts/:id/grade",
    guard,
    validateBody(gradeAttemptSchema),
    asyncRoute(async (req, res) => {
      res.json({ data: await assessments.gradeAttempt(req.user!.id, req.params.id, req.body, req.id) });
    }),
  );

  return router;
}
