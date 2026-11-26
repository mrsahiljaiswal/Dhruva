import {
  attachFileSchema,
  createResourceSchema,
  publishResourceSchema,
  resourceListQuerySchema,
  updateResourceSchema,
  uploadSlotSchema,
} from "@dhruva/shared";
import { Router } from "express";
import type { EventBus } from "../../events/bus.js";
import { AppError } from "../../middleware/errors.js";
import { validateBody } from "../../middleware/validate.js";
import type { ObjectStorage } from "../../platform/storage.js";
import { authenticate, authorize } from "../../policies/authenticate.js";
import type { CohortRepository } from "../cohorts/repository.js";
import type { AssignmentRepository } from "../mentors/assignments.js";
import { asyncRoute } from "../auth/session.js";
import type { UserRepository } from "../users/repository.js";
import type { ResourceRepository } from "./repository.js";
import { createResourceService, type ResourceGrantSource } from "./service.js";
import type { UploadIntentRepository } from "./uploads.js";

const LIST_FILTERS = new Set(["page", "limit", "status", "topic", "difficulty", "type", "sort"]);

function expectedRevision(header: string | undefined): number {
  if (!header) {
    throw new AppError(400, "VALIDATION_ERROR", "If-Match is required.", [
      { path: "if-match", message: "If-Match is required." },
    ]);
  }
  const value = header.trim().replace(/^W\//, "").replaceAll('"', "");
  if (!/^\d+$/.test(value)) {
    throw new AppError(400, "VALIDATION_ERROR", "If-Match is invalid.", [
      { path: "if-match", message: "If-Match must be the resource revision." },
    ]);
  }
  return Number(value);
}

function sendResource(
  res: { set: (name: string, value: string) => void; status: (code: number) => { json: (body: unknown) => void } },
  status: number,
  revision: number,
  body: unknown,
) {
  res.set("ETag", `"${revision}"`);
  res.status(status).json({ data: body });
}

export function createResourceRouter(options: {
  users: UserRepository;
  cohorts: CohortRepository;
  assignments: AssignmentRepository;
  resources: ResourceRepository;
  uploads: UploadIntentRepository;
  storage: ObjectStorage;
  bus: EventBus;
  grants?: ResourceGrantSource;
}): Router {
  const router = Router();
  const guard = authenticate(options.users);
  const resources = createResourceService(options);

  router.get(
    "/resources",
    guard,
    asyncRoute(async (req, res) => {
      const unknown = Object.keys(req.query).filter((key) => !LIST_FILTERS.has(key));
      if (unknown.length > 0) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          "Request validation failed.",
          unknown.map((key) => ({ path: key, message: "This filter is not supported." })),
        );
      }
      const parsed = resourceListQuerySchema.safeParse({
        ...(req.query.page === undefined ? {} : { page: req.query.page }),
        ...(req.query.limit === undefined ? {} : { limit: req.query.limit }),
        ...(req.query.status === undefined ? {} : { status: req.query.status }),
        ...(req.query.topic === undefined ? {} : { topic: req.query.topic }),
        ...(req.query.difficulty === undefined ? {} : { difficulty: req.query.difficulty }),
        ...(req.query.type === undefined ? {} : { type: req.query.type }),
        ...(req.query.sort === undefined ? {} : { sort: req.query.sort }),
      });
      if (!parsed.success) {
        throw parsed.error;
      }
      res.json(await resources.list(req.user!.id, parsed.data));
    }),
  );

  router.post(
    "/resources",
    guard,
    authorize("resources.create"),
    validateBody(createResourceSchema),
    asyncRoute(async (req, res) => {
      const created = await resources.create(req.user!.id, req.body, req.id);
      sendResource(res, 201, created.resource.revision, created.body);
    }),
  );

  router.post(
    "/uploads",
    guard,
    authorize("resources.upload"),
    validateBody(uploadSlotSchema),
    asyncRoute(async (req, res) => {
      const slot = await resources.requestUpload(req.user!.id, req.body, req.id);
      res.status(201).json({ data: slot });
    }),
  );

  router.get(
    "/resources/:id",
    guard,
    asyncRoute(async (req, res) => {
      const found = await resources.get(req.user!.id, req.params.id, req.id);
      sendResource(res, 200, found.resource.revision, found.body);
    }),
  );

  router.patch(
    "/resources/:id",
    guard,
    validateBody(updateResourceSchema),
    asyncRoute(async (req, res) => {
      const updated = await resources.update(req.user!.id, req.params.id, expectedRevision(req.get("if-match")), req.body, req.id);
      sendResource(res, 200, updated.resource.revision, updated.body);
    }),
  );

  router.post(
    "/resources/:id/publish",
    guard,
    validateBody(publishResourceSchema),
    asyncRoute(async (req, res) => {
      const published = await resources.publish(
        req.user!.id,
        req.params.id,
        expectedRevision(req.get("if-match")),
        req.body,
        req.id,
      );
      sendResource(res, 200, published.resource.revision, published.body);
    }),
  );

  router.post(
    "/resources/:id/archive",
    guard,
    asyncRoute(async (req, res) => {
      const archived = await resources.archive(req.user!.id, req.params.id, expectedRevision(req.get("if-match")), req.id);
      sendResource(res, 200, archived.resource.revision, archived.body);
    }),
  );

  router.post(
    "/resources/:id/attachments",
    guard,
    validateBody(attachFileSchema),
    asyncRoute(async (req, res) => {
      const attached = await resources.attach(
        req.user!.id,
        req.params.id,
        expectedRevision(req.get("if-match")),
        req.body.storageKey,
        req.id,
      );
      sendResource(res, 200, attached.resource.revision, attached.body);
    }),
  );

  router.get(
    "/resources/:id/download",
    guard,
    asyncRoute(async (req, res) => {
      const storageKey = typeof req.query.storageKey === "string" ? req.query.storageKey : "";
      if (!storageKey) {
        throw new AppError(400, "VALIDATION_ERROR", "Request validation failed.", [
          { path: "storageKey", message: "Choose a file." },
        ]);
      }
      const link = await resources.download(req.user!.id, req.params.id, storageKey, req.id);
      res.json({ data: link });
    }),
  );

  return router;
}
