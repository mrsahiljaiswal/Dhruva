import {
  acceptAnswerSchema,
  createCommentSchema,
  createDoubtSchema,
  createForumPostSchema,
  createReportSchema,
  forumListQuerySchema,
  reactionWriteSchema,
  reasonSchema,
  resourcePostQuerySchema,
} from "@dhruva/shared";
import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request, RequestHandler } from "express";
import type { EventBus } from "../../events/bus.js";
import { AppError } from "../../middleware/errors.js";
import { validateBody } from "../../middleware/validate.js";
import { authenticate } from "../../policies/authenticate.js";
import type { AssignmentRepository } from "../mentors/assignments.js";
import { asyncRoute } from "../auth/session.js";
import type { ResourceRepository } from "../resources/repository.js";
import type { UserRepository } from "../users/repository.js";
import type { DiscussionRepository } from "./repository.js";
import { createDiscussionService, type DiscussionGrantSource } from "./service.js";

const QUERY_KEYS = ["page", "limit", "category", "status", "q"] as const;

function queryFields(query: Request["query"]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const key of QUERY_KEYS) {
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

function reportLimiter(limit: number, windowMs: number): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? "127.0.0.1"),
    validate: { keyGeneratorIpFallback: false },
    handler: (req, res) => {
      res.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests. Try again later.",
          details: [],
          requestId: req.id ?? "",
        },
      });
    },
  });
}

export function createDiscussionRouter(options: {
  users: UserRepository;
  resources: ResourceRepository;
  assignments: AssignmentRepository;
  discussions: DiscussionRepository;
  bus: EventBus;
  grants?: DiscussionGrantSource;
  reportLimit?: { limit: number; windowMs: number };
  now?: () => Date;
}): Router {
  const router = Router();
  const guard = authenticate(options.users);
  const reports = reportLimiter(options.reportLimit?.limit ?? 20, options.reportLimit?.windowMs ?? 60 * 60 * 1000);
  const discussions = createDiscussionService({
    users: options.users,
    resources: options.resources,
    assignments: options.assignments,
    discussions: options.discussions,
    bus: options.bus,
    grants: options.grants,
    now: options.now,
  });

  router.get(
    "/resources/:id/posts",
    guard,
    asyncRoute(async (req, res) => {
      const parsed = resourcePostQuerySchema.safeParse(queryFields(req.query));
      if (!parsed.success) {
        throw parsed.error;
      }
      res.json(await discussions.listResourcePosts(req.user!.id, req.params.id, parsed.data, req.id));
    }),
  );

  router.post(
    "/resources/:id/posts",
    guard,
    validateBody(createDoubtSchema),
    asyncRoute(async (req, res) => {
      res.status(201).json({ data: await discussions.createDoubt(req.user!.id, req.params.id, req.body, req.id) });
    }),
  );

  router.get(
    "/forum/posts",
    guard,
    asyncRoute(async (req, res) => {
      const parsed = forumListQuerySchema.safeParse(queryFields(req.query));
      if (!parsed.success) {
        throw parsed.error;
      }
      res.json(await discussions.listForumPosts(req.user!.id, parsed.data));
    }),
  );

  router.post(
    "/forum/posts",
    guard,
    validateBody(createForumPostSchema),
    asyncRoute(async (req, res) => {
      res.status(201).json({ data: await discussions.createForumPost(req.user!.id, req.body) });
    }),
  );

  router.get(
    "/posts/:id",
    guard,
    asyncRoute(async (req, res) => {
      res.json({ data: await discussions.getPost(req.user!.id, req.params.id, req.id) });
    }),
  );

  router.post(
    "/posts/:id/comments",
    guard,
    validateBody(createCommentSchema),
    asyncRoute(async (req, res) => {
      res.status(201).json({ data: await discussions.comment(req.user!.id, req.params.id, req.body, req.id) });
    }),
  );

  router.post(
    "/posts/:id/accept",
    guard,
    validateBody(acceptAnswerSchema),
    asyncRoute(async (req, res) => {
      res.json({ data: await discussions.accept(req.user!.id, req.params.id, req.body.commentId, req.id) });
    }),
  );

  router.post(
    "/posts/:id/resolve",
    guard,
    asyncRoute(async (req, res) => {
      res.json({ data: await discussions.resolve(req.user!.id, req.params.id, req.id) });
    }),
  );

  router.post(
    "/posts/:id/highlight",
    guard,
    asyncRoute(async (req, res) => {
      res.json({ data: await discussions.highlight(req.user!.id, req.params.id, req.id) });
    }),
  );

  router.post(
    "/posts/:id/escalate",
    guard,
    reports,
    validateBody(reasonSchema),
    asyncRoute(async (req, res) => {
      const filed = await discussions.escalate(req.user!.id, req.params.id, req.body, req.id);
      res.status(filed.created ? 201 : 200).json({ data: filed.report });
    }),
  );

  router.post(
    "/reactions",
    guard,
    validateBody(reactionWriteSchema),
    asyncRoute(async (req, res) => {
      res.json({ data: await discussions.react(req.user!.id, req.body, req.id) });
    }),
  );

  router.post(
    "/reports",
    guard,
    reports,
    validateBody(createReportSchema),
    asyncRoute(async (req, res) => {
      const filed = await discussions.report(req.user!.id, req.body, req.id);
      res.status(filed.created ? 201 : 200).json({ data: filed.report });
    }),
  );

  return router;
}
