import { assignMentorSchema, createCohortSchema, csvImportSchema, updateUserSchema } from "@dhruva/shared";
import { Router } from "express";
import type { EventBus } from "../../events/bus.js";
import { AppError } from "../../middleware/errors.js";
import { validateBody } from "../../middleware/validate.js";
import { authenticate, authorize } from "../../policies/authenticate.js";
import { canViewStudent } from "../../policies/can.js";
import type { AuthService } from "../auth/service.js";
import { asyncRoute, revokeUserSessions } from "../auth/session.js";
import { DuplicateCohortError, type CohortRepository } from "../cohorts/repository.js";
import { assignStudents, reassignStudents, type AssignmentRepository } from "../mentors/assignments.js";
import { createImportStore, parseImportCsv } from "../users/import.js";
import type { UserRepository } from "../users/repository.js";

function day(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function createManagementRouter(options: {
  users: UserRepository;
  cohorts: CohortRepository;
  assignments: AssignmentRepository;
  bus: EventBus;
  service: AuthService;
}): Router {
  const router = Router();
  const guard = authenticate(options.users);
  const imports = createImportStore();

  router.get(
    "/cohorts",
    guard,
    authorize("cohorts.view"),
    asyncRoute(async (_req, res) => {
      const cohorts = await options.cohorts.list();
      res.json({
        data: cohorts.map((cohort) => ({
          id: cohort.id,
          name: cohort.name,
          academicYear: cohort.academicYear,
          startDate: day(cohort.startDate),
          endDate: day(cohort.endDate),
          status: cohort.status,
        })),
      });
    }),
  );

  router.post(
    "/cohorts",
    guard,
    authorize("cohorts.create"),
    validateBody(createCohortSchema),
    asyncRoute(async (req, res) => {
      try {
        const cohort = await options.cohorts.create({
          name: req.body.name,
          academicYear: req.body.academicYear,
          startDate: new Date(`${req.body.startDate}T00:00:00.000Z`),
          endDate: new Date(`${req.body.endDate}T00:00:00.000Z`),
        });
        res.status(201).json({
          data: {
            id: cohort.id,
            name: cohort.name,
            academicYear: cohort.academicYear,
            startDate: day(cohort.startDate),
            endDate: day(cohort.endDate),
            status: cohort.status,
          },
        });
      } catch (error) {
        if (error instanceof DuplicateCohortError) {
          throw new AppError(409, "CONFLICT", error.message);
        }
        throw error;
      }
    }),
  );

  router.get(
    "/users",
    guard,
    authorize("users.list"),
    asyncRoute(async (req, res) => {
      const role = typeof req.query.role === "string" ? req.query.role : undefined;
      const users = await options.users.list(
        role === "STUDENT" || role === "MENTOR" || role === "ADMIN" ? { role } : {},
      );
      res.json({
        data: users.map((user) => ({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          branch: user.branch,
          cohortId: user.cohortId,
          status: user.status,
          capabilities: user.capabilities,
        })),
      });
    }),
  );

  router.get(
    "/users/:id",
    guard,
    asyncRoute(async (req, res) => {
      const target = await options.users.findById(req.params.id);
      if (!target) {
        throw new AppError(404, "NOT_FOUND", "That person was not found.");
      }
      const active = target.role === "STUDENT" ? await options.assignments.findActiveByStudent(target.id) : null;
      if (!canViewStudent(req.user!, target.id, active?.mentorId ?? null)) {
        const bus = req.app.locals.eventBus as EventBus | undefined;
        await bus?.emit({
          action: "security.access_denied",
          actorId: req.user!.id,
          subjectType: "User",
          subjectId: target.id,
          requestId: req.id,
        });
        throw new AppError(403, "FORBIDDEN", "You do not have access to this.");
      }
      res.json({
        data: {
          id: target.id,
          name: target.name,
          email: target.email,
          role: target.role,
          branch: target.branch,
          cohortId: target.cohortId,
          status: target.status,
        },
      });
    }),
  );

  router.get(
    "/mentors/:id/students",
    guard,
    asyncRoute(async (req, res) => {
      if (req.user!.role !== "ADMIN" && req.user!.id !== req.params.id) {
        const bus = req.app.locals.eventBus as EventBus | undefined;
        await bus?.emit({
          action: "security.access_denied",
          actorId: req.user!.id,
          subjectType: "User",
          subjectId: req.params.id,
          requestId: req.id,
        });
        throw new AppError(403, "FORBIDDEN", "You do not have access to this.");
      }
      const rows = await options.assignments.listActiveByMentor(req.params.id);
      const students = (
        await Promise.all(rows.map((row) => options.users.findById(row.studentId)))
      ).flatMap((student) =>
        student
          ? [{ id: student.id, name: student.name, email: student.email, branch: student.branch, status: student.status }]
          : [],
      );
      res.json({ data: students });
    }),
  );

  router.post(
    "/mentor-assignments",
    guard,
    authorize("mentor.assign"),
    validateBody(assignMentorSchema),
    asyncRoute(async (req, res) => {
      const assigned = await assignStudents({
        users: options.users,
        assignments: options.assignments,
        bus: options.bus,
        actorId: req.user!.id,
        mentorId: req.body.mentorId,
        studentIds: req.body.studentIds,
      });
      res.status(201).json({ data: { assigned } });
    }),
  );

  router.patch(
    "/users/:id",
    guard,
    authorize("users.update"),
    validateBody(updateUserSchema),
    asyncRoute(async (req, res) => {
      const current = await options.users.findById(req.params.id);
      if (!current) {
        throw new AppError(404, "NOT_FOUND", "That person was not found.");
      }
      if (current.role === "STUDENT" && req.body.branch === null) {
        throw new AppError(400, "VALIDATION_ERROR", "A student needs a branch.");
      }
      const updated = await options.users.update(current.id, {
        ...(req.body.name !== undefined ? { name: req.body.name } : {}),
        ...(req.body.branch !== undefined ? { branch: req.body.branch } : {}),
        ...(req.body.cohortId !== undefined ? { cohortId: req.body.cohortId } : {}),
        ...(req.body.capabilities !== undefined ? { capabilities: req.body.capabilities } : {}),
      });
      if (req.body.capabilities) {
        await options.bus.emit({
          action: "mentor.capabilities_changed",
          actorId: req.user!.id,
          subjectType: "User",
          subjectId: current.id,
          before: { capabilities: current.capabilities },
          after: { capabilities: req.body.capabilities },
        });
      }
      res.json({
        data: {
          id: updated!.id,
          name: updated!.name,
          branch: updated!.branch,
          cohortId: updated!.cohortId,
          capabilities: updated!.capabilities,
        },
      });
    }),
  );

  router.post(
    "/users/:id/deactivate",
    guard,
    authorize("users.deactivate"),
    asyncRoute(async (req, res) => {
      if (req.params.id === req.user!.id) {
        throw new AppError(400, "VALIDATION_ERROR", "You cannot deactivate your own account.");
      }
      const current = await options.users.findById(req.params.id);
      if (!current) {
        throw new AppError(404, "NOT_FOUND", "That person was not found.");
      }
      const updated = await options.users.update(current.id, { status: "DEACTIVATED" });
      await options.bus.emit({
        action: "user.deactivated",
        actorId: req.user!.id,
        subjectType: "User",
        subjectId: current.id,
      });
      await revokeUserSessions(req, current.id);
      res.json({ data: { id: updated!.id, status: updated!.status } });
    }),
  );

  router.post(
    "/users/:id/reactivate",
    guard,
    authorize("users.reinvite"),
    asyncRoute(async (req, res) => {
      const current = await options.users.findById(req.params.id);
      if (!current) {
        throw new AppError(404, "NOT_FOUND", "That person was not found.");
      }
      if (current.status !== "DEACTIVATED") {
        throw new AppError(400, "INVALID_STATE", "Only a deactivated account can be invited again.");
      }
      await options.users.update(current.id, { status: "INVITED", passwordHash: null });
      const result = await options.service.reinvite(current.id);
      res.json({ data: { id: result.user.id, status: result.user.status, inviteUrl: result.inviteUrl } });
    }),
  );

  router.post(
    "/users/:id/reinvite",
    guard,
    authorize("users.reinvite"),
    asyncRoute(async (req, res) => {
      const result = await options.service.reinvite(req.params.id);
      res.json({ data: { id: result.user.id, inviteUrl: result.inviteUrl } });
    }),
  );

  router.post(
    "/mentor-assignments/reassign",
    guard,
    authorize("mentor.assign"),
    validateBody(assignMentorSchema),
    asyncRoute(async (req, res) => {
      const moved = await reassignStudents({
        users: options.users,
        assignments: options.assignments,
        bus: options.bus,
        actorId: req.user!.id,
        mentorId: req.body.mentorId,
        studentIds: req.body.studentIds,
      });
      res.json({ data: { moved } });
    }),
  );

  router.get(
    "/mentors/:id/workload",
    guard,
    asyncRoute(async (req, res) => {
      if (req.user!.role !== "ADMIN" && req.user!.id !== req.params.id) {
        throw new AppError(403, "FORBIDDEN", "You do not have access to this.");
      }
      const rows = await options.assignments.listActiveByMentor(req.params.id);
      res.json({ data: { students: rows.length, pendingReviews: 0, overdue: 0 } });
    }),
  );

  router.get(
    "/students/:id/mentor-history",
    guard,
    authorize("users.list"),
    asyncRoute(async (req, res) => {
      const student = await options.users.findById(req.params.id);
      if (!student || student.role !== "STUDENT") {
        throw new AppError(404, "NOT_FOUND", "That student was not found.");
      }
      const rows = await options.assignments.listByStudent(student.id);
      const history = await Promise.all(
        rows.map(async (row) => {
          const mentor = await options.users.findById(row.mentorId);
          return {
            mentorId: row.mentorId,
            mentorName: mentor?.name ?? "Unknown mentor",
            status: row.status,
            startDate: row.startDate.toISOString(),
            endDate: row.endDate ? row.endDate.toISOString() : null,
            endReason: row.endReason,
          };
        }),
      );
      res.json({ data: history });
    }),
  );

  router.post(
    "/users/import",
    guard,
    authorize("users.create"),
    validateBody(csvImportSchema),
    asyncRoute(async (req, res) => {
      const preview = await parseImportCsv(req.body.csv, options.users, options.cohorts);
      imports.save(preview);
      res.json({
        data: {
          previewId: preview.id,
          rows: preview.rows.map((row) => ({
            line: row.line,
            name: row.name,
            email: row.email,
            errors: row.errors,
          })),
        },
      });
    }),
  );

  router.post(
    "/users/import/:previewId/commit",
    guard,
    authorize("users.create"),
    asyncRoute(async (req, res) => {
      const preview = imports.get(req.params.previewId);
      if (!preview) {
        throw new AppError(404, "NOT_FOUND", "That import preview was not found.");
      }
      if (preview.committed) {
        res.json({ data: preview.committed });
        return;
      }
      const skipped: { line: number; email: string; reason: string }[] = [];
      let created = 0;
      for (const row of preview.rows) {
        if (row.errors.length > 0 || !row.role) {
          skipped.push({ line: row.line, email: row.email, reason: row.errors.join(" ") || "Invalid row." });
          continue;
        }
        await options.service.invite({
          name: row.name,
          email: row.email,
          role: row.role,
          branch: row.branch,
          cohortId: row.role === "STUDENT" ? row.cohortId : null,
          actorId: req.user!.id,
        });
        created += 1;
      }
      preview.committed = { created, skipped };
      res.json({ data: preview.committed });
    }),
  );

  return router;
}
