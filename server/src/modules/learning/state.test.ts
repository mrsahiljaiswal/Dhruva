import { describe, expect, it } from "vitest";
import { canTransition, dayOffset, isOverdue, utcDay } from "./state.js";

describe("recipient state", () => {
  it("computes overdue from the due date and leaves settled work alone", () => {
    const due = new Date("2026-11-01T00:00:00.000Z");
    const after = new Date("2026-11-02T00:00:00.000Z");
    expect(isOverdue(due, "NOT_STARTED", after)).toBe(true);
    expect(isOverdue(due, "IN_PROGRESS", after)).toBe(true);
    expect(isOverdue(due, "REVISION_REQUESTED", after)).toBe(true);
    expect(isOverdue(due, "SUBMITTED", after)).toBe(false);
    expect(isOverdue(due, "UNDER_REVIEW", after)).toBe(false);
    expect(isOverdue(due, "COMPLETED", after)).toBe(false);
    expect(isOverdue(due, "NOT_STARTED", due)).toBe(false);
  });

  it("allows only the drawn transitions", () => {
    expect(canTransition("NOT_STARTED", "IN_PROGRESS")).toBe(true);
    expect(canTransition("IN_PROGRESS", "SUBMITTED")).toBe(true);
    expect(canTransition("SUBMITTED", "UNDER_REVIEW")).toBe(true);
    expect(canTransition("UNDER_REVIEW", "COMPLETED")).toBe(true);
    expect(canTransition("UNDER_REVIEW", "REVISION_REQUESTED")).toBe(true);
    expect(canTransition("REVISION_REQUESTED", "SUBMITTED")).toBe(true);
    expect(canTransition("NOT_STARTED", "SUBMITTED")).toBe(false);
    expect(canTransition("COMPLETED", "IN_PROGRESS")).toBe(false);
    expect(canTransition("SUBMITTED", "COMPLETED")).toBe(false);
  });

  it("counts calendar days from a cohort start in UTC", () => {
    expect(utcDay(new Date("2026-08-01T18:00:00.000Z"))).toBe("2026-08-01");
    expect(dayOffset(new Date("2026-08-01T00:00:00.000Z"), "2026-08-01")).toBe(0);
    expect(dayOffset(new Date("2026-08-01T00:00:00.000Z"), "2026-08-03")).toBe(2);
    expect(dayOffset(new Date("2026-08-01T00:00:00.000Z"), "2026-07-31")).toBe(-1);
  });
});
