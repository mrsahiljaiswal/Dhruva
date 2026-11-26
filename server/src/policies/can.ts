import type { Role, UserStatus } from "@dhruva/shared";
import type { Capabilities } from "@dhruva/shared";

export type AuthUser = {
  id: string;
  role: Role;
  status: UserStatus;
  capabilities: Capabilities;
};

export type Action =
  | "profile.view"
  | "profile.update"
  | "users.create"
  | "users.list"
  | "users.update"
  | "users.deactivate"
  | "users.reinvite"
  | "cohorts.view"
  | "cohorts.create"
  | "mentor.assign"
  | "resources.create"
  | "resources.upload"
  | "paths.view"
  | "paths.manage"
  | "assignments.view"
  | "assignments.create"
  | "assessments.create"
  | "assessments.publish"
  | "plan.view"
  | "settings.view"
  | "settings.update";

export type Subject = { type: "profile"; userId: string } | { type: "user" };

export function can(user: AuthUser, action: Action, subject?: Subject): boolean {
  if (user.status !== "ACTIVE") {
    return false;
  }

  if (
    action === "users.create" ||
    action === "users.list" ||
    action === "users.update" ||
    action === "users.deactivate" ||
    action === "users.reinvite" ||
    action === "cohorts.create" ||
    action === "mentor.assign"
  ) {
    return user.role === "ADMIN";
  }

  if (action === "cohorts.view") {
    return true;
  }

  if (action === "resources.create" || action === "resources.upload") {
    return user.role === "ADMIN" || (user.role === "MENTOR" && user.capabilities.canCreateResources);
  }

  if (action === "paths.view" || action === "assignments.view" || action === "assignments.create") {
    return user.role === "ADMIN" || user.role === "MENTOR";
  }

  if (action === "paths.manage") {
    return user.role === "ADMIN";
  }

  if (action === "assessments.create") {
    return user.role === "ADMIN" || (user.role === "MENTOR" && user.capabilities.canCreateAssessments);
  }

  if (action === "assessments.publish") {
    return user.role === "ADMIN";
  }

  if (action === "plan.view") {
    return user.role === "STUDENT";
  }

  if (action === "settings.view" || action === "settings.update") {
    return user.role === "ADMIN";
  }

  if (action === "profile.view" || action === "profile.update") {
    return subject?.type === "profile" && subject.userId === user.id;
  }

  return false;
}

export function canViewStudent(viewer: AuthUser, studentId: string, activeMentorId: string | null): boolean {
  if (viewer.status !== "ACTIVE") {
    return false;
  }
  if (viewer.role === "ADMIN" || viewer.id === studentId) {
    return true;
  }
  return viewer.role === "MENTOR" && activeMentorId === viewer.id;
}
