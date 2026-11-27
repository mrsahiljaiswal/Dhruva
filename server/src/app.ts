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
import { createSubmissionRouter } from "./modules/submissions/routes.js";
import { createMemorySubmissionRepository, type SubmissionRepository } from "./modules/submissions/repository.js";
import { codeExecutionOff, ManualReviewRunner, type CodeRunner, type ExecutionGate } from "./modules/submissions/runner.js";
import { createAssessmentRouter } from "./modules/assessments/routes.js";
import { createMemoryAssessmentRepository, type AssessmentRepository } from "./modules/assessments/repository.js";
import { createDiscussionRouter } from "./modules/discussions/routes.js";
import { createMemoryDiscussionRepository, type DiscussionRepository } from "./modules/discussions/repository.js";
import { createAnalyticsRouter } from "./modules/analytics/routes.js";
import {
  createMemoryExportRepository,
  createMemoryLearningEventRepository,
  createMemoryProgressRepository,
} from "./modules/analytics/repository.js";
import { registerProgressSubscriber } from "./modules/analytics/subscriber.js";
import type { AnalyticsDeps } from "./modules/analytics/rebuild.js";
import { grantedResourceIds } from "./modules/learning/grants.js";
import type { UploadIntentRepository } from "./modules/resources/uploads.js";
import type { ObjectStorage } from "./platform/storage.js";
import { createMessagingRouter } from "./modules/messaging/routes.js";
import { createMemoryMessagingRepository, type MessagingRepository } from "./modules/messaging/repository.js";
import { createMessagingService } from "./modules/messaging/service.js";
import { createNotificationRouter } from "./modules/notifications/routes.js";
import { createMemoryNotificationRepository, type NotificationRepository } from "./modules/notifications/repository.js";
import { createMemoryPreferenceRepository, type PreferenceRepository } from "./modules/notifications/preferences.js";
import { createSettingsRouter } from "./modules/settings/routes.js";
import { createMemorySettingsRepository, type SettingsRepository } from "./modules/settings/repository.js";
import { noopDelivery, type Delivery } from "./realtime/delivery.js";

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
    revisions?: SubmissionRepository;
    runner?: CodeRunner;
    execution?: ExecutionGate;
    assessments?: AssessmentRepository;
  };
  discussions?: {
    repository?: DiscussionRepository;
    reportLimit?: { limit: number; windowMs: number };
    now?: () => Date;
  };
  messaging?: {
    repository?: MessagingRepository;
    settings?: SettingsRepository;
    notifications?: NotificationRepository;
    preferences?: PreferenceRepository;
    delivery?: Delivery;
    now?: () => Date;
  };
  analytics?: {
    deps?: AnalyticsDeps;
    enqueue?: (id: string) => Promise<void>;
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
    const sessions = session({
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
    });
    app.locals.session = sessions;
    app.use(sessions);
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
      const revisions = deps.learning?.revisions ?? createMemorySubmissionRepository();
      const assessments = deps.learning?.assessments ?? createMemoryAssessmentRepository();
      const discussions = deps.discussions?.repository ?? createMemoryDiscussionRepository();
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
        app.use(
          API_PREFIX,
          createSubmissionRouter({
            users: deps.auth.users,
            mentorAssignments: deps.auth.directory.assignments,
            resources: deps.resources.repository,
            work: deps.learning.work,
            revisions,
            uploads: deps.resources.uploads,
            storage: deps.resources.storage,
            bus: deps.eventBus,
            runner: deps.learning.runner ?? new ManualReviewRunner(),
            execution: deps.learning.execution ?? codeExecutionOff,
            now: deps.learning.now,
          }),
        );
        app.use(
          API_PREFIX,
          createAssessmentRouter({
            users: deps.auth.users,
            cohorts: deps.auth.directory.cohorts,
            mentorAssignments: deps.auth.directory.assignments,
            assessments,
            bus: deps.eventBus,
            runner: deps.learning.runner ?? new ManualReviewRunner(),
            execution: deps.learning.execution ?? codeExecutionOff,
            now: deps.learning.now,
          }),
        );
      }
      const messagingRepository = deps.messaging?.repository ?? createMemoryMessagingRepository();
      const settings = deps.messaging?.settings ?? createMemorySettingsRepository();
      const notifications = deps.messaging?.notifications ?? createMemoryNotificationRepository();
      const preferences = deps.messaging?.preferences ?? createMemoryPreferenceRepository();
      const delivery = deps.messaging?.delivery ?? noopDelivery;
      const messagingService = createMessagingService({
        users: deps.auth.users,
        assignments: deps.auth.directory.assignments,
        settings,
        messaging: messagingRepository,
        bus: deps.eventBus,
        delivery,
        uploads: deps.resources?.uploads,
        storage: deps.resources?.storage,
        now: deps.messaging?.now,
      });
      app.locals.messaging = messagingService;
      app.use(
        API_PREFIX,
        createSettingsRouter({
          users: deps.auth.users,
          settings,
          bus: deps.eventBus,
        }),
      );
      app.use(
        API_PREFIX,
        createMessagingRouter({
          users: deps.auth.users,
          assignments: deps.auth.directory.assignments,
          settings,
          messaging: messagingRepository,
          bus: deps.eventBus,
          delivery,
          service: messagingService,
        }),
      );
      app.use(
        API_PREFIX,
        createNotificationRouter({
          users: deps.auth.users,
          notifications,
          preferences,
          bus: deps.eventBus,
          now: deps.messaging?.now,
        }),
      );
      if (deps.resources) {
        app.use(
          API_PREFIX,
          createDiscussionRouter({
            users: deps.auth.users,
            resources: deps.resources.repository,
            assignments: deps.auth.directory.assignments,
            discussions,
            bus: deps.eventBus,
            grants: deps.learning
              ? {
                  resourceIdsFor: (viewer) =>
                    grantedResourceIds(deps.learning!.work, deps.auth!.directory!.assignments, viewer),
                }
              : undefined,
            reportLimit: deps.discussions?.reportLimit,
            now: deps.discussions?.now,
          }),
        );
      }
      if (deps.learning && deps.resources) {
        const analytics: AnalyticsDeps = deps.analytics?.deps ?? {
          users: deps.auth.users,
          cohorts: deps.auth.directory.cohorts,
          mentorAssignments: deps.auth.directory.assignments,
          work: deps.learning.work,
          resources: deps.resources.repository,
          assessments,
          revisions,
          discussions,
          settings,
          progress: createMemoryProgressRepository(),
          events: createMemoryLearningEventRepository(),
          exports: createMemoryExportRepository(),
          mailer: deps.mailer,
          now: deps.learning.now ?? deps.messaging?.now,
        };
        registerProgressSubscriber(deps.eventBus, analytics);
        app.use(
          API_PREFIX,
          createAnalyticsRouter({
            users: deps.auth.users,
            mentorAssignments: deps.auth.directory.assignments,
            analytics,
            bus: deps.eventBus,
            enqueue: deps.analytics?.enqueue,
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
