import type { Difficulty, ResourceStatus, ResourceType, Role } from "@dhruva/shared";

export const TYPE_LABELS: Record<ResourceType, string> = {
  ARTICLE: "Article",
  VIDEO: "Video",
  PDF: "PDF",
  DOCUMENTATION: "Documentation",
  CODING_EXERCISE: "Coding exercise",
  QUIZ: "Quiz",
  PROJECT: "Project",
  EXTERNAL_LINK: "External link",
};

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  BEGINNER: "Beginner",
  INTERMEDIATE: "Intermediate",
  ADVANCED: "Advanced",
};

export const STATUS_LABELS: Record<ResourceStatus, string> = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
  ARCHIVED: "Archived",
};

export function libraryBase(role: Role | undefined): string {
  if (role === "ADMIN") {
    return "/admin/resources";
  }
  if (role === "MENTOR") {
    return "/mentor/resources";
  }
  return "/student/resources";
}

export const fieldClass =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function difficultyAccent(difficulty: Difficulty): string {
  if (difficulty === "BEGINNER") {
    return "border-l-emerald-700";
  }
  if (difficulty === "INTERMEDIATE") {
    return "border-l-amber-600";
  }
  return "border-l-rose-800";
}
