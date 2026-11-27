import type { LearningEventType } from "@dhruva/shared";
import type { DomainEvent, EventBus } from "../../events/bus.js";
import type { AnalyticsDeps } from "./rebuild.js";
import { rebuildProgress } from "./rebuild.js";

const EVENT_TYPES: Record<string, LearningEventType> = {
  "resource.opened": "RESOURCE_OPENED",
  "assignment.started": "ASSIGNMENT_STARTED",
  "submission.created": "SUBMISSION_MADE",
  "attempt.started": "ATTEMPT_STARTED",
  "attempt.graded": "ATTEMPT_GRADED",
  "doubt.asked": "DOUBT_ASKED",
};

const REF_TYPES: Record<LearningEventType, string> = {
  RESOURCE_OPENED: "Resource",
  ASSIGNMENT_STARTED: "Assignment",
  SUBMISSION_MADE: "Submission",
  ATTEMPT_STARTED: "AssessmentAttempt",
  ATTEMPT_GRADED: "AssessmentAttempt",
  DOUBT_ASKED: "DiscussionPost",
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function studentIds(event: DomainEvent): string[] {
  const after = event.after ?? {};
  const many = Array.isArray(after.studentIds) ? after.studentIds.filter((item): item is string => typeof item === "string") : [];
  const one = text(after.studentId) ?? text(after.authorId) ?? event.actorId ?? null;
  return [...new Set([...many, ...(one ? [one] : [])])];
}

export function registerProgressSubscriber(bus: EventBus, deps: AnalyticsDeps): void {
  const refresh = async (event: DomainEvent) => {
    const ids = studentIds(event);
    if (ids.length > 0) {
      await rebuildProgress(deps, ids);
    }
  };

  for (const [action, type] of Object.entries(EVENT_TYPES)) {
    bus.on(action, async (event) => {
      const ids = studentIds(event);
      const studentId = text(event.after?.studentId) ?? text(event.after?.authorId) ?? event.actorId ?? null;
      if (studentId) {
        const user = await deps.users.findById(studentId);
        if (user?.role === "STUDENT") {
          await deps.events.append({
            studentId,
            type,
            refType: REF_TYPES[type],
            refId: event.subjectId ?? text(event.after?.resourceId) ?? text(event.after?.assignmentId) ?? studentId,
            metadata: {},
            occurredAt: (deps.now ?? (() => new Date()))(),
          });
        }
      }
      if (ids.length > 0) {
        await rebuildProgress(deps, ids);
      }
    });
  }

  for (const action of ["submission.reviewed", "attempt.finalized", "assignment.published"]) {
    bus.on(action, refresh);
  }
}
