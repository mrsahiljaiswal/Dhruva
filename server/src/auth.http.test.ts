import { hashPassword } from "./modules/auth/passwords.js";
import { AuthService } from "./modules/auth/service.js";
import { createMemoryTokenRepository } from "./modules/auth/tokens.js";
import { registerAuditSubscriber, type AuditRecord } from "./modules/audit/subscriber.js";
import { createMemoryUserRepository } from "./modules/users/repository.js";
import request from "supertest";
import { pino } from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "./events/bus.js";
import type { OutboundMail } from "./platform/mail.js";
import { createApp } from "./app.js";

const logger = pino({ level: "silent" });

function build() {
  const sent: OutboundMail[] = [];
  const records: AuditRecord[] = [];
  const users = createMemoryUserRepository();
  const bus = new EventBus(logger);
  registerAuditSubscriber(bus, { async write(record) { records.push(record); } });
  const service = new AuthService({
    users,
    tokens: createMemoryTokenRepository(),
    mailer: { async send(message) { sent.push(message); } },
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
      loginLimit: { limit: 2, windowMs: 60_000 },
    },
  });
  return { app, users, sent, records, service };
}

async function csrf(agent: request.Agent): Promise<string> {
  const response = await agent.get("/api/v1/auth/csrf");
  return response.body.data.csrfToken as string;
}

describe("auth HTTP", () => {
  let ctx: ReturnType<typeof build>;

  beforeEach(() => {
    ctx = build();
  });

  it("requires a CSRF token on login", async () => {
    const response = await request(ctx.app).post("/api/v1/auth/login").send({
      email: "ada@example.com",
      password: "Correct1",
    });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("signs in, returns the current user, and rotates the session on the next login", async () => {
    const passwordHash = await hashPassword("Correct1", 4);
    await ctx.users.create({
      name: "Ada",
      email: "ada@example.com",
      passwordHash,
      role: "STUDENT",
      branch: "CSE",
      cohortId: null,
      status: "ACTIVE",
      capabilities: { canCreateResources: false, canCreateAssessments: false, canGradeAssessments: false },
      invitedAt: null,
      activatedAt: new Date(),
    });

    const agent = request.agent(ctx.app);
    const token = await csrf(agent);
    const first = await agent.post("/api/v1/auth/login").set("x-csrf-token", token).send({
      email: "ada@example.com",
      password: "Correct1",
    });
    expect(first.status).toBe(200);
    expect(first.body.data.role).toBe("STUDENT");
    const firstCookie = first.headers["set-cookie"]?.[0];

    const me = await agent.get("/api/v1/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe("ada@example.com");

    const second = await agent.post("/api/v1/auth/login").set("x-csrf-token", token).send({
      email: "ada@example.com",
      password: "Correct1",
    });
    expect(second.headers["set-cookie"]?.[0]).not.toBe(firstCookie);

    const loggedOut = await agent.post("/api/v1/auth/logout").set("x-csrf-token", token);
    expect(loggedOut.status).toBe(204);
    const after = await agent.get("/api/v1/auth/me");
    expect(after.status).toBe(401);
  });

  it("lets an admin invite a student and denies a student the same action", async () => {
    const passwordHash = await hashPassword("Correct1", 4);
    await ctx.users.create({
      name: "Admin",
      email: "admin@example.com",
      passwordHash,
      role: "ADMIN",
      branch: null,
      cohortId: null,
      status: "ACTIVE",
      capabilities: { canCreateResources: false, canCreateAssessments: false, canGradeAssessments: false },
      invitedAt: null,
      activatedAt: new Date(),
    });
    await ctx.users.create({
      name: "Student",
      email: "student@example.com",
      passwordHash,
      role: "STUDENT",
      branch: "ECE",
      cohortId: null,
      status: "ACTIVE",
      capabilities: { canCreateResources: false, canCreateAssessments: false, canGradeAssessments: false },
      invitedAt: null,
      activatedAt: new Date(),
    });

    const student = request.agent(ctx.app);
    const studentToken = await csrf(student);
    await student.post("/api/v1/auth/login").set("x-csrf-token", studentToken).send({
      email: "student@example.com",
      password: "Correct1",
    });
    const denied = await student.post("/api/v1/users").set("x-csrf-token", studentToken).send({
      name: "New",
      email: "new@example.com",
      role: "MENTOR",
    });
    expect(denied.status).toBe(403);
    expect(ctx.records.some((record) => record.action === "security.access_denied")).toBe(true);

    const admin = request.agent(ctx.app);
    const adminToken = await csrf(admin);
    await admin.post("/api/v1/auth/login").set("x-csrf-token", adminToken).send({
      email: "admin@example.com",
      password: "Correct1",
    });
    const created = await admin.post("/api/v1/users").set("x-csrf-token", adminToken).send({
      name: "New Mentor",
      email: "new@example.com",
      role: "MENTOR",
      password: "ShouldNotWork1",
    });
    expect(created.status).toBe(400);

    const invited = await admin.post("/api/v1/users").set("x-csrf-token", adminToken).send({
      name: "New Mentor",
      email: "new@example.com",
      role: "MENTOR",
    });
    expect(invited.status).toBe(201);
    expect(invited.body.data.passwordHash).toBeUndefined();
    expect(ctx.records.some((record) => record.action === "user.created")).toBe(true);

    const raw = ctx.sent.at(-1)?.text.match(/token=([^&\s]+)/)?.[1];
    const accepted = await admin.post("/api/v1/auth/accept-invite").set("x-csrf-token", adminToken).send({
      token: raw,
      password: "Correct1",
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.status).toBe("ACTIVE");
  });

  it("answers forgotten passwords the same way when the email is unknown", async () => {
    const agent = request.agent(ctx.app);
    const token = await csrf(agent);
    const response = await agent.post("/api/v1/auth/forgot-password").set("x-csrf-token", token).send({
      email: "missing@example.com",
    });
    expect(response.status).toBe(202);
    expect(ctx.sent).toHaveLength(0);
  });

  it("rate limits repeated logins", async () => {
    const agent = request.agent(ctx.app);
    const token = await csrf(agent);
    const send = () =>
      agent.post("/api/v1/auth/login").set("x-csrf-token", token).send({
        email: "ada@example.com",
        password: "nope",
      });
    expect((await send()).status).toBe(401);
    expect((await send()).status).toBe(401);
    const blocked = await send();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("RATE_LIMITED");
  });
});
