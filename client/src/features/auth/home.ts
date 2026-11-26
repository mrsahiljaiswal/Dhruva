import type { Role } from "@dhruva/shared";

export function homeFor(role: Role): string {
  if (role === "ADMIN") {
    return "/admin/dashboard";
  }
  if (role === "MENTOR") {
    return "/mentor/dashboard";
  }
  return "/student/dashboard";
}
