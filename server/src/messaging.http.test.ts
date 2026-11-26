import { hashPassword } from "./modules/auth/passwords.js";
import { AuthService } from "./modules/auth/service.js";
import { createMemoryTokenRepository } from "./modules/auth/tokens.js";
import { registerAuditSubscriber, type AuditRecord } from "./modules/audit/subscriber.js";
import { createMemoryCohortRepository } from "./modules/cohorts/repository.js";
import { createMemoryLearningPathRepository } from "./modules/learning/paths.js";
import { createMemoryWorkRepository } from "./modules/learning/work.js";
import { createMemoryAssignmentRepository } from "./modules/mentors/assignments.js";
import { createMemoryMessagingRepository, type MessagingRepository } from "./modules/messaging/repository.js";
import { createMemoryNotificationRepository } from "./modules/notifications/repository.js";
import { createMemoryPreferenceRepository } from "./modules/notifications/preferences.js";
import { registerNotificationSubscriber } from "./modules/notifications/subscriber.js";
import { createMemoryResourceRepository } from "./modules/resources/repository.js";
import { createMemoryUploadRepository } from "./modules/resources/uploads.js";
import { createMemorySettingsRepository } from "./modules/settings/repository.js";
import { createMemoryUserRepository, type UserRepository } from "./modules/users/repository.js";
import request from "supertest";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { EventBus } from "./events/bus.js";
import type { OutboundMail } from "./platform/mail.js";
import { createMemoryObjectStorage } from "./platform/storage.js";
import type { Delivery } from "./realtime/delivery.js";

const logger = pino({ level: "silent" });

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
  const assignments = createMemoryAssignmentRepository();
  const bus = new EventBus(logger);
  const audits: AuditRecord[] = [];
  const order: string[] = [];
  const open = new Set<string>();
  const emails: OutboundMail[] = [];
  const inner = createMemoryMessagingRepository();
  const messaging: MessagingRepository = {
    ...inner,
    async insertMessage(input) {
      order.push("write");
      const saved = await inner.insertMessage(input);
      const visible = await inner.findMessage(saved.id);
      if (!visible) {
        throw new Error("message was pushed before it was stored");
      }
      return saved;
    },
  };
  const delivery: Delivery = {
    listeners: () => [...open],
    messageNew() {
      order.push("push");
    },
    messageRead() {},
    typing() {},
    notificationNew() {},
  };
  registerAuditSubscriber(bus, { async write(record) { audits.push(record); } });
  const notifications = createMemoryNotificationRepository();
  const preferences = createMemoryPreferenceRepository();
  const settings = createMemorySettingsRepository();
  registerNotificationSubscriber(bus, {
    users,
    notifications,
    preferences,
    mailer: { async send(message) { emails.push(message); } },
    delivery,
    logger,
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
    learning: {
      paths: createMemoryLearningPathRepository(),
      work: createMemoryWorkRepository(),
    },
    messaging: { repository: messaging, settings, notifications, preferences, delivery },
  });
  const cohort = await cohorts.create({
    name: "2026 First Year",
    academicYear: "2026-27",
    startDate: new Date("2026-08-01T00:00:00.000Z"),
    endDate: new Date("2027-05-31T00:00:00.000Z"),
  });
  const admin = await person(users, { name: "Ada Admin", email: "admin@example.com", role: "ADMIN" });
  const secondAdmin = await person(users, { name: "Second", email: "second@example.com", role: "ADMIN" });
  const mentor = await person(users, { name: "Grace", email: "grace@example.com", role: "MENTOR" });
  const otherMentor = await person(users, { name: "Alan", email: "alan@example.com", role: "MENTOR" });
  const student = await person(users, { name: "Ada", email: "ada@example.com", role: "STUDENT", cohortId: cohort.id });
  const peer = await person(users, { name: "Bea", email: "bea@example.com", role: "STUDENT", cohortId: cohort.id });
  const classmate = await person(users, { name: "Cam", email: "cam@example.com", role: "STUDENT", cohortId: cohort.id });
  await assignments.create({
    mentorId: mentor.id,
    studentId: student.id,
    assignedBy: admin.id,
    status: "ACTIVE",
    startDate: new Date(),
    endDate: null,
    endReason: null,
  });
  return { app, audits, order, open, emails, notifications, settings, mentor, otherMentor, student, peer, classmate, secondAdmin };
}

describe("messaging and notifications", () => {
  it("requires a session for every new endpoint", async () => {
    const { app } = await build();
    const anonymous = request.agent(app);
    const token = (await anonymous.get("/api/v1/auth/csrf")).body.data.csrfToken as string;
    expect((await anonymous.get("/api/v1/conversations")).status).toBe(401);
    expect((await anonymous.post("/api/v1/conversations").set("x-csrf-token", token).send({ type: "DIRECT", withMentor: true })).status).toBe(401);
    expect((await anonymous.get("/api/v1/notifications")).status).toBe(401);
    expect((await anonymous.get("/api/v1/settings")).status).toBe(401);
    expect((await anonymous.get("/api/v1/settings/features")).status).toBe(401);
  });

  it("lets a student message only their assigned mentor until peer chat is turned on", async () => {
    const { app, audits, order, emails, notifications, mentor, peer } = await build();
    const features = await (await signIn(app, "ada@example.com")).agent.get("/api/v1/settings/features");
    expect(features.body.data).toEqual({ studentDirectMessages: false, groupChat: false });

    const ada = await signIn(app, "ada@example.com");
    const blocked = await ada.agent
      .post("/api/v1/conversations")
      .set("x-csrf-token", ada.token)
      .send({ type: "DIRECT", participantId: peer.id });
    expect(blocked.status).toBe(403);
    expect(audits.some((entry) => entry.action === "security.access_denied" && entry.actorId === ada.id)).toBe(true);

    const opened = await ada.agent
      .post("/api/v1/conversations")
      .set("x-csrf-token", ada.token)
      .send({ type: "DIRECT", withMentor: true });
    expect(opened.status).toBe(201);
    expect(opened.body.data.purpose).toBe("MENTORSHIP");
    expect(opened.body.data.participants.map((person: { id: string }) => person.id).sort()).toEqual([ada.id, mentor.id].sort());

    const again = await ada.agent
      .post("/api/v1/conversations")
      .set("x-csrf-token", ada.token)
      .send({ type: "DIRECT", participantId: mentor.id });
    expect(again.status).toBe(200);
    expect(again.body.data.id).toBe(opened.body.data.id);

    const secret = "the lab note stays in the database";
    const sent = await ada.agent
      .post(`/api/v1/conversations/${opened.body.data.id}/messages`)
      .set("x-csrf-token", ada.token)
      .send({ body: secret });
    expect(sent.status).toBe(201);
    expect(order).toEqual(["write", "push"]);

    const grace = await signIn(app, "grace@example.com");
    const inbox = await grace.agent.get("/api/v1/notifications");
    expect(inbox.body.data).toEqual([
      expect.objectContaining({ type: "MESSAGE", text: "You have a new message." }),
    ]);
    expect(JSON.stringify(inbox.body)).not.toContain(secret);
    expect(emails).toHaveLength(0);

    await grace.agent
      .patch("/api/v1/me/notification-preferences")
      .set("x-csrf-token", grace.token)
      .send({ email: true });
    const second = await ada.agent
      .post(`/api/v1/conversations/${opened.body.data.id}/messages`)
      .set("x-csrf-token", ada.token)
      .send({ body: `<b>${secret}</b> again` });
    expect(second.status).toBe(201);
    expect(second.body.data.body).toBe(`${secret} again`);
    expect(emails).toHaveLength(1);
    expect(emails[0]?.text).not.toContain(secret);
    expect(emails[0]?.to).toBe("grace@example.com");

    const read = await grace.agent
      .post(`/api/v1/conversations/${opened.body.data.id}/read`)
      .set("x-csrf-token", grace.token)
      .send({ messageId: second.body.data.id });
    expect(read.status).toBe(200);
    const thread = await ada.agent.get(`/api/v1/conversations/${opened.body.data.id}/messages`);
    const stored = thread.body.data.find((message: { id: string }) => message.id === second.body.data.id);
    expect(stored.readBy).toEqual(expect.arrayContaining([expect.objectContaining({ userId: grace.id })]));

    const outsider = await signIn(app, "alan@example.com");
    const denied = await outsider.agent.get(`/api/v1/conversations/${opened.body.data.id}/messages`);
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.body)).not.toContain(secret);
    expect(audits.some((entry) => entry.action === "security.access_denied" && entry.actorId === outsider.id)).toBe(true);

    const listed = await notifications.listForUser(grace.id, 10);
    expect(listed.rows.every((row) => row.type === "MESSAGE")).toBe(true);
  });

  it("keeps an old mentor conversation readable and closes it to new messages after reassignment", async () => {
    const { app, student, mentor, otherMentor } = await build();
    const ada = await signIn(app, "ada@example.com");
    const opened = await ada.agent.post("/api/v1/conversations").set("x-csrf-token", ada.token).send({ type: "DIRECT", withMentor: true });
    const sent = await ada.agent
      .post(`/api/v1/conversations/${opened.body.data.id}/messages`)
      .set("x-csrf-token", ada.token)
      .send({ body: "before the move" });
    expect(sent.status).toBe(201);

    const admin = await signIn(app, "admin@example.com");
    const moved = await admin.agent
      .post("/api/v1/mentor-assignments/reassign")
      .set("x-csrf-token", admin.token)
      .send({ mentorId: otherMentor.id, studentIds: [student.id] });
    expect(moved.status).toBe(200);

    const grace = await signIn(app, "grace@example.com");
    const history = await grace.agent.get(`/api/v1/conversations/${opened.body.data.id}/messages`);
    expect(history.status).toBe(200);
    expect(history.body.data[0].body).toBe("before the move");
    const stillThere = await ada.agent.get(`/api/v1/conversations/${opened.body.data.id}/messages`);
    expect(stillThere.status).toBe(200);

    const closed = await ada.agent
      .post(`/api/v1/conversations/${opened.body.data.id}/messages`)
      .set("x-csrf-token", ada.token)
      .send({ body: "after the move" });
    expect(closed.status).toBe(403);
    const mentorClosed = await grace.agent
      .post(`/api/v1/conversations/${opened.body.data.id}/messages`)
      .set("x-csrf-token", grace.token)
      .send({ body: "still mentoring" });
    expect(mentorClosed.status).toBe(403);

    const privateWork = await grace.agent.get(`/api/v1/students/${student.id}/assignments`);
    expect(privateWork.status).toBe(403);
    const alan = await signIn(app, "alan@example.com");
    const next = await alan.agent
      .post("/api/v1/conversations")
      .set("x-csrf-token", alan.token)
      .send({ type: "DIRECT", participantId: student.id });
    expect(next.status).toBe(201);
    expect(next.body.data.id).not.toBe(opened.body.data.id);
    expect(mentor.id).not.toBe(otherMentor.id);
  });

  it("opens peer and group conversations only after an admin turns those settings on", async () => {
    const { app, peer, classmate, audits } = await build();
    const ada = await signIn(app, "ada@example.com");
    const groupBlocked = await ada.agent
      .post("/api/v1/conversations")
      .set("x-csrf-token", ada.token)
      .send({ type: "GROUP", participantIds: [peer.id, classmate.id], title: "Study" });
    expect(groupBlocked.status).toBe(403);

    const admin = await signIn(app, "admin@example.com");
    const studentSettings = await ada.agent.get("/api/v1/settings");
    expect(studentSettings.status).toBe(403);
    const current = await admin.agent.get("/api/v1/settings");
    expect(current.body.data).toMatchObject({ studentDirectMessages: false, groupChat: false, version: 0 });
    const saved = await admin.agent
      .patch("/api/v1/settings")
      .set("x-csrf-token", admin.token)
      .set("if-match", current.headers.etag)
      .send({ studentDirectMessages: true, groupChat: true });
    expect(saved.status).toBe(200);
    expect(audits.some((entry) => entry.action === "settings.updated" && entry.before?.studentDirectMessages === false)).toBe(true);

    const peerChat = await ada.agent
      .post("/api/v1/conversations")
      .set("x-csrf-token", ada.token)
      .send({ type: "DIRECT", email: "bea@example.com" });
    expect(peerChat.status).toBe(201);
    expect(peerChat.body.data.purpose).toBe("PEER");

    const group = await ada.agent
      .post("/api/v1/conversations")
      .set("x-csrf-token", ada.token)
      .send({ type: "GROUP", emails: ["bea@example.com", "cam@example.com"], title: "Evening study" });
    expect(group.status).toBe(201);
    expect(group.body.data.participants).toHaveLength(3);

    const adminChat = await admin.agent
      .post("/api/v1/conversations")
      .set("x-csrf-token", admin.token)
      .send({ type: "DIRECT", participantId: ada.id });
    expect(adminChat.status).toBe(403);
  });

  it("is the only way an admin can read a private conversation, and it notifies another admin", async () => {
    const { app, audits, notifications, secondAdmin } = await build();
    const ada = await signIn(app, "ada@example.com");
    const opened = await ada.agent.post("/api/v1/conversations").set("x-csrf-token", ada.token).send({ type: "DIRECT", withMentor: true });
    const secret = "private check-in";
    await ada.agent
      .post(`/api/v1/conversations/${opened.body.data.id}/messages`)
      .set("x-csrf-token", ada.token)
      .send({ body: secret });

    const admin = await signIn(app, "admin@example.com");
    const silent = await admin.agent.get(`/api/v1/conversations/${opened.body.data.id}/messages`);
    expect(silent.status).toBe(403);
    expect(JSON.stringify(silent.body)).not.toContain(secret);

    const missingReason = await admin.agent
      .post(`/api/v1/conversations/${opened.body.data.id}/break-glass`)
      .set("x-csrf-token", admin.token)
      .send({});
    expect(missingReason.status).toBe(400);

    const openedGlass = await admin.agent
      .post(`/api/v1/conversations/${opened.body.data.id}/break-glass`)
      .set("x-csrf-token", admin.token)
      .send({ reason: "A report cannot be decided from the quoted message." });
    expect(openedGlass.status).toBe(200);
    expect(openedGlass.body.data[0].body).toBe(secret);
    expect(audits).toContainEqual(
      expect.objectContaining({
        action: "security.break_glass",
        actorId: admin.id,
        subjectId: opened.body.data.id,
        reason: "A report cannot be decided from the quoted message.",
      }),
    );

    const notice = await notifications.listForUser(secondAdmin.id, 10);
    expect(notice.rows.map((row) => row.type)).toContain("BREAK_GLASS");
    expect(notice.rows.find((row) => row.type === "BREAK_GLASS")?.text).not.toContain(secret);
    const actorNotice = await notifications.listForUser(admin.id, 10);
    expect(actorNotice.rows.some((row) => row.type === "BREAK_GLASS")).toBe(false);

    const studentAttempt = await ada.agent
      .post(`/api/v1/conversations/${opened.body.data.id}/break-glass`)
      .set("x-csrf-token", ada.token)
      .send({ reason: "I am curious." });
    expect(studentAttempt.status).toBe(403);
    expect(JSON.stringify(studentAttempt.body)).not.toContain(secret);
  });

  it("does not notify someone who already has the conversation open", async () => {
    const { app, open, notifications, mentor } = await build();
    const ada = await signIn(app, "ada@example.com");
    const opened = await ada.agent.post("/api/v1/conversations").set("x-csrf-token", ada.token).send({ type: "DIRECT", withMentor: true });
    open.add(mentor.id);
    await ada.agent
      .post(`/api/v1/conversations/${opened.body.data.id}/messages`)
      .set("x-csrf-token", ada.token)
      .send({ body: "are you there" });
    const inbox = await notifications.listForUser(mentor.id, 10);
    expect(inbox.rows).toHaveLength(0);
  });
});
