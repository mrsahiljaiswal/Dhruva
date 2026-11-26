import type { Difficulty, QuestionType } from "@dhruva/shared";

export type GradeKey = {
  questionId: string;
  optionIds: string[];
  text: string | null;
  testCases: { name: string; input: string; expectedOutput: string; hidden: boolean }[];
};

export type SnapshotQuestion = {
  questionId: string;
  type: QuestionType;
  prompt: string;
  options: { id: string; text: string }[];
  marks: number;
  topic: string;
  difficulty: Difficulty;
  language: string | null;
  testCases: { name: string; input: string; hidden: boolean }[];
};

export type SavedAnswer = {
  questionId: string;
  value: string | string[];
};

export function isManual(type: QuestionType): boolean {
  return type === "SHORT_ANSWER" || type === "CODING";
}

export function scoreObjective(
  type: QuestionType,
  marks: number,
  optionIds: string[],
  value: string | string[] | undefined,
): number {
  if (value === undefined) {
    return 0;
  }
  if (type === "MULTI_SELECT") {
    if (!Array.isArray(value)) {
      return 0;
    }
    const given = [...new Set(value)].sort();
    const expected = [...optionIds].sort();
    const match = given.length === expected.length && given.every((item, index) => item === expected[index]);
    return match ? marks : 0;
  }
  if (Array.isArray(value)) {
    return 0;
  }
  return optionIds.length === 1 && value === optionIds[0] ? marks : 0;
}

export function gradeSaved(
  questions: SnapshotQuestion[],
  keys: GradeKey[],
  answers: SavedAnswer[],
): { autoScore: number; pendingManual: boolean } {
  let autoScore = 0;
  let pendingManual = false;
  for (const question of questions) {
    if (isManual(question.type)) {
      pendingManual = true;
      continue;
    }
    const key = keys.find((item) => item.questionId === question.questionId);
    const answer = answers.find((item) => item.questionId === question.questionId);
    autoScore += scoreObjective(question.type, question.marks, key?.optionIds ?? [], answer?.value);
  }
  return { autoScore, pendingManual };
}

export function manualTotal(
  questions: SnapshotQuestion[],
  awards: { questionId: string; awarded: number }[],
): number | "invalid" {
  const manual = questions.filter((question) => isManual(question.type));
  const seen = new Set<string>();
  if (awards.length !== manual.length) {
    return "invalid";
  }
  let total = 0;
  for (const award of awards) {
    if (seen.has(award.questionId)) {
      return "invalid";
    }
    seen.add(award.questionId);
    const question = manual.find((item) => item.questionId === award.questionId);
    if (!question || award.awarded < 0 || award.awarded > question.marks) {
      return "invalid";
    }
    total += award.awarded;
  }
  return total;
}
