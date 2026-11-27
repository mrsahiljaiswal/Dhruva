import { DEFAULT_SUPPORT_THRESHOLDS } from "@dhruva/shared";
import { describe, expect, it } from "vitest";
import { supportIndicator } from "./indicator.js";

const thresholds = { ...DEFAULT_SUPPORT_THRESHOLDS };

describe("support indicators", () => {
  it("stays on track when there is no assigned work and no score", () => {
    const result = supportIndicator({
      assignedCount: 0,
      completionPct: null,
      averageScore: null,
      overdueCount: 0,
      openWork: false,
      daysSinceActivity: null,
      thresholds,
    });
    expect(result.supportIndicator).toBe("ON_TRACK");
    expect(result.supportReasons).toEqual(["No assigned work yet."]);
  });

  it("keeps assignment completion and assessment scores as separate signals", () => {
    const completion = supportIndicator({
      assignedCount: 4,
      completionPct: 100,
      averageScore: 30,
      overdueCount: 0,
      openWork: false,
      daysSinceActivity: null,
      thresholds,
    });
    expect(completion.supportIndicator).toBe("MENTOR_INTERVENTION");
    expect(completion.supportReasons.some((reason) => reason.includes("Assessment average"))).toBe(true);
    expect(completion.supportReasons.some((reason) => reason.includes("Assignment completion"))).toBe(false);

    const quiet = supportIndicator({
      assignedCount: 4,
      completionPct: 25,
      averageScore: 90,
      overdueCount: 0,
      openWork: true,
      daysSinceActivity: 1,
      thresholds,
    });
    expect(quiet.supportIndicator).toBe("MENTOR_INTERVENTION");
    expect(quiet.supportReasons.some((reason) => reason.includes("Assignment completion"))).toBe(true);
    expect(quiet.supportReasons.some((reason) => reason.includes("Assessment average"))).toBe(false);
  });

  it("uses the stronger matching threshold and explains it", () => {
    const attention = supportIndicator({
      assignedCount: 2,
      completionPct: 50,
      averageScore: 80,
      overdueCount: 1,
      openWork: true,
      daysSinceActivity: 1,
      thresholds,
    });
    expect(attention.supportIndicator).toBe("NEEDS_ATTENTION");
    expect(attention.supportReasons.join(" ")).toContain("50%");

    const intervention = supportIndicator({
      assignedCount: 2,
      completionPct: 50,
      averageScore: 80,
      overdueCount: 3,
      openWork: true,
      daysSinceActivity: 1,
      thresholds,
    });
    expect(intervention.supportIndicator).toBe("MENTOR_INTERVENTION");
  });

  it("flags a long gap while work is still open", () => {
    const result = supportIndicator({
      assignedCount: 1,
      completionPct: 0,
      averageScore: null,
      overdueCount: 0,
      openWork: true,
      daysSinceActivity: 9,
      thresholds,
    });
    expect(result.supportIndicator).toBe("MENTOR_INTERVENTION");
    expect(result.supportReasons.some((reason) => reason.includes("9 days"))).toBe(true);
  });
});
