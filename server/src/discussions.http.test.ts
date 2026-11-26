import { hashPassword } from "./modules/auth/passwords.js";
import { AuthService } from "./modules/auth/service.js";
import { createMemoryTokenRepository } from "./modules/auth/tokens.js";
import { registerAuditSubscriber, type AuditRecord } from "./modules/audit/subscriber.js";
import { createMemoryCohortRepository } from "./modules/cohorts/repository.js";
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

const article = {
  title: "Arrays",
  description: "How arrays work",
  type: "ARTICLE",
  content: "An array keeps its values in order.",
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
  return { agent, token, id: response.body.data.id as string };
}

async function build() {
  const users = createMemoryUserRepository();
  const cohorts = createMemoryCohortRepository();
  const assignments = createMemoryAssignmentRepository();
  const bus = new EventBus(logger);
  const audits: AuditRecord[] = [];
  const events: { action: string; after: Record<string, unknown> | null }[] = [];
  registerAuditSubscriber(bus, {
    async write(record) {
      audits.push(record);
    },
  });
  for (const action of ["doubt.asked", "doubt.replied", "discussion.reported"]) {
    bus.on(action, (event) => {
      events.push({ action, after: (event.after as Record<string, unknown> | null) ?? null });
    });
  }
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
    discussions: { reportLimit: { limit: 3, windowMs: 60 * 60 * 1000 } },
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
  const otherMentor = await person(users, { name: "Alan", email: "alan@example.com", role: "MENTOR" });
  const student = await person(users, { name: "Ada", email: "ada@example.com", role: "STUDENT", cohortId: cohort.id });
  const outsider = await person(users, { name: "Bea", email: "bea@example.com", role: "STUDENT", cohortId: otherCohort.id });
  await assignments.create({
    mentorId: mentor.id,
    studentId: student.id,
    assignedBy: admin.id,
    status: "ACTIVE",
    startDate: new Date(),
    endDate: null,
    endReason: null,
  });
  return { app, users, audits, events, cohort, mentor, otherMentor, student, outsider };
}

async function publish(app: ReturnType<typeof createApp>, visibility: string, targetIds: string[]) {
  const admin = await signIn(app, "admin@example.com");
  const created = await admin.agent.post("/api/v1/resources").set("x-csrf-token", admin.token).send(article);
  expect(created.status).toBe(201);
  const published = await admin.agent
    .post(`/api/v1/resources/${created.body.data.id}/publish`)
    .set("x-csrf-token", admin.token)
    .set("if-match", created.headers.etag)
    .send({ visibility, targetIds });
  expect(published.status).toBe(200);
  return created.body.data.id as string;
}

describe("discussions", () => {
  it("lets a student ask a doubt, keeps the code as text, and nests replies once", async () => {
    const { app, events, mentor } = await build();
    const resourceId = await publish(app, "GLOBAL", []);
    expect((await request(app).get(`/api/v1/resources/${resourceId}/posts`)).status).toBe(401);

    const ada = await signIn(app, "ada@example.com");
    const created = await ada.agent
      .post(`/api/v1/resources/${resourceId}/posts`)
      .set("x-csrf-token", ada.token)
      .send({
        title: "Why <b>does</b> this loop?",
        body: "It never ends.\n\n<script>alert(1)</script>See the snippet.",
        codeSnippet: "vector<int> values;",
      });
    expect(created.status).toBe(201);
    expect(created.body.data.title).toBe("Why does this loop?");
    expect(created.body.data.body).toBe("It never ends.\n\nSee the snippet.");
    expect(created.body.data.codeSnippet).toBe("vector<int> values;");
    expect(events[0]).toMatchObject({ action: "doubt.asked", after: { resourceId, mentorId: mentor.id } });

    const grace = await signIn(app, "grace@example.com");
    const answer = await grace.agent
      .post(`/api/v1/posts/${created.body.data.id}/comments`)
      .set("x-csrf-token", grace.token)
      .send({ body: "The index starts at <em>zero</em>." });
    expect(answer.status).toBe(201);
    expect(answer.body.data.body).toBe("The index starts at zero.");
    expect(events.some((event) => event.action === "doubt.replied" && event.after?.mentorId === mentor.id)).toBe(true);

    const follow = await ada.agent
      .post(`/api/v1/posts/${created.body.data.id}/comments`)
      .set("x-csrf-token", ada.token)
      .send({ body: "That helped.", parentCommentId: answer.body.data.id });
    expect(follow.status).toBe(201);
    const deeper = await ada.agent
      .post(`/api/v1/posts/${created.body.data.id}/comments`)
      .set("x-csrf-token", ada.token)
      .send({ body: "And another.", parentCommentId: follow.body.data.id });
    expect(deeper.status).toBe(422);

    const accepted = await ada.agent
      .post(`/api/v1/posts/${created.body.data.id}/accept`)
      .set("x-csrf-token", ada.token)
      .send({ commentId: answer.body.data.id });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.acceptedCommentId).toBe(answer.body.data.id);
    expect(accepted.body.data.replyCount).toBe(2);

    const reaction = { targetType: "COMMENT", targetId: answer.body.data.id, kind: "HELPFUL" };
    const helpful = await ada.agent.post("/api/v1/reactions").set("x-csrf-token", ada.token).send(reaction);
    expect(helpful.status).toBe(200);
    expect(helpful.body.data.active).toBe(true);
    const removed = await ada.agent.post("/api/v1/reactions").set("x-csrf-token", ada.token).send(reaction);
    expect(removed.body.data.active).toBe(false);
  });

  it("searches the forum and filters unanswered or resolved threads", async () => {
    const { app } = await build();
    const ada = await signIn(app, "ada@example.com");
    const grace = await signIn(app, "grace@example.com");
    const binary = await ada.agent.post("/api/v1/forum/posts").set("x-csrf-token", ada.token).send({
      title: "Binary search",
      body: "When does the range shrink?",
      category: "DSA",
    });
    const sorting = await ada.agent.post("/api/v1/forum/posts").set("x-csrf-token", ada.token).send({
      title: "Sorting networks",
      body: "How do the comparators line up?",
      category: "PROGRAMMING",
    });
    expect(binary.status).toBe(201);
    expect(sorting.status).toBe(201);
    const answer = await grace.agent
      .post(`/api/v1/posts/${sorting.body.data.id}/comments`)
      .set("x-csrf-token", grace.token)
      .send({ body: "Each comparator takes a pair." });
    const resolved = await grace.agent
      .post(`/api/v1/posts/${sorting.body.data.id}/resolve`)
      .set("x-csrf-token", grace.token);
    expect(resolved.status).toBe(200);
    const highlighted = await grace.agent
      .post(`/api/v1/posts/${binary.body.data.id}/highlight`)
      .set("x-csrf-token", grace.token);
    expect(highlighted.body.data.highlighted).toBe(true);

    const found = await ada.agent.get("/api/v1/forum/posts").query({ q: "binary search", category: "DSA" });
    expect(found.status).toBe(200);
    expect(found.body.data.map((post: { title: string }) => post.title)).toEqual(["Binary search"]);

    const unanswered = await ada.agent.get("/api/v1/forum/posts").query({ status: "UNANSWERED" });
    expect(unanswered.body.data.map((post: { title: string }) => post.title)).toEqual(["Binary search"]);
    const done = await ada.agent.get("/api/v1/forum/posts").query({ status: "RESOLVED" });
    expect(done.body.data.map((post: { id: string }) => post.id)).toEqual([sorting.body.data.id]);

    const operators = await ada.agent.get("/api/v1/forum/posts").query({ q: { $ne: "" } });
    expect(operators.status).toBe(400);
    const symbols = await ada.agent.get("/api/v1/forum/posts").query({ q: "$$$" });
    expect(symbols.status).toBe(200);
    expect(symbols.body.total).toBe(0);
    expect(answer.status).toBe(201);

    const alan = await signIn(app, "alan@example.com");
    expect((await alan.agent.get("/api/v1/forum/posts")).status).toBe(200);
    const studentHighlight = await ada.agent
      .post(`/api/v1/posts/${binary.body.data.id}/highlight`)
      .set("x-csrf-token", ada.token);
    expect(studentHighlight.status).toBe(403);
  });

  it("hides a resource doubt from people who cannot see it, and lets the assigned mentor answer", async () => {
    const { app, audits, cohort, mentor, outsider } = await build();
    const resourceId = await publish(app, "COHORT", [cohort.id]);
    const ada = await signIn(app, "ada@example.com");
    const created = await ada.agent.post(`/api/v1/resources/${resourceId}/posts`).set("x-csrf-token", ada.token).send({
      title: "Cohort question",
      body: "Is this reading only for us?",
    });
    expect(created.status).toBe(201);
    const postId = created.body.data.id as string;

    const bea = await signIn(app, "bea@example.com");
    const alan = await signIn(app, "alan@example.com");
    const grace = await signIn(app, "grace@example.com");
    const hiddenList = await bea.agent.get(`/api/v1/resources/${resourceId}/posts`);
    const hiddenPost = await alan.agent.get(`/api/v1/posts/${postId}`);
    const mentorList = await grace.agent.get(`/api/v1/resources/${resourceId}/posts`);
    const mentorPost = await grace.agent.get(`/api/v1/posts/${postId}`);
    expect(hiddenList.status).toBe(403);
    expect(hiddenPost.status).toBe(403);
    expect(mentorList.status).toBe(403);
    expect(mentorPost.status).toBe(200);

    const answer = await grace.agent
      .post(`/api/v1/posts/${postId}/comments`)
      .set("x-csrf-token", grace.token)
      .send({ body: "Yes. It was published to your cohort." });
    const accepted = await grace.agent
      .post(`/api/v1/posts/${postId}/accept`)
      .set("x-csrf-token", grace.token)
      .send({ commentId: answer.body.data.id });
    const resolved = await grace.agent.post(`/api/v1/posts/${postId}/resolve`).set("x-csrf-token", grace.token);
    expect(answer.status).toBe(201);
    expect(accepted.status).toBe(200);
    expect(resolved.body.data.status).toBe("RESOLVED");

    const studentResolve = await ada.agent.post(`/api/v1/posts/${postId}/resolve`).set("x-csrf-token", ada.token);
    const studentEscalate = await ada.agent
      .post(`/api/v1/posts/${postId}/escalate`)
      .set("x-csrf-token", ada.token)
      .send({ reason: "I want an administrator." });
    expect(studentResolve.status).toBe(403);
    expect(studentEscalate.status).toBe(403);
    const denied = audits.filter((entry) => entry.action === "security.access_denied");
    expect(denied.some((entry) => entry.actorId === outsider.id)).toBe(true);
    expect(denied.some((entry) => entry.actorId === mentor.id)).toBe(true);
    expect(denied.some((entry) => entry.actorId === ada.id)).toBe(true);
  });

  it("files a report for a post, a comment, or a user, and an escalation is the same report", async () => {
    const { app, events, users, student } = await build();
    const ada = await signIn(app, "ada@example.com");
    const grace = await signIn(app, "grace@example.com");
    const post = await ada.agent.post("/api/v1/forum/posts").set("x-csrf-token", ada.token).send({
      title: "Off topic",
      body: "This does not belong here.",
      category: "GENERAL",
    });
    const comment = await grace.agent
      .post(`/api/v1/posts/${post.body.data.id}/comments`)
      .set("x-csrf-token", grace.token)
      .send({ body: "Please move it." });

    const first = await ada.agent.post("/api/v1/reports").set("x-csrf-token", ada.token).send({
      targetType: "POST",
      targetId: post.body.data.id,
      reason: "<b>It is off topic.</b>",
    });
    const duplicate = await ada.agent.post("/api/v1/reports").set("x-csrf-token", ada.token).send({
      targetType: "POST",
      targetId: post.body.data.id,
      reason: "It is off topic.",
    });
    expect(first.status).toBe(201);
    expect(first.body.data.reason).toBe("It is off topic.");
    expect(first.body.data.status).toBe("OPEN");
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.data.id).toBe(first.body.data.id);
    expect(events.filter((event) => event.action === "discussion.reported")).toHaveLength(1);

    const onComment = await ada.agent.post("/api/v1/reports").set("x-csrf-token", ada.token).send({
      targetType: "COMMENT",
      targetId: comment.body.data.id,
      reason: "The reply is rude.",
    });
    expect(onComment.status).toBe(201);
    const limited = await ada.agent.post("/api/v1/reports").set("x-csrf-token", ada.token).send({
      targetType: "USER",
      targetId: grace.id,
      reason: "Repeated trouble.",
    });
    expect(limited.status).toBe(429);

    const ownAccount = await grace.agent.post("/api/v1/reports").set("x-csrf-token", grace.token).send({
      targetType: "USER",
      targetId: grace.id,
      reason: "Myself.",
    });
    expect(ownAccount.status).toBe(422);
    const escalation = await grace.agent
      .post(`/api/v1/posts/${post.body.data.id}/escalate`)
      .set("x-csrf-token", grace.token)
      .send({ reason: "I cannot tell whether this breaks the forum rules." });
    expect(escalation.status).toBe(201);
    expect(escalation.body.data.targetType).toBe("POST");
    expect(events.some((event) => event.action === "discussion.reported" && event.after?.via === "escalation")).toBe(true);

    await users.update(student.id, { status: "DEACTIVATED" });
    const inactive = await ada.agent.get("/api/v1/forum/posts");
    expect(inactive.status).toBe(403);
    expect(inactive.body.error.code).toBe("ACCOUNT_INACTIVE");
  });
});
