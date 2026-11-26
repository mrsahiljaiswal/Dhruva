import { hashPassword } from "./modules/auth/passwords.js";
import { AuthService } from "./modules/auth/service.js";
import { createMemoryTokenRepository } from "./modules/auth/tokens.js";
import { createMemoryCohortRepository } from "./modules/cohorts/repository.js";
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

const logger = pino({ level: "silent" });

const article = {
  title: "Arrays",
  description: "How arrays work",
  type: "ARTICLE",
  content: "# Arrays\n\n<script>alert(1)</script>Use an index.",
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
  input: { name: string; email: string; role: "ADMIN" | "MENTOR" | "STUDENT"; cohortId?: string | null; resources?: boolean },
) {
  return users.create({
    name: input.name,
    email: input.email,
    passwordHash: await hashPassword("Correct1", 4),
    role: input.role,
    branch: input.role === "STUDENT" ? "CSE" : null,
    cohortId: input.cohortId ?? null,
    status: "ACTIVE",
    capabilities: {
      canCreateResources: input.resources ?? false,
      canCreateAssessments: false,
      canGradeAssessments: false,
    },
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
  const assignments = createMemoryAssignmentRepository();
  const resources = createMemoryResourceRepository();
  const uploads = createMemoryUploadRepository();
  const storage = createMemoryObjectStorage();
  const bus = new EventBus(logger);
  const audits: AuditRecord[] = [];
  registerAuditSubscriber(bus, {
    async write(record) {
      audits.push(record);
    },
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
    resources: { repository: resources, uploads, storage },
  });
  const cohort = await cohorts.create({
    name: "2026 First Year",
    academicYear: "2026-27",
    startDate: new Date("2026-08-01"),
    endDate: new Date("2027-05-31"),
  });
  const otherCohort = await cohorts.create({
    name: "2025 First Year",
    academicYear: "2025-26",
    startDate: new Date("2025-08-01"),
    endDate: new Date("2026-05-31"),
  });
  const admin = await person(users, { name: "Admin", email: "admin@example.com", role: "ADMIN" });
  const mentor = await person(users, { name: "Grace", email: "grace@example.com", role: "MENTOR", resources: true });
  const plainMentor = await person(users, { name: "Alan", email: "alan@example.com", role: "MENTOR" });
  const student = await person(users, { name: "Ada", email: "ada@example.com", role: "STUDENT", cohortId: cohort.id });
  const outsider = await person(users, {
    name: "Bea",
    email: "bea@example.com",
    role: "STUDENT",
    cohortId: otherCohort.id,
  });
  await assignments.create({
    mentorId: mentor.id,
    studentId: student.id,
    assignedBy: admin.id,
    status: "ACTIVE",
    startDate: new Date(),
    endDate: null,
    endReason: null,
  });
  return { app, storage, audits, cohort, mentor, plainMentor, student, outsider };
}

describe("resource library", () => {
  it("lets an allowed mentor publish only to their own group or their own students", async () => {
    const { app, audits, mentor, plainMentor, student, outsider } = await build();
    const author = await signIn(app, "grace@example.com");
    const created = await author.agent.post("/api/v1/resources").set("x-csrf-token", author.token).send(article);
    expect(created.status).toBe(201);
    expect(created.body.data.version).toBe(1);
    expect(created.body.data.content).not.toContain("<script>");
    expect(created.headers.etag).toBe('"0"');

    const blocked = await author.agent
      .post(`/api/v1/resources/${created.body.data.id}/publish`)
      .set("x-csrf-token", author.token)
      .set("if-match", '"0"')
      .send({ visibility: "GLOBAL", targetIds: [] });
    expect(blocked.status).toBe(403);
    expect(audits.some((entry) => entry.action === "security.access_denied")).toBe(true);

    const cohortAttempt = await author.agent
      .post(`/api/v1/resources/${created.body.data.id}/publish`)
      .set("x-csrf-token", author.token)
      .set("if-match", '"0"')
      .send({ visibility: "COHORT", targetIds: ["cohort"] });
    expect(cohortAttempt.status).toBe(403);

    const otherGroup = await author.agent
      .post(`/api/v1/resources/${created.body.data.id}/publish`)
      .set("x-csrf-token", author.token)
      .set("if-match", '"0"')
      .send({ visibility: "MENTOR_GROUP", targetIds: [plainMentor.id] });
    expect(otherGroup.status).toBe(403);

    const unassigned = await author.agent
      .post(`/api/v1/resources/${created.body.data.id}/publish`)
      .set("x-csrf-token", author.token)
      .set("if-match", '"0"')
      .send({ visibility: "INDIVIDUAL", targetIds: [outsider.id] });
    expect(unassigned.status).toBe(403);

    const ownStudent = await author.agent
      .post(`/api/v1/resources/${created.body.data.id}/publish`)
      .set("x-csrf-token", author.token)
      .set("if-match", '"0"')
      .send({ visibility: "INDIVIDUAL", targetIds: [student.id] });
    expect(ownStudent.status).toBe(200);
    expect(ownStudent.body.data.version).toBe(1);
    expect(audits.some((entry) => entry.action === "resource.published")).toBe(true);

    const ownGroup = await author.agent.post("/api/v1/resources").set("x-csrf-token", author.token).send({
      ...article,
      title: "Mentor notes",
    });
    const group = await author.agent
      .post(`/api/v1/resources/${ownGroup.body.data.id}/publish`)
      .set("x-csrf-token", author.token)
      .set("if-match", '"0"')
      .send({ visibility: "MENTOR_GROUP", targetIds: [mentor.id] });
    expect(group.status).toBe(200);

    const studentSession = await signIn(app, "ada@example.com");
    const visible = await studentSession.agent.get(`/api/v1/resources/${created.body.data.id}`);
    expect(visible.status).toBe(200);
    const groupVisible = await studentSession.agent.get(`/api/v1/resources/${ownGroup.body.data.id}`);
    expect(groupVisible.status).toBe(200);
    const outsiderSession = await signIn(app, "bea@example.com");
    const hidden = await outsiderSession.agent.get(`/api/v1/resources/${ownGroup.body.data.id}`);
    expect(hidden.status).toBe(403);
    const plainArchive = await signIn(app, "alan@example.com");
    const archive = await plainArchive.agent
      .post(`/api/v1/resources/${created.body.data.id}/archive`)
      .set("x-csrf-token", plainArchive.token)
      .set("if-match", `"${ownStudent.body.data.revision}"`);
    expect(archive.status).toBe(403);

    const anonymous = await request(app).get("/api/v1/resources");
    expect(anonymous.status).toBe(401);
    const studentCreate = await studentSession.agent.post("/api/v1/resources").set("x-csrf-token", studentSession.token).send(article);
    expect(studentCreate.status).toBe(403);
    const plain = await signIn(app, "alan@example.com");
    const plainCreate = await plain.agent.post("/api/v1/resources").set("x-csrf-token", plain.token).send(article);
    expect(plainCreate.status).toBe(403);
  });

  it("shows a student only the published scopes that include them", async () => {
    const { app, cohort, student, outsider } = await build();
    const admin = await signIn(app, "admin@example.com");
    const global = await admin.agent.post("/api/v1/resources").set("x-csrf-token", admin.token).send(article);
    await admin.agent
      .post(`/api/v1/resources/${global.body.data.id}/publish`)
      .set("x-csrf-token", admin.token)
      .set("if-match", '"0"')
      .send({ visibility: "GLOBAL", targetIds: [] });
    const cohortResource = await admin.agent
      .post("/api/v1/resources")
      .set("x-csrf-token", admin.token)
      .send({ ...article, title: "Cohort notes" });
    await admin.agent
      .post(`/api/v1/resources/${cohortResource.body.data.id}/publish`)
      .set("x-csrf-token", admin.token)
      .set("if-match", '"0"')
      .send({ visibility: "COHORT", targetIds: [cohort.id] });
    const personal = await admin.agent
      .post("/api/v1/resources")
      .set("x-csrf-token", admin.token)
      .send({
        ...article,
        title: "Practice",
        type: "CODING_EXERCISE",
        language: "python",
        testCases: [{ name: "adds", input: "1 2", expectedOutput: "3", hidden: false }],
      });
    await admin.agent
      .post(`/api/v1/resources/${personal.body.data.id}/publish`)
      .set("x-csrf-token", admin.token)
      .set("if-match", '"0"')
      .send({ visibility: "INDIVIDUAL", targetIds: [student.id] });

    const ada = await signIn(app, "ada@example.com");
    const list = await ada.agent.get("/api/v1/resources");
    expect(list.status).toBe(200);
    expect(list.body.data.map((item: { title: string }) => item.title).sort()).toEqual(["Arrays", "Cohort notes", "Practice"]);
    const practice = await ada.agent.get(`/api/v1/resources/${personal.body.data.id}`);
    expect(practice.status).toBe(200);
    expect(practice.body.data.testCases).toEqual([{ name: "adds", input: "1 2", hidden: false }]);
    expect(JSON.stringify(practice.body.data)).not.toContain("expectedOutput");

    const bea = await signIn(app, "bea@example.com");
    const beaList = await bea.agent.get("/api/v1/resources");
    expect(beaList.body.data.map((item: { title: string }) => item.title)).toEqual(["Arrays"]);
    const denied = await bea.agent.get(`/api/v1/resources/${cohortResource.body.data.id}`);
    expect(denied.status).toBe(403);
    const missing = await bea.agent.get("/api/v1/resources/missing-resource");
    expect(missing.status).toBe(403);
    const adminMissing = await admin.agent.get("/api/v1/resources/missing-resource");
    expect(adminMissing.status).toBe(404);
    void outsider;
  });

  it("increments the version of a published resource and hides it after archive", async () => {
    const { app, audits } = await build();
    const admin = await signIn(app, "admin@example.com");
    const created = await admin.agent.post("/api/v1/resources").set("x-csrf-token", admin.token).send(article);
    const draftEdit = await admin.agent
      .patch(`/api/v1/resources/${created.body.data.id}`)
      .set("x-csrf-token", admin.token)
      .set("if-match", '"0"')
      .send({ title: "Arrays, revised" });
    expect(draftEdit.status).toBe(200);
    expect(draftEdit.body.data.version).toBe(1);
    expect(draftEdit.body.data.revision).toBe(1);

    const published = await admin.agent
      .post(`/api/v1/resources/${created.body.data.id}/publish`)
      .set("x-csrf-token", admin.token)
      .set("if-match", '"1"')
      .send({ visibility: "GLOBAL", targetIds: [] });
    expect(published.body.data.version).toBe(1);

    const stale = await admin.agent
      .patch(`/api/v1/resources/${created.body.data.id}`)
      .set("x-csrf-token", admin.token)
      .set("if-match", '"1"')
      .send({ title: "Lost update" });
    expect(stale.status).toBe(409);

    const edited = await admin.agent
      .patch(`/api/v1/resources/${created.body.data.id}`)
      .set("x-csrf-token", admin.token)
      .set("if-match", `"${published.body.data.revision}"`)
      .send({ title: "Arrays, published revision" });
    expect(edited.status).toBe(200);
    expect(edited.body.data.version).toBe(2);

    const archived = await admin.agent
      .post(`/api/v1/resources/${created.body.data.id}/archive`)
      .set("x-csrf-token", admin.token)
      .set("if-match", `"${edited.body.data.revision}"`);
    expect(archived.status).toBe(200);
    expect(audits.some((entry) => entry.action === "resource.archived")).toBe(true);

    const student = await signIn(app, "ada@example.com");
    expect((await student.agent.get(`/api/v1/resources/${created.body.data.id}`)).status).toBe(403);
    expect((await student.agent.get("/api/v1/resources?status=ARCHIVED")).body.data).toEqual([]);
    expect((await admin.agent.get(`/api/v1/resources/${created.body.data.id}`)).status).toBe(200);
    const locked = await admin.agent
      .patch(`/api/v1/resources/${created.body.data.id}`)
      .set("x-csrf-token", admin.token)
      .set("if-match", `"${archived.body.data.revision}"`)
      .send({ title: "Too late" });
    expect(locked.status).toBe(409);
  });

  it("attaches a file only after storage confirms it, then issues a short-lived download", async () => {
    const { app, storage, student } = await build();
    const admin = await signIn(app, "admin@example.com");
    const created = await admin.agent.post("/api/v1/resources").set("x-csrf-token", admin.token).send(article);
    await admin.agent
      .post(`/api/v1/resources/${created.body.data.id}/publish`)
      .set("x-csrf-token", admin.token)
      .set("if-match", '"0"')
      .send({ visibility: "INDIVIDUAL", targetIds: [student.id] });

    const svg = await admin.agent.post("/api/v1/uploads").set("x-csrf-token", admin.token).send({
      fileName: "notes.svg",
      mimeType: "image/svg+xml",
      sizeBytes: 100,
    });
    expect(svg.status).toBe(400);
    const huge = await admin.agent.post("/api/v1/uploads").set("x-csrf-token", admin.token).send({
      fileName: "notes.pdf",
      mimeType: "application/pdf",
      sizeBytes: 20 * 1024 * 1024 + 1,
    });
    expect(huge.status).toBe(400);

    const slot = await admin.agent.post("/api/v1/uploads").set("x-csrf-token", admin.token).send({
      fileName: "notes.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1200,
    });
    expect(slot.status).toBe(201);
    expect(slot.body.data.method).toBe("PUT");
    const early = await admin.agent
      .post(`/api/v1/resources/${created.body.data.id}/attachments`)
      .set("x-csrf-token", admin.token)
      .set("if-match", '"1"')
      .send({ storageKey: slot.body.data.storageKey });
    expect(early.status).toBe(422);

    storage.complete(slot.body.data.storageKey as string, { sizeBytes: 50 });
    const mismatch = await admin.agent
      .post(`/api/v1/resources/${created.body.data.id}/attachments`)
      .set("x-csrf-token", admin.token)
      .set("if-match", '"1"')
      .send({ storageKey: slot.body.data.storageKey });
    expect(mismatch.status).toBe(422);

    storage.complete(slot.body.data.storageKey as string);
    const attached = await admin.agent
      .post(`/api/v1/resources/${created.body.data.id}/attachments`)
      .set("x-csrf-token", admin.token)
      .set("if-match", '"1"')
      .send({ storageKey: slot.body.data.storageKey });
    expect(attached.status).toBe(200);
    expect(attached.body.data.attachments[0].fileName).toBe("notes.pdf");
    expect(attached.body.data.version).toBe(2);

    const ada = await signIn(app, "ada@example.com");
    const download = await ada.agent.get(
      `/api/v1/resources/${created.body.data.id}/download?storageKey=${slot.body.data.storageKey}`,
    );
    expect(download.status).toBe(200);
    expect(download.body.data.url).toContain("storage.test/download");
    expect(Date.parse(download.body.data.expiresAt)).toBeGreaterThan(Date.now());

    const bea = await signIn(app, "bea@example.com");
    const denied = await bea.agent.get(
      `/api/v1/resources/${created.body.data.id}/download?storageKey=${slot.body.data.storageKey}`,
    );
    expect(denied.status).toBe(403);
  });
});
