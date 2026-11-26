import type Agenda from "agenda";
import type { EventBus } from "../events/bus.js";
import type { AssignmentRepository } from "../modules/mentors/assignments.js";
import { resolveTargetStudents } from "../modules/learning/targets.js";
import type { WorkRepository } from "../modules/learning/work.js";
import type { UserRepository } from "../modules/users/repository.js";

export type ReconcileDeps = {
  work: WorkRepository;
  users: UserRepository;
  mentorAssignments: AssignmentRepository;
  bus?: EventBus;
};

export async function reconcileRecipients(deps: ReconcileDeps): Promise<{ assignmentId: string; studentIds: string[] }[]> {
  const published = await deps.work.listPublished();
  const added: { assignmentId: string; studentIds: string[] }[] = [];
  for (const assignment of published) {
    const students = await resolveTargetStudents(assignment, deps.users, deps.mentorAssignments);
    const studentIds = await deps.work.addMissing(
      assignment.id,
      students.map((student) => student.id),
    );
    if (studentIds.length === 0) {
      continue;
    }
    added.push({ assignmentId: assignment.id, studentIds });
    await deps.bus?.emit({
      action: "assignment.recipients_added",
      actorId: null,
      subjectType: "Assignment",
      subjectId: assignment.id,
      after: { studentIds },
    });
  }
  return added;
}

export function registerReconcileJob(agenda: Agenda, deps: ReconcileDeps): void {
  agenda.define("assignment.reconcile_recipients", async () => {
    await reconcileRecipients(deps);
  });
}

export async function ensureReconcileSchedule(agenda: Agenda): Promise<void> {
  const existing = await agenda.jobs({ name: "assignment.reconcile_recipients" });
  if (existing.length === 0) {
    await agenda.every("15 minutes", "assignment.reconcile_recipients");
  }
}
