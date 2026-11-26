import type { RequestHandler } from "express";
import type { EventBus } from "../events/bus.js";
import { AppError } from "../middleware/errors.js";
import type { UserRepository } from "../modules/users/repository.js";
import { can, type Action, type AuthUser, type Subject } from "./can.js";

export const ABSOLUTE_SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export function isSessionExpired(issuedAt: number, now: number): boolean {
  return now - issuedAt > ABSOLUTE_SESSION_MS;
}

export function authenticate(users: UserRepository, now: () => Date = () => new Date()): RequestHandler {
  return async (req, _res, next) => {
    try {
      const userId = req.session?.userId;
      const issuedAt = req.session?.issuedAt;
      if (!userId || issuedAt === undefined || isSessionExpired(issuedAt, now().getTime())) {
        next(new AppError(401, "UNAUTHENTICATED", "Sign in to continue."));
        return;
      }
      const user = await users.findById(userId);
      if (!user || user.status === "INVITED") {
        next(new AppError(401, "UNAUTHENTICATED", "Sign in to continue."));
        return;
      }
      if (user.status === "DEACTIVATED") {
        next(new AppError(403, "ACCOUNT_INACTIVE", "This account is deactivated."));
        return;
      }
      req.user = {
        id: user.id,
        role: user.role,
        status: user.status,
        capabilities: user.capabilities,
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function authorize(action: Action, subjectFor?: (user: AuthUser) => Subject): RequestHandler {
  return async (req, _res, next) => {
    try {
      if (!req.user) {
        next(new AppError(401, "UNAUTHENTICATED", "Sign in to continue."));
        return;
      }
      const subject = subjectFor?.(req.user);
      if (can(req.user, action, subject)) {
        next();
        return;
      }
      const bus = req.app.locals.eventBus as EventBus | undefined;
      await bus?.emit({
        action: "security.access_denied",
        actorId: req.user.id,
        subjectType: "User",
        subjectId: subject?.type === "profile" ? subject.userId : null,
        requestId: req.id,
      });
      next(new AppError(403, "FORBIDDEN", "You do not have access to this."));
    } catch (error) {
      next(error);
    }
  };
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
