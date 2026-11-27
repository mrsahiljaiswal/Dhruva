import { SUPPORT_INDICATOR_NOTE, type SupportThresholds } from "@dhruva/shared";
import type { AssessmentRecord, AssessmentRepository, AttemptRecord } from "../assessments/repository.js";
import type { CohortRepository } from "../cohorts/repository.js";
import type { DiscussionRepository, PostRecord } from "../discussions/repository.js";
import type { WorkRecord, WorkRepository } from "../learning/work.js";
import type { AssignmentRepository } from "../mentors/assignments.js";
import type { Mailer } from "../../platform/mail.js";
import type { ResourceRecord, ResourceRepository } from "../resources/repository.js";
import type { SettingsRepository } from "../settings/repository.js";
import type { SubmissionRepository } from "../submissions/repository.js";
import type { UserRecord, UserRepository } from "../users/repository.js";
import { completionPct, projectStudent, type FeedbackSource } from "./project.js";
import type { ExportRecord, ExportRepository, LearningEventRepository, ProgressRecord, ProgressRepository } from "./repository.js";

const PENDING_REVIEW = new Set(["SUBMITTED", "UNDER_REVIEW"]);
const FILE_TTL_MS = 24 * 60 * 60 * 1000;
const LINK_TTL_MS = 15 * 60 * 1000;

export type AnalyticsDeps = {
  users: UserRepository;
  cohorts: CohortRepository;
  mentorAssignments: AssignmentRepository;
  work: WorkRepository;
  resources: ResourceRepository;
  assessments: AssessmentRepository;
  revisions: SubmissionRepository;
  discussions: DiscussionRepository;
  settings: SettingsRepository;
  progress: ProgressRepository;
  events: LearningEventRepository;
  exports: ExportRepository;
  mailer?: Mailer;
  appBaseUrl?: string;
  now?: () => Date;
};

type Bundle = {
  now: Date;
  thresholds: SupportThresholds;
  users: UserRecord[];
  cohorts: { id: string; name: string }[];
  assignments: Map<string, WorkRecord>;
  resources: ResourceRecord[];
  topics: Map<string, string>;
  assessments: Map<string, AssessmentRecord>;
  attempts: AttemptRecord[];
  events: Awaited<ReturnType<LearningEventRepository["listAll"]>>;
  feedback: FeedbackSource[];
  doubts: PostRecord[];
  recipients: Awaited<ReturnType<WorkRepository["listRecipientsForStudents"]>>;
  progress: ProgressRecord[];
};

function clock(deps: AnalyticsDeps): Date {
  return (deps.now ?? (() => new Date()))();
}

function mean(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function weekStart(date: Date): string {
  const day = date.getUTCDay() || 7;
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day + 1));
  return monday.toISOString().slice(0, 10);
}

async function openDoubts(discussions: DiscussionRepository): Promise<PostRecord[]> {
  const rows: PostRecord[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const batch = await discussions.listPosts({ scope: "RESOURCE", status: "OPEN", page, limit: 100 });
    rows.push(...batch.rows);
    if (batch.rows.length === 0 || rows.length >= batch.total) {
      break;
    }
  }
  return rows.filter((post) => post.replyCount === 0 && !post.deletedAt);
}

async function loadBundle(deps: AnalyticsDeps, studentIds?: string[]): Promise<Bundle> {
  const now = clock(deps);
  const settings = await deps.settings.get();
  const users = await deps.users.list();
  const students = users.filter((user) => user.role === "STUDENT" && (!studentIds || studentIds.includes(user.id)));
  const [cohorts, work, resources, assessmentRows, attempts, events, revisions, doubts] = await Promise.all([
    deps.cohorts.list(),
    deps.work.list(),
    deps.resources.list(),
    deps.assessments.listAssessments(),
    deps.assessments.listAttempts(),
    deps.events.listAll(),
    deps.revisions.listWithFeedback(),
    openDoubts(deps.discussions),
  ]);
  const recipients = await deps.work.listRecipientsForStudents(students.map((student) => student.id));
  const assignments = new Map(work.map((row) => [row.id, row]));
  const topics = new Map(resources.map((resource) => [resource.id, resource.topic]));
  const assessments = new Map(assessmentRows.map((row) => [row.id, row]));
  const feedback: FeedbackSource[] = revisions
    .filter((row) => row.feedback && row.reviewedAt)
    .map((row) => ({
      recipientId: row.recipientId,
      studentId: row.studentId,
      feedback: row.feedback ?? "",
      reviewedAt: row.reviewedAt ?? now,
      score: row.score,
    }));
  const progress = students.map((student) =>
    projectStudent({
      studentId: student.id,
      now,
      thresholds: settings.supportThresholds,
      recipients: recipients.filter((row) => row.studentId === student.id),
      assignments,
      topics,
      attempts: attempts.filter((row) => row.studentId === student.id),
      assessments,
      events: events.filter((row) => row.studentId === student.id),
      feedback,
    }),
  );
  for (const record of progress) {
    await deps.progress.save(record);
  }
  return {
    now,
    thresholds: settings.supportThresholds,
    users,
    cohorts,
    assignments,
    resources,
    topics,
    assessments,
    attempts,
    events,
    feedback,
    doubts,
    recipients,
    progress,
  };
}

export async function rebuildProgress(deps: AnalyticsDeps, studentIds?: string[]): Promise<ProgressRecord[]> {
  const bundle = await loadBundle(deps, studentIds);
  return bundle.progress;
}

function studentMap(users: UserRecord[]): Map<string, UserRecord> {
  return new Map(users.filter((user) => user.role === "STUDENT").map((user) => [user.id, user]));
}

function needing(record: ProgressRecord): boolean {
  return record.supportIndicator !== "ON_TRACK";
}

export async function studentProgress(deps: AnalyticsDeps, studentId: string): Promise<ProgressRecord | null> {
  const user = await deps.users.findById(studentId);
  if (!user || user.role !== "STUDENT") {
    return null;
  }
  const [record] = await rebuildProgress(deps, [studentId]);
  return record ?? null;
}

export async function mentorDashboard(deps: AnalyticsDeps, mentorId: string) {
  const links = await deps.mentorAssignments.listActiveByMentor(mentorId);
  const studentIds = links.map((link) => link.studentId);
  const bundle = await loadBundle(deps, studentIds);
  const people = studentMap(bundle.users);
  const rows = bundle.progress.filter((record) => studentIds.includes(record.studentId));
  const recipientIds = new Set(bundle.recipients.map((row) => row.studentId));
  const pendingSubmissions = bundle.recipients.filter(
    (row) => recipientIds.has(row.studentId) && PENDING_REVIEW.has(row.state),
  ).length;
  const authors = new Set(studentIds);
  const unansweredDoubts = bundle.doubts.filter((post) => authors.has(post.authorId)).length;
  const trends = new Map<string, number[]>();
  for (let index = 7; index >= 0; index -= 1) {
    const day = new Date(Date.UTC(bundle.now.getUTCFullYear(), bundle.now.getUTCMonth(), bundle.now.getUTCDate() - index * 7));
    trends.set(weekStart(day), []);
  }
  for (const attempt of bundle.attempts) {
    if (!authors.has(attempt.studentId) || attempt.totalScore === null || attempt.status === "IN_PROGRESS") {
      continue;
    }
    const assessment = bundle.assessments.get(attempt.assessmentId);
    if (!assessment || assessment.totalMarks <= 0) {
      continue;
    }
    const key = weekStart(attempt.startedAt);
    if (!trends.has(key)) {
      continue;
    }
    trends.get(key)?.push((attempt.totalScore / assessment.totalMarks) * 100);
  }
  const assigned = rows.reduce((sum, row) => sum + row.assignedCount, 0);
  const completed = rows.reduce((sum, row) => sum + row.completedCount, 0);
  return {
    assignedStudents: studentIds.length,
    completionPct: completionPct(completed, assigned),
    pendingSubmissions,
    unansweredDoubts,
    needingSupport: rows.filter(needing).length,
    assessmentTrends: [...trends.entries()].map(([week, scores]) => ({
      week,
      averagePct: mean(scores),
      attempts: scores.length,
    })),
    students: rows.map((row) => {
      const person = people.get(row.studentId);
      return {
        id: row.studentId,
        name: person?.name ?? "Student",
        branch: person?.branch ?? null,
        completionPct: row.completionPct,
        averageScore: row.averageScore,
        pendingCount: row.pendingCount,
        overdueCount: row.overdueCount,
        supportIndicator: row.supportIndicator,
        supportReasons: row.supportReasons,
      };
    }),
    thresholds: bundle.thresholds,
    supportNote: SUPPORT_INDICATOR_NOTE,
  };
}

export async function adminOverview(deps: AnalyticsDeps) {
  const bundle = await loadBundle(deps);
  const students = bundle.users.filter((user) => user.role === "STUDENT");
  const mentors = bundle.users.filter((user) => user.role === "MENTOR");
  const people = studentMap(bundle.users);
  const byStudent = new Map(bundle.progress.map((row) => [row.studentId, row]));
  const mentorWorkload = [];
  for (const mentor of mentors) {
    const links = await deps.mentorAssignments.listActiveByMentor(mentor.id);
    const ids = new Set(links.map((link) => link.studentId));
    const pendingSubmissions = bundle.recipients.filter((row) => ids.has(row.studentId) && PENDING_REVIEW.has(row.state)).length;
    mentorWorkload.push({
      mentorId: mentor.id,
      name: mentor.name,
      students: links.length,
      pendingSubmissions,
      needingSupport: [...ids].filter((id) => {
        const row = byStudent.get(id);
        return row ? needing(row) : false;
      }).length,
    });
  }
  const cohorts = bundle.cohorts.map((cohort) => {
    const members = students.filter((student) => student.cohortId === cohort.id);
    const rows = members.flatMap((student) => {
      const row = byStudent.get(student.id);
      return row ? [row] : [];
    });
    return {
      cohortId: cohort.id,
      name: cohort.name,
      students: members.length,
      completionPct: completionPct(
        rows.reduce((sum, row) => sum + row.completedCount, 0),
        rows.reduce((sum, row) => sum + row.assignedCount, 0),
      ),
      averageScore: mean(rows.flatMap((row) => (row.averageScore === null ? [] : [row.averageScore]))),
      needingSupport: rows.filter(needing).length,
    };
  });
  const branchNames = [...new Set(students.flatMap((student) => (student.branch ? [student.branch] : [])))];
  const branches = branchNames.map((branch) => {
    const members = students.filter((student) => student.branch === branch);
    const rows = members.flatMap((student) => {
      const row = byStudent.get(student.id);
      return row ? [row] : [];
    });
    return {
      branch,
      students: members.length,
      completionPct: completionPct(
        rows.reduce((sum, row) => sum + row.completedCount, 0),
        rows.reduce((sum, row) => sum + row.assignedCount, 0),
      ),
      averageScore: mean(rows.flatMap((row) => (row.averageScore === null ? [] : [row.averageScore]))),
      needingSupport: rows.filter(needing).length,
    };
  });
  const topicStudents = new Map<string, ProgressRecord[]>();
  for (const row of bundle.progress) {
    for (const topic of row.topicScores) {
      const current = topicStudents.get(topic.topic) ?? [];
      current.push(row);
      topicStudents.set(topic.topic, current);
    }
  }
  const topics = [...topicStudents.entries()].map(([topic, rows]) => {
    const scores = rows.flatMap((row) => {
      const match = row.topicScores.find((item) => item.topic === topic);
      return match?.averageScore === null || match?.averageScore === undefined ? [] : [match.averageScore];
    });
    const assigned = rows.reduce((sum, row) => sum + (row.topicScores.find((item) => item.topic === topic)?.assignedCount ?? 0), 0);
    const completed = rows.reduce((sum, row) => sum + (row.topicScores.find((item) => item.topic === topic)?.completedCount ?? 0), 0);
    return { topic, students: rows.length, completionPct: completionPct(completed, assigned), averageScore: mean(scores) };
  });
  const assessments = [...bundle.assessments.values()]
    .filter((assessment) => assessment.status === "PUBLISHED")
    .map((assessment) => {
      const attempts = bundle.attempts.filter(
        (attempt) => attempt.assessmentId === assessment.id && attempt.totalScore !== null && attempt.status !== "IN_PROGRESS",
      );
      const percentages = attempts.map((attempt) => (attempt.totalScore ?? 0) / assessment.totalMarks * 100);
      const passed = attempts.filter((attempt) => (attempt.totalScore ?? 0) >= assessment.passingMarks).length;
      return {
        assessmentId: assessment.id,
        title: assessment.title,
        attempts: attempts.length,
        averagePct: mean(percentages),
        passRate: attempts.length === 0 ? null : Math.round((passed / attempts.length) * 1000) / 10,
      };
    });
  const publishedResources = bundle.resources.filter((resource) => resource.status === "PUBLISHED");
  const opened = new Set(
    bundle.events
      .filter((event) => event.type === "RESOURCE_OPENED" && publishedResources.some((resource) => resource.id === event.refId))
      .map((event) => event.refId),
  );
  return {
    totals: {
      users: bundle.users.length,
      students: students.length,
      mentors: mentors.length,
      admins: bundle.users.filter((user) => user.role === "ADMIN").length,
      activeUsers: bundle.users.filter((user) => user.status === "ACTIVE").length,
      cohorts: bundle.cohorts.length,
      publishedResources: publishedResources.length,
      publishedAssignments: [...bundle.assignments.values()].filter((row) => row.status === "PUBLISHED").length,
      publishedAssessments: [...bundle.assessments.values()].filter((row) => row.status === "PUBLISHED").length,
    },
    mentorWorkload,
    cohorts,
    branches,
    topics,
    assessments,
    resourceCompletion: {
      published: publishedResources.length,
      opened: opened.size,
      completionPct: completionPct(opened.size, publishedResources.length),
    },
    flagged: bundle.progress.filter(needing).map((row) => {
      const person = people.get(row.studentId);
      return {
        studentId: row.studentId,
        name: person?.name ?? "Student",
        branch: person?.branch ?? null,
        cohortId: person?.cohortId ?? null,
        supportIndicator: row.supportIndicator,
        supportReasons: row.supportReasons,
      };
    }),
    thresholds: bundle.thresholds,
    supportNote: SUPPORT_INDICATOR_NOTE,
  };
}

function cell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function csv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((row) => row.map(cell).join(",")).join("\n");
}

async function renderExport(deps: AnalyticsDeps, job: ExportRecord, bundle: Bundle): Promise<string> {
  const students = bundle.users.filter((user) => user.role === "STUDENT" && (!job.cohortId || user.cohortId === job.cohortId));
  const progress = new Map(bundle.progress.map((row) => [row.studentId, row]));
  const cohortName = new Map(bundle.cohorts.map((cohort) => [cohort.id, cohort.name]));
  if (job.kind === "STUDENT_PROGRESS") {
    return csv([
      ["name", "email", "branch", "cohort", "assigned", "completed", "pending", "overdue", "completionPct", "averageScore", "supportIndicator"],
      ...students.map((student) => {
        const row = progress.get(student.id);
        return [
          student.name,
          student.email,
          student.branch,
          student.cohortId ? cohortName.get(student.cohortId) ?? "" : "",
          row?.assignedCount ?? 0,
          row?.completedCount ?? 0,
          row?.pendingCount ?? 0,
          row?.overdueCount ?? 0,
          row?.completionPct ?? "",
          row?.averageScore ?? "",
          row?.supportIndicator ?? "",
        ];
      }),
    ]);
  }
  if (job.kind === "MENTOR_ALLOCATION") {
    const mentors = bundle.users.filter((user) => user.role === "MENTOR");
    const lines: (string | number | null)[][] = [["mentor", "student", "email", "branch", "cohort", "status"]];
    for (const mentor of mentors) {
      const links = await deps.mentorAssignments.listActiveByMentor(mentor.id);
      for (const link of links) {
        const student = students.find((person) => person.id === link.studentId);
        if (!student && job.cohortId) {
          continue;
        }
        const person = bundle.users.find((user) => user.id === link.studentId);
        lines.push([
          mentor.name,
          person?.name ?? "",
          person?.email ?? "",
          person?.branch ?? "",
          person?.cohortId ? cohortName.get(person.cohortId) ?? "" : "",
          link.status,
        ]);
      }
    }
    return csv(lines);
  }
  if (job.kind === "ASSESSMENTS") {
    const allowed = new Set(students.map((student) => student.id));
    const lines: (string | number | null)[][] = [["assessment", "student", "attempt", "status", "score", "total", "percentage"]];
    for (const attempt of bundle.attempts) {
      if (!allowed.has(attempt.studentId)) {
        continue;
      }
      const assessment = bundle.assessments.get(attempt.assessmentId);
      const person = bundle.users.find((user) => user.id === attempt.studentId);
      const percentage =
        assessment && assessment.totalMarks > 0 && attempt.totalScore !== null
          ? Math.round((attempt.totalScore / assessment.totalMarks) * 1000) / 10
          : "";
      lines.push([
        assessment?.title ?? attempt.assessmentId,
        person?.name ?? "",
        attempt.attemptNo,
        attempt.status,
        attempt.totalScore,
        assessment?.totalMarks ?? "",
        percentage,
      ]);
    }
    return csv(lines);
  }
  const overview = await adminOverview(deps);
  return csv([
    ["cohort", "students", "completionPct", "averageScore", "needingSupport"],
    ...overview.cohorts
      .filter((cohort) => !job.cohortId || cohort.cohortId === job.cohortId)
      .map((cohort) => [cohort.name, cohort.students, cohort.completionPct, cohort.averageScore, cohort.needingSupport]),
  ]);
}

export async function generateExport(deps: AnalyticsDeps, id: string): Promise<void> {
  const job = await deps.exports.find(id);
  if (!job || job.status !== "PENDING") {
    return;
  }
  try {
    const bundle = await loadBundle(deps);
    const content = await renderExport(deps, job, bundle);
    const expiresAt = new Date(clock(deps).getTime() + FILE_TTL_MS);
    await deps.exports.markReady(id, content, expiresAt);
    if (deps.mailer) {
      const requester = await deps.users.findById(job.requestedBy);
      if (requester) {
        const link = `${deps.appBaseUrl ?? ""}/api/v1/exports/${id}`;
        await deps.mailer.send({
          to: requester.email,
          subject: "Your Dhruva report is ready",
          text: `The ${job.kind} report is ready. Open ${link} while signed in to download it. The file expires within a day, and each download link lasts 15 minutes.`,
        });
      }
    }
  } catch {
    await deps.exports.markFailed(id, "The export failed.");
  }
}

export async function requestExport(
  deps: AnalyticsDeps,
  input: { requestedBy: string; kind: ExportRecord["kind"]; cohortId: string | null },
  enqueue: (id: string) => Promise<void>,
): Promise<ExportRecord> {
  const created = await deps.exports.insert({ ...input, createdAt: clock(deps) });
  await enqueue(created.id);
  return (await deps.exports.find(created.id)) ?? created;
}

export function downloadPath(id: string, token: string): string {
  return `/api/v1/exports/${id}/download?token=${token}`;
}

export async function mintExportLink(deps: AnalyticsDeps, record: ExportRecord): Promise<{ url: string | null; expiresAt: string | null }> {
  if (record.status !== "READY") {
    return { url: null, expiresAt: null };
  }
  if (record.expiresAt && record.expiresAt.getTime() <= clock(deps).getTime()) {
    return { url: null, expiresAt: null };
  }
  const minted = await deps.exports.mintDownload(record.id, new Date(clock(deps).getTime() + LINK_TTL_MS));
  if (!minted) {
    return { url: null, expiresAt: null };
  }
  return { url: downloadPath(record.id, minted.token), expiresAt: minted.record.downloadExpiresAt?.toISOString() ?? null };
}
