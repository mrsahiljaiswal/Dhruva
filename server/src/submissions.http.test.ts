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
import request from "supertest";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { EventBus } from "./events/bus.js";
import { createMemoryObjectStorage } from "./platform/storage.js";
import type { CodeRunner, ExecutionGate } from "./modules/submissions/runner.js";

const logger = pino({ level: "silent" });
const KEY = "11111111-1111-4111-8111-111111111111";
const KEY_TWO = "22222222-2222-4222-8222-222222222222";

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
  return { agent, token };
}

async function build(options?: { execution?: ExecutionGate; runner?: CodeRunner }) {
  const users = createMemoryUserRepository();
  const cohorts = createMemoryCohortRepository();
  const mentorAssignments = createMemoryAssignmentRepository();
  const resources = createMemoryResourceRepository();
  const paths = createMemoryLearningPathRepository();
  const work = createMemoryWorkRepository();
  const storage = createMemoryObjectStorage();
  const bus = new EventBus(logger);
  const audits: AuditRecord[] = [];
  const events: string[] = [];
  registerAuditSubscriber(bus, {
    async write(record) {
      audits.push(record);
    },
  });
  bus.on("submission.created", () => {
    events.push("submission.created");
  });
  bus.on("submission.reviewed", () => {
    events.push("submission.reviewed");
  });
  let runs = 0;
  const runner: CodeRunner = options?.runner ?? {
    mode: "manual",
    async run() {
      runs += 1;
      return { status: "pending_review", cases: [] };
    },
  };
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
    resources: { repository: resources, uploads: createMemoryUploadRepository(), storage },
    learning: { paths, work, now: () => clock, runner, execution: options?.execution },
  });
  const cohort = await cohorts.create({
    name: "2026 First Year",
    academicYear: "2026-27",
    startDate: new Date("2026-08-01T00:00:00.000Z"),
    endDate: new Date("2027-05-31T00:00:00.000Z"),
  });
  const admin = await person(users, { name: "Admin", email: "admin@example.com", role: "ADMIN" });
  const mentor = await person(users, { name: "Grace", email: "grace@example.com", role: "MENTOR" });
  await person(users, { name: "Alan", email: "alan@example.com", role: "MENTOR" });
  const student = await person(users, { name: "Ada", email: "ada@example.com", role: "STUDENT", cohortId: cohort.id });
  const other = await person(users, { name: "Bea", email: "bea@example.com", role: "STUDENT", cohortId: cohort.id });
  await mentorAssignments.create({
    mentorId: mentor.id,
    studentId: student.id,
    assignedBy: admin.id,
    status: "ACTIVE",
    startDate: new Date(),
    endDate: null,
    endReason: null,
  });
  return {
    app,
    users,
    storage,
    audits,
    events,
    cohort,
    student,
    other,
    runs: () => runs,
    setClock: (value: Date) => {
      clock = value;
    },
  };
}

function assignmentBody(cohortId: string, title: string, submissionType: string, resourceId: string | null = null) {
  return {
    title,
    description: "Show your work.",
    resourceId,
    targetType: "COHORT",
    targetIds: [cohortId],
    branches: [],
    dueDate: "2026-08-20T00:00:00.000Z",
    priority: "NORMAL",
    submissionType,
    language: submissionType === "EDITOR_LINK" ? "python" : null,
    testCases:
      submissionType === "EDITOR_LINK" ? [{ name: "sample", input: "1", expectedOutput: "1", hidden: false }] : [],
    rubric: [{ criterion: "Correctness", maxPoints: 10 }],
  };
}

async function publish(admin: { agent: request.Agent; token: string }, body: Record<string, unknown>) {
  const created = await admin.agent.post("/api/v1/assignments").set("x-csrf-token", admin.token).send(body);
  expect(created.status).toBe(201);
  const published = await admin.agent
    .post(`/api/v1/assignments/${created.body.data.id}/publish`)
    .set("x-csrf-token", admin.token)
    .set("if-match", `"${created.body.data.revision}"`);
  expect(published.status).toBe(200);
  return published.body.data as { id: string; revision: number };
}

async function ownRecipient(agent: request.Agent, title: string) {
  const list = await agent.get("/api/v1/me/assignments");
  expect(list.status).toBe(200);
  const row = (list.body.data as { id: string; assignment: { title: string }; overdue: boolean; state: string }[]).find(
    (item) => item.assignment.title === title,
  );
  expect(row).toBeTruthy();
  return row!;
}

describe("submissions and review", () => {
  it("stores one revision for a repeated submit, snapshots the resource, and completes on approval", async () => {
    const { app, audits, events, runs, cohort } = await build();
    const admin = await signIn(app, "admin@example.com");
    const createdResource = await admin.agent.post("/api/v1/resources").set("x-csrf-token", admin.token).send(article);
    expect(createdResource.status).toBe(201);
    const resourceId = createdResource.body.data.id as string;
    const publishedResource = await admin.agent
      .post(`/api/v1/resources/${resourceId}/publish`)
      .set("x-csrf-token", admin.token)
      .set("if-match", '"0"')
      .send({ visibility: "GLOBAL", targetIds: [] });
    expect(publishedResource.status).toBe(200);
    expect(publishedResource.body.data.version).toBe(1);

    await publish(admin, {
      ...assignmentBody(cohort.id, "Explain arrays", "TEXT", resourceId),
      testCases: [
        { name: "sample", input: "1", expectedOutput: "2", hidden: false },
        { name: "hidden", input: "9", expectedOutput: "secret-output", hidden: true },
      ],
    });

    const student = await signIn(app, "ada@example.com");
    const recipient = await ownRecipient(student.agent, "Explain arrays");
    const tooSoon = await student.agent
      .post(`/api/v1/recipients/${recipient.id}/submissions`)
      .set("x-csrf-token", student.token)
      .set("idempotency-key", KEY)
      .send({ textAnswer: "An array stores values by index." });
    expect(tooSoon.status).toBe(409);
    expect(tooSoon.body.error.code).toBe("INVALID_STATE");

    const started = await student.agent.post(`/api/v1/recipients/${recipient.id}/start`).set("x-csrf-token", student.token);
    expect(started.status).toBe(200);
    expect(started.body.data.state).toBe("IN_PROGRESS");
    expect(started.body.data.startedAt).toBeTruthy();

    const submitted = await student.agent
      .post(`/api/v1/recipients/${recipient.id}/submissions`)
      .set("x-csrf-token", student.token)
      .set("idempotency-key", KEY)
      .send({ textAnswer: "An array stores values by index." });
    expect(submitted.status).toBe(201);
    expect(submitted.body.data.recipient.state).toBe("SUBMITTED");
    expect(submitted.body.data.revision.revisionNo).toBe(1);
    expect(submitted.body.data.revision.resourceVersion).toBe(1);
    expect(submitted.body.data.revision.status).toBe("PENDING");
    expect(JSON.stringify(submitted.body.data.recipient.assignment.testCases)).not.toContain("secret-output");
    expect(runs()).toBe(0);
    expect(events).toEqual(["submission.created"]);

    const repeated = await student.agent
      .post(`/api/v1/recipients/${recipient.id}/submissions`)
      .set("x-csrf-token", student.token)
      .set("idempotency-key", KEY)
      .send({ textAnswer: "An array stores values by index." });
    expect(repeated.status).toBe(201);
    expect(repeated.body.data.revision.id).toBe(submitted.body.data.revision.id);

    const changed = await student.agent
      .post(`/api/v1/recipients/${recipient.id}/submissions`)
      .set("x-csrf-token", student.token)
      .set("idempotency-key", KEY)
      .send({ textAnswer: "A different answer." });
    expect(changed.status).toBe(409);
    expect(changed.body.error.code).toBe("CONFLICT");

    const missingKey = await student.agent
      .post(`/api/v1/recipients/${recipient.id}/submissions`)
      .set("x-csrf-token", student.token)
      .send({ textAnswer: "An array stores values by index." });
    expect(missingKey.status).toBe(400);

    const edited = await admin.agent
      .patch(`/api/v1/resources/${resourceId}`)
      .set("x-csrf-token", admin.token)
      .set("if-match", `"${publishedResource.body.data.revision}"`)
      .send({ description: "Edited after the submission." });
    expect(edited.status).toBe(200);
    expect(edited.body.data.version).toBe(2);

    const history = await student.agent.get(`/api/v1/recipients/${recipient.id}/submissions`);
    expect(history.status).toBe(200);
    expect(history.body.data).toHaveLength(1);
    expect(history.body.data[0].resourceVersion).toBe(1);

    const otherStudent = await signIn(app, "bea@example.com");
    const deniedStudent = await otherStudent.agent.get(`/api/v1/recipients/${recipient.id}/submissions`);
    expect(deniedStudent.status).toBe(403);
    const otherMentor = await signIn(app, "alan@example.com");
    const deniedMentor = await otherMentor.agent.get(`/api/v1/recipients/${recipient.id}/submissions`);
    expect(deniedMentor.status).toBe(403);
    expect(audits.filter((entry) => entry.action === "security.access_denied" && entry.subjectType === "Submission")).toHaveLength(2);

    const mentor = await signIn(app, "grace@example.com");
    expect((await mentor.agent.get(`/api/v1/recipients/${recipient.id}/submissions`)).status).toBe(200);
    expect((await admin.agent.get(`/api/v1/recipients/${recipient.id}/submissions`)).status).toBe(200);
    const mentorSubmit = await mentor.agent
      .post(`/api/v1/recipients/${recipient.id}/submissions`)
      .set("x-csrf-token", mentor.token)
      .set("idempotency-key", KEY_TWO)
      .send({ textAnswer: "Not my work." });
    expect(mentorSubmit.status).toBe(403);

    const revisionId = submitted.body.data.revision.id as string;
    const earlyReview = await mentor.agent.post(`/api/v1/submissions/${revisionId}/review`).set("x-csrf-token", mentor.token).send({
      decision: "APPROVE",
      feedback: "Clear explanation.",
      score: 8,
      rubricScores: [{ criterion: "Correctness", points: 8 }],
    });
    expect(earlyReview.status).toBe(409);

    const studentReview = await student.agent.post(`/api/v1/submissions/${revisionId}/review`).set("x-csrf-token", student.token).send({
      decision: "APPROVE",
      feedback: "I approve myself.",
      score: 10,
      rubricScores: [],
    });
    expect(studentReview.status).toBe(403);

    const opened = await mentor.agent.post(`/api/v1/submissions/${revisionId}/open`).set("x-csrf-token", mentor.token);
    expect(opened.status).toBe(200);
    expect(opened.body.data.recipient.state).toBe("UNDER_REVIEW");

    const approved = await mentor.agent.post(`/api/v1/submissions/${revisionId}/review`).set("x-csrf-token", mentor.token).send({
      decision: "APPROVE",
      feedback: "Clear explanation.",
      score: 8,
      rubricScores: [{ criterion: "Correctness", points: 8 }],
    });
    expect(approved.status).toBe(200);
    expect(approved.body.data.recipient.state).toBe("COMPLETED");
    expect(approved.body.data.recipient.score).toBe(8);
    expect(approved.body.data.revision.status).toBe("APPROVED");
    expect(approved.body.data.revision.feedback).toBe("Clear explanation.");
    expect(events).toContain("submission.reviewed");
    expect((await student.agent.get(`/api/v1/recipients/${recipient.id}/submissions`)).body.data[0].feedback).toBe("Clear explanation.");
  });

  it("keeps the earlier revision readable when the mentor asks for changes", async () => {
    const { app, cohort } = await build();
    const admin = await signIn(app, "admin@example.com");
    await publish(admin, assignmentBody(cohort.id, "Rewrite the loop", "TEXT"));
    const student = await signIn(app, "ada@example.com");
    const recipient = await ownRecipient(student.agent, "Rewrite the loop");
    await student.agent.post(`/api/v1/recipients/${recipient.id}/start`).set("x-csrf-token", student.token);
    const first = await student.agent
      .post(`/api/v1/recipients/${recipient.id}/submissions`)
      .set("x-csrf-token", student.token)
      .set("idempotency-key", KEY)
      .send({ textAnswer: "First attempt." });
    expect(first.status).toBe(201);
    const revisionId = first.body.data.revision.id as string;
    const mentor = await signIn(app, "grace@example.com");
    await mentor.agent.post(`/api/v1/submissions/${revisionId}/open`).set("x-csrf-token", mentor.token);
    const returned = await mentor.agent.post(`/api/v1/submissions/${revisionId}/review`).set("x-csrf-token", mentor.token).send({
      decision: "REQUEST_CHANGES",
      feedback: "Show the edge case.",
      score: null,
      rubricScores: [],
    });
    expect(returned.status).toBe(200);
    expect(returned.body.data.recipient.state).toBe("REVISION_REQUESTED");

    const second = await student.agent
      .post(`/api/v1/recipients/${recipient.id}/submissions`)
      .set("x-csrf-token", student.token)
      .set("idempotency-key", KEY_TWO)
      .send({ textAnswer: "Second attempt, with the empty list." });
    expect(second.status).toBe(201);
    expect(second.body.data.recipient.state).toBe("SUBMITTED");
    expect(second.body.data.revision.revisionNo).toBe(2);

    const history = await mentor.agent.get(`/api/v1/recipients/${recipient.id}/submissions`);
    expect(history.body.data).toHaveLength(2);
    expect(history.body.data[0].textAnswer).toBe("First attempt.");
    expect(history.body.data[0].feedback).toBe("Show the edge case.");
    expect(history.body.data[0].status).toBe("REVISION_REQUESTED");
    expect(history.body.data[1].status).toBe("PENDING");
  });

  it("rejects an archived assignment, a stranger, and a deactivated student", async () => {
    const { app, users, cohort, student } = await build();
    const admin = await signIn(app, "admin@example.com");
    const published = await publish(admin, assignmentBody(cohort.id, "Closed work", "REPOSITORY"));
    const ada = await signIn(app, "ada@example.com");
    const recipient = await ownRecipient(ada.agent, "Closed work");
    expect((await request(app).get(`/api/v1/recipients/${recipient.id}/submissions`)).status).toBe(401);
    const started = await ada.agent.post(`/api/v1/recipients/${recipient.id}/start`).set("x-csrf-token", ada.token);
    expect(started.status).toBe(200);
    const archived = await admin.agent
      .post(`/api/v1/assignments/${published.id}/archive`)
      .set("x-csrf-token", admin.token)
      .set("if-match", `"${published.revision}"`);
    expect(archived.status).toBe(200);
    const late = await ada.agent
      .post(`/api/v1/recipients/${recipient.id}/submissions`)
      .set("x-csrf-token", ada.token)
      .set("idempotency-key", KEY)
      .send({ repositoryUrl: "https://github.com/ada/arrays" });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe("INVALID_STATE");

    await users.update(student.id, { status: "DEACTIVATED" });
    const inactive = await ada.agent.get(`/api/v1/recipients/${recipient.id}/submissions`);
    expect(inactive.status).toBe(403);
    expect(inactive.body.error.code).toBe("ACCOUNT_INACTIVE");
  });

  it("accepts a confirmed file and a submission that arrives after the due date", async () => {
    const { app, storage, cohort, setClock } = await build();
    const admin = await signIn(app, "admin@example.com");
    await publish(admin, assignmentBody(cohort.id, "Upload the notes", "FILE"));
    const student = await signIn(app, "ada@example.com");
    const recipient = await ownRecipient(student.agent, "Upload the notes");
    await student.agent.post(`/api/v1/recipients/${recipient.id}/start`).set("x-csrf-token", student.token);
    const slot = await student.agent.post(`/api/v1/recipients/${recipient.id}/uploads`).set("x-csrf-token", student.token).send({
      fileName: "notes.txt",
      mimeType: "text/plain",
      sizeBytes: 12,
    });
    expect(slot.status).toBe(201);
    const unstored = await student.agent
      .post(`/api/v1/recipients/${recipient.id}/submissions`)
      .set("x-csrf-token", student.token)
      .set("idempotency-key", KEY)
      .send({ fileKey: slot.body.data.storageKey });
    expect(unstored.status).toBe(422);
    storage.complete(slot.body.data.storageKey as string);
    const submitted = await student.agent
      .post(`/api/v1/recipients/${recipient.id}/submissions`)
      .set("x-csrf-token", student.token)
      .set("idempotency-key", KEY)
      .send({ fileKey: slot.body.data.storageKey });
    expect(submitted.status).toBe(201);
    expect(submitted.body.data.revision.fileName).toBe("notes.txt");
    const download = await student.agent.get(`/api/v1/submissions/${submitted.body.data.revision.id}/download`);
    expect(download.status).toBe(200);
    expect(download.body.data.url).toContain("notes.txt");
    const stranger = await signIn(app, "alan@example.com");
    expect((await stranger.agent.get(`/api/v1/submissions/${submitted.body.data.revision.id}/download`)).status).toBe(403);

    setClock(new Date("2026-09-01T00:00:00.000Z"));
    await publish(admin, assignmentBody(cohort.id, "Past due", "EDITOR_LINK"));
    const overdue = await ownRecipient(student.agent, "Past due");
    expect(overdue.overdue).toBe(true);
    await student.agent.post(`/api/v1/recipients/${overdue.id}/start`).set("x-csrf-token", student.token);
    const accepted = await student.agent
      .post(`/api/v1/recipients/${overdue.id}/submissions`)
      .set("x-csrf-token", student.token)
      .set("idempotency-key", KEY_TWO)
      .send({ editorUrl: "https://editor.example.com/ada/past-due" });
    expect(accepted.status).toBe(201);
    expect(accepted.body.data.recipient.state).toBe("SUBMITTED");
  });

  it("calls the runner only when code execution is enabled, and still leaves the revision for review", async () => {
    const calls: { language: string; source: string }[] = [];
    const { app, cohort } = await build({
      execution: { enabled: () => true },
      runner: {
        mode: "manual",
        async run(input) {
          calls.push({ language: input.language, source: input.source });
          return { status: "pending_review", cases: [] };
        },
      },
    });
    const admin = await signIn(app, "admin@example.com");
    await publish(admin, assignmentBody(cohort.id, "Editor exercise", "EDITOR_LINK"));
    const student = await signIn(app, "ada@example.com");
    const recipient = await ownRecipient(student.agent, "Editor exercise");
    await student.agent.post(`/api/v1/recipients/${recipient.id}/start`).set("x-csrf-token", student.token);
    const submitted = await student.agent
      .post(`/api/v1/recipients/${recipient.id}/submissions`)
      .set("x-csrf-token", student.token)
      .set("idempotency-key", KEY)
      .send({ editorUrl: "https://editor.example.com/ada/add" });
    expect(submitted.status).toBe(201);
    expect(submitted.body.data.revision.status).toBe("PENDING");
    expect(submitted.body.data.recipient.state).toBe("SUBMITTED");
    expect(calls).toEqual([{ language: "python", source: "https://editor.example.com/ada/add" }]);
  });
});
