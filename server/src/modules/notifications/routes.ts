import { updateNotificationPreferencesSchema } from "@dhruva/shared";
import { Router } from "express";
import type { EventBus } from "../../events/bus.js";
import { AppError } from "../../middleware/errors.js";
import { validateBody } from "../../middleware/validate.js";
import { authenticate, authorize } from "../../policies/authenticate.js";
import { asyncRoute } from "../auth/session.js";
import type { UserRepository } from "../users/repository.js";
import type { PreferenceRepository } from "./preferences.js";
import type { NotificationRepository } from "./repository.js";
import { createNotificationService } from "./service.js";

export function createNotificationRouter(options: {
  users: UserRepository;
  notifications: NotificationRepository;
  preferences: PreferenceRepository;
  bus: EventBus;
  now?: () => Date;
}): Router {
  const router = Router();
  const guard = authenticate(options.users);
  const ownProfile = authorize("profile.update", (user) => ({ type: "profile", userId: user.id }));
  const notifications = createNotificationService(options);

  router.get(
    "/notifications",
    guard,
    asyncRoute(async (req, res) => {
      res.json(await notifications.list(req.user!.id));
    }),
  );

  router.post(
    "/notifications/read-all",
    guard,
    asyncRoute(async (req, res) => {
      res.json({ data: await notifications.markAllRead(req.user!.id) });
    }),
  );

  router.post(
    "/notifications/:id/read",
    guard,
    asyncRoute(async (req, res) => {
      const row = await notifications.markRead(req.user!.id, req.params.id);
      if (!row) {
        await options.bus.emit({
          action: "security.access_denied",
          actorId: req.user!.id,
          subjectType: "Notification",
          subjectId: req.params.id,
          requestId: req.id ?? null,
        });
        throw new AppError(403, "FORBIDDEN", "You do not have access to this.");
      }
      res.json({ data: row });
    }),
  );

  router.get(
    "/me/notification-preferences",
    guard,
    asyncRoute(async (req, res) => {
      res.json({ data: await notifications.preferences(req.user!.id) });
    }),
  );

  router.patch(
    "/me/notification-preferences",
    guard,
    ownProfile,
    validateBody(updateNotificationPreferencesSchema),
    asyncRoute(async (req, res) => {
      res.json({ data: await notifications.updatePreferences(req.user!.id, req.body.email) });
    }),
  );

  return router;
}
