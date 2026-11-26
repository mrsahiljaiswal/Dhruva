import type Agenda from "agenda";
import type { EventBus } from "../events/bus.js";
import type { AssessmentRepository } from "../modules/assessments/repository.js";
import { createAssessmentService } from "../modules/assessments/service.js";
import type { CohortRepository } from "../modules/cohorts/repository.js";
import type { AssignmentRepository } from "../modules/mentors/assignments.js";
import { codeExecutionOff, type CodeRunner, type ExecutionGate } from "../modules/submissions/runner.js";
import type { UserRepository } from "../modules/users/repository.js";

export type ExpireDeps = {
  users: UserRepository;
  cohorts: CohortRepository;
  mentorAssignments: AssignmentRepository;
  assessments: AssessmentRepository;
  bus: EventBus;
  runner?: CodeRunner;
  execution?: ExecutionGate;
  now?: () => Date;
};

export function registerExpireJob(agenda: Agenda, deps: ExpireDeps): void {
  const runner = deps.runner ?? { mode: "manual" as const, async run() { return { status: "pending_review" as const, cases: [] }; } };
  const assessments = createAssessmentService({
    users: deps.users,
    cohorts: deps.cohorts,
    mentorAssignments: deps.mentorAssignments,
    assessments: deps.assessments,
    bus: deps.bus,
    runner,
    execution: deps.execution ?? codeExecutionOff,
    now: deps.now,
  });
  agenda.define("attempt.expire", async () => {
    await assessments.expireDue();
  });
}

export async function ensureExpireSchedule(agenda: Agenda): Promise<void> {
  const existing = await agenda.jobs({ name: "attempt.expire" });
  if (existing.length === 0) {
    await agenda.every("1 minute", "attempt.expire");
  }
}
