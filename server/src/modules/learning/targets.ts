import type { AssignmentTarget, Branch } from "@dhruva/shared";
import type { AssignmentRepository } from "../mentors/assignments.js";
import type { UserRecord, UserRepository } from "../users/repository.js";

export type TargetSpec = {
  targetType: AssignmentTarget;
  targetIds: string[];
  branches: Branch[];
};

export async function resolveTargetStudents(
  target: TargetSpec,
  users: UserRepository,
  mentors: AssignmentRepository,
): Promise<UserRecord[]> {
  const students = await users.list({ role: "STUDENT", status: "ACTIVE" });
  if (target.targetType === "COHORT") {
    const ids = new Set(target.targetIds);
    return students.filter((student) => student.cohortId !== null && ids.has(student.cohortId));
  }
  if (target.targetType === "BRANCH") {
    const cohorts = new Set(target.targetIds);
    const branches = new Set(target.branches);
    return students.filter(
      (student) =>
        student.cohortId !== null &&
        cohorts.has(student.cohortId) &&
        student.branch !== null &&
        branches.has(student.branch),
    );
  }
  if (target.targetType === "MENTOR_GROUP") {
    const studentIds = new Set<string>();
    for (const mentorId of target.targetIds) {
      const rows = await mentors.listActiveByMentor(mentorId);
      for (const row of rows) {
        studentIds.add(row.studentId);
      }
    }
    return students.filter((student) => studentIds.has(student.id));
  }
  const ids = new Set(target.targetIds);
  return students.filter((student) => ids.has(student.id));
}
