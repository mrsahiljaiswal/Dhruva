import type { ResourceStatus, Role, UserStatus, Visibility } from "@dhruva/shared";

export type ResourceViewer = {
  id: string;
  role: Role;
  status: UserStatus;
  cohortId: string | null;
  activeMentorId: string | null;
};

export type ResourceVisibility = {
  status: ResourceStatus;
  visibility: Visibility | null;
  targetIds: string[];
  createdBy: string;
};

function publishedToStudent(viewer: ResourceViewer, resource: ResourceVisibility): boolean {
  switch (resource.visibility) {
    case "GLOBAL":
      return true;
    case "COHORT":
      return viewer.cohortId !== null && resource.targetIds.includes(viewer.cohortId);
    case "MENTOR_GROUP":
      return viewer.activeMentorId !== null && resource.targetIds.includes(viewer.activeMentorId);
    case "INDIVIDUAL":
      return resource.targetIds.includes(viewer.id);
    default:
      return false;
  }
}

function publishedToMentor(viewer: ResourceViewer, resource: ResourceVisibility): boolean {
  switch (resource.visibility) {
    case "GLOBAL":
      return true;
    case "COHORT":
      return viewer.cohortId !== null && resource.targetIds.includes(viewer.cohortId);
    case "MENTOR_GROUP":
    case "INDIVIDUAL":
      return resource.targetIds.includes(viewer.id);
    default:
      return false;
  }
}

/**
 * The only check for whether a person may see a resource.
 * Lists, detail pages, download links, and the daily plan all call this.
 * `viaAssignment` is the recipient grant: assigned work opens the material
 * even when the resource's own scope would not. An archived resource stays
 * closed to everyone except an admin or its author.
 */
export function canViewResource(
  viewer: ResourceViewer,
  resource: ResourceVisibility,
  options?: { viaAssignment?: boolean },
): boolean {
  if (viewer.status !== "ACTIVE") {
    return false;
  }
  if (viewer.role === "ADMIN") {
    return true;
  }
  if (resource.createdBy === viewer.id) {
    return true;
  }
  if (resource.status === "ARCHIVED") {
    return false;
  }
  if (options?.viaAssignment && resource.status === "PUBLISHED") {
    return true;
  }
  if (resource.status !== "PUBLISHED") {
    return false;
  }
  if (viewer.role === "STUDENT") {
    return publishedToStudent(viewer, resource);
  }
  if (viewer.role === "MENTOR") {
    return publishedToMentor(viewer, resource);
  }
  return false;
}
