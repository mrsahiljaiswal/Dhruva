import {
  acceptInviteSchema,
  changePasswordSchema,
  createUserSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
} from "@dhruva/shared";
import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { RequestHandler } from "express";
import { AppError } from "../../middleware/errors.js";
import { validateBody } from "../../middleware/validate.js";
import { authenticate, authorize } from "../../policies/authenticate.js";
import type { AuthService } from "./service.js";
import { asyncRoute, destroySession, establishSession, revokeOtherSessions } from "./session.js";
import { issueCsrfToken } from "./csrf.js";

function clientAddress(req: Parameters<RequestHandler>[0]): string {
  return ipKeyGenerator(req.ip ?? "127.0.0.1");
}

function limited(limit: number, windowMs: number, key: (req: Parameters<RequestHandler>[0]) => string): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => key(req),
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

export function createAuthRouter(options: {
  service: AuthService;
  users: Parameters<typeof authenticate>[0];
  secureCookies: boolean;
  loginLimit: { limit: number; windowMs: number };
  resetLimit: { limit: number; windowMs: number };
  inviteLimit: { limit: number; windowMs: number };
}): Router {
  const router = Router();
  const { service } = options;

  router.get("/auth/csrf", issueCsrfToken(options.secureCookies));

  router.post(
    "/auth/login",
    limited(options.loginLimit.limit, options.loginLimit.windowMs, (req) => {
      const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase() : "";
      return `${clientAddress(req)}:${email}`;
    }),
    validateBody(loginSchema),
    asyncRoute(async (req, res) => {
      const user = await service.login(req.body.email, req.body.password);
      await establishSession(req, user.id);
      res.json({ data: service.toPublic(user) });
    }),
  );

  router.post(
    "/auth/logout",
    asyncRoute(async (req, res) => {
      await destroySession(req);
      res.status(204).end();
    }),
  );

  router.get(
    "/auth/me",
    authenticate(options.users),
    asyncRoute(async (req, res) => {
      const user = await options.users.findById(req.user!.id);
      if (!user) {
        throw new AppError(401, "UNAUTHENTICATED", "Sign in to continue.");
      }
      res.json({ data: service.toPublic(user) });
    }),
  );

  router.post(
    "/auth/change-password",
    authenticate(options.users),
    validateBody(changePasswordSchema),
    asyncRoute(async (req, res) => {
      await service.changePassword(req.user!.id, req.body.currentPassword, req.body.newPassword);
      await establishSession(req, req.user!.id);
      await revokeOtherSessions(req, req.user!.id);
      res.status(204).end();
    }),
  );

  router.post(
    "/auth/forgot-password",
    limited(options.resetLimit.limit, options.resetLimit.windowMs, (req) => clientAddress(req)),
    validateBody(forgotPasswordSchema),
    asyncRoute(async (req, res) => {
      await service.forgotPassword(req.body.email);
      res.status(202).json({ data: { status: "accepted" } });
    }),
  );

  router.post(
    "/auth/reset-password",
    limited(options.resetLimit.limit, options.resetLimit.windowMs, (req) => clientAddress(req)),
    validateBody(resetPasswordSchema),
    asyncRoute(async (req, res) => {
      const user = await service.resetPassword(req.body.token, req.body.password);
      await revokeOtherSessions(req, user.id);
      res.json({ data: { status: "reset" } });
    }),
  );

  router.post(
    "/auth/accept-invite",
    limited(options.inviteLimit.limit, options.inviteLimit.windowMs, (req) => clientAddress(req)),
    validateBody(acceptInviteSchema),
    asyncRoute(async (req, res) => {
      const user = await service.acceptInvite(req.body.token, req.body.password);
      await establishSession(req, user.id);
      res.json({ data: service.toPublic(user) });
    }),
  );

  router.post(
    "/users",
    authenticate(options.users),
    authorize("users.create"),
    validateBody(createUserSchema),
    asyncRoute(async (req, res) => {
      const invited = await service.invite({
        name: req.body.name,
        email: req.body.email,
        role: req.body.role,
        branch: req.body.branch,
        cohortId: req.body.cohortId,
        actorId: req.user!.id,
      });
      res.status(201).json({
        data: service.toPublic(invited.user),
        ...(invited.inviteUrl ? { inviteUrl: invited.inviteUrl } : {}),
      });
    }),
  );

  return router;
}
