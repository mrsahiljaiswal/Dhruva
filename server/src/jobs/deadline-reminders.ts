import { SETTLED_RECIPIENT_STATES } from "@dhruva/shared";
import type { AssignmentRepository } from "../modules/mentors/assignments.js";
import type { WorkRepository } from "../modules/learning/work.js";
import { utcDay } from "../modules/learning/state.js";
import { deliverNotification } from "../modules/notifications/dispatch.js";
import type { NotificationDeps } from "../modules/notifications/subscriber.js";
import type Agenda from "agenda";

const settled = new Set<string>(SETTLED_RECIPIENT_STATES);
const DAY_MS = 24 * 60 * 60 * 1000;

export async function remindDeadlines(
  deps: NotificationDeps & { work: WorkRepository; assignments: AssignmentRepository },
): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  const published = await deps.work.listPublished();
  const overdueByMentor = new Map<string, Set<string>>();

  for (const assignment of published) {
    const recipients = await deps.work.listRecipients(assignment.id);
    const dueIn = assignment.dueDate.getTime() - now.getTime();
    const upcoming = dueIn > 0 && dueIn <= DAY_MS;
    for (const recipient of recipients) {
      if (settled.has(recipient.state)) {
        continue;
      }
      if (upcoming) {
        await deliverNotification(deps, {
          userId: recipient.studentId,
          type: "DEADLINE_UPCOMING",
          text: `Due soon: ${assignment.title}`,
          payload: { assignmentId: assignment.id },
          dedupeKey: `due:${assignment.id}`,
          createdAt: now,
        });
      }
      if (dueIn < 0) {
        const active = await deps.assignments.findActiveByStudent(recipient.studentId);
        if (active) {
          const students = overdueByMentor.get(active.mentorId) ?? new Set<string>();
          students.add(recipient.studentId);
          overdueByMentor.set(active.mentorId, students);
        }
      }
    }
  }

  const day = utcDay(now);
  for (const [mentorId, students] of overdueByMentor) {
    const count = students.size;
    await deliverNotification(deps, {
      userId: mentorId,
      type: "DEADLINE_UPCOMING",
      text: count === 1 ? "1 assigned student has overdue work." : `${count} assigned students have overdue work.`,
      payload: { count: String(count) },
      dedupeKey: `overdue:${day}`,
      createdAt: now,
    });
  }
}

export function registerDeadlineJob(
  agenda: Agenda,
  deps: NotificationDeps & { work: WorkRepository; assignments: AssignmentRepository },
): void {
  agenda.define("deadline.reminders", async () => {
    await remindDeadlines(deps);
  });
}

export async function ensureDeadlineSchedule(agenda: Agenda): Promise<void> {
  const existing = await agenda.jobs({ name: "deadline.reminders" });
  if (existing.length === 0) {
    await agenda.every("1 hour", "deadline.reminders");
  }
}
