import { createSubmissionSchema, reviewSubmissionSchema, submissionUploadSchema } from "@dhruva/shared";
import { Router } from "express";
import { z } from "zod";
import type { EventBus } from "../../events/bus.js";
import { AppError } from "../../middleware/errors.js";
import { validateBody } from "../../middleware/validate.js";
import { authenticate } from "../../policies/authenticate.js";
import { asyncRoute } from "../auth/session.js";
import type { WorkRepository } from "../learning/work.js";
import type { AssignmentRepository } from "../mentors/assignments.js";
import type { ResourceRepository } from "../resources/repository.js";
import type { UploadIntentRepository } from "../resources/uploads.js";
import type { ObjectStorage } from "../../platform/storage.js";
import type { UserRepository } from "../users/repository.js";
import type { SubmissionRepository } from "./repository.js";
import { codeExecutionOff, type CodeRunner, type ExecutionGate } from "./runner.js";
import { createSubmissionService } from "./service.js";

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

export function createSubmissionRouter(options: {
  users: UserRepository;
  mentorAssignments: AssignmentRepository;
  resources: ResourceRepository;
  work: WorkRepository;
  revisions: SubmissionRepository;
  uploads: UploadIntentRepository;
  storage: ObjectStorage;
  bus: EventBus;
  runner: CodeRunner;
  execution?: ExecutionGate;
  now?: () => Date;
}): Router {
  const router = Router();
  const guard = authenticate(options.users);
  const submissions = createSubmissionService({
    users: options.users,
    mentorAssignments: options.mentorAssignments,
    resources: options.resources,
    work: options.work,
    revisions: options.revisions,
    uploads: options.uploads,
    storage: options.storage,
    bus: options.bus,
    runner: options.runner,
    execution: options.execution ?? codeExecutionOff,
    now: options.now,
  });

  router.post(
    "/recipients/:id/start",
    guard,
    asyncRoute(async (req, res) => {
      res.json({ data: await submissions.start(req.user!.id, req.params.id, req.id) });
    }),
  );

  router.get(
    "/recipients/:id/submissions",
    guard,
    asyncRoute(async (req, res) => {
      res.json({ data: await submissions.list(req.user!.id, req.params.id, req.id) });
    }),
  );

  router.post(
    "/recipients/:id/uploads",
    guard,
    validateBody(submissionUploadSchema),
    asyncRoute(async (req, res) => {
      const slot = await submissions.requestUpload(req.user!.id, req.params.id, req.body, req.id);
      res.status(201).json({ data: slot });
    }),
  );

  router.post(
    "/recipients/:id/submissions",
    guard,
    validateBody(createSubmissionSchema),
    asyncRoute(async (req, res) => {
      const result = await submissions.submit(req.user!.id, req.params.id, req.body, idempotencyKey(req.get("idempotency-key")), req.id);
      res.status(201).json({ data: result });
    }),
  );

  router.post(
    "/submissions/:id/open",
    guard,
    asyncRoute(async (req, res) => {
      res.json({ data: await submissions.openReview(req.user!.id, req.params.id, req.id) });
    }),
  );

  router.post(
    "/submissions/:id/review",
    guard,
    validateBody(reviewSubmissionSchema),
    asyncRoute(async (req, res) => {
      res.json({ data: await submissions.review(req.user!.id, req.params.id, req.body, req.id) });
    }),
  );

  router.get(
    "/submissions/:id/download",
    guard,
    asyncRoute(async (req, res) => {
      res.json({ data: await submissions.download(req.user!.id, req.params.id, req.id) });
    }),
  );

  return router;
}
