import type { Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createServer } from "node:http";
import { hashPassword } from "../modules/auth/passwords.js";
import { AuthService } from "../modules/auth/service.js";
import { createMemoryTokenRepository } from "../modules/auth/tokens.js";
import { registerAuditSubscriber, type AuditRecord } from "../modules/audit/subscriber.js";
import { createMemoryCohortRepository } from "../modules/cohorts/repository.js";
import { createMemoryAssignmentRepository } from "../modules/mentors/assignments.js";
import { createMemoryMessagingRepository } from "../modules/messaging/repository.js";
import type { MessagingService } from "../modules/messaging/service.js";
import { createMemoryNotificationRepository } from "../modules/notifications/repository.js";
import { createMemoryPreferenceRepository } from "../modules/notifications/preferences.js";
import { registerNotificationSubscriber } from "../modules/notifications/subscriber.js";
import { createMemorySettingsRepository } from "../modules/settings/repository.js";
import { createMemoryUserRepository } from "../modules/users/repository.js";
import request from "supertest";
import { io as ioClient, type Socket } from "socket.io-client";
import { pino } from "pino";
import { afterEach, describe, expect, it } from "vitest";
import type { RequestHandler } from "express";
import { createApp } from "../app.js";
import { EventBus } from "../events/bus.js";
import { createDeliveryBridge } from "./delivery.js";
import { attachRealtime } from "./socket.js";

const logger = pino({ level: "silent" });
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (closers.length > 0) {
    await closers.pop()?.();
  }
});

function cookiesFrom(response: { headers: { "set-cookie"?: string | string[] } }): string[] {
  const raw = response.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((row) => row.split(";")[0] ?? "").filter(Boolean);
}

async function listen() {
  const users = createMemoryUserRepository();
  const cohorts = createMemoryCohortRepository();
  const assignments = createMemoryAssignmentRepository();
  const bus = new EventBus(logger);
  const audits: AuditRecord[] = [];
  registerAuditSubscriber(bus, { async write(record) { audits.push(record); } });
  const messaging = createMemoryMessagingRepository();
  const delivery = createDeliveryBridge();
  registerNotificationSubscriber(bus, {
    users,
    notifications: createMemoryNotificationRepository(),
    preferences: createMemoryPreferenceRepository(),
    delivery,
    logger,
  });
  const auth = new AuthService({
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
      service: auth,
      users,
      sessionSecret: "test-session-secret",
      secureCookies: false,
      directory: { cohorts, assignments },
    },
    messaging: {
      repository: messaging,
      settings: createMemorySettingsRepository(),
      delivery,
    },
  });
  const httpServer: HttpServer = createServer(app);
  const realtime = attachRealtime(httpServer, {
    clientOrigin: "http://localhost:5173",
    session: app.locals.session as RequestHandler,
    users,
    messaging: app.locals.messaging as MessagingService,
    bridge: delivery,
  });
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => resolve());
  });
  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("The socket server did not bind.");
  }
  const port = address.port;
  closers.push(async () => {
    await realtime.close();
  });
  const cohort = await cohorts.create({
    name: "2026",
    academicYear: "2026-27",
    startDate: new Date("2026-08-01T00:00:00.000Z"),
    endDate: new Date("2027-05-31T00:00:00.000Z"),
  });
  const mentor = await users.create({
    name: "Grace",
    email: "grace@example.com",
    passwordHash: await hashPassword("Correct1", 4),
    role: "MENTOR",
    branch: null,
    cohortId: null,
    status: "ACTIVE",
    capabilities: { canCreateResources: false, canCreateAssessments: false, canGradeAssessments: false },
    invitedAt: null,
    activatedAt: new Date(),
  });
  const student = await users.create({
    name: "Ada",
    email: "ada@example.com",
    passwordHash: await hashPassword("Correct1", 4),
    role: "STUDENT",
    branch: "CSE",
    cohortId: cohort.id,
    status: "ACTIVE",
    capabilities: { canCreateResources: false, canCreateAssessments: false, canGradeAssessments: false },
    invitedAt: null,
    activatedAt: new Date(),
  });
  const outsider = await users.create({
    name: "Bea",
    email: "bea@example.com",
    passwordHash: await hashPassword("Correct1", 4),
    role: "STUDENT",
    branch: "CSE",
    cohortId: cohort.id,
    status: "ACTIVE",
    capabilities: { canCreateResources: false, canCreateAssessments: false, canGradeAssessments: false },
    invitedAt: null,
    activatedAt: new Date(),
  });
  await assignments.create({
    mentorId: mentor.id,
    studentId: student.id,
    assignedBy: mentor.id,
    status: "ACTIVE",
    startDate: new Date(),
    endDate: null,
    endReason: null,
  });
  return { app, port, audits, messaging, student, outsider };
}

async function sessionCookie(app: ReturnType<typeof createApp>, email: string): Promise<string> {
  const agent = request.agent(app);
  const csrf = await agent.get("/api/v1/auth/csrf");
  const login = await agent.post("/api/v1/auth/login").set("x-csrf-token", csrf.body.data.csrfToken).send({ email, password: "Correct1" });
  expect(login.status).toBe(200);
  return [...cookiesFrom(csrf), ...cookiesFrom(login)].join("; ");
}

function connect(port: number, cookie: string): Socket {
  return ioClient(`http://127.0.0.1:${port}`, {
    extraHeaders: { cookie },
    reconnection: false,
    timeout: 3000,
  });
}

describe("socket messaging", () => {
  it("rejects a join from outside the conversation and relays typing without storing it", async () => {
    const { app, port, audits, messaging, student, outsider } = await listen();
    const ada = request.agent(app);
    const csrf = (await ada.get("/api/v1/auth/csrf")).body.data.csrfToken as string;
    expect((await ada.post("/api/v1/auth/login").set("x-csrf-token", csrf).send({ email: "ada@example.com", password: "Correct1" })).status).toBe(200);
    const opened = await ada.post("/api/v1/conversations").set("x-csrf-token", csrf).send({ type: "DIRECT", withMentor: true });
    expect(opened.status).toBe(201);
    const conversationId = opened.body.data.id as string;

    const outsiderCookie = await sessionCookie(app, "bea@example.com");
    const denied = connect(port, outsiderCookie);
    const join = await new Promise<{ ok: boolean }>((resolve, reject) => {
      denied.on("connect", () => {
        denied.emit("conversation.join", { conversationId }, (result: { ok: boolean }) => resolve(result));
      });
      denied.on("connect_error", reject);
    });
    expect(join.ok).toBe(false);
    expect(audits.some((entry) => entry.action === "security.access_denied" && entry.actorId === outsider.id)).toBe(true);
    denied.close();

    const adaCookie = await sessionCookie(app, "ada@example.com");
    const graceCookie = await sessionCookie(app, "grace@example.com");
    const adaSocket = connect(port, adaCookie);
    const graceSocket = connect(port, graceCookie);
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        adaSocket.on("connect", () => resolve());
        adaSocket.on("connect_error", reject);
      }),
      new Promise<void>((resolve, reject) => {
        graceSocket.on("connect", () => resolve());
        graceSocket.on("connect_error", reject);
      }),
    ]);
    const adaJoined = await new Promise<{ ok: boolean }>((resolve) => {
      adaSocket.emit("conversation.join", { conversationId }, resolve);
    });
    const graceJoined = await new Promise<{ ok: boolean }>((resolve) => {
      graceSocket.emit("conversation.join", { conversationId }, resolve);
    });
    expect(adaJoined.ok).toBe(true);
    expect(graceJoined.ok).toBe(true);

    const typing = new Promise<{ conversationId: string; userId: string }>((resolve) => {
      graceSocket.on("typing", resolve);
    });
    adaSocket.emit("conversation.typing", { conversationId });
    await expect(typing).resolves.toMatchObject({ conversationId, userId: student.id });
    const stored = await messaging.listMessages(conversationId, 1, 20);
    expect(stored.total).toBe(0);

    const pushed = new Promise<{ conversationId: string }>((resolve) => {
      graceSocket.on("message.new", resolve);
    });
    const sent = await new Promise<{ ok: boolean }>((resolve) => {
      adaSocket.emit("message.send", { conversationId, body: "on my way" }, resolve);
    });
    expect(sent.ok).toBe(true);
    await expect(pushed).resolves.toEqual({ conversationId });
    const after = await messaging.listMessages(conversationId, 1, 20);
    expect(after.rows[0]?.body).toBe("on my way");
    adaSocket.close();
    graceSocket.close();
  });
});
