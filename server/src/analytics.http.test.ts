import { hashPassword } from "./modules/auth/passwords.js";
import { AuthService } from "./modules/auth/service.js";
import { createMemoryTokenRepository } from "./modules/auth/tokens.js";
import { rebuildProgress, type AnalyticsDeps } from "./modules/analytics/rebuild.js";
import {
  createMemoryExportRepository,
  createMemoryLearningEventRepository,
  createMemoryProgressRepository,
} from "./modules/analytics/repository.js";
import { registerAuditSubscriber, type AuditRecord } from "./modules/audit/subscriber.js";
import { createMemoryAssessmentRepository } from "./modules/assessments/repository.js";
import { createMemoryCohortRepository } from "./modules/cohorts/repository.js";
import { createMemoryDiscussionRepository } from "./modules/discussions/repository.js";
import { createMemoryLearningPathRepository } from "./modules/learning/paths.js";
import { createMemoryWorkRepository } from "./modules/learning/work.js";
import { createMemoryAssignmentRepository } from "./modules/mentors/assignments.js";
import { createMemoryResourceRepository } from "./modules/resources/repository.js";
import { createMemoryUploadRepository } from "./modules/resources/uploads.js";
import { createMemorySettingsRepository } from "./modules/settings/repository.js";
import { createMemorySubmissionRepository } from "./modules/submissions/repository.js";
import { createMemoryUserRepository, type UserRepository } from "./modules/users/repository.js";
import request from "supertest";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { EventBus } from "./events/bus.js";
import { createMemoryObjectStorage } from "./platform/storage.js";

const logger = pino({ level: "silent" });
const now = new Date("2026-11-26T12:00:00.000Z");

async function person(
  users: UserRepository,
  input: { name: string; email: string; role: "ADMIN" | "MENTOR" | "STUDENT"; cohortId?: string | null },
) {
  return users.create({
    name: input.name,
    email: input.email,
    passwordHash: await hashPassword("Correct1", 4),
    role: input.role,
    branch: input.role === "STUDENT" ? "CSE" : null,
    cohortId: input.cohortId ?? null,
    status: "ACTIVE",
    capabilities: { canCreateResources: false, canCreateAssessments: false, canGradeAssessments: false },
    invitedAt: null,
    activatedAt: new Date(),
  });
}

async function signIn(app: ReturnType<typeof createApp>, email: string) {
  const agent = request.agent(app);
  const token = (await agent.get("/api/v1/auth/csrf")).body.data.csrfToken as string;
  const response = await agent.post("/api/v1/auth/login").set("x-csrf-token", token).send({ email, password: "Correct1" });
  expect(response.status).toBe(200);
  return { agent, token, id: response.body.data.id as string };
}

async function build() {
  const users = createMemoryUserRepository();
  const cohorts = createMemoryCohortRepository();
  const mentorAssignments = createMemoryAssignmentRepository();
  const work = createMemoryWorkRepository();
  const resources = createMemoryResourceRepository();
  const revisions = createMemorySubmissionRepository();
  const assessments = createMemoryAssessmentRepository();
  const discussions = createMemoryDiscussionRepository();
  const settings = createMemorySettingsRepository();
  const progress = createMemoryProgressRepository();
  const events = createMemoryLearningEventRepository();
  const exportsRepo = createMemoryExportRepository();
  const bus = new EventBus(logger);
  const audits: AuditRecord[] = [];
  registerAuditSubscriber(bus, {
    async write(record) {
      audits.push(record);
    },
  });
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
    progress,
    events,
    exports: exportsRepo,
    now: () => now,
  };
  const service = new AuthService({
    users,
    tokens: createMemoryTokenRepository(),
    mailer: { async send() {} },
    bus,
    logger,
    appBaseUrl: "http://localhost:5173",
    passwordRounds: 4,
  });
  const app = createApp({
    clientOrigin: "http://localhost:5173",
    isDbReady: () => true,
    logger,
    eventBus: bus,
    auth: {
      service,
      users,
      sessionSecret: "test-session-secret",
      secureCookies: false,
      directory: { cohorts, assignments: mentorAssignments },
    },
    resources: {
      repository: resources,
      uploads: createMemoryUploadRepository(),
      storage: createMemoryObjectStorage(),
    },
    learning: {
      paths: createMemoryLearningPathRepository(),
      work,
      revisions,
      assessments,
      now: () => now,
    },
    discussions: { repository: discussions },
    messaging: { settings },
    analytics: { deps: analytics },
  });
  const cohort = await cohorts.create({
    name: "2026 First Year",
    academicYear: "2026-27",
    startDate: new Date("2026-08-01T00:00:00.000Z"),
    endDate: new Date("2027-05-31T00:00:00.000Z"),
  });
  const admin = await person(users, { name: "Ada Admin", email: "admin@example.com", role: "ADMIN" });
  const second = await person(users, { name: "Second", email: "second@example.com", role: "ADMIN" });
  const mentor = await person(users, { name: "Grace", email: "grace@example.com", role: "MENTOR" });
  const other = await person(users, { name: "Alan", email: "alan@example.com", role: "MENTOR" });
  const student = await person(users, { name: "Ada", email: "ada@example.com", role: "STUDENT", cohortId: cohort.id });
  await mentorAssignments.create({
    mentorId: mentor.id,
    studentId: student.id,
    assignedBy: admin.id,
    status: "ACTIVE",
    startDate: now,
    endDate: null,
    endReason: null,
  });
  const finished = await work.create({
    title: "Finished work",
    description: "Done",
    resourceId: null,
    targetType: "INDIVIDUAL",
    targetIds: [student.id],
    branches: [],
    dueDate: new Date("2026-11-01T00:00:00.000Z"),
    priority: "NORMAL",
    submissionType: "TEXT",
    language: null,
    testCases: [],
    rubric: [],
    assignedBy: admin.id,
  });
  const late = await work.create({
    title: "Late work",
    description: "Still open",
    resourceId: null,
    targetType: "INDIVIDUAL",
    targetIds: [student.id],
    branches: [],
    dueDate: new Date("2026-11-20T00:00:00.000Z"),
    priority: "HIGH",
    submissionType: "TEXT",
    language: null,
    testCases: [],
    rubric: [],
    assignedBy: admin.id,
  });
  await work.publish(finished.id, 0, new Date("2026-11-01T00:00:00.000Z"), [student.id]);
  await work.publish(late.id, 0, new Date("2026-11-01T00:00:00.000Z"), [student.id]);
  const recipients = await work.listRecipientsForStudent(student.id);
  const done = recipients.find((row) => row.assignmentId === finished.id);
  if (!done) {
    throw new Error("missing recipient");
  }
  await work.transitionRecipient(done.id, ["NOT_STARTED"], { state: "COMPLETED", completedAt: now, score: 9 });
  return { app, audits, bus, analytics, progress, student, mentor, other, second };
}

describe("progress and analytics", () => {
  it("requires a session for the progress and export endpoints", async () => {
    const { app } = await build();
    const anonymous = request.agent(app);
    const token = (await anonymous.get("/api/v1/auth/csrf")).body.data.csrfToken as string;
    expect((await anonymous.get("/api/v1/me/progress")).status).toBe(401);
    expect((await anonymous.get("/api/v1/students/student/progress")).status).toBe(401);
    expect((await anonymous.get("/api/v1/analytics/mentor")).status).toBe(401);
    expect((await anonymous.get("/api/v1/analytics/overview")).status).toBe(401);
    expect((await anonymous.post("/api/v1/exports").set("x-csrf-token", token).send({ kind: "STUDENT_PROGRESS" })).status).toBe(401);
  });

  it("shows a student their counts without a support label, and keeps the label off their access", async () => {
    const { app, bus, student } = await build();
    await bus.emit({
      action: "resource.opened",
      actorId: student.id,
      subjectType: "Resource",
      subjectId: "resource-1",
      after: { studentId: student.id, resourceId: "resource-1" },
    });
    const ada = await signIn(app, "ada@example.com");
    const own = await ada.agent.get("/api/v1/me/progress");
    expect(own.status).toBe(200);
    expect(own.body.data.assignedCount).toBe(2);
    expect(own.body.data.completedCount).toBe(1);
    expect(own.body.data.pendingCount).toBe(0);
    expect(own.body.data.overdueCount).toBe(1);
    expect(own.body.data.completionPct).toBe(50);
    expect(own.body.data.averageScore).toBeNull();
    expect(own.body.data.weeklyActiveDays).toBe(1);
    expect(own.body.data.activity[0].type).toBe("RESOURCE_OPENED");
    expect(own.body.data.supportIndicator).toBeUndefined();
    expect((await ada.agent.get("/api/v1/me/plan")).status).not.toBe(403);
  });

  it("lets the assigned mentor and an admin read the indicator, and audits a mentor who is not assigned", async () => {
    const { app, audits, student } = await build();
    const grace = await signIn(app, "grace@example.com");
    const alan = await signIn(app, "alan@example.com");
    const ada = await signIn(app, "ada@example.com");
    const admin = await signIn(app, "admin@example.com");

    const denied = await alan.agent.get(`/api/v1/students/${student.id}/progress`);
    expect(denied.status).toBe(403);
    expect(
      audits.some(
        (entry) =>
          entry.action === "security.access_denied" &&
          entry.actorId === alan.id &&
          entry.subjectType === "Student" &&
          entry.subjectId === student.id,
      ),
    ).toBe(true);

    const self = await ada.agent.get(`/api/v1/students/${student.id}/progress`);
    expect(self.status).toBe(403);

    const allowed = await grace.agent.get(`/api/v1/students/${student.id}/progress`);
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.supportIndicator).toBe("NEEDS_ATTENTION");
    expect(allowed.body.data.supportNote).toContain("does not block");
    expect(allowed.body.data.supportReasons.length).toBeGreaterThan(0);
    expect(allowed.body.data.thresholds.attentionCompletionPct).toBe(70);

    const adminView = await admin.agent.get(`/api/v1/students/${student.id}/progress`);
    expect(adminView.status).toBe(200);

    const mentorBoard = await grace.agent.get("/api/v1/analytics/mentor");
    expect(mentorBoard.status).toBe(200);
    expect(mentorBoard.body.data.assignedStudents).toBe(1);
    expect(mentorBoard.body.data.students[0].supportIndicator).toBe("NEEDS_ATTENTION");
    expect(mentorBoard.body.data.completionPct).toBe(50);
    expect((await grace.agent.get("/api/v1/analytics/overview")).status).toBe(403);
    expect((await ada.agent.get("/api/v1/analytics/mentor")).status).toBe(403);

    const overview = await admin.agent.get("/api/v1/analytics/overview");
    expect(overview.status).toBe(200);
    expect(overview.body.data.totals.students).toBe(1);
    expect(overview.body.data.flagged).toEqual([
      expect.objectContaining({ studentId: student.id, supportIndicator: "NEEDS_ATTENTION" }),
    ]);
    expect(overview.body.data.cohorts[0].completionPct).toBe(50);
  });

  it("rebuilds a stale projection from assignments and keeps exports to the requesting admin", async () => {
    const { app, analytics, progress, student, audits } = await build();
    await progress.save({
      studentId: student.id,
      assignedCount: 99,
      completedCount: 99,
      pendingCount: 0,
      overdueCount: 0,
      completionPct: 100,
      averageScore: 100,
      topicScores: [],
      weeklyActiveDays: 0,
      week: [],
      recentFeedback: [],
      supportIndicator: "ON_TRACK",
      supportReasons: [],
      computedAt: now,
    });
    await rebuildProgress(analytics, [student.id]);
    const rebuilt = await progress.find(student.id);
    expect(rebuilt?.assignedCount).toBe(2);
    expect(rebuilt?.completedCount).toBe(1);
    expect(rebuilt?.supportIndicator).toBe("NEEDS_ATTENTION");

    const ada = await signIn(app, "ada@example.com");
    const grace = await signIn(app, "grace@example.com");
    const admin = await signIn(app, "admin@example.com");
    const second = await signIn(app, "second@example.com");
    expect((await ada.agent.post("/api/v1/exports").set("x-csrf-token", ada.token).send({ kind: "STUDENT_PROGRESS" })).status).toBe(403);
    expect((await grace.agent.post("/api/v1/exports").set("x-csrf-token", grace.token).send({ kind: "STUDENT_PROGRESS" })).status).toBe(403);

    const created = await admin.agent
      .post("/api/v1/exports")
      .set("x-csrf-token", admin.token)
      .send({ kind: "STUDENT_PROGRESS" });
    expect(created.status).toBe(202);
    expect(created.body.data.status).toBe("READY");
    expect(created.body.data.downloadUrl).toContain("/download?token=");

    const stolen = await second.agent.get(`/api/v1/exports/${created.body.data.id}`);
    expect(stolen.status).toBe(403);
    expect(audits.some((entry) => entry.action === "security.access_denied" && entry.subjectType === "ReportExport")).toBe(true);

    const file = await request(app).get(created.body.data.downloadUrl as string);
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toContain("text/csv");
    expect(file.text).toContain("Ada");
    expect(file.text).toContain("NEEDS_ATTENTION");
    expect((await request(app).get(`/api/v1/exports/${created.body.data.id}/download?token=nope`)).status).toBe(403);
  });
});
