import { createAnnouncementSchema, patchAnnouncementSchema, reportListQuerySchema, reportStatusSchema, resolveReportSchema } from "@dhruva/shared";
import { Router } from "express";
import type { Request } from "express";
import { AppError } from "../../middleware/errors.js";
import { validateBody } from "../../middleware/validate.js";
import { authenticate, authorize } from "../../policies/authenticate.js";
import { asyncRoute, revokeUserSessions } from "../auth/session.js";
import { createMemoryAnnouncementRepository, type AnnouncementRepository } from "./repository.js";
import { createModerationService, type ModerationDeps } from "./service.js";

function reportQuery(query: Request["query"]): { status?: "OPEN" | "DISMISSED" | "ACTION_TAKEN" } {
  const status = query.status;
  if (status === undefined || status === "") {
    return {};
  }
  if (typeof status !== "string") {
    throw new AppError(400, "VALIDATION_ERROR", "Request validation failed.", [
      { path: "status", message: "Send this filter as text." },
    ]);
  }
  const parsed = reportListQuerySchema.safeParse({ status });
  if (!parsed.success) {
    const check = reportStatusSchema.safeParse(status);
    throw new AppError(400, "VALIDATION_ERROR", "Request validation failed.", [
      { path: "status", message: check.success ? "Send this filter as text." : "Choose an open, dismissed, or action-taken report." },
    ]);
  }
  return { status: parsed.data.status };
}

export function createModerationRouter(deps: Omit<ModerationDeps, "announcements" | "revokeSessions"> & { announcements?: AnnouncementRepository }): Router {
  const router = Router();
  const guard = authenticate(deps.users);
  const announcements = deps.announcements ?? createMemoryAnnouncementRepository();

  router.get(
    "/announcements",
    guard,
    asyncRoute(async (req, res) => {
      const service = createModerationService({ ...deps, announcements, revokeSessions: (userId) => revokeUserSessions(req, userId) });
      res.json({ data: await service.listAnnouncements(req.user!.id) });
    }),
  );

  router.post(
    "/announcements",
    guard,
    authorize("announcements.manage"),
    validateBody(createAnnouncementSchema),
    asyncRoute(async (req, res) => {
      const service = createModerationService({ ...deps, announcements, revokeSessions: (userId) => revokeUserSessions(req, userId) });
      res.status(201).json({ data: await service.createAnnouncement(req.user!.id, req.body, req.id) });
    }),
  );

  router.patch(
    "/announcements/:id",
    guard,
    authorize("announcements.manage"),
    validateBody(patchAnnouncementSchema),
    asyncRoute(async (req, res) => {
      const service = createModerationService({ ...deps, announcements, revokeSessions: (userId) => revokeUserSessions(req, userId) });
      res.json({ data: await service.updateAnnouncement(req.user!.id, req.params.id, req.body, req.id) });
    }),
  );

  router.get(
    "/reports",
    guard,
    authorize("reports.review"),
    asyncRoute(async (req, res) => {
      const service = createModerationService({ ...deps, announcements, revokeSessions: (userId) => revokeUserSessions(req, userId) });
      const filter = reportQuery(req.query);
      res.json({ data: await service.listReports(filter.status) });
    }),
  );

  router.post(
    "/reports/:id/resolve",
    guard,
    authorize("reports.review"),
    validateBody(resolveReportSchema),
    asyncRoute(async (req, res) => {
      const service = createModerationService({ ...deps, announcements, revokeSessions: (userId) => revokeUserSessions(req, userId) });
      res.json({
        data: await service.resolveReport(req.user!.id, req.params.id, req.body.action, req.body.note, req.id),
      });
    }),
  );

  return router;
}
