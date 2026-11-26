import { describe, expect, it } from "vitest";
import { gradeSaved, manualTotal, scoreObjective, type GradeKey, type SnapshotQuestion } from "./grade.js";

const questions: SnapshotQuestion[] = [
  {
    questionId: "mcq",
    type: "MCQ",
    prompt: "Sum",
    options: [
      { id: "a", text: "3" },
      { id: "b", text: "4" },
    ],
    marks: 2,
    topic: "Arithmetic",
    difficulty: "BEGINNER",
    language: null,
    testCases: [],
  },
  {
    questionId: "multi",
    type: "MULTI_SELECT",
    prompt: "Even",
    options: [
      { id: "2", text: "2" },
      { id: "3", text: "3" },
      { id: "4", text: "4" },
    ],
    marks: 4,
    topic: "Arithmetic",
    difficulty: "BEGINNER",
    language: null,
    testCases: [],
  },
  {
    questionId: "short",
    type: "SHORT_ANSWER",
    prompt: "Why",
    options: [],
    marks: 3,
    topic: "Writing",
    difficulty: "BEGINNER",
    language: null,
    testCases: [],
  },
];

const keys: GradeKey[] = [
  { questionId: "mcq", optionIds: ["b"], text: null, testCases: [] },
  { questionId: "multi", optionIds: ["2", "4"], text: null, testCases: [] },
  { questionId: "short", optionIds: [], text: "because", testCases: [] },
];

describe("gradeSaved", () => {
  it("scores objective questions and leaves short answers for a person", () => {
    expect(scoreObjective("MCQ", 2, ["b"], "b")).toBe(2);
    expect(scoreObjective("MCQ", 2, ["b"], "a")).toBe(0);
    expect(scoreObjective("MULTI_SELECT", 4, ["4", "2"], ["2", "4"])).toBe(4);
    expect(scoreObjective("MULTI_SELECT", 4, ["2", "4"], ["2"])).toBe(0);
    const graded = gradeSaved(questions, keys, [
      { questionId: "mcq", value: "b" },
      { questionId: "multi", value: ["4", "2"] },
      { questionId: "short", value: "because" },
    ]);
    expect(graded).toEqual({ autoScore: 6, pendingManual: true });
  });

  it("accepts manual marks only for the manual questions and only within their marks", () => {
    expect(manualTotal(questions, [{ questionId: "short", awarded: 2 }])).toBe(2);
    expect(manualTotal(questions, [{ questionId: "short", awarded: 4 }])).toBe("invalid");
    expect(manualTotal(questions, [{ questionId: "mcq", awarded: 2 }])).toBe("invalid");
    expect(manualTotal(questions, [])).toBe("invalid");
  });
});
