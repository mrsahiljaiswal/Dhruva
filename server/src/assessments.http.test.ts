import { hashPassword } from "./modules/auth/passwords.js";
import { AuthService } from "./modules/auth/service.js";
import { createMemoryTokenRepository } from "./modules/auth/tokens.js";
import { createMemoryAssessmentRepository } from "./modules/assessments/repository.js";
import { registerAuditSubscriber, type AuditRecord } from "./modules/audit/subscriber.js";
import { createMemoryCohortRepository } from "./modules/cohorts/repository.js";
import { createMemoryLearningPathRepository } from "./modules/learning/paths.js";
import { createMemoryWorkRepository } from "./modules/learning/work.js";
import { createMemoryAssignmentRepository } from "./modules/mentors/assignments.js";
import { createMemoryResourceRepository } from "./modules/resources/repository.js";
import { createMemoryUploadRepository } from "./modules/resources/uploads.js";
import { createMemoryUserRepository, type UserRepository } from "./modules/users/repository.js";
import request from "supertest";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { EventBus } from "./events/bus.js";
import { createMemoryObjectStorage } from "./platform/storage.js";

const logger = pino({ level: "silent" });
const KEY = "11111111-1111-4111-8111-111111111111";
const KEY_TWO = "22222222-2222-4222-8222-222222222222";

const mcq = {
  type: "MCQ",
  prompt: "What is 2 + 2?",
  options: [
    { id: "a", text: "3" },
    { id: "b", text: "4" },
  ],
  answerKey: { optionIds: ["b"], text: null },
  marks: 2,
  topic: "Arithmetic",
  difficulty: "BEGINNER",
  language: null,
  testCases: [],
};

const shortAnswer = {
  type: "SHORT_ANSWER",
  prompt: "Name the process plants use to make food.",
  options: [],
  answerKey: { optionIds: [], text: "photosynthesis" },
  marks: 3,
  topic: "Biology",
  difficulty: "BEGINNER",
  language: null,
  testCases: [],
};

const coding = {
  type: "CODING",
  prompt: "Return the sum of two numbers.",
  options: [],
  answerKey: { optionIds: [], text: null },
  marks: 5,
  topic: "Functions",
  difficulty: "BEGINNER",
  language: "python",
  testCases: [
    { name: "sample", input: "1 1", expectedOutput: "2", hidden: false },
    { name: "hidden", input: "9", expectedOutput: "secret-output", hidden: true },
  ],
};

function paper(questionIds: string[], cohortId: string, attemptsAllowed = 2) {
  return {
    title: "Weekly quiz",
    description: "Answer every part.",
    questionIds,
    durationMin: 30,
    passingMarks: 1,
    attemptsAllowed,
    availableFrom: "2026-08-01T00:00:00.000Z",
    availableUntil: "2026-08-02T00:00:00.000Z",
    answersReleaseAt: "2026-08-03T00:00:00.000Z",
    targetType: "COHORT",
    targetIds: [cohortId],
    branches: [],
  };
}

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

async function build() {
  const users = createMemoryUserRepository();
  const cohorts = createMemoryCohortRepository();
  const mentorAssignments = createMemoryAssignmentRepository();
  const assessments = createMemoryAssessmentRepository();
  const bus = new EventBus(logger);
  const audits: AuditRecord[] = [];
  const events: string[] = [];
  registerAuditSubscriber(bus, {
    async write(record) {
      audits.push(record);
    },
  });
  for (const action of ["attempt.started", "attempt.finalized", "attempt.graded"]) {
    bus.on(action, () => {
      events.push(action);
    });
  }
  let runs = 0;
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
      repository: createMemoryResourceRepository(),
      uploads: createMemoryUploadRepository(),
      storage: createMemoryObjectStorage(),
    },
    learning: {
      paths: createMemoryLearningPathRepository(),
      work: createMemoryWorkRepository(),
      assessments,
      now: () => clock,
      runner: {
        mode: "manual",
        async run() {
          runs += 1;
          return { status: "pending_review", cases: [] };
        },
      },
    },
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
    assessments,
    audits,
    events,
    cohort,
    mentor,
    student,
    runs: () => runs,
    setClock: (value: Date) => {
      clock = value;
    },
  };
}

describe("assessments", () => {
  it("rejects a second row with the same attempt number", async () => {
    const repo = createMemoryAssessmentRepository();
    const input = {
      assessmentId: "assessment-1",
      studentId: "student-1",
      attemptNo: 1,
      assessmentVersion: 1,
      questionSnapshot: [],
      gradingKeys: [],
      startedAt: new Date("2026-08-01T12:00:00.000Z"),
      expiresAt: new Date("2026-08-01T12:30:00.000Z"),
    };
    expect((await repo.insertAttempt(input)).kind).toBe("created");
    expect((await repo.insertAttempt(input)).kind).toBe("duplicate");
    expect(await repo.listForStudent(input.assessmentId, input.studentId)).toHaveLength(1);
  });

  it("lets an author or an admin write questions, and only an admin publish", async () => {
    const { app, users, mentor, student, audits } = await build();
    await users.update(mentor.id, {
      capabilities: { canCreateResources: false, canCreateAssessments: true, canGradeAssessments: false },
    });
    const admin = await signIn(app, "admin@example.com");
    const grace = await signIn(app, "grace@example.com");
    const alan = await signIn(app, "alan@example.com");
    const ada = await signIn(app, "ada@example.com");

    expect((await request(app).get("/api/v1/assessments")).status).toBe(401);
    expect((await request(app).get("/api/v1/attempts/missing")).status).toBe(401);
    expect((await ada.agent.get("/api/v1/questions")).status).toBe(403);
    expect((await alan.agent.post("/api/v1/questions").set("x-csrf-token", alan.token).send(mcq)).status).toBe(403);
    expect(audits.some((entry) => entry.action === "security.access_denied")).toBe(true);

    const authored = await grace.agent.post("/api/v1/questions").set("x-csrf-token", grace.token).send(mcq);
    expect(authored.status).toBe(201);
    expect(authored.body.data.answerKey.optionIds).toEqual(["b"]);
    const official = await admin.agent.post("/api/v1/questions").set("x-csrf-token", admin.token).send(shortAnswer);
    expect(official.status).toBe(201);
    const editedByOther = await grace.agent
      .patch(`/api/v1/questions/${official.body.data.id}`)
      .set("x-csrf-token", grace.token)
      .send(shortAnswer);
    expect(editedByOther.status).toBe(403);
    expect(audits.some((entry) => entry.action === "security.access_denied" && entry.subjectType === "Question")).toBe(true);

    const ownDraft = await grace.agent
      .post("/api/v1/assessments")
      .set("x-csrf-token", grace.token)
      .send({
        ...paper([authored.body.data.id], "missing"),
        targetType: "INDIVIDUAL",
        targetIds: [student.id],
      });
    expect(ownDraft.status).toBe(201);
    const cohortDraft = await grace.agent
      .post("/api/v1/assessments")
      .set("x-csrf-token", grace.token)
      .send(paper([authored.body.data.id], ownDraft.body.data.targetIds[0]));
    expect(cohortDraft.status).toBe(403);
    const publishedByMentor = await grace.agent
      .post(`/api/v1/assessments/${ownDraft.body.data.id}/publish`)
      .set("x-csrf-token", grace.token)
      .set("if-match", '"0"');
    expect(publishedByMentor.status).toBe(403);
    const published = await admin.agent
      .post(`/api/v1/assessments/${ownDraft.body.data.id}/publish`)
      .set("x-csrf-token", admin.token)
      .set("if-match", '"0"');
    expect(published.status).toBe(200);
    expect(published.body.data.status).toBe("PUBLISHED");

    await users.update(student.id, { status: "DEACTIVATED" });
    const inactive = await ada.agent.get("/api/v1/assessments");
    expect(inactive.status).toBe(403);
    expect(inactive.body.error.code).toBe("ACCOUNT_INACTIVE");
  });

  it("snapshots the paper, grades objective answers, and keeps the answer key hidden until release", async () => {
    const { app, users, assessments, audits, events, cohort, mentor, student, runs, setClock } = await build();
    const admin = await signIn(app, "admin@example.com");
    const grace = await signIn(app, "grace@example.com");
    const alan = await signIn(app, "alan@example.com");
    const ada = await signIn(app, "ada@example.com");
    const bea = await signIn(app, "bea@example.com");

    const objective = await admin.agent.post("/api/v1/questions").set("x-csrf-token", admin.token).send(mcq);
    const written = await admin.agent.post("/api/v1/questions").set("x-csrf-token", admin.token).send(shortAnswer);
    const program = await admin.agent.post("/api/v1/questions").set("x-csrf-token", admin.token).send(coding);
    expect(objective.status).toBe(201);
    const objectiveId = objective.body.data.id as string;
    const writtenId = written.body.data.id as string;
    const programId = program.body.data.id as string;

    const created = await admin.agent
      .post("/api/v1/assessments")
      .set("x-csrf-token", admin.token)
      .send(paper([objectiveId, writtenId, programId], cohort.id));
    expect(created.status).toBe(201);
    expect(created.body.data.totalMarks).toBe(10);
    expect(created.body.data.version).toBe(0);
    const missingVersion = await admin.agent
      .post(`/api/v1/assessments/${created.body.data.id}/publish`)
      .set("x-csrf-token", admin.token);
    expect(missingVersion.status).toBe(400);
    const published = await admin.agent
      .post(`/api/v1/assessments/${created.body.data.id}/publish`)
      .set("x-csrf-token", admin.token)
      .set("if-match", '"0"');
    expect(published.status).toBe(200);
    const assessmentId = published.body.data.id as string;

    const hidden = await ada.agent.get("/api/v1/assessments");
    expect(hidden.status).toBe(200);
    expect(JSON.stringify(hidden.body)).not.toContain("answerKey");
    expect(JSON.stringify(hidden.body)).not.toContain("photosynthesis");

    setClock(new Date("2026-07-31T12:00:00.000Z"));
    const early = await ada.agent.post(`/api/v1/assessments/${assessmentId}/attempts`).set("x-csrf-token", ada.token);
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe("UNPROCESSABLE");

    setClock(new Date("2026-08-01T12:00:00.000Z"));
    const started = await ada.agent.post(`/api/v1/assessments/${assessmentId}/attempts`).set("x-csrf-token", ada.token);
    expect(started.status).toBe(201);
    expect(started.body.data.status).toBe("IN_PROGRESS");
    expect(started.body.data.assessmentVersion).toBe(1);
    expect(started.body.data.expiresAt).toBe("2026-08-01T12:30:00.000Z");
    expect(started.body.data.answersReleased).toBe(false);
    const sitting = JSON.stringify(started.body);
    expect(sitting).not.toContain("answerKey");
    expect(sitting).not.toContain("photosynthesis");
    expect(sitting).not.toContain("secret-output");
    expect(sitting).not.toContain("expectedOutput");
    expect(started.body.data.questions[2].testCases).toEqual([{ name: "sample", input: "1 1", hidden: false }]);
    const attemptId = started.body.data.id as string;

    const saved = await ada.agent
      .patch(`/api/v1/attempts/${attemptId}/answers`)
      .set("x-csrf-token", ada.token)
      .send({
        answers: [
          { questionId: objectiveId, value: "b" },
          { questionId: writtenId, value: "sunlight" },
          { questionId: programId, value: "print(2)" },
        ],
      });
    expect(saved.status).toBe(200);
    expect(saved.body.data.answers).toHaveLength(3);

    const rewritten = await admin.agent
      .patch(`/api/v1/questions/${objectiveId}`)
      .set("x-csrf-token", admin.token)
      .send({ ...mcq, prompt: "Changed after the start", answerKey: { optionIds: ["a"], text: null } });
    expect(rewritten.status).toBe(200);

    const submitted = await ada.agent
      .post(`/api/v1/attempts/${attemptId}/submit`)
      .set("x-csrf-token", ada.token)
      .set("idempotency-key", KEY);
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.status).toBe("SUBMITTED");
    expect(submitted.body.data.autoScore).toBe(2);
    expect(submitted.body.data.manualScore).toBeNull();
    expect(submitted.body.data.totalScore).toBe(2);
    expect(submitted.body.data.pendingManual).toBe(true);
    expect(submitted.body.data.questions[0].prompt).toBe("What is 2 + 2?");
    expect(JSON.stringify(submitted.body)).not.toContain("photosynthesis");
    expect(JSON.stringify(submitted.body)).not.toContain("secret-output");
    expect(events).toEqual(["attempt.started", "attempt.finalized"]);
    expect(runs()).toBe(0);

    const repeated = await ada.agent
      .post(`/api/v1/attempts/${attemptId}/submit`)
      .set("x-csrf-token", ada.token)
      .set("idempotency-key", KEY);
    expect(repeated.status).toBe(200);
    expect(repeated.body.data.id).toBe(attemptId);
    const conflicting = await ada.agent
      .post(`/api/v1/attempts/${attemptId}/submit`)
      .set("x-csrf-token", ada.token)
      .set("idempotency-key", KEY_TWO);
    expect(conflicting.status).toBe(409);
    expect(events.filter((event) => event === "attempt.finalized")).toHaveLength(1);

    const mentorView = await grace.agent.get(`/api/v1/attempts/${attemptId}`);
    expect(mentorView.status).toBe(200);
    expect(JSON.stringify(mentorView.body)).not.toContain("answerKey");
    expect(JSON.stringify(mentorView.body)).not.toContain("photosynthesis");
    const adminView = await admin.agent.get(`/api/v1/attempts/${attemptId}`);
    expect(adminView.status).toBe(200);
    expect(JSON.stringify(adminView.body)).not.toContain("secret-output");
    const stranger = await alan.agent.get(`/api/v1/attempts/${attemptId}`);
    expect(stranger.status).toBe(403);
    const classmate = await bea.agent.get(`/api/v1/attempts/${attemptId}`);
    expect(classmate.status).toBe(403);
    expect(audits.filter((entry) => entry.action === "security.access_denied" && entry.subjectType === "AssessmentAttempt")).toHaveLength(2);

    const ungraded = await grace.agent
      .post(`/api/v1/attempts/${attemptId}/grade`)
      .set("x-csrf-token", grace.token)
      .send({ marks: [{ questionId: writtenId, awarded: 3 }, { questionId: programId, awarded: 5 }] });
    expect(ungraded.status).toBe(403);

    const second = await ada.agent.post(`/api/v1/assessments/${assessmentId}/attempts`).set("x-csrf-token", ada.token);
    expect(second.status).toBe(201);
    const secondId = second.body.data.id as string;
    await ada.agent
      .patch(`/api/v1/attempts/${secondId}/answers`)
      .set("x-csrf-token", ada.token)
      .send({ answers: [{ questionId: objectiveId, value: "b" }] });
    setClock(new Date("2026-08-01T13:00:00.000Z"));
    const late = await ada.agent
      .patch(`/api/v1/attempts/${secondId}/answers`)
      .set("x-csrf-token", ada.token)
      .send({ answers: [{ questionId: objectiveId, value: "a" }] });
    expect(late.status).toBe(422);
    expect(late.body.error.message).toBe("The attempt has ended.");
    const expired = await ada.agent.get(`/api/v1/attempts/${secondId}`);
    expect(expired.body.data.status).toBe("EXPIRED");
    expect(expired.body.data.questions[0].prompt).toBe("Changed after the start");
    expect(expired.body.data.autoScore).toBe(0);
    expect(expired.body.data.answers[0].value).toBe("b");

    const third = await ada.agent.post(`/api/v1/assessments/${assessmentId}/attempts`).set("x-csrf-token", ada.token);
    expect(third.status).toBe(422);
    expect(third.body.error.message).toBe("No attempts remain.");
    expect(await assessments.listForStudent(assessmentId, student.id)).toHaveLength(2);

    const realList = assessments.listForStudent.bind(assessments);
    let hiddenOnce = false;
    assessments.listForStudent = async (id, studentId) => {
      const rows = await realList(id, studentId);
      if (!hiddenOnce) {
        hiddenOnce = true;
        return [];
      }
      return rows;
    };
    const raced = await ada.agent.post(`/api/v1/assessments/${assessmentId}/attempts`).set("x-csrf-token", ada.token);
    expect(raced.status).toBe(422);
    expect(raced.body.error.message).toBe("The attempt could not be started. Try again.");
    expect(await realList(assessmentId, student.id)).toHaveLength(2);

    setClock(new Date("2026-08-03T00:00:00.000Z"));
    const released = await ada.agent.get(`/api/v1/attempts/${attemptId}`);
    expect(released.body.data.answersReleased).toBe(true);
    expect(JSON.stringify(released.body)).toContain("photosynthesis");
    expect(JSON.stringify(released.body)).toContain("secret-output");
    const releasedMentor = await grace.agent.get(`/api/v1/attempts/${attemptId}`);
    expect(releasedMentor.body.data.questions[1].answerKey.text).toBe("photosynthesis");

    await users.update(mentor.id, {
      capabilities: { canCreateResources: false, canCreateAssessments: false, canGradeAssessments: true },
    });
    const graded = await grace.agent
      .post(`/api/v1/attempts/${attemptId}/grade`)
      .set("x-csrf-token", grace.token)
      .send({
        marks: [
          { questionId: writtenId, awarded: 3 },
          { questionId: programId, awarded: 5 },
        ],
      });
    expect(graded.status).toBe(200);
    expect(graded.body.data.status).toBe("GRADED");
    expect(graded.body.data.manualScore).toBe(8);
    expect(graded.body.data.totalScore).toBe(10);
    expect(graded.body.data.pendingManual).toBe(false);
    expect(events).toContain("attempt.graded");
    const deniedGrade = await alan.agent
      .post(`/api/v1/attempts/${attemptId}/grade`)
      .set("x-csrf-token", alan.token)
      .send({ marks: [{ questionId: writtenId, awarded: 1 }] });
    expect(deniedGrade.status).toBe(403);
    expect(runs()).toBe(0);
  });
});
