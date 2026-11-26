import type { Role } from "@dhruva/shared";
import type { AssignmentRepository } from "../mentors/assignments.js";
import type { WorkRepository } from "./work.js";

export async function grantedResourceIds(
  work: WorkRepository,
  mentors: AssignmentRepository,
  viewer: { id: string; role: Role },
): Promise<Set<string>> {
  if (viewer.role === "STUDENT") {
    return work.resourceIdsForStudents([viewer.id]);
  }
  if (viewer.role === "MENTOR") {
    const rows = await mentors.listActiveByMentor(viewer.id);
    return work.resourceIdsForStudents(rows.map((row) => row.studentId));
  }
  return new Set();
}
