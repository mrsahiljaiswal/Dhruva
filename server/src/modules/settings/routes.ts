import { updatePlatformSettingsSchema } from "@dhruva/shared";
import { Router } from "express";
import type { EventBus } from "../../events/bus.js";
import { AppError } from "../../middleware/errors.js";
import { validateBody } from "../../middleware/validate.js";
import { authenticate, authorize } from "../../policies/authenticate.js";
import { asyncRoute } from "../auth/session.js";
import type { UserRepository } from "../users/repository.js";
import type { SettingsRepository } from "./repository.js";

function expectedVersion(header: string | undefined): number {
  if (!header) {
    throw new AppError(400, "VALIDATION_ERROR", "If-Match is required.", [
      { path: "if-match", message: "If-Match is required." },
    ]);
  }
  const value = header.trim().replace(/^W\//, "").replaceAll('"', "");
  if (!/^\d+$/.test(value)) {
    throw new AppError(400, "VALIDATION_ERROR", "If-Match is invalid.", [
      { path: "if-match", message: "If-Match must be the settings version." },
    ]);
  }
  return Number(value);
}

function present(record: {
  studentDirectMessages: boolean;
  groupChat: boolean;
  supportThresholds: {
    attentionCompletionPct: number;
    interventionCompletionPct: number;
    attentionAverageScore: number;
    interventionAverageScore: number;
    attentionOverdueCount: number;
    interventionOverdueCount: number;
    inactiveDays: number;
  };
  version: number;
}) {
  return {
    studentDirectMessages: record.studentDirectMessages,
    groupChat: record.groupChat,
    supportThresholds: record.supportThresholds,
    version: record.version,
  };
}

export function createSettingsRouter(options: { users: UserRepository; settings: SettingsRepository; bus: EventBus }): Router {
  const router = Router();
  const guard = authenticate(options.users);

  router.get(
    "/settings/features",
    guard,
    asyncRoute(async (_req, res) => {
      const current = await options.settings.get();
      res.json({
        data: {
          studentDirectMessages: current.studentDirectMessages,
          groupChat: current.groupChat,
        },
      });
    }),
  );

  router.get(
    "/settings",
    guard,
    authorize("settings.view"),
    asyncRoute(async (_req, res) => {
      const current = await options.settings.get();
      res.set("ETag", `"${current.version}"`);
      res.json({ data: present(current) });
    }),
  );

  router.patch(
    "/settings",
    guard,
    authorize("settings.update"),
    validateBody(updatePlatformSettingsSchema),
    asyncRoute(async (req, res) => {
      const version = expectedVersion(req.get("if-match"));
      const current = await options.settings.get();
      if (current.version !== version) {
        throw new AppError(409, "CONFLICT", "These settings changed. Reload them and try again.");
      }
      const updated = await options.settings.update(version, req.body);
      if (updated === "conflict") {
        throw new AppError(409, "CONFLICT", "These settings changed. Reload them and try again.");
      }
      await options.bus.emit({
        action: "settings.updated",
        actorId: req.user!.id,
        subjectType: "PlatformSettings",
        subjectId: updated.id,
        before: {
          studentDirectMessages: current.studentDirectMessages,
          groupChat: current.groupChat,
          supportThresholds: current.supportThresholds,
        },
        after: {
          studentDirectMessages: updated.studentDirectMessages,
          groupChat: updated.groupChat,
          supportThresholds: updated.supportThresholds,
        },
        requestId: req.id ?? null,
      });
      res.set("ETag", `"${updated.version}"`);
      res.json({ data: present(updated) });
    }),
  );

  return router;
}
