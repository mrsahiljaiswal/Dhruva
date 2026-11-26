import type { DiscussionCategory } from "@dhruva/shared";

export const CATEGORY_LABELS: Record<DiscussionCategory, string> = {
  PROGRAMMING: "Programming Fundamentals",
  MATHEMATICS: "Mathematics",
  DSA: "DSA",
  BRANCH: "Engineering Branch Discussions",
  GENERAL: "General Doubts",
  ANNOUNCEMENTS: "Announcements",
};

export const fieldClass =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export const areaClass =
  "flex min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
