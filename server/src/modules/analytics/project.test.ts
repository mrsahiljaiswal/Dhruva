import { DEFAULT_SUPPORT_THRESHOLDS } from "@dhruva/shared";
import { describe, expect, it } from "vitest";
import type { AttemptRecord } from "../assessments/repository.js";
import type { RecipientRecord, WorkRecord } from "../learning/work.js";
import { completionPct, projectStudent } from "./project.js";

const now = new Date("2026-11-26T12:00:00.000Z");

function assignment(id: string, dueDate: string): WorkRecord {
  return {
    id,
    title: id,
    description: "",
    resourceId: null,
    assignedBy: "admin",
    targetType: "INDIVIDUAL",
    targetIds: ["student"],
    branches: [],
    dueDate: new Date(dueDate),
    priority: "NORMAL",
    submissionType: "TEXT",
    language: null,
    testCases: [],
    rubric: [],
    status: "PUBLISHED",
    publishedAt: new Date("2026-11-01T00:00:00.000Z"),
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function recipient(id: string, assignmentId: string, state: RecipientRecord["state"]): RecipientRecord {
  return {
    id,
    assignmentId,
    studentId: "student",
    state,
    startedAt: null,
    submittedAt: null,
    completedAt: state === "COMPLETED" ? now : null,
    score: null,
  };
}

describe("progress projection", () => {
  it("counts completed, pending, and overdue separately from assessment scores", () => {
    expect(completionPct(1, 2)).toBe(50);
    expect(completionPct(0, 0)).toBeNull();
    const done = assignment("done", "2026-11-01T00:00:00.000Z");
    const late = assignment("late", "2026-11-01T00:00:00.000Z");
    const attempt = {
      id: "attempt",
      assessmentId: "quiz",
      studentId: "student",
      attemptNo: 1,
      assessmentVersion: 1,
      questionSnapshot: [
        {
          questionId: "q1",
          type: "MCQ",
          prompt: "?",
          options: [],
          marks: 10,
          topic: "Arrays",
          difficulty: "BEGINNER",
          language: null,
          testCases: [],
        },
      ],
      gradingKeys: [],
      answers: [],
      startedAt: now,
      expiresAt: now,
      submittedAt: now,
      status: "GRADED",
      autoScore: 8,
      manualScore: 0,
      totalScore: 8,
      pendingManual: false,
      gradedBy: null,
      idempotencyKey: null,
      bodyHash: null,
    } as AttemptRecord;
    const projected = projectStudent({
      studentId: "student",
      now,
      thresholds: { ...DEFAULT_SUPPORT_THRESHOLDS },
      recipients: [recipient("r1", done.id, "COMPLETED"), recipient("r2", late.id, "NOT_STARTED")],
      assignments: new Map([
        [done.id, done],
        [late.id, late],
      ]),
      topics: new Map(),
      attempts: [attempt],
      assessments: new Map([["quiz", { totalMarks: 10, passingMarks: 5 }]]),
      events: [
        {
          id: "event",
          studentId: "student",
          type: "RESOURCE_OPENED",
          refType: "Resource",
          refId: "resource",
          metadata: {},
          occurredAt: now,
        },
      ],
      feedback: [
        {
          recipientId: "r1",
          studentId: "student",
          feedback: "Clear write-up.",
          reviewedAt: now,
          score: 9,
        },
      ],
    });
    expect(projected.assignedCount).toBe(2);
    expect(projected.completedCount).toBe(1);
    expect(projected.overdueCount).toBe(1);
    expect(projected.pendingCount).toBe(0);
    expect(projected.completionPct).toBe(50);
    expect(projected.averageScore).toBe(80);
    expect(projected.topicScores.find((topic) => topic.topic === "Arrays")?.averageScore).toBe(80);
    expect(projected.recentFeedback[0]?.feedback).toBe("Clear write-up.");
    expect(projected.weeklyActiveDays).toBe(1);
    expect(projected.supportIndicator).toBe("NEEDS_ATTENTION");
  });
});
