import type { SupportThresholds } from "@dhruva/shared";
import type { AttemptRecord } from "../assessments/repository.js";
import { isOverdue } from "../learning/state.js";
import type { RecipientRecord, WorkRecord } from "../learning/work.js";
import { supportIndicator } from "./indicator.js";
import type { LearningEventRecord, ProgressRecord, TopicScore } from "./repository.js";

export type FeedbackSource = {
  recipientId: string;
  studentId: string;
  feedback: string;
  reviewedAt: Date;
  score: number | null;
};

const DAY_MS = 86_400_000;

export function completionPct(completed: number, assigned: number): number | null {
  if (assigned === 0) {
    return null;
  }
  return Math.round((completed / assigned) * 1000) / 10;
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function utcDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function daysSince(now: Date, earlier: Date): number {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = Date.UTC(earlier.getUTCFullYear(), earlier.getUTCMonth(), earlier.getUTCDate());
  return Math.max(0, Math.round((end - start) / DAY_MS));
}

function weekWindow(now: Date, events: LearningEventRecord[]): { date: string; active: boolean }[] {
  const active = new Set(events.map((event) => utcDate(event.occurredAt)));
  const days: { date: string; active: boolean }[] = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset));
    const date = utcDate(day);
    days.push({ date, active: active.has(date) });
  }
  return days;
}

function scoredAttempts(attempts: AttemptRecord[], assessments: Map<string, { totalMarks: number }>): number[] {
  const latest = new Map<string, AttemptRecord>();
  for (const attempt of attempts) {
    if (attempt.totalScore === null || attempt.status === "IN_PROGRESS") {
      continue;
    }
    const current = latest.get(attempt.assessmentId);
    if (!current || current.startedAt.getTime() <= attempt.startedAt.getTime()) {
      latest.set(attempt.assessmentId, attempt);
    }
  }
  const scores: number[] = [];
  for (const attempt of latest.values()) {
    const assessment = assessments.get(attempt.assessmentId);
    if (!assessment || assessment.totalMarks <= 0 || attempt.totalScore === null) {
      continue;
    }
    scores.push((attempt.totalScore / assessment.totalMarks) * 100);
  }
  return scores;
}

export function projectStudent(input: {
  studentId: string;
  now: Date;
  thresholds: SupportThresholds;
  recipients: RecipientRecord[];
  assignments: Map<string, WorkRecord>;
  topics: Map<string, string>;
  attempts: AttemptRecord[];
  assessments: Map<string, { totalMarks: number; passingMarks: number }>;
  events: LearningEventRecord[];
  feedback: FeedbackSource[];
}): ProgressRecord {
  let completedCount = 0;
  let overdueCount = 0;
  const topicAssigned = new Map<string, { assigned: number; completed: number }>();
  let earliestOpen: Date | null = null;

  for (const recipient of input.recipients) {
    const assignment = input.assignments.get(recipient.assignmentId);
    const topic = (assignment?.resourceId && input.topics.get(assignment.resourceId)) || "General";
    const bucket = topicAssigned.get(topic) ?? { assigned: 0, completed: 0 };
    bucket.assigned += 1;
    const completed = recipient.state === "COMPLETED";
    if (completed) {
      completedCount += 1;
      bucket.completed += 1;
    } else if (assignment && isOverdue(assignment.dueDate, recipient.state, input.now)) {
      overdueCount += 1;
    }
    topicAssigned.set(topic, bucket);
    if (!completed && assignment?.publishedAt && (!earliestOpen || assignment.publishedAt < earliestOpen)) {
      earliestOpen = assignment.publishedAt;
    }
  }

  const assignedCount = input.recipients.length;
  const pendingCount = Math.max(0, assignedCount - completedCount - overdueCount);
  const scoreValues = scoredAttempts(input.attempts, input.assessments);
  const averageScore = average(scoreValues);
  const topicScoresMap = new Map<string, number[]>();
  for (const attempt of input.attempts) {
    if (attempt.totalScore === null || attempt.status === "IN_PROGRESS") {
      continue;
    }
    const assessment = input.assessments.get(attempt.assessmentId);
    if (!assessment || assessment.totalMarks <= 0) {
      continue;
    }
    const pct = (attempt.totalScore / assessment.totalMarks) * 100;
    const topics = new Set(attempt.questionSnapshot.map((question) => question.topic).filter((topic) => topic.length > 0));
    for (const topic of topics) {
      const current = topicScoresMap.get(topic) ?? [];
      current.push(pct);
      topicScoresMap.set(topic, current);
    }
  }

  const topicNames = new Set([...topicAssigned.keys(), ...topicScoresMap.keys()]);
  const topicScores: TopicScore[] = [...topicNames]
    .sort()
    .map((topic) => {
      const counts = topicAssigned.get(topic) ?? { assigned: 0, completed: 0 };
      return {
        topic,
        assignedCount: counts.assigned,
        completedCount: counts.completed,
        completionPct: completionPct(counts.completed, counts.assigned),
        averageScore: average(topicScoresMap.get(topic) ?? []),
      };
    });

  const week = weekWindow(input.now, input.events);
  const lastEvent = input.events.reduce<Date | null>((latest, event) => {
    if (!latest || event.occurredAt > latest) {
      return event.occurredAt;
    }
    return latest;
  }, null);
  const openWork = assignedCount - completedCount > 0;
  const activityAnchor = lastEvent ?? earliestOpen;
  const daysSinceActivity = openWork && activityAnchor ? daysSince(input.now, activityAnchor) : null;
  const indicator = supportIndicator({
    assignedCount,
    completionPct: completionPct(completedCount, assignedCount),
    averageScore,
    overdueCount,
    openWork,
    daysSinceActivity,
    thresholds: input.thresholds,
  });

  const recentFeedback = input.feedback
    .filter((row) => row.studentId === input.studentId && row.feedback.trim().length > 0)
    .sort((left, right) => right.reviewedAt.getTime() - left.reviewedAt.getTime())
    .slice(0, 5)
    .map((row) => ({
      assignmentTitle: input.assignments.get(
        input.recipients.find((recipient) => recipient.id === row.recipientId)?.assignmentId ?? "",
      )?.title ?? "Assignment",
      feedback: row.feedback,
      reviewedAt: row.reviewedAt.toISOString(),
      score: row.score,
    }));

  return {
    studentId: input.studentId,
    assignedCount,
    completedCount,
    pendingCount,
    overdueCount,
    completionPct: completionPct(completedCount, assignedCount),
    averageScore,
    topicScores,
    weeklyActiveDays: week.filter((day) => day.active).length,
    week,
    recentFeedback,
    supportIndicator: indicator.supportIndicator,
    supportReasons: indicator.supportReasons,
    computedAt: input.now,
  };
}
