import { createExportSchema, SUPPORT_INDICATOR_NOTE, type LearningEventType } from "@dhruva/shared";
import { Router } from "express";
import type { EventBus } from "../../events/bus.js";
import { AppError } from "../../middleware/errors.js";
import { validateBody } from "../../middleware/validate.js";
import { authenticate, authorize } from "../../policies/authenticate.js";
import { asyncRoute } from "../auth/session.js";
import type { AssignmentRepository } from "../mentors/assignments.js";
import type { UserRepository } from "../users/repository.js";
import {
  adminOverview,
  generateExport,
  mentorDashboard,
  mintExportLink,
  requestExport,
  studentProgress,
  type AnalyticsDeps,
} from "./rebuild.js";
import type { ExportRecord, ProgressRecord } from "./repository.js";

function presentProgress(
  record: ProgressRecord,
  activity: { type: LearningEventType; refType: string; refId: string; occurredAt: string }[],
) {
  return {
    studentId: record.studentId,
    assignedCount: record.assignedCount,
    completedCount: record.completedCount,
    pendingCount: record.pendingCount,
    overdueCount: record.overdueCount,
    completionPct: record.completionPct,
    averageScore: record.averageScore,
    topicScores: record.topicScores,
    weeklyActiveDays: record.weeklyActiveDays,
    week: record.week,
    recentFeedback: record.recentFeedback,
    activity,
    computedAt: record.computedAt.toISOString(),
  };
}

function presentJob(record: ExportRecord, link: { url: string | null; expiresAt: string | null }) {
  return {
    id: record.id,
    kind: record.kind,
    status: record.status,
    createdAt: record.createdAt.toISOString(),
    expiresAt: record.expiresAt?.toISOString() ?? null,
    downloadUrl: link.url,
    downloadExpiresAt: link.expiresAt,
  };
}

export function createAnalyticsRouter(options: {
  users: UserRepository;
  mentorAssignments: AssignmentRepository;
  analytics: AnalyticsDeps;
  bus: EventBus;
  enqueue?: (id: string) => Promise<void>;
}): Router {
  const router = Router();
  const guard = authenticate(options.users);
  const deps = options.analytics;

  async function activityFor(studentId: string) {
    const events = await deps.events.listForStudent(studentId, 20);
    return events.map((event) => ({
      type: event.type,
      refType: event.refType,
      refId: event.refId,
      occurredAt: event.occurredAt.toISOString(),
    }));
  }

  async function deny(actorId: string, subjectType: string, subjectId: string | null, requestId: string | undefined): Promise<never> {
    await options.bus.emit({
      action: "security.access_denied",
      actorId,
      subjectType,
      subjectId,
      requestId: requestId ?? null,
    });
    throw new AppError(403, "FORBIDDEN", "You do not have access to this.");
  }

  router.get(
    "/me/progress",
    guard,
    authorize("progress.own"),
    asyncRoute(async (req, res) => {
      const record = await studentProgress(deps, req.user!.id);
      if (!record) {
        throw new AppError(404, "NOT_FOUND", "That student was not found.");
      }
      res.json({ data: presentProgress(record, await activityFor(record.studentId)) });
    }),
  );

  router.get(
    "/students/:id/progress",
    guard,
    asyncRoute(async (req, res) => {
      const actor = req.user!;
      const studentId = req.params.id;
      const link = await options.mentorAssignments.findActiveByStudent(studentId);
      const allowed = actor.role === "ADMIN" || (actor.role === "MENTOR" && link?.mentorId === actor.id);
      if (!allowed) {
        return deny(actor.id, "Student", studentId, req.id);
      }
      const record = await studentProgress(deps, studentId);
      if (!record) {
        if (actor.role === "MENTOR") {
          return deny(actor.id, "Student", studentId, req.id);
        }
        throw new AppError(404, "NOT_FOUND", "That student was not found.");
      }
      const settings = await deps.settings.get();
      res.json({
        data: {
          ...presentProgress(record, await activityFor(record.studentId)),
          supportIndicator: record.supportIndicator,
          supportReasons: record.supportReasons,
          thresholds: settings.supportThresholds,
          supportNote: SUPPORT_INDICATOR_NOTE,
        },
      });
    }),
  );

  router.get(
    "/analytics/mentor",
    guard,
    authorize("analytics.mentor"),
    asyncRoute(async (req, res) => {
      res.json({ data: await mentorDashboard(deps, req.user!.id) });
    }),
  );

  router.get(
    "/analytics/overview",
    guard,
    authorize("analytics.admin"),
    asyncRoute(async (_req, res) => {
      res.json({ data: await adminOverview(deps) });
    }),
  );

  router.post(
    "/exports",
    guard,
    authorize("exports.manage"),
    validateBody(createExportSchema),
    asyncRoute(async (req, res) => {
      const record = await requestExport(
        deps,
        { requestedBy: req.user!.id, kind: req.body.kind, cohortId: req.body.cohortId ?? null },
        options.enqueue ?? ((id) => generateExport(deps, id)),
      );
      const link = record.status === "READY" ? await mintExportLink(deps, record) : { url: null, expiresAt: null };
      res.status(202).json({ data: presentJob(record, link) });
    }),
  );

  router.get(
    "/exports/:id/download",
    asyncRoute(async (req, res) => {
      const token = typeof req.query.token === "string" ? req.query.token : "";
      const record = await deps.exports.findByToken(req.params.id, token, (deps.now ?? (() => new Date()))());
      if (!record?.content) {
        throw new AppError(403, "FORBIDDEN", "This download link is invalid or has expired.");
      }
      res.setHeader("content-type", "text/csv; charset=utf-8");
      res.setHeader("content-disposition", `attachment; filename="${record.kind.toLowerCase()}.csv"`);
      res.send(record.content);
    }),
  );

  router.get(
    "/exports/:id",
    guard,
    authorize("exports.manage"),
    asyncRoute(async (req, res) => {
      const record = await deps.exports.find(req.params.id);
      if (!record || record.requestedBy !== req.user!.id) {
        return deny(req.user!.id, "ReportExport", req.params.id, req.id);
      }
      const link = await mintExportLink(deps, record);
      res.json({ data: presentJob(record, link) });
    }),
  );

  return router;
}
