import { hashPassword } from "./modules/auth/passwords.js";
import { AuthService } from "./modules/auth/service.js";
import { createMemoryTokenRepository } from "./modules/auth/tokens.js";
import { createMemoryAuditLogRepository } from "./modules/audit/repository.js";
import { registerAuditSubscriber } from "./modules/audit/subscriber.js";
import { createMemoryCohortRepository } from "./modules/cohorts/repository.js";
import { createMemoryAssignmentRepository } from "./modules/mentors/assignments.js";
import { createMemoryAnnouncementRepository } from "./modules/moderation/repository.js";
import { runAnnouncementSchedule } from "./modules/moderation/service.js";
import { createMemoryNotificationRepository } from "./modules/notifications/repository.js";
import { createMemoryPreferenceRepository } from "./modules/notifications/preferences.js";
import { registerNotificationSubscriber } from "./modules/notifications/subscriber.js";
import { createMemoryResourceRepository } from "./modules/resources/repository.js";
import { createMemoryUploadRepository } from "./modules/resources/uploads.js";
import { createMemoryUserRepository, type UserRepository } from "./modules/users/repository.js";
import request from "supertest";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { EventBus } from "./events/bus.js";
import { createMemoryObjectStorage } from "./platform/storage.js";
import { noopDelivery } from "./realtime/delivery.js";

const logger = pino({ level: "silent" });

async function person(
  users: UserRepository,
  input: { name: string; email: string; role: "ADMIN" | "MENTOR" | "STUDENT"; cohortId?: string | null; branch?: "CSE" | "ECE" | null },
) {
  return users.create({
    name: input.name,
    email: input.email,
    passwordHash: await hashPassword("Correct1", 4),
    role: input.role,
    branch: input.branch === undefined ? (input.role === "STUDENT" ? "CSE" : null) : input.branch,
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

async function build(now = () => new Date("2026-11-27T08:00:00.000Z")) {
  const users = createMemoryUserRepository();
  const cohorts = createMemoryCohortRepository();
  const assignments = createMemoryAssignmentRepository();
  const announcements = createMemoryAnnouncementRepository();
  const auditLog = createMemoryAuditLogRepository();
  const notifications = createMemoryNotificationRepository();
  const bus = new EventBus(logger);
  registerAuditSubscriber(bus, auditLog);
  registerNotificationSubscriber(bus, {
    users,
    notifications,
    preferences: createMemoryPreferenceRepository(),
    delivery: noopDelivery,
    logger,
    now,
  });
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
      directory: { cohorts, assignments },
    },
    resources: {
      repository: createMemoryResourceRepository(),
      uploads: createMemoryUploadRepository(),
      storage: createMemoryObjectStorage(),
    },
    moderation: { announcements, now },
    audit: { log: auditLog },
    messaging: { notifications, preferences: createMemoryPreferenceRepository(), delivery: noopDelivery, now },
  });
  const cohort = await cohorts.create({
    name: "2026 First Year",
    academicYear: "2026-27",
    startDate: new Date("2026-08-01T00:00:00.000Z"),
    endDate: new Date("2027-05-31T00:00:00.000Z"),
  });
  const otherCohort = await cohorts.create({
    name: "2025 First Year",
    academicYear: "2025-26",
    startDate: new Date("2025-08-01T00:00:00.000Z"),
    endDate: new Date("2026-05-31T00:00:00.000Z"),
  });
  const admin = await person(users, { name: "Admin", email: "admin@example.com", role: "ADMIN" });
  const mentor = await person(users, { name: "Grace", email: "grace@example.com", role: "MENTOR" });
  const student = await person(users, { name: "Ada", email: "ada@example.com", role: "STUDENT", cohortId: cohort.id });
  const outsider = await person(users, { name: "Bea", email: "bea@example.com", role: "STUDENT", cohortId: otherCohort.id, branch: "ECE" });
  await assignments.create({
    mentorId: mentor.id,
    studentId: student.id,
    assignedBy: admin.id,
    status: "ACTIVE",
    startDate: new Date("2026-08-01T00:00:00.000Z"),
    endDate: null,
    endReason: null,
  });
  return { app, users, announcements, assignments, bus, notifications, cohort, admin, mentor, student, outsider };
}

describe("announcements, moderation, and the audit viewer", () => {
  it("keeps management with admin and lets every signed-in person read what was published for them", async () => {
    const { app, student } = await build();
    const admin = await signIn(app, "admin@example.com");
    const ada = await signIn(app, "ada@example.com");
    const grace = await signIn(app, "grace@example.com");

    expect((await request(app).get("/api/v1/announcements")).status).toBe(401);
    expect((await request(app).get("/api/v1/reports")).status).toBe(401);
    expect((await request(app).get("/api/v1/audit")).status).toBe(401);

    const created = await admin.agent
      .post("/api/v1/announcements")
      .set("x-csrf-token", admin.token)
      .send({ title: "Lab move", body: "The lab is in room 2.", audience: "ALL", targetIds: [] });
    expect(created.status).toBe(201);

    for (const caller of [ada, grace]) {
      const denied = await caller.agent
        .post("/api/v1/announcements")
        .set("x-csrf-token", caller.token)
        .send({ title: "Nope", body: "Students cannot publish this.", audience: "ALL", targetIds: [] });
      expect(denied.status).toBe(403);
      expect((await caller.agent.get("/api/v1/reports")).status).toBe(403);
      expect((await caller.agent.get("/api/v1/audit")).status).toBe(403);
      expect((await caller.agent.get(`/api/v1/audit/User/${student.id}`)).status).toBe(403);
    }

    expect((await ada.agent.get("/api/v1/announcements")).status).toBe(200);
    expect((await admin.agent.get("/api/v1/reports")).status).toBe(200);
    expect((await admin.agent.get("/api/v1/audit")).status).toBe(200);
    expect((await admin.agent.post("/api/v1/audit").set("x-csrf-token", admin.token).send({ action: "user.created" })).status).toBe(404);
    expect((await admin.agent.delete(`/api/v1/audit/User/${student.id}`).set("x-csrf-token", admin.token)).status).toBe(404);

    const denied = await admin.agent.get("/api/v1/audit").query({ action: "security.access_denied" });
    expect(denied.body.data.some((row: { actorId: string }) => row.actorId === ada.id)).toBe(true);
  });

  it("publishes on a schedule, expires afterwards, and notifies only the audience", async () => {
    let clock = new Date("2026-11-27T08:00:00.000Z");
    const { app, announcements, users, assignments, bus, notifications, cohort, mentor, student, outsider } = await build(() => clock);
    const admin = await signIn(app, "admin@example.com");
    const ada = await signIn(app, "ada@example.com");
    const bea = await signIn(app, "bea@example.com");

    const scheduled = await admin.agent.post("/api/v1/announcements").set("x-csrf-token", admin.token).send({
      title: "Friday lab",
      body: "Bring a notebook.",
      audience: "COHORT",
      targetIds: [cohort.id],
      publishAt: "2026-11-27T09:00:00.000Z",
      expiresAt: "2026-11-27T10:00:00.000Z",
    });
    expect(scheduled.status).toBe(201);
    expect(scheduled.body.data.status).toBe("SCHEDULED");
    expect((await ada.agent.get("/api/v1/announcements")).body.data).toEqual([]);
    expect((await admin.agent.get("/api/v1/announcements")).body.data).toEqual([
      expect.objectContaining({ id: scheduled.body.data.id, status: "SCHEDULED" }),
    ]);

    clock = new Date("2026-11-27T09:00:00.000Z");
    await runAnnouncementSchedule({ announcements, users, assignments, bus, now: () => clock }, clock);
    const visible = await ada.agent.get("/api/v1/announcements");
    expect(visible.body.data.map((row: { title: string }) => row.title)).toEqual(["Friday lab"]);
    expect((await bea.agent.get("/api/v1/announcements")).body.data).toEqual([]);
    const adaNotes = await notifications.listForUser(student.id, 10);
    expect(adaNotes.rows).toEqual([expect.objectContaining({ type: "ANNOUNCEMENT", text: "Friday lab" })]);
    expect((await notifications.listForUser(outsider.id, 10)).rows).toEqual([]);

    const group = await admin.agent.post("/api/v1/announcements").set("x-csrf-token", admin.token).send({
      title: "Mentor note",
      body: "Check in this week.",
      audience: "MENTOR_GROUP",
      targetIds: [mentor.id],
    });
    expect(group.status).toBe(201);
    expect((await ada.agent.get("/api/v1/announcements")).body.data.map((row: { title: string }) => row.title)).toContain("Mentor note");
    expect((await bea.agent.get("/api/v1/announcements")).body.data.map((row: { title: string }) => row.title)).not.toContain("Mentor note");

    clock = new Date("2026-11-27T10:00:00.000Z");
    await runAnnouncementSchedule({ announcements, users, assignments, bus, now: () => clock }, clock);
    expect((await ada.agent.get("/api/v1/announcements")).body.data.map((row: { title: string }) => row.title)).toEqual(["Mentor note"]);

    const expired = await admin.agent
      .patch(`/api/v1/announcements/${group.body.data.id}`)
      .set("x-csrf-token", admin.token)
      .send({ expireNow: true });
    expect(expired.status).toBe(200);
    expect(expired.body.data.status).toBe("EXPIRED");
    expect((await ada.agent.get("/api/v1/announcements")).body.data).toEqual([]);
  });

  it("dismisses, hides, warns, and suspends through the same deactivation path, and audits each decision", async () => {
    const { app, users, student } = await build();
    const admin = await signIn(app, "admin@example.com");
    const ada = await signIn(app, "ada@example.com");
    const grace = await signIn(app, "grace@example.com");

    const post = await ada.agent.post("/api/v1/forum/posts").set("x-csrf-token", ada.token).send({
      title: "Spam post",
      body: "Buy this now.",
      category: "GENERAL",
    });
    expect(post.status).toBe(201);
    const comment = await ada.agent.post(`/api/v1/posts/${post.body.data.id}/comments`).set("x-csrf-token", ada.token).send({
      body: "And again.",
    });
    expect(comment.status).toBe(201);

    async function report(targetType: string, targetId: string, reason: string) {
      const filed = await grace.agent.post("/api/v1/reports").set("x-csrf-token", grace.token).send({ targetType, targetId, reason });
      expect(filed.status).toBe(201);
      return filed.body.data.id as string;
    }

    const dismissedId = await report("POST", post.body.data.id, "Off topic");
    const dismissed = await admin.agent
      .post(`/api/v1/reports/${dismissedId}/resolve`)
      .set("x-csrf-token", admin.token)
      .send({ action: "DISMISS", note: "The post is allowed." });
    expect(dismissed.status).toBe(200);
    expect(dismissed.body.data.status).toBe("DISMISSED");
    expect((await ada.agent.get("/api/v1/forum/posts")).body.data.map((row: { id: string }) => row.id)).toContain(post.body.data.id);
    const again = await admin.agent
      .post(`/api/v1/reports/${dismissedId}/resolve`)
      .set("x-csrf-token", admin.token)
      .send({ action: "DISMISS", note: "Already closed." });
    expect(again.status).toBe(409);

    const hiddenId = await report("COMMENT", comment.body.data.id, "Repeated");
    const hidden = await admin.agent
      .post(`/api/v1/reports/${hiddenId}/resolve`)
      .set("x-csrf-token", admin.token)
      .send({ action: "HIDE", note: "Removed the reply." });
    expect(hidden.status).toBe(200);
    const thread = await ada.agent.get(`/api/v1/posts/${post.body.data.id}`);
    expect(thread.body.data.comments).toEqual([]);

    const warnedId = await report("USER", student.id, "Please review the guidelines.");
    const warned = await admin.agent
      .post(`/api/v1/reports/${warnedId}/resolve`)
      .set("x-csrf-token", admin.token)
      .send({ action: "WARN", note: "Keep posts on the coursework." });
    expect(warned.status).toBe(200);
    expect((await users.findById(student.id))?.status).toBe("ACTIVE");
    const hideUser = await report("USER", student.id, "Hide the account.");
    expect(
      (
        await admin.agent
          .post(`/api/v1/reports/${hideUser}/resolve`)
          .set("x-csrf-token", admin.token)
          .send({ action: "HIDE", note: "This is an account." })
      ).status,
    ).toBe(422);

    const suspendedId = hideUser;
    const suspended = await admin.agent
      .post(`/api/v1/reports/${suspendedId}/resolve`)
      .set("x-csrf-token", admin.token)
      .send({ action: "SUSPEND", note: "Suspended after the warning." });
    expect(suspended.status).toBe(200);
    expect((await users.findById(student.id))?.status).toBe("DEACTIVATED");
    expect([401, 403]).toContain((await ada.agent.get("/api/v1/announcements")).status);

    const history = await admin.agent.get(`/api/v1/audit/Report/${suspendedId}`);
    expect(history.status).toBe(200);
    expect(history.body.data).toEqual([
      expect.objectContaining({
        action: "moderation.action_taken",
        reason: "Suspended after the warning.",
        subjectType: "Report",
        subjectId: suspendedId,
      }),
    ]);
    const deactivation = await admin.agent.get("/api/v1/audit").query({ action: "user.deactivated", subjectId: student.id });
    expect(deactivation.body.data).toEqual([
      expect.objectContaining({ action: "user.deactivated", subjectId: student.id, actorId: admin.id }),
    ]);
    const byActor = await admin.agent.get("/api/v1/audit").query({ actorId: admin.id, action: "moderation.action_taken" });
    expect(byActor.body.total).toBeGreaterThanOrEqual(4);
  });
});
