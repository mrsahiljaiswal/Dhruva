import {
  createAssignmentSchema,
  learningPathWriteSchema,
  planQuerySchema,
  updateAssignmentSchema,
} from "@dhruva/shared";
import { Router } from "express";
import type { EventBus } from "../../events/bus.js";
import { AppError } from "../../middleware/errors.js";
import { validateBody } from "../../middleware/validate.js";
import { authenticate, authorize } from "../../policies/authenticate.js";
import type { CohortRepository } from "../cohorts/repository.js";
import type { AssignmentRepository } from "../mentors/assignments.js";
import { asyncRoute } from "../auth/session.js";
import type { ResourceRepository } from "../resources/repository.js";
import type { UserRepository } from "../users/repository.js";
import type { LearningPathRepository } from "./paths.js";
import { createLearningService } from "./service.js";
import type { WorkRepository } from "./work.js";

function expectedRevision(header: string | undefined): number {
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

function sendRevision(
  res: { set: (name: string, value: string) => void; status: (code: number) => { json: (body: unknown) => void } },
  status: number,
  revision: number,
  body: unknown,
) {
  res.set("ETag", `"${revision}"`);
  res.status(status).json({ data: body });
}

function parsePlanDate(query: unknown): string | undefined {
  const parsed = planQuerySchema.safeParse(query ?? {});
  if (!parsed.success) {
    throw parsed.error;
  }
  return parsed.data.date;
}

export function createLearningRouter(options: {
  users: UserRepository;
  cohorts: CohortRepository;
  mentorAssignments: AssignmentRepository;
  resources: ResourceRepository;
  paths: LearningPathRepository;
  work: WorkRepository;
  bus: EventBus;
  now?: () => Date;
}): Router {
  const router = Router();
  const guard = authenticate(options.users);
  const learning = createLearningService(options);

  router.get(
    "/learning-paths",
    guard,
    authorize("paths.view"),
    asyncRoute(async (req, res) => {
      res.json(await learning.listPaths(req.user!.id));
    }),
  );

  router.post(
    "/learning-paths",
    guard,
    authorize("paths.manage"),
    validateBody(learningPathWriteSchema),
    asyncRoute(async (req, res) => {
      const created = await learning.createPath(req.user!.id, req.body, req.id);
      sendRevision(res, 201, created.path.revision, created.body);
    }),
  );

  router.get(
    "/learning-paths/:id",
    guard,
    authorize("paths.view"),
    asyncRoute(async (req, res) => {
      const found = await learning.getPath(req.user!.id, req.params.id);
      sendRevision(res, 200, found.path.revision, found.body);
    }),
  );

  router.patch(
    "/learning-paths/:id",
    guard,
    authorize("paths.manage"),
    validateBody(learningPathWriteSchema),
    asyncRoute(async (req, res) => {
      const updated = await learning.updatePath(req.user!.id, req.params.id, expectedRevision(req.get("if-match")), req.body, req.id);
      sendRevision(res, 200, updated.path.revision, updated.body);
    }),
  );

  router.post(
    "/learning-paths/:id/publish",
    guard,
    authorize("paths.manage"),
    asyncRoute(async (req, res) => {
      const published = await learning.publishPath(req.user!.id, req.params.id, expectedRevision(req.get("if-match")), req.id);
      sendRevision(res, 200, published.path.revision, published.body);
    }),
  );

  router.post(
    "/learning-paths/:id/archive",
    guard,
    authorize("paths.manage"),
    asyncRoute(async (req, res) => {
      const archived = await learning.archivePath(req.user!.id, req.params.id, expectedRevision(req.get("if-match")), req.id);
      sendRevision(res, 200, archived.path.revision, archived.body);
    }),
  );

  router.get(
    "/assignments",
    guard,
    authorize("assignments.view"),
    asyncRoute(async (req, res) => {
      res.json(await learning.listAssignments(req.user!.id));
    }),
  );

  router.post(
    "/assignments",
    guard,
    authorize("assignments.create"),
    validateBody(createAssignmentSchema),
    asyncRoute(async (req, res) => {
      const created = await learning.createAssignment(req.user!.id, req.body, req.id);
      sendRevision(res, 201, created.assignment.revision, created.body);
    }),
  );

  router.get(
    "/assignments/:id",
    guard,
    authorize("assignments.view"),
    asyncRoute(async (req, res) => {
      const found = await learning.getAssignment(req.user!.id, req.params.id, req.id);
      sendRevision(res, 200, found.assignment.revision, found.body);
    }),
  );

  router.patch(
    "/assignments/:id",
    guard,
    validateBody(updateAssignmentSchema),
    asyncRoute(async (req, res) => {
      const updated = await learning.updateAssignment(
        req.user!.id,
        req.params.id,
        expectedRevision(req.get("if-match")),
        req.body,
        req.id,
      );
      sendRevision(res, 200, updated.assignment.revision, updated.body);
    }),
  );

  router.post(
    "/assignments/:id/publish",
    guard,
    asyncRoute(async (req, res) => {
      const published = await learning.publishAssignment(req.user!.id, req.params.id, expectedRevision(req.get("if-match")), req.id);
      sendRevision(res, 200, published.assignment.revision, published.body);
    }),
  );

  router.post(
    "/assignments/:id/archive",
    guard,
    asyncRoute(async (req, res) => {
      const archived = await learning.archiveAssignment(req.user!.id, req.params.id, expectedRevision(req.get("if-match")), req.id);
      sendRevision(res, 200, archived.assignment.revision, archived.body);
    }),
  );

  router.get(
    "/me/plan",
    guard,
    authorize("plan.view"),
    asyncRoute(async (req, res) => {
      res.json(await learning.myPlan(req.user!.id, parsePlanDate(req.query)));
    }),
  );

  router.get(
    "/me/assignments",
    guard,
    authorize("plan.view"),
    asyncRoute(async (req, res) => {
      res.json(await learning.myAssignments(req.user!.id));
    }),
  );

  router.get(
    "/students/:id/plan",
    guard,
    asyncRoute(async (req, res) => {
      res.json(await learning.studentPlan(req.user!.id, req.params.id, parsePlanDate(req.query), req.id));
    }),
  );

  router.get(
    "/students/:id/assignments",
    guard,
    asyncRoute(async (req, res) => {
      res.json(await learning.studentAssignments(req.user!.id, req.params.id, req.id));
    }),
  );

  return router;
}
