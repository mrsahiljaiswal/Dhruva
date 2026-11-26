import { messageListQuerySchema, openConversationSchema, reasonSchema, sendMessageSchema, markReadSchema } from "@dhruva/shared";
import { Router } from "express";
import type { Request } from "express";
import type { EventBus } from "../../events/bus.js";
import { AppError } from "../../middleware/errors.js";
import { validateBody } from "../../middleware/validate.js";
import type { ObjectStorage } from "../../platform/storage.js";
import type { Delivery } from "../../realtime/delivery.js";
import { authenticate } from "../../policies/authenticate.js";
import { asyncRoute } from "../auth/session.js";
import type { AssignmentRepository } from "../mentors/assignments.js";
import type { UploadIntentRepository } from "../resources/uploads.js";
import type { SettingsRepository } from "../settings/repository.js";
import type { UserRepository } from "../users/repository.js";
import type { MessagingRepository } from "./repository.js";
import { createMessagingService, type MessagingService } from "./service.js";

function pageQuery(query: Request["query"]) {
  const fields: Record<string, string> = {};
  for (const key of ["page", "limit"] as const) {
    const value = query[key];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== "string") {
      throw new AppError(400, "VALIDATION_ERROR", "Request validation failed.", [
        { path: key, message: "Send this filter as text." },
      ]);
    }
    if (value.length > 0) {
      fields[key] = value;
    }
  }
  return fields;
}

export function createMessagingRouter(options: {
  users: UserRepository;
  assignments: AssignmentRepository;
  settings: SettingsRepository;
  messaging: MessagingRepository;
  bus: EventBus;
  delivery: Delivery;
  uploads?: UploadIntentRepository;
  storage?: ObjectStorage;
  service?: MessagingService;
  now?: () => Date;
}): Router {
  const router = Router();
  const guard = authenticate(options.users);
  const messaging =
    options.service ??
    createMessagingService({
      users: options.users,
      assignments: options.assignments,
      settings: options.settings,
      messaging: options.messaging,
      bus: options.bus,
      delivery: options.delivery,
      uploads: options.uploads,
      storage: options.storage,
      now: options.now,
    });

  router.get(
    "/conversations",
    guard,
    asyncRoute(async (req, res) => {
      res.json(await messaging.list(req.user!.id));
    }),
  );

  router.post(
    "/conversations",
    guard,
    validateBody(openConversationSchema),
    asyncRoute(async (req, res) => {
      const opened = await messaging.open(req.user!.id, req.body, req.id);
      res.status(opened.created ? 201 : 200).json({ data: opened.conversation });
    }),
  );

  router.get(
    "/conversations/:id/messages",
    guard,
    asyncRoute(async (req, res) => {
      const parsed = messageListQuerySchema.safeParse(pageQuery(req.query));
      if (!parsed.success) {
        throw parsed.error;
      }
      res.json(await messaging.messages(req.user!.id, req.params.id, parsed.data.page, parsed.data.limit, req.id));
    }),
  );

  router.post(
    "/conversations/:id/messages",
    guard,
    validateBody(sendMessageSchema),
    asyncRoute(async (req, res) => {
      res.status(201).json({ data: await messaging.send(req.user!.id, req.params.id, req.body, req.id) });
    }),
  );

  router.post(
    "/conversations/:id/read",
    guard,
    validateBody(markReadSchema),
    asyncRoute(async (req, res) => {
      res.json({ data: await messaging.markRead(req.user!.id, req.params.id, req.body.messageId, req.id) });
    }),
  );

  router.post(
    "/conversations/:id/break-glass",
    guard,
    validateBody(reasonSchema),
    asyncRoute(async (req, res) => {
      res.json(await messaging.breakGlass(req.user!.id, req.params.id, req.body.reason, req.id));
    }),
  );

  return router;
}
