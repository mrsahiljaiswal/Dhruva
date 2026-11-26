import { hashPassword } from "./modules/auth/passwords.js";
import { AuthService } from "./modules/auth/service.js";
import { createMemoryTokenRepository } from "./modules/auth/tokens.js";
import { createMemoryCohortRepository } from "./modules/cohorts/repository.js";
import { createMemoryAssignmentRepository } from "./modules/mentors/assignments.js";
import { createMemoryUserRepository } from "./modules/users/repository.js";
import request from "supertest";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { EventBus } from "./events/bus.js";

const logger = pino({ level: "silent" });

const caps = { canCreateResources: false, canCreateAssessments: false, canGradeAssessments: false };

async function person(
  users: ReturnType<typeof createMemoryUserRepository>,
  input: { name: string; email: string; role: "ADMIN" | "MENTOR" | "STUDENT"; branch?: "CSE" | null },
) {
  return users.create({
    name: input.name,
    email: input.email,
    passwordHash: await hashPassword("Correct1", 4),
    role: input.role,
    branch: input.branch ?? null,
    cohortId: null,
    status: "ACTIVE",
    capabilities: caps,
    invitedAt: null,
    activatedAt: new Date(),
  });
}

describe("mentor allocation", () => {
  it("lets an admin assign a student and hides that student from another mentor", async () => {
    const users = createMemoryUserRepository();
    const cohorts = createMemoryCohortRepository();
    const assignments = createMemoryAssignmentRepository();
    const bus = new EventBus(logger);
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
    });

    const admin = await person(users, { name: "Admin", email: "admin@example.com", role: "ADMIN" });
    const mentor = await person(users, { name: "Grace", email: "grace@example.com", role: "MENTOR" });
    const other = await person(users, { name: "Alan", email: "alan@example.com", role: "MENTOR" });
    const student = await person(users, { name: "Ada", email: "ada@example.com", role: "STUDENT", branch: "CSE" });
    void admin;
    void other;

    const adminAgent = request.agent(app);
    const token = (await adminAgent.get("/api/v1/auth/csrf")).body.data.csrfToken as string;
    await adminAgent.post("/api/v1/auth/login").set("x-csrf-token", token).send({
      email: "admin@example.com",
      password: "Correct1",
    });

    const cohort = await adminAgent.post("/api/v1/cohorts").set("x-csrf-token", token).send({
      name: "2026 First Year",
      academicYear: "2026-27",
      startDate: "2026-08-01",
      endDate: "2027-05-31",
    });
    expect(cohort.status).toBe(201);

    const assigned = await adminAgent.post("/api/v1/mentor-assignments").set("x-csrf-token", token).send({
      mentorId: mentor.id,
      studentIds: [student.id],
    });
    expect(assigned.status).toBe(201);
    expect(assigned.body.data.assigned).toBe(1);

    const again = await adminAgent.post("/api/v1/mentor-assignments").set("x-csrf-token", token).send({
      mentorId: other.id,
      studentIds: [student.id],
    });
    expect(again.status).toBe(409);

    const mentorAgent = request.agent(app);
    const mentorToken = (await mentorAgent.get("/api/v1/auth/csrf")).body.data.csrfToken as string;
    await mentorAgent.post("/api/v1/auth/login").set("x-csrf-token", mentorToken).send({
      email: "grace@example.com",
      password: "Correct1",
    });
    const visible = await mentorAgent.get(`/api/v1/users/${student.id}`);
    expect(visible.status).toBe(200);
    expect(visible.body.data.name).toBe("Ada");

    const otherAgent = request.agent(app);
    const otherToken = (await otherAgent.get("/api/v1/auth/csrf")).body.data.csrfToken as string;
    await otherAgent.post("/api/v1/auth/login").set("x-csrf-token", otherToken).send({
      email: "alan@example.com",
      password: "Correct1",
    });
    const hidden = await otherAgent.get(`/api/v1/users/${student.id}`);
    expect(hidden.status).toBe(403);
    const list = await otherAgent.get(`/api/v1/mentors/${mentor.id}/students`);
    expect(list.status).toBe(403);
  });

  it("reassigns a student, imports a csv, and deactivates an account", async () => {
    const users = createMemoryUserRepository();
    const cohorts = createMemoryCohortRepository();
    const assignments = createMemoryAssignmentRepository();
    const bus = new EventBus(logger);
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
    });
    const mentor = await person(users, { name: "Grace", email: "grace@example.com", role: "MENTOR" });
    const next = await person(users, { name: "Alan", email: "alan@example.com", role: "MENTOR" });
    const student = await person(users, { name: "Ada", email: "ada@example.com", role: "STUDENT", branch: "CSE" });
    await person(users, { name: "Admin", email: "admin@example.com", role: "ADMIN" });

    const adminAgent = request.agent(app);
    const token = (await adminAgent.get("/api/v1/auth/csrf")).body.data.csrfToken as string;
    await adminAgent.post("/api/v1/auth/login").set("x-csrf-token", token).send({
      email: "admin@example.com",
      password: "Correct1",
    });
    await adminAgent.post("/api/v1/cohorts").set("x-csrf-token", token).send({
      name: "2026 First Year",
      academicYear: "2026-27",
      startDate: "2026-08-01",
      endDate: "2027-05-31",
    });
    await adminAgent.post("/api/v1/mentor-assignments").set("x-csrf-token", token).send({
      mentorId: mentor.id,
      studentIds: [student.id],
    });

    const moved = await adminAgent.post("/api/v1/mentor-assignments/reassign").set("x-csrf-token", token).send({
      mentorId: next.id,
      studentIds: [student.id],
    });
    expect(moved.status).toBe(200);
    expect(moved.body.data.moved).toBe(1);
    const history = await adminAgent.get(`/api/v1/students/${student.id}/mentor-history`);
    expect(history.body.data).toHaveLength(2);
    expect(history.body.data[1].mentorName).toBe("Alan");
    const workload = await adminAgent.get(`/api/v1/mentors/${next.id}/workload`);
    expect(workload.body.data.students).toBe(1);

    const flags = await adminAgent.patch(`/api/v1/users/${mentor.id}`).set("x-csrf-token", token).send({
      capabilities: { canCreateResources: true, canCreateAssessments: false, canGradeAssessments: true },
    });
    expect(flags.status).toBe(200);
    expect(flags.body.data.capabilities.canCreateResources).toBe(true);

    const preview = await adminAgent.post("/api/v1/users/import").set("x-csrf-token", token).send({
      csv: "Name,Email,Branch,Cohort,Role\nBea,bea@example.com,CSE,2026 First Year,STUDENT\nNope,not-an-email,CSE,2026 First Year,STUDENT\n",
    });
    expect(preview.status).toBe(200);
    expect(preview.body.data.rows[0].errors).toEqual([]);
    expect(preview.body.data.rows[1].errors.length).toBeGreaterThan(0);
    const commit = await adminAgent
      .post(`/api/v1/users/import/${preview.body.data.previewId}/commit`)
      .set("x-csrf-token", token);
    expect(commit.body.data.created).toBe(1);
    const again = await adminAgent
      .post(`/api/v1/users/import/${preview.body.data.previewId}/commit`)
      .set("x-csrf-token", token);
    expect(again.body.data.created).toBe(1);
    expect(await users.findByEmail("bea@example.com")).toBeTruthy();

    const off = await adminAgent.post(`/api/v1/users/${mentor.id}/deactivate`).set("x-csrf-token", token);
    expect(off.status).toBe(200);
    const mentorAgent = request.agent(app);
    const mentorToken = (await mentorAgent.get("/api/v1/auth/csrf")).body.data.csrfToken as string;
    const denied = await mentorAgent.post("/api/v1/auth/login").set("x-csrf-token", mentorToken).send({
      email: "grace@example.com",
      password: "Correct1",
    });
    expect(denied.status).toBe(403);
  });
});
