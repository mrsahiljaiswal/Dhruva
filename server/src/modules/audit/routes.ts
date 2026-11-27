import { auditListQuerySchema, auditSubjectParamsSchema } from "@dhruva/shared";
import { Router } from "express";
import type { Request } from "express";
import { AppError } from "../../middleware/errors.js";
import { authenticate, authorize } from "../../policies/authenticate.js";
import { asyncRoute } from "../auth/session.js";
import type { UserRepository } from "../users/repository.js";
import { createMemoryAuditLogRepository, type AuditLogRepository, type StoredAudit } from "./repository.js";

const QUERY_KEYS = ["actorId", "action", "subjectType", "subjectId", "from", "to", "page", "limit"] as const;

function queryFields(query: Request["query"]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const key of QUERY_KEYS) {
    const value = query[key];
    if (value === undefined || value === "") {
      continue;
    }
    if (typeof value !== "string") {
      throw new AppError(400, "VALIDATION_ERROR", "Request validation failed.", [
        { path: key, message: "Send this filter as text." },
      ]);
    }
    fields[key] = value;
  }
  return fields;
}

function present(row: StoredAudit) {
  return {
    id: row.id,
    actorId: row.actorId,
    action: row.action,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    before: row.before,
    after: row.after,
    reason: row.reason,
    requestId: row.requestId,
    ip: row.ip,
    createdAt: row.createdAt.toISOString(),
  };
}

export function createAuditRouter(options: { users: UserRepository; log?: AuditLogRepository }): Router {
  const router = Router();
  const guard = authenticate(options.users);
  const log = options.log ?? createMemoryAuditLogRepository();

  router.get(
    "/audit",
    guard,
    authorize("audit.read"),
    asyncRoute(async (req, res) => {
      const parsed = auditListQuerySchema.safeParse(queryFields(req.query));
      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Request validation failed.", [
          { path: parsed.error.issues[0]?.path.join(".") || "query", message: parsed.error.issues[0]?.message ?? "Check the filters." },
        ]);
      }
      if (parsed.data.from && parsed.data.to && parsed.data.to < parsed.data.from) {
        throw new AppError(400, "VALIDATION_ERROR", "The end of the range is before the start.", [
          { path: "to", message: "The end of the range is before the start." },
        ]);
      }
      const page = await log.query({
        actorId: parsed.data.actorId,
        action: parsed.data.action,
        subjectType: parsed.data.subjectType,
        subjectId: parsed.data.subjectId,
        from: parsed.data.from ? new Date(parsed.data.from) : undefined,
        to: parsed.data.to ? new Date(parsed.data.to) : undefined,
        page: parsed.data.page,
        limit: parsed.data.limit,
      });
      res.json({
        data: page.rows.map(present),
        page: parsed.data.page,
        limit: parsed.data.limit,
        total: page.total,
      });
    }),
  );

  router.get(
    "/audit/:subjectType/:subjectId",
    guard,
    authorize("audit.read"),
    asyncRoute(async (req, res) => {
      const parsed = auditSubjectParamsSchema.safeParse({
        subjectType: req.params.subjectType,
        subjectId: req.params.subjectId,
      });
      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Request validation failed.", [
          { path: "subject", message: "That history address is not valid." },
        ]);
      }
      const rows = await log.history(parsed.data.subjectType, parsed.data.subjectId);
      res.json({ data: rows.map(present) });
    }),
  );

  return router;
}
