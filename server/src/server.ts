import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import mongoose from "mongoose";
import { loadEnv } from "./config/env.js";
import { createApp } from "./app.js";
import { createAgenda } from "./jobs/agenda.js";
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
import { createMongoResourceRepository } from "./modules/resources/repository.js";
import { ensureReconcileSchedule, registerReconcileJob } from "./jobs/reconcile-recipients.js";
import { ensureExpireSchedule, registerExpireJob } from "./jobs/expire-attempts.js";
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
  registerAuditSubscriber(bus);
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
  const cohorts = createMongoCohortRepository();
  const agenda = createAgenda(env.MONGODB_URI);
  registerReconcileJob(agenda, { work, users, mentorAssignments, bus });
  registerExpireJob(agenda, { users, cohorts, mentorAssignments, assessments, bus, runner: new ManualReviewRunner(), execution: codeExecutionOff });
  agenda.on("error", (error: unknown) => {
    logger.error({ err: error }, "job scheduler error");
  });
  await agenda.start();
  await ensureReconcileSchedule(agenda);
  await ensureExpireSchedule(agenda);

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
      revisions: createMongoSubmissionRepository(),
      runner: new ManualReviewRunner(),
      execution: codeExecutionOff,
      assessments,
    },
    resources: {
      repository: createMongoResourceRepository(),
      uploads: createMongoUploadRepository(),
      storage: createObjectStorage(env),
    },
  });

  const server = app.listen(env.PORT, () => {
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
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      }),
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
