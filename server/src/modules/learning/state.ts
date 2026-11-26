import { SETTLED_RECIPIENT_STATES, type RecipientState } from "@dhruva/shared";

const settled = new Set<string>(SETTLED_RECIPIENT_STATES);

const next: Record<RecipientState, readonly RecipientState[]> = {
  NOT_STARTED: ["IN_PROGRESS"],
  IN_PROGRESS: ["SUBMITTED"],
  SUBMITTED: ["UNDER_REVIEW"],
  UNDER_REVIEW: ["REVISION_REQUESTED", "COMPLETED"],
  REVISION_REQUESTED: ["SUBMITTED"],
  COMPLETED: [],
};

export function isOverdue(dueDate: Date, state: RecipientState, now: Date): boolean {
  return !settled.has(state) && dueDate.getTime() < now.getTime();
}

export function canTransition(from: RecipientState, to: RecipientState): boolean {
  return next[from].includes(to);
}

export function utcDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function dayOffset(origin: Date, day: string): number {
  const start = Date.UTC(origin.getUTCFullYear(), origin.getUTCMonth(), origin.getUTCDate());
  const [year, month, date] = day.split("-").map(Number);
  const target = Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1);
  return Math.round((target - start) / 86_400_000);
}
