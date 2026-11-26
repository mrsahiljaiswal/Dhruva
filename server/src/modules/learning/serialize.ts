import type { AssignmentDefinition, LearningPathDetail, LearningPathSummary, RecipientView } from "@dhruva/shared";
import type { PathRecord } from "./paths.js";
import type { RecipientRecord, WorkRecord, WorkTestCase } from "./work.js";

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function visibleTests(cases: WorkTestCase[], reveal: boolean) {
  if (reveal) {
    return cases;
  }
  return cases.filter((item) => !item.hidden).map((item) => ({ name: item.name, input: item.input, hidden: false as const }));
}

export function summarizePath(path: PathRecord): LearningPathSummary {
  return {
    id: path.id,
    title: path.title,
    description: path.description,
    cohortId: path.cohortId,
    durationDays: path.durationDays,
    status: path.status,
    revision: path.revision,
    createdBy: path.createdBy,
    publishedAt: iso(path.publishedAt),
    updatedAt: path.updatedAt.toISOString(),
    moduleCount: path.modules.length,
  };
}

export function presentPath(path: PathRecord): LearningPathDetail {
  return {
    ...summarizePath(path),
    modules: path.modules.map((module) => ({
      id: module.id,
      order: module.order,
      title: module.title,
      weeks: module.weeks.map((week) => ({
        id: week.id,
        weekNumber: week.weekNumber,
        title: week.title,
        days: week.days.map((day) => ({
          id: day.id,
          dayNumber: day.dayNumber,
          title: day.title,
          items: day.items.map((item) => ({ ...item, title: null })),
        })),
      })),
    })),
  };
}

export function presentAssignment(assignment: WorkRecord, recipientCount: number): AssignmentDefinition {
  return {
    id: assignment.id,
    title: assignment.title,
    description: assignment.description,
    resourceId: assignment.resourceId,
    assignedBy: assignment.assignedBy,
    targetType: assignment.targetType,
    targetIds: assignment.targetIds,
    branches: assignment.branches,
    dueDate: assignment.dueDate.toISOString(),
    priority: assignment.priority,
    submissionType: assignment.submissionType,
    language: assignment.language,
    testCases: visibleTests(assignment.testCases, true),
    rubric: assignment.rubric,
    status: assignment.status,
    publishedAt: iso(assignment.publishedAt),
    revision: assignment.revision,
    recipientCount,
    updatedAt: assignment.updatedAt.toISOString(),
  };
}

export function presentRecipient(
  recipient: RecipientRecord,
  assignment: WorkRecord,
  overdue: boolean,
  revealTests: boolean,
): RecipientView {
  return {
    id: recipient.id,
    assignmentId: recipient.assignmentId,
    studentId: recipient.studentId,
    state: recipient.state,
    startedAt: iso(recipient.startedAt),
    submittedAt: iso(recipient.submittedAt),
    completedAt: iso(recipient.completedAt),
    score: recipient.score,
    overdue,
    assignment: {
      title: assignment.title,
      description: assignment.description,
      resourceId: assignment.resourceId,
      dueDate: assignment.dueDate.toISOString(),
      priority: assignment.priority,
      submissionType: assignment.submissionType,
      language: assignment.language,
      testCases: visibleTests(assignment.testCases, revealTests),
      rubric: assignment.rubric,
      status: assignment.status,
    },
  };
}
