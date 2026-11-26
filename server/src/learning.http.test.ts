import { hashPassword } from "./modules/auth/passwords.js";
import { AuthService } from "./modules/auth/service.js";
import { createMemoryTokenRepository } from "./modules/auth/tokens.js";
import { createMemoryCohortRepository } from "./modules/cohorts/repository.js";
import { createMemoryLearningPathRepository } from "./modules/learning/paths.js";
import { createMemoryWorkRepository } from "./modules/learning/work.js";
import { createMemoryAssignmentRepository } from "./modules/mentors/assignments.js";
import { createMemoryResourceRepository } from "./modules/resources/repository.js";
import { createMemoryUploadRepository } from "./modules/resources/uploads.js";
import { createMemoryUserRepository, type UserRepository } from "./modules/users/repository.js";
import { registerAuditSubscriber, type AuditRecord } from "./modules/audit/subscriber.js";
import { reconcileRecipients } from "./jobs/reconcile-recipients.js";
import request from "supertest";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { EventBus } from "./events/bus.js";
import { createMemoryObjectStorage } from "./platform/storage.js";

const logger = pino({ level: "silent" });

const article = {
  title: "Arrays",
  description: "How arrays work",
  type: "ARTICLE",
  content: "Use an index.",
  externalLink: null,
  topic: "Data structures",
  tags: ["arrays"],
  difficulty: "BEGINNER",
  estimatedDurationMin: 25,
  language: null,
  testCases: [],
};

async function person(
  users: UserRepository,
  input: {
    name: string;
    email: string;
    role: "ADMIN" | "MENTOR" | "STUDENT";
    cohortId?: string | null;
    branch?: "CSE" | "ECE";
  },
) {
  return users.create({
    name: input.name,
    email: input.email,
    passwordHash: await hashPassword("Correct1", 4),
    role: input.role,
    branch: input.role === "STUDENT" ? (input.branch ?? "CSE") : null,
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
  return { agent, token };
}

async function build() {
  const users = createMemoryUserRepository();
  const cohorts = createMemoryCohortRepository();
  const mentorAssignments = createMemoryAssignmentRepository();
  const resources = createMemoryResourceRepository();
  const paths = createMemoryLearningPathRepository();
  const work = createMemoryWorkRepository();
  const bus = new EventBus(logger);
  const audits: AuditRecord[] = [];
  registerAuditSubscriber(bus, {
    async write(record) {
      audits.push(record);
    },
  });
  let clock = new Date("2026-08-01T12:00:00.000Z");
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
    learning: { paths, work, now: () => clock },
  });
  const cohort = await cohorts.create({
    name: "2026 First Year",
    academicYear: "2026-27",
    startDate: new Date("2026-08-01T00:00:00.000Z"),
    endDate: new Date("2027-05-31T00:00:00.000Z"),
  });
  const admin = await person(users, { name: "Admin", email: "admin@example.com", role: "ADMIN" });
  const mentor = await person(users, { name: "Grace", email: "grace@example.com", role: "MENTOR" });
  const otherMentor = await person(users, { name: "Alan", email: "alan@example.com", role: "MENTOR" });
  const student = await person(users, { name: "Ada", email: "ada@example.com", role: "STUDENT", cohortId: cohort.id });
  const ece = await person(users, {
    name: "Bea",
    email: "bea@example.com",
    role: "STUDENT",
    cohortId: cohort.id,
    branch: "ECE",
  });
  await mentorAssignments.create({
    mentorId: mentor.id,
    studentId: student.id,
    assignedBy: admin.id,
    status: "ACTIVE",
    startDate: new Date(),
    endDate: null,
    endReason: null,
  });
  return { app, users, work, mentorAssignments, bus, audits, cohort, student, ece, mentor, setClock: (value: Date) => { clock = value; } };
}

function pathBody(cohortId: string, resourceId: string) {
  return {
    title: "First fortnight",
    description: "Start with arrays.",
    cohortId,
    durationDays: 14,
    modules: [
      {
        order: 1,
        title: "Foundations",
        weeks: [
          {
            weekNumber: 1,
            title: "Week 1",
            days: [
              {
                dayNumber: 1,
                title: "Arrays",
                items: [{ kind: "RESOURCE", refId: resourceId, required: true }],
              },
            ],
          },
        ],
      },
    ],
  };
}

const codingAssignment = {
  title: "Add two numbers",
  description: "Read two integers.",
  priority: "NORMAL",
  submissionType: "EDITOR_LINK",
  language: "python",
  testCases: [
    { name: "sample", input: "1 2", expectedOutput: "3", hidden: false },
    { name: "hidden", input: "4 5", expectedOutput: "secret-output", hidden: true },
  ],
  rubric: [{ criterion: "Correctness", maxPoints: 10 }],
};

describe("learning paths and assignments", () => {
  it("publishes a plan, fans assignments out, and keeps overdue computed", async () => {
    const { app, audits, cohort, ece } = await build();
    const admin = await signIn(app, "admin@example.com");
    const createdResource = await admin.agent.post("/api/v1/resources").set("x-csrf-token", admin.token).send(article);
    expect(createdResource.status).toBe(201);
    const resourceId = createdResource.body.data.id as string;
    await admin.agent
      .post(`/api/v1/resources/${resourceId}/publish`)
      .set("x-csrf-token", admin.token)
      .set("if-match", '"0"')
      .send({ visibility: "INDIVIDUAL", targetIds: [ece.id] });

    const studentSession = await signIn(app, "ada@example.com");
    expect((await studentSession.agent.get(`/api/v1/resources/${resourceId}`)).status).toBe(403);
    expect((await studentSession.agent.get("/api/v1/learning-paths")).status).toBe(403);
    expect((await studentSession.agent.get("/api/v1/assignments")).status).toBe(403);
    expect((await request(app).get("/api/v1/me/plan")).status).toBe(401);

    const mentor = await signIn(app, "grace@example.com");
    expect((await mentor.agent.post("/api/v1/learning-paths").set("x-csrf-token", mentor.token).send(pathBody(cohort.id, resourceId))).status).toBe(403);
    expect((await mentor.agent.get("/api/v1/me/plan")).status).toBe(403);

    const drafted = await admin.agent
      .post("/api/v1/learning-paths")
      .set("x-csrf-token", admin.token)
      .send(pathBody(cohort.id, resourceId));
    expect(drafted.status).toBe(201);
    const publishedPath = await admin.agent
      .post(`/api/v1/learning-paths/${drafted.body.data.id}/publish`)
      .set("x-csrf-token", admin.token)
      .set("if-match", '"0"');
    expect(publishedPath.status).toBe(200);

    const cohortAssignment = await admin.agent.post("/api/v1/assignments").set("x-csrf-token", admin.token).send({
      ...codingAssignment,
      resourceId,
      targetType: "COHORT",
      targetIds: [cohort.id],
      branches: [],
      dueDate: "2026-08-10T00:00:00.000Z",
    });
    expect(cohortAssignment.status).toBe(201);
    const published = await admin.agent
      .post(`/api/v1/assignments/${cohortAssignment.body.data.id}/publish`)
      .set("x-csrf-token", admin.token)
      .set("if-match", '"0"');
    expect(published.status).toBe(200);
    expect(published.body.data.recipientCount).toBe(2);
    expect(audits.some((entry) => entry.action === "assignment.published")).toBe(true);

    const again = await admin.agent
      .post(`/api/v1/assignments/${cohortAssignment.body.data.id}/publish`)
      .set("x-csrf-token", admin.token)
      .set("if-match", `"${published.body.data.revision}"`);
    expect(again.status).toBe(409);

    const opened = await studentSession.agent.get(`/api/v1/resources/${resourceId}`);
    expect(opened.status).toBe(200);
    expect((await mentor.agent.get(`/api/v1/resources/${resourceId}`)).status).toBe(200);
    const otherMentor = await signIn(app, "alan@example.com");
    expect((await otherMentor.agent.get(`/api/v1/resources/${resourceId}`)).status).toBe(403);

    const plan = await studentSession.agent.get("/api/v1/me/plan");
    expect(plan.status).toBe(200);
    expect(plan.body.data.dayNumber).toBe(1);
    expect(plan.body.data.path.dayTitle).toBe("Arrays");
    expect(plan.body.data.items).toEqual([
      expect.objectContaining({ kind: "RESOURCE", title: "Arrays", source: "PATH" }),
    ]);
    const before = await studentSession.agent.get("/api/v1/me/plan?date=2026-07-31");
    expect(before.body.data.dayNumber).toBeNull();
    expect(before.body.data.items).toEqual([]);

    const mine = await studentSession.agent.get("/api/v1/me/assignments");
    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].overdue).toBe(false);
    expect(mine.body.data[0].state).toBe("NOT_STARTED");
    expect(JSON.stringify(mine.body.data)).not.toContain("secret-output");
    expect(JSON.stringify(mine.body.data)).not.toContain("expectedOutput");
    expect(mine.body.data[0].assignment.testCases).toEqual([{ name: "sample", input: "1 2", hidden: false }]);

    const branchOnly = await admin.agent.post("/api/v1/assignments").set("x-csrf-token", admin.token).send({
      ...codingAssignment,
      title: "ECE only",
      resourceId: null,
      targetType: "BRANCH",
      targetIds: [cohort.id],
      branches: ["ECE"],
      dueDate: "2026-08-02T00:00:00.000Z",
      language: null,
      testCases: [],
    });
    const branchPublished = await admin.agent
      .post(`/api/v1/assignments/${branchOnly.body.data.id}/publish`)
      .set("x-csrf-token", admin.token)
      .set("if-match", '"0"');
    expect(branchPublished.body.data.recipientCount).toBe(1);

    const adaAfterBranch = await studentSession.agent.get("/api/v1/me/assignments");
    expect(adaAfterBranch.body.data).toHaveLength(1);
    const bea = await signIn(app, "bea@example.com");
    const beaWork = await bea.agent.get("/api/v1/me/assignments");
    expect(beaWork.body.data.map((row: { assignment: { title: string } }) => row.assignment.title).sort()).toEqual([
      "Add two numbers",
      "ECE only",
    ]);

  });

  it("lets a mentor assign only their own students and reconciles people who join later", async () => {
    const { app, audits, users, work, cohort, student, mentor, bus, mentorAssignments, setClock } = await build();
    const grace = await signIn(app, "grace@example.com");
    const blocked = await grace.agent.post("/api/v1/assignments").set("x-csrf-token", grace.token).send({
      ...codingAssignment,
      resourceId: null,
      targetType: "COHORT",
      targetIds: [cohort.id],
      branches: [],
      dueDate: "2026-08-03T00:00:00.000Z",
      language: null,
      testCases: [],
    });
    expect(blocked.status).toBe(403);
    expect(audits.some((entry) => entry.action === "security.access_denied")).toBe(true);

    const own = await grace.agent.post("/api/v1/assignments").set("x-csrf-token", grace.token).send({
      ...codingAssignment,
      title: "Ada's practice",
      resourceId: null,
      targetType: "INDIVIDUAL",
      targetIds: [student.id],
      branches: [],
      dueDate: "2026-08-03T00:00:00.000Z",
      language: null,
      testCases: [],
    });
    expect(own.status).toBe(201);
    const published = await grace.agent
      .post(`/api/v1/assignments/${own.body.data.id}/publish`)
      .set("x-csrf-token", grace.token)
      .set("if-match", '"0"');
    expect(published.status).toBe(200);
    expect(published.body.data.recipientCount).toBe(1);

    const alan = await signIn(app, "alan@example.com");
    const denied = await alan.agent.get(`/api/v1/students/${student.id}/assignments`);
    expect(denied.status).toBe(403);
    expect(audits.filter((entry) => entry.action === "security.access_denied").length).toBeGreaterThan(1);
    const alanList = await alan.agent.get("/api/v1/assignments");
    expect(alanList.status).toBe(200);
    expect(alanList.body.data).toEqual([]);

    const graceView = await grace.agent.get(`/api/v1/students/${student.id}/plan`);
    expect(graceView.status).toBe(200);
    expect(graceView.body.data.items).toEqual([
      expect.objectContaining({ source: "INDIVIDUAL", title: "Ada's practice", state: "NOT_STARTED" }),
    ]);

    setClock(new Date("2026-08-04T00:00:00.000Z"));
    const ada = await signIn(app, "ada@example.com");
    const overdue = await ada.agent.get("/api/v1/me/assignments");
    expect(overdue.body.data[0].overdue).toBe(true);

    const late = await person(users, { name: "Cam", email: "cam@example.com", role: "STUDENT", cohortId: cohort.id });
    const cohortTask = await grace.agent.post("/api/v1/assignments").set("x-csrf-token", grace.token).send({
      ...codingAssignment,
      title: "Should stay individual",
      resourceId: null,
      targetType: "INDIVIDUAL",
      targetIds: [student.id],
      branches: [],
      dueDate: "2026-09-01T00:00:00.000Z",
      language: null,
      testCases: [],
    });
    expect(cohortTask.status).toBe(201);

    const admin = await signIn(app, "admin@example.com");
    const forCohort = await admin.agent.post("/api/v1/assignments").set("x-csrf-token", admin.token).send({
      ...codingAssignment,
      title: "Whole cohort",
      resourceId: null,
      targetType: "COHORT",
      targetIds: [cohort.id],
      branches: [],
      dueDate: "2026-09-01T00:00:00.000Z",
      language: null,
      testCases: [],
    });
    await admin.agent
      .post(`/api/v1/assignments/${forCohort.body.data.id}/publish`)
      .set("x-csrf-token", admin.token)
      .set("if-match", '"0"');

    const first = await reconcileRecipients({ work, users, mentorAssignments, bus });
    expect(first.some((row) => row.studentIds.includes(late.id))).toBe(false);
    const joined = await person(users, { name: "Dee", email: "dee@example.com", role: "STUDENT", cohortId: cohort.id });
    const second = await reconcileRecipients({ work, users, mentorAssignments, bus });
    expect(second).toEqual([{ assignmentId: forCohort.body.data.id, studentIds: [joined.id] }]);
    const third = await reconcileRecipients({ work, users, mentorAssignments, bus });
    expect(third).toEqual([]);
    const dee = await signIn(app, "dee@example.com");
    const deeWork = await dee.agent.get("/api/v1/me/assignments");
    expect(deeWork.body.data).toHaveLength(1);
    expect(deeWork.body.data[0].assignment.title).toBe("Whole cohort");

    const group = await grace.agent.post("/api/v1/assignments").set("x-csrf-token", grace.token).send({
      ...codingAssignment,
      title: "My group",
      resourceId: null,
      targetType: "MENTOR_GROUP",
      targetIds: [mentor.id],
      branches: [],
      dueDate: "2026-09-02T00:00:00.000Z",
      language: null,
      testCases: [],
    });
    expect(group.status).toBe(201);
    const groupPublished = await grace.agent
      .post(`/api/v1/assignments/${group.body.data.id}/publish`)
      .set("x-csrf-token", grace.token)
      .set("if-match", '"0"');
    expect(groupPublished.body.data.recipientCount).toBe(1);
    void late;
  });
});
