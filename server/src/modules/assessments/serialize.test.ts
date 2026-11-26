import { describe, expect, it } from "vitest";
import type { AttemptRecord } from "./repository.js";
import { presentAttempt } from "./serialize.js";

const secret = "secret-output";
const expectedText = "photosynthesis";

function attempt(): AttemptRecord {
  return {
    id: "attempt-1",
    assessmentId: "assessment-1",
    studentId: "student-1",
    attemptNo: 1,
    assessmentVersion: 1,
    questionSnapshot: [
      {
        questionId: "q-short",
        type: "SHORT_ANSWER",
        prompt: "Name the process.",
        options: [],
        marks: 3,
        topic: "Biology",
        difficulty: "BEGINNER",
        language: null,
        testCases: [],
      },
      {
        questionId: "q-code",
        type: "CODING",
        prompt: "Return the sum.",
        options: [],
        marks: 5,
        topic: "Functions",
        difficulty: "BEGINNER",
        language: "python",
        testCases: [
          { name: "sample", input: "1 1", hidden: false },
          { name: "hidden", input: "9", hidden: true },
        ],
      },
    ],
    gradingKeys: [
      { questionId: "q-short", optionIds: [], text: expectedText, testCases: [] },
      {
        questionId: "q-code",
        optionIds: [],
        text: null,
        testCases: [
          { name: "sample", input: "1 1", expectedOutput: "2", hidden: false },
          { name: "hidden", input: "9", expectedOutput: secret, hidden: true },
        ],
      },
    ],
    answers: [],
    startedAt: new Date("2026-08-01T12:00:00.000Z"),
    expiresAt: new Date("2026-08-01T12:30:00.000Z"),
    submittedAt: null,
    status: "IN_PROGRESS",
    autoScore: null,
    manualScore: null,
    totalScore: null,
    pendingManual: false,
    gradedBy: null,
    idempotencyKey: null,
    bodyHash: null,
  };
}

const assessment = {
  id: "assessment-1",
  title: "Weekly quiz",
  passingMarks: 1,
  answersReleaseAt: new Date("2026-08-03T00:00:00.000Z"),
};

describe("presentAttempt", () => {
  it("keeps answer keys and expected outputs off the payload before the release time", () => {
    const body = presentAttempt(attempt(), assessment, new Date("2026-08-01T12:10:00.000Z"));
    const encoded = JSON.stringify(body);
    expect(body.answersReleased).toBe(false);
    expect(encoded).not.toContain("answerKey");
    expect(encoded).not.toContain(expectedText);
    expect(encoded).not.toContain(secret);
    expect(encoded).not.toContain("expectedOutput");
    const coding = body.questions.find((question) => question.questionId === "q-code");
    expect(coding?.testCases).toEqual([{ name: "sample", input: "1 1", hidden: false }]);
  });

  it("includes the answer key only once the release time has passed", () => {
    const body = presentAttempt(attempt(), assessment, new Date("2026-08-03T00:00:00.000Z"));
    expect(body.answersReleased).toBe(true);
    const encoded = JSON.stringify(body);
    expect(encoded).toContain(expectedText);
    expect(encoded).toContain(secret);
    expect(body.questions.find((question) => question.questionId === "q-short")?.answerKey).toEqual({
      optionIds: [],
      text: expectedText,
    });
  });

  it("never releases answers when the assessment has no release time", () => {
    const body = presentAttempt(attempt(), { ...assessment, answersReleaseAt: null }, new Date("2027-01-01T00:00:00.000Z"));
    expect(body.answersReleased).toBe(false);
    expect(JSON.stringify(body)).not.toContain(expectedText);
  });
});
