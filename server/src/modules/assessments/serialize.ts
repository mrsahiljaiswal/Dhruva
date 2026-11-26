import type { AssessmentSummary, AttemptDetail, AttemptQuestion, AttemptSummary, Question } from "@dhruva/shared";
import type { GradeKey, SnapshotQuestion } from "./grade.js";
import type { AssessmentRecord, AttemptRecord, QuestionRecord } from "./repository.js";

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function answersAreReleased(releaseAt: Date | null, now: Date): boolean {
  return releaseAt !== null && now.getTime() >= releaseAt.getTime();
}

export function presentQuestion(row: QuestionRecord): Question {
  return {
    id: row.id,
    type: row.type,
    prompt: row.prompt,
    options: row.options.map((option) => ({ ...option })),
    answerKey: { optionIds: [...row.answerKey.optionIds], text: row.answerKey.text },
    marks: row.marks,
    topic: row.topic,
    difficulty: row.difficulty,
    language: row.language,
    testCases: row.testCases.map((item) => ({ ...item })),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function presentSittingQuestion(question: SnapshotQuestion, key: GradeKey | undefined, released: boolean): AttemptQuestion {
  const source = released ? (key?.testCases ?? []) : (key?.testCases ?? []).filter((item) => !item.hidden);
  const testCases = source.map((item) =>
    released
      ? { name: item.name, input: item.input, expectedOutput: item.expectedOutput, hidden: item.hidden }
      : { name: item.name, input: item.input, hidden: item.hidden },
  );
  const served: AttemptQuestion = {
    questionId: question.questionId,
    type: question.type,
    prompt: question.prompt,
    options: question.options.map((option) => ({ ...option })),
    marks: question.marks,
    topic: question.topic,
    difficulty: question.difficulty,
    language: question.language,
    testCases,
  };
  if (!released || !key) {
    return served;
  }
  return {
    ...served,
    answerKey: { optionIds: [...key.optionIds], text: key.text },
  };
}

export function presentAttempt(
  attempt: AttemptRecord,
  assessment: { id: string; title: string; passingMarks: number; answersReleaseAt: Date | null },
  now: Date,
): AttemptDetail {
  const released = answersAreReleased(assessment.answersReleaseAt, now);
  return {
    id: attempt.id,
    assessmentId: assessment.id,
    assessmentTitle: assessment.title,
    studentId: attempt.studentId,
    attemptNo: attempt.attemptNo,
    assessmentVersion: attempt.assessmentVersion,
    questions: attempt.questionSnapshot.map((question) =>
      presentSittingQuestion(
        question,
        attempt.gradingKeys.find((key) => key.questionId === question.questionId),
        released,
      ),
    ),
    answers: attempt.answers.map((answer) => ({
      questionId: answer.questionId,
      value: Array.isArray(answer.value) ? [...answer.value] : answer.value,
      autoSavedAt: answer.autoSavedAt.toISOString(),
    })),
    startedAt: attempt.startedAt.toISOString(),
    expiresAt: attempt.expiresAt.toISOString(),
    submittedAt: iso(attempt.submittedAt),
    status: attempt.status,
    autoScore: attempt.autoScore,
    manualScore: attempt.manualScore,
    totalScore: attempt.totalScore,
    gradedBy: attempt.gradedBy,
    answersReleased: released,
    passingMarks: assessment.passingMarks,
    pendingManual: attempt.pendingManual,
  };
}

export function presentAssessment(
  assessment: AssessmentRecord,
  attempts: AttemptRecord[],
  attemptsUsed: number,
  names: Map<string, string>,
): AssessmentSummary {
  return {
    id: assessment.id,
    title: assessment.title,
    description: assessment.description,
    questionIds: [...assessment.questionIds],
    durationMin: assessment.durationMin,
    totalMarks: assessment.totalMarks,
    passingMarks: assessment.passingMarks,
    attemptsAllowed: assessment.attemptsAllowed,
    attemptsUsed,
    availableFrom: assessment.availableFrom.toISOString(),
    availableUntil: assessment.availableUntil.toISOString(),
    answersReleaseAt: iso(assessment.answersReleaseAt),
    targetType: assessment.targetType,
    targetIds: [...assessment.targetIds],
    branches: [...assessment.branches],
    status: assessment.status,
    version: assessment.version,
    createdBy: assessment.createdBy,
    publishedAt: iso(assessment.publishedAt),
    updatedAt: assessment.updatedAt.toISOString(),
    attempts: attempts.map((attempt) => presentAttemptSummary(attempt, names.get(attempt.studentId) ?? "Student")),
  };
}

export function presentAttemptSummary(
  attempt: AttemptRecord,
  studentName: string,
): AttemptSummary {
  return {
    id: attempt.id,
    studentId: attempt.studentId,
    studentName,
    attemptNo: attempt.attemptNo,
    status: attempt.status,
    startedAt: attempt.startedAt.toISOString(),
    expiresAt: attempt.expiresAt.toISOString(),
    submittedAt: iso(attempt.submittedAt),
    autoScore: attempt.autoScore,
    manualScore: attempt.manualScore,
    totalScore: attempt.totalScore,
    pendingManual: attempt.pendingManual,
  };
}
