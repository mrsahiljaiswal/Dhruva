import { describe, expect, it } from "vitest";
import { createMemoryAssignmentRepository } from "../modules/mentors/assignments.js";
import { createMemoryUserRepository } from "../modules/users/repository.js";
import { createMemoryWorkRepository } from "../modules/learning/work.js";
import { reconcileRecipients } from "./reconcile-recipients.js";

describe("reconcileRecipients", () => {
  it("adds students who match a published target and skips a second run", async () => {
    const users = createMemoryUserRepository();
    const mentors = createMemoryAssignmentRepository();
    const work = createMemoryWorkRepository();
    const ada = await users.create({
      name: "Ada",
      email: "ada@example.com",
      passwordHash: null,
      role: "STUDENT",
      branch: "CSE",
      cohortId: "cohort-1",
      status: "ACTIVE",
      capabilities: { canCreateResources: false, canCreateAssessments: false, canGradeAssessments: false },
      invitedAt: null,
      activatedAt: new Date(),
    });
    const assignment = await work.create({
      title: "Lab",
      description: "",
      resourceId: null,
      assignedBy: "admin",
      targetType: "COHORT",
      targetIds: ["cohort-1"],
      branches: [],
      dueDate: new Date("2026-09-01T00:00:00.000Z"),
      priority: "NORMAL",
      submissionType: "TEXT",
      language: null,
      testCases: [],
      rubric: [],
    });
    await work.publish(assignment.id, 0, new Date(), [ada.id]);
    const quiet = await reconcileRecipients({ work, users, mentorAssignments: mentors });
    expect(quiet).toEqual([]);
    const cam = await users.create({
      name: "Cam",
      email: "cam@example.com",
      passwordHash: null,
      role: "STUDENT",
      branch: "CSE",
      cohortId: "cohort-1",
      status: "ACTIVE",
      capabilities: { canCreateResources: false, canCreateAssessments: false, canGradeAssessments: false },
      invitedAt: null,
      activatedAt: new Date(),
    });
    const added = await reconcileRecipients({ work, users, mentorAssignments: mentors });
    expect(added).toEqual([{ assignmentId: assignment.id, studentIds: [cam.id] }]);
    expect(await reconcileRecipients({ work, users, mentorAssignments: mentors })).toEqual([]);
    expect(await work.listRecipients(assignment.id)).toHaveLength(2);
  });
});
