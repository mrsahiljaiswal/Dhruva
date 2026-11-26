import { API_PREFIX } from "@dhruva/shared";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import session from "express-session";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import type { EventBus } from "./events/bus.js";
import type { AppLogger } from "./platform/logger.js";
import type { Mailer } from "./platform/mail.js";
import { AppError } from "./middleware/errors.js";
import { errorHandler } from "./middleware/error-handler.js";
import { requestId } from "./middleware/request-id.js";
import { requireCsrf } from "./modules/auth/csrf.js";
import { createAuthRouter } from "./modules/auth/routes.js";
import type { AuthService } from "./modules/auth/service.js";
import { SESSION_COOKIE, SESSION_IDLE_MS } from "./modules/auth/session.js";
import type { UserRepository } from "./modules/users/repository.js";
import { healthRouter } from "./modules/health/routes.js";
import { createManagementRouter } from "./modules/directory/routes.js";
import type { CohortRepository } from "./modules/cohorts/repository.js";
import type { AssignmentRepository } from "./modules/mentors/assignments.js";
import { createResourceRouter } from "./modules/resources/routes.js";
import type { ResourceRepository } from "./modules/resources/repository.js";
import { createLearningRouter } from "./modules/learning/routes.js";
import type { LearningPathRepository } from "./modules/learning/paths.js";
import type { WorkRepository } from "./modules/learning/work.js";
import { grantedResourceIds } from "./modules/learning/grants.js";
import type { UploadIntentRepository } from "./modules/resources/uploads.js";
import type { ObjectStorage } from "./platform/storage.js";

export type AppDeps = {
  clientOrigin: string;
  isDbReady: () => boolean;
  logger: AppLogger;
  eventBus?: EventBus;
  mailer?: Mailer;
  rateLimit?: false | { limit: number; windowMs: number };
  auth?: {
    service: AuthService;
    users: UserRepository;
    sessionSecret: string;
    secureCookies: boolean;
    sessionStore?: session.Store;
    loginLimit?: { limit: number; windowMs: number };
    resetLimit?: { limit: number; windowMs: number };
    inviteLimit?: { limit: number; windowMs: number };
    directory?: {
      cohorts: CohortRepository;
      assignments: AssignmentRepository;
    };
  };
  resources?: {
    repository: ResourceRepository;
    uploads: UploadIntentRepository;
    storage: ObjectStorage;
  };
  learning?: {
    paths: LearningPathRepository;
    work: WorkRepository;
    now?: () => Date;
  };
};

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.locals.eventBus = deps.eventBus;
  app.locals.mailer = deps.mailer;

  app.use(requestId);
  app.use((req, res, next) => {
    const started = Date.now();
    res.on("finish", () => {
      deps.logger.info(
        {
          requestId: req.id,
          method: req.method,
          url: req.originalUrl,
          status: res.statusCode,
          ms: Date.now() - started,
        },
        "request",
      );
    });
    next();
  });
  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || origin === deps.clientOrigin) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
      credentials: true,
      exposedHeaders: ["ETag"],
    }),
  );

  if (deps.rateLimit) {
    const limits = deps.rateLimit;
    app.use(
      rateLimit({
        windowMs: limits.windowMs,
        limit: limits.limit,
        standardHeaders: "draft-7",
        legacyHeaders: false,
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
      }),
    );
  }

  app.use(express.json({ limit: "1mb" }));
  if (deps.auth) {
    app.use(cookieParser());
    app.use(
      session({
        name: SESSION_COOKIE,
        secret: deps.auth.sessionSecret,
        resave: false,
        saveUninitialized: false,
        rolling: true,
        store: deps.auth.sessionStore,
        cookie: {
          httpOnly: true,
          sameSite: "lax",
          secure: deps.auth.secureCookies,
          maxAge: SESSION_IDLE_MS,
        },
      }),
    );
    app.use(requireCsrf());
  }
  app.use(API_PREFIX, healthRouter(deps.isDbReady));
  if (deps.auth) {
    app.use(
      API_PREFIX,
      createAuthRouter({
        service: deps.auth.service,
        users: deps.auth.users,
        secureCookies: deps.auth.secureCookies,
        loginLimit: deps.auth.loginLimit ?? { limit: 10, windowMs: 15 * 60 * 1000 },
        resetLimit: deps.auth.resetLimit ?? { limit: 5, windowMs: 60 * 60 * 1000 },
        inviteLimit: deps.auth.inviteLimit ?? { limit: 10, windowMs: 60 * 60 * 1000 },
      }),
    );
    if (deps.auth.directory && deps.eventBus) {
      app.use(
        API_PREFIX,
        createManagementRouter({
          users: deps.auth.users,
          cohorts: deps.auth.directory.cohorts,
          assignments: deps.auth.directory.assignments,
          bus: deps.eventBus,
          service: deps.auth.service,
        }),
      );
      if (deps.resources) {
        app.use(
          API_PREFIX,
          createResourceRouter({
            users: deps.auth.users,
            cohorts: deps.auth.directory.cohorts,
            assignments: deps.auth.directory.assignments,
            resources: deps.resources.repository,
            uploads: deps.resources.uploads,
            storage: deps.resources.storage,
            bus: deps.eventBus,
            grants: deps.learning
              ? {
                  resourceIdsFor: (viewer) =>
                    grantedResourceIds(deps.learning!.work, deps.auth!.directory!.assignments, viewer),
                }
              : undefined,
          }),
        );
      }
      if (deps.learning && deps.resources) {
        app.use(
          API_PREFIX,
          createLearningRouter({
            users: deps.auth.users,
            cohorts: deps.auth.directory.cohorts,
            mentorAssignments: deps.auth.directory.assignments,
            resources: deps.resources.repository,
            paths: deps.learning.paths,
            work: deps.learning.work,
            bus: deps.eventBus,
            now: deps.learning.now,
          }),
        );
      }
    }
  }

  app.use((_req, _res, next) => {
    next(new AppError(404, "NOT_FOUND", "The requested resource was not found."));
  });
  app.use(errorHandler(deps.logger));

  return app;
}
