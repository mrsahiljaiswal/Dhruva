import type { SupportIndicator, SupportThresholds } from "@dhruva/shared";

export type IndicatorInput = {
  assignedCount: number;
  completionPct: number | null;
  averageScore: number | null;
  overdueCount: number;
  openWork: boolean;
  daysSinceActivity: number | null;
  thresholds: SupportThresholds;
};

export type IndicatorResult = {
  supportIndicator: SupportIndicator;
  supportReasons: string[];
};

function pct(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function supportIndicator(input: IndicatorInput): IndicatorResult {
  const { thresholds } = input;
  const intervention: string[] = [];
  const attention: string[] = [];

  if (input.assignedCount > 0 && input.completionPct !== null) {
    if (input.completionPct < thresholds.interventionCompletionPct) {
      intervention.push(
        `Assignment completion is ${pct(input.completionPct)}%, below the mentor-intervention threshold of ${pct(thresholds.interventionCompletionPct)}%.`,
      );
    } else if (input.completionPct < thresholds.attentionCompletionPct) {
      attention.push(
        `Assignment completion is ${pct(input.completionPct)}%, below the needs-attention threshold of ${pct(thresholds.attentionCompletionPct)}%.`,
      );
    }
  }

  if (input.averageScore !== null) {
    if (input.averageScore < thresholds.interventionAverageScore) {
      intervention.push(
        `Assessment average is ${pct(input.averageScore)}%, below the mentor-intervention threshold of ${pct(thresholds.interventionAverageScore)}%.`,
      );
    } else if (input.averageScore < thresholds.attentionAverageScore) {
      attention.push(
        `Assessment average is ${pct(input.averageScore)}%, below the needs-attention threshold of ${pct(thresholds.attentionAverageScore)}%.`,
      );
    }
  }

  if (input.overdueCount >= thresholds.interventionOverdueCount && thresholds.interventionOverdueCount > 0) {
    intervention.push(
      `${input.overdueCount} assignment${input.overdueCount === 1 ? " is" : "s are"} overdue, which meets the mentor-intervention threshold of ${thresholds.interventionOverdueCount}.`,
    );
  } else if (input.overdueCount >= thresholds.attentionOverdueCount && thresholds.attentionOverdueCount > 0) {
    attention.push(
      `${input.overdueCount} assignment${input.overdueCount === 1 ? " is" : "s are"} overdue, which meets the needs-attention threshold of ${thresholds.attentionOverdueCount}.`,
    );
  }

  if (
    input.openWork &&
    input.daysSinceActivity !== null &&
    input.daysSinceActivity >= thresholds.inactiveDays
  ) {
    attention.push(
      input.daysSinceActivity === 0
        ? "No learning activity yet."
        : `No learning activity for ${input.daysSinceActivity} days, past the ${thresholds.inactiveDays}-day attention window.`,
    );
  }

  if (intervention.length > 0) {
    return { supportIndicator: "MENTOR_INTERVENTION", supportReasons: [...intervention, ...attention] };
  }
  if (attention.length > 0) {
    return { supportIndicator: "NEEDS_ATTENTION", supportReasons: attention };
  }
  if (input.assignedCount === 0 && input.averageScore === null) {
    return { supportIndicator: "ON_TRACK", supportReasons: ["No assigned work yet."] };
  }
  return {
    supportIndicator: "ON_TRACK",
    supportReasons: ["Assignment completion and assessment scores are inside the configured thresholds."],
  };
}
