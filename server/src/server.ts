import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import type { RequestHandler } from "express";
import mongoose from "mongoose";
import { loadEnv } from "./config/env.js";
import { createApp } from "./app.js";
import { createAgenda } from "./jobs/agenda.js";
import { createMongoAuditLogRepository } from "./modules/audit/repository.js";
import { registerAuditSubscriber } from "./modules/audit/subscriber.js";
import { EventBus } from "./events/bus.js";
import { createLogger } from "./platform/logger.js";
import { createMailer } from "./platform/mail.js";
import { initSentry } from "./platform/sentry.js";
import { AuthService } from "./modules/auth/service.js";
import { ensureBootstrapAdmin } from "./modules/auth/bootstrap.js";
import { createMongoTokenRepository } from "./modules/auth/tokens.js";
import { createMongoUserRepository } from "./modules/users/repository.js";
import { createMongoCohortRepository } from "./modules/cohorts/repository.js";
import { createMongoAssignmentRepository } from "./modules/mentors/assignments.js";
import { createMongoLearningPathRepository } from "./modules/learning/paths.js";
import { createMongoWorkRepository } from "./modules/learning/work.js";
import { createMongoSubmissionRepository } from "./modules/submissions/repository.js";
import { codeExecutionOff, ManualReviewRunner } from "./modules/submissions/runner.js";
import { createMongoAssessmentRepository } from "./modules/assessments/repository.js";
import { createMongoDiscussionRepository } from "./modules/discussions/repository.js";
import { createMongoResourceRepository } from "./modules/resources/repository.js";
import { ensureReconcileSchedule, registerReconcileJob } from "./jobs/reconcile-recipients.js";
import { ensureExpireSchedule, registerExpireJob } from "./jobs/expire-attempts.js";
import { ensureDeadlineSchedule, registerDeadlineJob } from "./jobs/deadline-reminders.js";
import { ensureRebuildSchedule, registerRebuildJob } from "./jobs/progress-rebuild.js";
import { registerExportJob } from "./jobs/export-generate.js";
import { ensureAnnouncementSchedule, registerAnnouncementJob } from "./jobs/publish-announcements.js";
import { createMongoAnnouncementRepository } from "./modules/moderation/repository.js";
import {
  createMongoExportRepository,
  createMongoLearningEventRepository,
  createMongoProgressRepository,
} from "./modules/analytics/repository.js";
import type { AnalyticsDeps } from "./modules/analytics/rebuild.js";
import { createMongoMessagingRepository } from "./modules/messaging/repository.js";
import { createMongoNotificationRepository } from "./modules/notifications/repository.js";
import { createMongoPreferenceRepository } from "./modules/notifications/preferences.js";
import { registerNotificationSubscriber } from "./modules/notifications/subscriber.js";
import { createMongoSettingsRepository } from "./modules/settings/repository.js";
import { createDeliveryBridge } from "./realtime/delivery.js";
import { attachRealtime } from "./realtime/socket.js";
import type { MessagingService } from "./modules/messaging/service.js";
import { createMongoUploadRepository } from "./modules/resources/uploads.js";
import { createObjectStorage } from "./platform/storage.js";
import MongoStore from "connect-mongo";

function loadEnvFile(): void {
  const candidates = [".env", "../.env", "../../.env"].map((path) => resolve(process.cwd(), path));
  const found = candidates.find((path) => existsSync(path));
  if (found) {
    loadDotenv({ path: found });
  }
}

const SHUTDOWN_MS = 20_000;

async function main(): Promise<void> {
  loadEnvFile();
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  initSentry(env.SENTRY_DSN);

  mongoose.set("strictQuery", true);
  await mongoose.connect(env.MONGODB_URI);

  const bus = new EventBus(logger);
  const auditLog = createMongoAuditLogRepository();
  registerAuditSubscriber(bus, auditLog);
  const messagingRepository = createMongoMessagingRepository();
  const settings = createMongoSettingsRepository();
  const notifications = createMongoNotificationRepository();
  const preferences = createMongoPreferenceRepository();
  const delivery = createDeliveryBridge();
  const mailer = createMailer({
    logger,
    from: env.EMAIL_FROM,
    apiKey: env.EMAIL_API_KEY,
    smtp:
      env.EMAIL_SMTP_HOST && env.EMAIL_SMTP_USER && env.EMAIL_SMTP_PASS
        ? {
            host: env.EMAIL_SMTP_HOST,
            port: env.EMAIL_SMTP_PORT,
            user: env.EMAIL_SMTP_USER,
            pass: env.EMAIL_SMTP_PASS,
          }
        : undefined,
  });
  const users = createMongoUserRepository();
  registerNotificationSubscriber(bus, {
    users,
    notifications,
    preferences,
    mailer,
    delivery,
    logger,
  });
  const authService = new AuthService({
    users,
    tokens: createMongoTokenRepository(),
    mailer,
    bus,
    logger,
    appBaseUrl: env.APP_BASE_URL,
    exposeInviteLinks: env.NODE_ENV !== "production" && !env.EMAIL_API_KEY && !env.EMAIL_SMTP_PASS,
  });
  await ensureBootstrapAdmin(authService, users, env.BOOTSTRAP_ADMIN_EMAIL, env.BOOTSTRAP_ADMIN_NAME);

  const mentorAssignments = createMongoAssignmentRepository();
  const learningPaths = createMongoLearningPathRepository();
  const work = createMongoWorkRepository();
  const assessments = createMongoAssessmentRepository();
  const revisions = createMongoSubmissionRepository();
  const resources = createMongoResourceRepository();
  const discussions = createMongoDiscussionRepository();
  const cohorts = createMongoCohortRepository();
  const analytics: AnalyticsDeps = {
    users,
    cohorts,
    mentorAssignments,
    work,
    resources,
    assessments,
    revisions,
    discussions,
    settings,
    progress: createMongoProgressRepository(),
    events: createMongoLearningEventRepository(),
    exports: createMongoExportRepository(),
    mailer,
    appBaseUrl: env.APP_BASE_URL,
  };
  const agenda = createAgenda(env.MONGODB_URI);
  registerReconcileJob(agenda, { work, users, mentorAssignments, bus });
  registerExpireJob(agenda, { users, cohorts, mentorAssignments, assessments, bus, runner: new ManualReviewRunner(), execution: codeExecutionOff });
  registerDeadlineJob(agenda, { users, notifications, preferences, mailer, delivery, logger, work, assignments: mentorAssignments });
  registerRebuildJob(agenda, analytics);
  registerExportJob(agenda, analytics);
  const announcements = createMongoAnnouncementRepository();
  registerAnnouncementJob(agenda, { announcements, users, assignments: mentorAssignments, bus });
  agenda.on("error", (error: unknown) => {
    logger.error({ err: error }, "job scheduler error");
  });
  await agenda.start();
  await ensureReconcileSchedule(agenda);
  await ensureExpireSchedule(agenda);
  await ensureDeadlineSchedule(agenda);
  await ensureRebuildSchedule(agenda);
  await ensureAnnouncementSchedule(agenda);

  const app = createApp({
    clientOrigin: env.CLIENT_ORIGIN,
    isDbReady: () => mongoose.connection.readyState === 1,
    logger,
    eventBus: bus,
    mailer,
    rateLimit: { limit: 300, windowMs: 60_000 },
    auth: {
      service: authService,
      users,
      sessionSecret: env.SESSION_SECRET,
      secureCookies: env.NODE_ENV === "production",
      sessionStore: MongoStore.create({ mongoUrl: env.MONGODB_URI }),
      directory: {
        cohorts,
        assignments: mentorAssignments,
      },
    },
    learning: {
      paths: learningPaths,
      work,
      revisions,
      runner: new ManualReviewRunner(),
      execution: codeExecutionOff,
      assessments,
    },
    resources: {
      repository: resources,
      uploads: createMongoUploadRepository(),
      storage: createObjectStorage(env),
    },
    discussions: {
      repository: discussions,
    },
    analytics: {
      deps: analytics,
      enqueue: async (id) => {
        await agenda.now("export.generate", { exportId: id });
      },
    },
    messaging: {
      repository: messagingRepository,
      settings,
      notifications,
      preferences,
      delivery,
    },
    moderation: { announcements },
    audit: { log: auditLog },
  });

  const server = createServer(app);
  const realtime = attachRealtime(server, {
    clientOrigin: env.CLIENT_ORIGIN,
    session: app.locals.session as RequestHandler,
    users,
    messaging: app.locals.messaging as MessagingService,
    bridge: delivery,
  });
  server.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, "API listening");
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, "shutting down");

    await Promise.race([
      realtime.close(),
      new Promise((resolveClose) => setTimeout(resolveClose, SHUTDOWN_MS)),
    ]);
    await agenda.stop();
    await mongoose.disconnect();
    process.exit(0);
  };

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
