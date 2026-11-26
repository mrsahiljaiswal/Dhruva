import { describe, expect, it } from "vitest";
import { pino } from "pino";
import { createMemoryAssignmentRepository } from "../modules/mentors/assignments.js";
import { createMemoryWorkRepository } from "../modules/learning/work.js";
import { createMemoryNotificationRepository } from "../modules/notifications/repository.js";
import { createMemoryPreferenceRepository } from "../modules/notifications/preferences.js";
import { createMemoryUserRepository } from "../modules/users/repository.js";
import { noopDelivery } from "../realtime/delivery.js";
import { remindDeadlines } from "./deadline-reminders.js";

const logger = pino({ level: "silent" });

describe("deadline reminders", () => {
  it("notifies a student once about an upcoming deadline and a mentor about overdue work", async () => {
    const users = createMemoryUserRepository();
    const student = await users.create({
      name: "Ada",
      email: "ada@example.com",
      passwordHash: null,
      role: "STUDENT",
      branch: "CSE",
      cohortId: null,
      status: "ACTIVE",
      capabilities: { canCreateResources: false, canCreateAssessments: false, canGradeAssessments: false },
      invitedAt: null,
      activatedAt: new Date(),
    });
    const mentor = await users.create({
      name: "Grace",
      email: "grace@example.com",
      passwordHash: null,
      role: "MENTOR",
      branch: null,
      cohortId: null,
      status: "ACTIVE",
      capabilities: { canCreateResources: false, canCreateAssessments: false, canGradeAssessments: false },
      invitedAt: null,
      activatedAt: new Date(),
    });
    const assignments = createMemoryAssignmentRepository();
    await assignments.create({
      mentorId: mentor.id,
      studentId: student.id,
      assignedBy: mentor.id,
      status: "ACTIVE",
      startDate: new Date("2026-11-01T00:00:00.000Z"),
      endDate: null,
      endReason: null,
    });
    const work = createMemoryWorkRepository();
    const soon = await work.create({
      title: "Arrays",
      description: "Practice",
      resourceId: null,
      targetType: "INDIVIDUAL",
      targetIds: [student.id],
      branches: [],
      dueDate: new Date("2026-11-26T18:00:00.000Z"),
      priority: "NORMAL",
      submissionType: "TEXT",
      language: null,
      testCases: [],
      rubric: [],
      assignedBy: mentor.id,
    });
    await work.publish(soon.id, 0, new Date("2026-11-20T00:00:00.000Z"), [student.id]);
    const late = await work.create({
      title: "Sorting",
      description: "Practice",
      resourceId: null,
      targetType: "INDIVIDUAL",
      targetIds: [student.id],
      branches: [],
      dueDate: new Date("2026-11-20T00:00:00.000Z"),
      priority: "NORMAL",
      submissionType: "TEXT",
      language: null,
      testCases: [],
      rubric: [],
      assignedBy: mentor.id,
    });
    await work.publish(late.id, 0, new Date("2026-11-01T00:00:00.000Z"), [student.id]);

    const notifications = createMemoryNotificationRepository();
    const deps = {
      users,
      notifications,
      preferences: createMemoryPreferenceRepository(),
      delivery: noopDelivery,
      logger,
      work,
      assignments,
      now: () => new Date("2026-11-26T08:00:00.000Z"),
    };
    await remindDeadlines(deps);
    await remindDeadlines(deps);

    const ada = await notifications.listForUser(student.id, 10);
    expect(ada.rows).toEqual([expect.objectContaining({ type: "DEADLINE_UPCOMING", text: "Due soon: Arrays" })]);
    const grace = await notifications.listForUser(mentor.id, 10);
    expect(grace.rows).toEqual([expect.objectContaining({ type: "DEADLINE_UPCOMING", text: "1 assigned student has overdue work." })]);
  });
});
