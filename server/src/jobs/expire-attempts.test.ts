import { describe, expect, it } from "vitest";
import { createAssessmentService } from "../modules/assessments/service.js";
import { createMemoryAssessmentRepository } from "../modules/assessments/repository.js";
import { createMemoryCohortRepository } from "../modules/cohorts/repository.js";
import { EventBus } from "../events/bus.js";
import { createMemoryAssignmentRepository } from "../modules/mentors/assignments.js";
import { codeExecutionOff } from "../modules/submissions/runner.js";
import { createMemoryUserRepository } from "../modules/users/repository.js";
import { pino } from "pino";

describe("expire attempts", () => {
  it("finalizes an open attempt from the saved answers and does not run twice", async () => {
    const assessments = createMemoryAssessmentRepository();
    const bus = new EventBus(pino({ level: "silent" }));
    const events: string[] = [];
    bus.on("attempt.finalized", () => {
      events.push("attempt.finalized");
    });
    const question = await assessments.insertQuestion({
      type: "MCQ",
      prompt: "What is 2 + 2?",
      options: [
        { id: "a", text: "3" },
        { id: "b", text: "4" },
      ],
      answerKey: { optionIds: ["b"], text: null },
      marks: 2,
      topic: "Arithmetic",
      difficulty: "BEGINNER",
      language: null,
      testCases: [],
      createdBy: "admin",
    });
    const inserted = await assessments.insertAttempt({
      assessmentId: "assessment-1",
      studentId: "student-1",
      attemptNo: 1,
      assessmentVersion: 1,
      questionSnapshot: [
        {
          questionId: question.id,
          type: "MCQ",
          prompt: question.prompt,
          options: question.options,
          marks: 2,
          topic: "Arithmetic",
          difficulty: "BEGINNER",
          language: null,
          testCases: [],
        },
      ],
      gradingKeys: [{ questionId: question.id, optionIds: ["b"], text: null, testCases: [] }],
      startedAt: new Date("2026-08-01T12:00:00.000Z"),
      expiresAt: new Date("2026-08-01T12:30:00.000Z"),
    });
    if (inserted.kind !== "created") {
      throw new Error("attempt was not created");
    }
    await assessments.saveAnswers(inserted.attempt.id, [
      { questionId: question.id, value: "b", autoSavedAt: new Date("2026-08-01T12:10:00.000Z") },
    ]);
    const service = createAssessmentService({
      users: createMemoryUserRepository(),
      cohorts: createMemoryCohortRepository(),
      mentorAssignments: createMemoryAssignmentRepository(),
      assessments,
      bus,
      runner: { mode: "manual", async run() { return { status: "pending_review", cases: [] }; } },
      execution: codeExecutionOff,
      now: () => new Date("2026-08-01T12:31:00.000Z"),
    });
    const first = await service.expireDue();
    expect(first).toEqual([inserted.attempt.id]);
    const stored = await assessments.findAttempt(inserted.attempt.id);
    expect(stored?.status).toBe("EXPIRED");
    expect(stored?.autoScore).toBe(2);
    expect(stored?.submittedAt).toBeNull();
    expect(events).toEqual(["attempt.finalized"]);
    expect(await service.expireDue()).toEqual([]);
    expect(events).toEqual(["attempt.finalized"]);
  });
});
