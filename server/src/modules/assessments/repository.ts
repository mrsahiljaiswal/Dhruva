import type {
  AnswerKey,
  AssignmentTarget,
  AttemptStatus,
  Branch,
  Difficulty,
  QuestionType,
  ResourceStatus,
} from "@dhruva/shared";
import { randomUUID } from "node:crypto";
import mongoose, { Schema } from "mongoose";
import type { GradeKey, SnapshotQuestion } from "./grade.js";

export type QuestionRecord = {
  id: string;
  type: QuestionType;
  prompt: string;
  options: { id: string; text: string }[];
  answerKey: AnswerKey;
  marks: number;
  topic: string;
  difficulty: Difficulty;
  language: string | null;
  testCases: { name: string; input: string; expectedOutput: string; hidden: boolean }[];
  createdBy: string;
  updatedAt: Date;
};

export type NewQuestion = Omit<QuestionRecord, "id" | "updatedAt">;

export type QuestionQuery = {
  page: number;
  limit: number;
  topic?: string;
  type?: QuestionType;
  q?: string;
};

export type AssessmentRecord = {
  id: string;
  title: string;
  description: string;
  questionIds: string[];
  durationMin: number;
  totalMarks: number;
  passingMarks: number;
  attemptsAllowed: number;
  availableFrom: Date;
  availableUntil: Date;
  answersReleaseAt: Date | null;
  targetType: AssignmentTarget;
  targetIds: string[];
  branches: Branch[];
  status: ResourceStatus;
  version: number;
  createdBy: string;
  publishedAt: Date | null;
  updatedAt: Date;
};

export type NewAssessment = Omit<AssessmentRecord, "id" | "status" | "version" | "publishedAt" | "updatedAt">;

export type AssessmentPatch = Omit<NewAssessment, "createdBy">;

export type StoredAnswer = {
  questionId: string;
  value: string | string[];
  autoSavedAt: Date;
};

export type AttemptRecord = {
  id: string;
  assessmentId: string;
  studentId: string;
  attemptNo: number;
  assessmentVersion: number;
  questionSnapshot: SnapshotQuestion[];
  gradingKeys: GradeKey[];
  answers: StoredAnswer[];
  startedAt: Date;
  expiresAt: Date;
  submittedAt: Date | null;
  status: AttemptStatus;
  autoScore: number | null;
  manualScore: number | null;
  totalScore: number | null;
  pendingManual: boolean;
  gradedBy: string | null;
  idempotencyKey: string | null;
  bodyHash: string | null;
};

export type NewAttempt = Omit<
  AttemptRecord,
  | "id"
  | "answers"
  | "submittedAt"
  | "status"
  | "autoScore"
  | "manualScore"
  | "totalScore"
  | "pendingManual"
  | "gradedBy"
  | "idempotencyKey"
  | "bodyHash"
>;

export type FinalizePatch = {
  status: AttemptStatus;
  submittedAt: Date | null;
  autoScore: number;
  manualScore: number | null;
  totalScore: number;
  pendingManual: boolean;
  idempotencyKey: string | null;
  bodyHash: string | null;
};

export type GradePatch = {
  manualScore: number;
  totalScore: number;
  pendingManual: false;
  status: "GRADED";
  gradedBy: string;
};

export type InsertAttemptResult = { kind: "created"; attempt: AttemptRecord } | { kind: "duplicate" };

export interface AssessmentRepository {
  listQuestions(query: QuestionQuery): Promise<{ rows: QuestionRecord[]; total: number }>;
  findQuestion(id: string): Promise<QuestionRecord | null>;
  insertQuestion(input: NewQuestion): Promise<QuestionRecord>;
  updateQuestion(id: string, input: NewQuestion): Promise<QuestionRecord | null>;
  listAssessments(): Promise<AssessmentRecord[]>;
  findAssessment(id: string): Promise<AssessmentRecord | null>;
  insertAssessment(input: NewAssessment): Promise<AssessmentRecord>;
  updateAssessment(id: string, expectedVersion: number, patch: AssessmentPatch): Promise<AssessmentRecord | "stale" | null>;
  publishAssessment(
    id: string,
    expectedVersion: number,
    publishedAt: Date,
    totalMarks: number,
  ): Promise<AssessmentRecord | "stale" | "invalid" | null>;
  listAttempts(assessmentId?: string): Promise<AttemptRecord[]>;
  listForStudent(assessmentId: string, studentId: string): Promise<AttemptRecord[]>;
  findAttempt(id: string): Promise<AttemptRecord | null>;
  insertAttempt(input: NewAttempt): Promise<InsertAttemptResult>;
  saveAnswers(id: string, answers: StoredAnswer[]): Promise<AttemptRecord | "closed" | null>;
  finalizeAttempt(id: string, patch: FinalizePatch): Promise<AttemptRecord | "stale" | null>;
  gradeAttempt(id: string, patch: GradePatch): Promise<AttemptRecord | "stale" | null>;
  listDue(now: Date): Promise<AttemptRecord[]>;
}

function cloneQuestion(row: QuestionRecord): QuestionRecord {
  return {
    ...row,
    options: row.options.map((option) => ({ ...option })),
    answerKey: { optionIds: [...row.answerKey.optionIds], text: row.answerKey.text },
    testCases: row.testCases.map((item) => ({ ...item })),
    updatedAt: new Date(row.updatedAt),
  };
}

function cloneAssessment(row: AssessmentRecord): AssessmentRecord {
  return {
    ...row,
    questionIds: [...row.questionIds],
    targetIds: [...row.targetIds],
    branches: [...row.branches],
    availableFrom: new Date(row.availableFrom),
    availableUntil: new Date(row.availableUntil),
    answersReleaseAt: row.answersReleaseAt ? new Date(row.answersReleaseAt) : null,
    publishedAt: row.publishedAt ? new Date(row.publishedAt) : null,
    updatedAt: new Date(row.updatedAt),
  };
}

function cloneAttempt(row: AttemptRecord): AttemptRecord {
  return {
    ...row,
    questionSnapshot: row.questionSnapshot.map((question) => ({
      ...question,
      options: question.options.map((option) => ({ ...option })),
      testCases: question.testCases.map((item) => ({ ...item })),
    })),
    gradingKeys: row.gradingKeys.map((key) => ({
      ...key,
      optionIds: [...key.optionIds],
      testCases: key.testCases.map((item) => ({ ...item })),
    })),
    answers: row.answers.map((answer) => ({
      ...answer,
      value: Array.isArray(answer.value) ? [...answer.value] : answer.value,
      autoSavedAt: new Date(answer.autoSavedAt),
    })),
    startedAt: new Date(row.startedAt),
    expiresAt: new Date(row.expiresAt),
    submittedAt: row.submittedAt ? new Date(row.submittedAt) : null,
  };
}

function questionMatches(row: QuestionRecord, query: QuestionQuery): boolean {
  if (query.type && row.type !== query.type) {
    return false;
  }
  if (query.topic && row.topic.toLowerCase() !== query.topic.toLowerCase()) {
    return false;
  }
  if (query.q) {
    const needle = query.q.toLowerCase();
    if (!row.prompt.toLowerCase().includes(needle) && !row.topic.toLowerCase().includes(needle)) {
      return false;
    }
  }
  return true;
}

function isDuplicate(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

export function createMemoryAssessmentRepository(): AssessmentRepository {
  const questions: QuestionRecord[] = [];
  const assessments: AssessmentRecord[] = [];
  const attempts: AttemptRecord[] = [];

  return {
    async listQuestions(query) {
      const matched = questions
        .filter((row) => questionMatches(row, query))
        .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
      const start = (query.page - 1) * query.limit;
      return { rows: matched.slice(start, start + query.limit).map(cloneQuestion), total: matched.length };
    },
    async findQuestion(id) {
      const found = questions.find((row) => row.id === id);
      return found ? cloneQuestion(found) : null;
    },
    async insertQuestion(input) {
      const record: QuestionRecord = { ...input, id: randomUUID(), updatedAt: new Date() };
      questions.push(record);
      return cloneQuestion(record);
    },
    async updateQuestion(id, input) {
      const found = questions.find((row) => row.id === id);
      if (!found) {
        return null;
      }
      Object.assign(found, input, { id, updatedAt: new Date() });
      return cloneQuestion(found);
    },
    async listAssessments() {
      return assessments.map(cloneAssessment).sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
    },
    async findAssessment(id) {
      const found = assessments.find((row) => row.id === id);
      return found ? cloneAssessment(found) : null;
    },
    async insertAssessment(input) {
      const now = new Date();
      const record: AssessmentRecord = { ...input, id: randomUUID(), status: "DRAFT", version: 0, publishedAt: null, updatedAt: now };
      assessments.push(record);
      return cloneAssessment(record);
    },
    async updateAssessment(id, expectedVersion, patch) {
      const found = assessments.find((row) => row.id === id);
      if (!found) {
        return null;
      }
      if (found.version !== expectedVersion) {
        return "stale";
      }
      Object.assign(found, patch, { version: found.version + 1, updatedAt: new Date() });
      return cloneAssessment(found);
    },
    async publishAssessment(id, expectedVersion, publishedAt, totalMarks) {
      const found = assessments.find((row) => row.id === id);
      if (!found) {
        return null;
      }
      if (found.version !== expectedVersion) {
        return "stale";
      }
      if (found.status !== "DRAFT") {
        return "invalid";
      }
      found.status = "PUBLISHED";
      found.publishedAt = publishedAt;
      found.totalMarks = totalMarks;
      found.version += 1;
      found.updatedAt = new Date();
      return cloneAssessment(found);
    },
    async listAttempts(assessmentId) {
      return attempts
        .filter((row) => (assessmentId ? row.assessmentId === assessmentId : true))
        .sort((left, right) => left.attemptNo - right.attemptNo)
        .map(cloneAttempt);
    },
    async listForStudent(assessmentId, studentId) {
      return attempts
        .filter((row) => row.assessmentId === assessmentId && row.studentId === studentId)
        .sort((left, right) => left.attemptNo - right.attemptNo)
        .map(cloneAttempt);
    },
    async findAttempt(id) {
      const found = attempts.find((row) => row.id === id);
      return found ? cloneAttempt(found) : null;
    },
    async insertAttempt(input) {
      if (attempts.some((row) => row.assessmentId === input.assessmentId && row.studentId === input.studentId && row.attemptNo === input.attemptNo)) {
        return { kind: "duplicate" };
      }
      const record: AttemptRecord = {
        ...input,
        id: randomUUID(),
        answers: [],
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
      attempts.push(record);
      return { kind: "created", attempt: cloneAttempt(record) };
    },
    async saveAnswers(id, answers) {
      const found = attempts.find((row) => row.id === id);
      if (!found) {
        return null;
      }
      if (found.status !== "IN_PROGRESS") {
        return "closed";
      }
      found.answers = answers.map((answer) => ({
        ...answer,
        value: Array.isArray(answer.value) ? [...answer.value] : answer.value,
        autoSavedAt: new Date(answer.autoSavedAt),
      }));
      return cloneAttempt(found);
    },
    async finalizeAttempt(id, patch) {
      const found = attempts.find((row) => row.id === id);
      if (!found) {
        return null;
      }
      if (found.status !== "IN_PROGRESS") {
        return "stale";
      }
      Object.assign(found, patch);
      return cloneAttempt(found);
    },
    async gradeAttempt(id, patch) {
      const found = attempts.find((row) => row.id === id);
      if (!found) {
        return null;
      }
      if (found.status !== "SUBMITTED" && found.status !== "EXPIRED") {
        return "stale";
      }
      Object.assign(found, patch);
      return cloneAttempt(found);
    },
    async listDue(now) {
      return attempts
        .filter((row) => row.status === "IN_PROGRESS" && row.expiresAt.getTime() <= now.getTime())
        .map(cloneAttempt);
    },
  };
}

const optionSchema = new Schema({ id: { type: String, required: true }, text: { type: String, required: true } }, { _id: false });
const testCaseSchema = new Schema(
  {
    name: { type: String, required: true },
    input: { type: String, required: true },
    expectedOutput: { type: String, required: true },
    hidden: { type: Boolean, required: true },
  },
  { _id: false },
);

const questionSchema = new Schema(
  {
    type: { type: String, required: true, enum: ["MCQ", "MULTI_SELECT", "TRUE_FALSE", "SHORT_ANSWER", "CODING"] },
    prompt: { type: String, required: true },
    options: { type: [optionSchema], default: [] },
    answerKey: {
      type: new Schema(
        { optionIds: { type: [String], default: [] }, text: { type: String, default: null } },
        { _id: false },
      ),
      required: true,
    },
    marks: { type: Number, required: true },
    topic: { type: String, required: true },
    difficulty: { type: String, required: true, enum: ["BEGINNER", "INTERMEDIATE", "ADVANCED"] },
    language: { type: String, default: null },
    testCases: { type: [testCaseSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    updatedAt: { type: Date, required: true },
  },
  { timestamps: false },
);
questionSchema.index({ topic: 1, updatedAt: -1 });

const assessmentSchema = new Schema(
  {
    title: { type: String, required: true },
    description: { type: String, default: "" },
    questionIds: { type: [Schema.Types.ObjectId], required: true },
    durationMin: { type: Number, required: true },
    totalMarks: { type: Number, required: true },
    passingMarks: { type: Number, required: true },
    attemptsAllowed: { type: Number, required: true },
    availableFrom: { type: Date, required: true },
    availableUntil: { type: Date, required: true },
    answersReleaseAt: { type: Date, default: null },
    targetType: { type: String, required: true, enum: ["COHORT", "BRANCH", "MENTOR_GROUP", "INDIVIDUAL"] },
    targetIds: { type: [String], required: true },
    branches: { type: [String], default: [] },
    status: { type: String, required: true, enum: ["DRAFT", "PUBLISHED", "ARCHIVED"] },
    version: { type: Number, required: true },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    publishedAt: { type: Date, default: null },
    updatedAt: { type: Date, required: true },
  },
  { timestamps: false },
);

const attemptSchema = new Schema(
  {
    assessmentId: { type: Schema.Types.ObjectId, required: true },
    studentId: { type: Schema.Types.ObjectId, required: true },
    attemptNo: { type: Number, required: true },
    assessmentVersion: { type: Number, required: true },
    questionSnapshot: { type: [Schema.Types.Mixed], default: [] },
    gradingKeys: { type: [Schema.Types.Mixed], default: [] },
    answers: {
      type: [
        new Schema(
          {
            questionId: { type: String, required: true },
            value: { type: Schema.Types.Mixed, required: true },
            autoSavedAt: { type: Date, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    startedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    submittedAt: { type: Date, default: null },
    status: { type: String, required: true, enum: ["IN_PROGRESS", "SUBMITTED", "EXPIRED", "GRADED"] },
    autoScore: { type: Number, default: null },
    manualScore: { type: Number, default: null },
    totalScore: { type: Number, default: null },
    pendingManual: { type: Boolean, default: false },
    gradedBy: { type: Schema.Types.ObjectId, default: null },
    idempotencyKey: { type: String, default: null },
    bodyHash: { type: String, default: null },
  },
  { timestamps: false },
);
attemptSchema.index({ assessmentId: 1, studentId: 1, attemptNo: 1 }, { unique: true });
attemptSchema.index({ status: 1, expiresAt: 1 });

type QuestionDoc = {
  _id: { toString(): string };
  type: QuestionType;
  prompt: string;
  options?: { id: string; text: string }[];
  answerKey?: { optionIds?: string[]; text?: string | null };
  marks: number;
  topic: string;
  difficulty: Difficulty;
  language?: string | null;
  testCases?: { name: string; input: string; expectedOutput: string; hidden: boolean }[];
  createdBy: { toString(): string };
  updatedAt: Date;
};

type AssessmentDoc = {
  _id: { toString(): string };
  title: string;
  description?: string;
  questionIds: { toString(): string }[];
  durationMin: number;
  totalMarks: number;
  passingMarks: number;
  attemptsAllowed: number;
  availableFrom: Date;
  availableUntil: Date;
  answersReleaseAt?: Date | null;
  targetType: AssignmentTarget;
  targetIds: string[];
  branches?: Branch[];
  status: ResourceStatus;
  version: number;
  createdBy: { toString(): string };
  publishedAt?: Date | null;
  updatedAt: Date;
};

type AttemptDoc = {
  _id: { toString(): string };
  assessmentId: { toString(): string };
  studentId: { toString(): string };
  attemptNo: number;
  assessmentVersion: number;
  questionSnapshot?: SnapshotQuestion[];
  gradingKeys?: GradeKey[];
  answers?: StoredAnswer[];
  startedAt: Date;
  expiresAt: Date;
  submittedAt?: Date | null;
  status: AttemptStatus;
  autoScore?: number | null;
  manualScore?: number | null;
  totalScore?: number | null;
  pendingManual?: boolean;
  gradedBy?: { toString(): string } | null;
  idempotencyKey?: string | null;
  bodyHash?: string | null;
};

const QuestionModel = (mongoose.models.AssessmentQuestion ??
  mongoose.model("AssessmentQuestion", questionSchema, "questions")) as mongoose.Model<QuestionDoc>;
const AssessmentModel = (mongoose.models.Assessment ?? mongoose.model("Assessment", assessmentSchema)) as mongoose.Model<AssessmentDoc>;
const AttemptModel = (mongoose.models.AssessmentAttempt ??
  mongoose.model("AssessmentAttempt", attemptSchema)) as mongoose.Model<AttemptDoc>;

function toQuestion(doc: QuestionDoc): QuestionRecord {
  return {
    id: doc._id.toString(),
    type: doc.type,
    prompt: doc.prompt,
    options: (doc.options ?? []).map((option) => ({ id: String(option.id), text: String(option.text) })),
    answerKey: {
      optionIds: [...(doc.answerKey?.optionIds ?? [])].map((id) => String(id)),
      text: doc.answerKey?.text ?? null,
    },
    marks: doc.marks,
    topic: doc.topic,
    difficulty: doc.difficulty,
    language: doc.language ?? null,
    testCases: (doc.testCases ?? []).map((item) => ({
      name: item.name,
      input: item.input,
      expectedOutput: item.expectedOutput,
      hidden: Boolean(item.hidden),
    })),
    createdBy: doc.createdBy.toString(),
    updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt : new Date(doc.updatedAt),
  };
}

function toAssessment(doc: AssessmentDoc): AssessmentRecord {
  return {
    id: doc._id.toString(),
    title: doc.title,
    description: doc.description ?? "",
    questionIds: doc.questionIds.map((id) => id.toString()),
    durationMin: doc.durationMin,
    totalMarks: doc.totalMarks,
    passingMarks: doc.passingMarks,
    attemptsAllowed: doc.attemptsAllowed,
    availableFrom: doc.availableFrom,
    availableUntil: doc.availableUntil,
    answersReleaseAt: doc.answersReleaseAt ?? null,
    targetType: doc.targetType,
    targetIds: [...doc.targetIds],
    branches: [...(doc.branches ?? [])],
    status: doc.status,
    version: doc.version,
    createdBy: doc.createdBy.toString(),
    publishedAt: doc.publishedAt ?? null,
    updatedAt: doc.updatedAt,
  };
}

function toAttempt(doc: AttemptDoc): AttemptRecord {
  return {
    id: doc._id.toString(),
    assessmentId: doc.assessmentId.toString(),
    studentId: doc.studentId.toString(),
    attemptNo: doc.attemptNo,
    assessmentVersion: doc.assessmentVersion,
    questionSnapshot: (doc.questionSnapshot ?? []).map((question) => ({
      ...question,
      options: question.options.map((option) => ({ ...option })),
      testCases: question.testCases.map((item) => ({ ...item })),
    })),
    gradingKeys: (doc.gradingKeys ?? []).map((key) => ({
      ...key,
      optionIds: [...key.optionIds],
      testCases: key.testCases.map((item) => ({ ...item })),
    })),
    answers: (doc.answers ?? []).map((answer) => ({
      questionId: answer.questionId,
      value: Array.isArray(answer.value) ? [...answer.value] : answer.value,
      autoSavedAt: new Date(answer.autoSavedAt),
    })),
    startedAt: doc.startedAt,
    expiresAt: doc.expiresAt,
    submittedAt: doc.submittedAt ?? null,
    status: doc.status,
    autoScore: doc.autoScore ?? null,
    manualScore: doc.manualScore ?? null,
    totalScore: doc.totalScore ?? null,
    pendingManual: doc.pendingManual ?? false,
    gradedBy: doc.gradedBy ? doc.gradedBy.toString() : null,
    idempotencyKey: doc.idempotencyKey ?? null,
    bodyHash: doc.bodyHash ?? null,
  };
}

function validId(id: string): boolean {
  return mongoose.isValidObjectId(id);
}

export function createMongoAssessmentRepository(): AssessmentRepository {
  return {
    async listQuestions(query) {
      const filter: Record<string, unknown> = {};
      if (query.type) {
        filter.type = query.type;
      }
      if (query.topic) {
        filter.topic = query.topic;
      }
      if (query.q) {
        const pattern = query.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        filter.$or = [{ prompt: { $regex: pattern, $options: "i" } }, { topic: { $regex: pattern, $options: "i" } }];
      }
      const total = await QuestionModel.countDocuments(filter);
      const docs = await QuestionModel.find(filter)
        .sort({ updatedAt: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean();
      return { rows: docs.map((doc) => toQuestion(doc)), total };
    },
    async findQuestion(id) {
      if (!validId(id)) {
        return null;
      }
      const doc = await QuestionModel.findById(id).lean();
      return doc ? toQuestion(doc) : null;
    },
    async insertQuestion(input) {
      const doc = await QuestionModel.create({ ...input, updatedAt: new Date() });
      return toQuestion(doc);
    },
    async updateQuestion(id, input) {
      if (!validId(id)) {
        return null;
      }
      const doc = await QuestionModel.findByIdAndUpdate(id, { ...input, updatedAt: new Date() }, { new: true }).lean();
      return doc ? toQuestion(doc) : null;
    },
    async listAssessments() {
      const docs = await AssessmentModel.find().sort({ updatedAt: -1 }).lean();
      return docs.map((doc) => toAssessment(doc));
    },
    async findAssessment(id) {
      if (!validId(id)) {
        return null;
      }
      const doc = await AssessmentModel.findById(id).lean();
      return doc ? toAssessment(doc) : null;
    },
    async insertAssessment(input) {
      const doc = await AssessmentModel.create({
        ...input,
        status: "DRAFT",
        version: 0,
        publishedAt: null,
        updatedAt: new Date(),
      });
      return toAssessment(doc);
    },
    async updateAssessment(id, expectedVersion, patch) {
      if (!validId(id)) {
        return null;
      }
      const doc = await AssessmentModel.findOneAndUpdate(
        { _id: id, version: expectedVersion },
        { $set: { ...patch, updatedAt: new Date() }, $inc: { version: 1 } },
        { new: true },
      ).lean();
      if (doc) {
        return toAssessment(doc);
      }
      const current = await AssessmentModel.findById(id).lean();
      return current ? "stale" : null;
    },
    async publishAssessment(id, expectedVersion, publishedAt, totalMarks) {
      if (!validId(id)) {
        return null;
      }
      const doc = await AssessmentModel.findOneAndUpdate(
        { _id: id, version: expectedVersion, status: "DRAFT" },
        { $set: { status: "PUBLISHED", publishedAt, totalMarks, updatedAt: new Date() }, $inc: { version: 1 } },
        { new: true },
      ).lean();
      if (doc) {
        return toAssessment(doc);
      }
      const current = await AssessmentModel.findById(id).lean();
      if (!current) {
        return null;
      }
      return current.version === expectedVersion ? "invalid" : "stale";
    },
    async listAttempts(assessmentId) {
      if (assessmentId && !validId(assessmentId)) {
        return [];
      }
      const docs = await AttemptModel.find(assessmentId ? { assessmentId } : {})
        .sort({ attemptNo: 1 })
        .lean();
      return docs.map((doc) => toAttempt(doc));
    },
    async listForStudent(assessmentId, studentId) {
      if (!validId(assessmentId) || !validId(studentId)) {
        return [];
      }
      const docs = await AttemptModel.find({ assessmentId, studentId }).sort({ attemptNo: 1 }).lean();
      return docs.map((doc) => toAttempt(doc));
    },
    async findAttempt(id) {
      if (!validId(id)) {
        return null;
      }
      const doc = await AttemptModel.findById(id).lean();
      return doc ? toAttempt(doc) : null;
    },
    async insertAttempt(input) {
      try {
        const doc = await AttemptModel.create({
          ...input,
          answers: [],
          submittedAt: null,
          status: "IN_PROGRESS",
          autoScore: null,
          manualScore: null,
          totalScore: null,
          pendingManual: false,
          gradedBy: null,
          idempotencyKey: null,
          bodyHash: null,
        });
        return { kind: "created", attempt: toAttempt(doc) };
      } catch (error) {
        if (!isDuplicate(error)) {
          throw error;
        }
        return { kind: "duplicate" };
      }
    },
    async saveAnswers(id, answers) {
      if (!validId(id)) {
        return null;
      }
      const doc = await AttemptModel.findOneAndUpdate({ _id: id, status: "IN_PROGRESS" }, { $set: { answers } }, { new: true }).lean();
      if (doc) {
        return toAttempt(doc);
      }
      const current = await AttemptModel.findById(id).lean();
      return current ? "closed" : null;
    },
    async finalizeAttempt(id, patch) {
      if (!validId(id)) {
        return null;
      }
      const doc = await AttemptModel.findOneAndUpdate({ _id: id, status: "IN_PROGRESS" }, { $set: patch }, { new: true }).lean();
      if (doc) {
        return toAttempt(doc);
      }
      const current = await AttemptModel.findById(id).lean();
      return current ? "stale" : null;
    },
    async gradeAttempt(id, patch) {
      if (!validId(id)) {
        return null;
      }
      const doc = await AttemptModel.findOneAndUpdate(
        { _id: id, status: { $in: ["SUBMITTED", "EXPIRED"] } },
        { $set: patch },
        { new: true },
      ).lean();
      if (doc) {
        return toAttempt(doc);
      }
      const current = await AttemptModel.findById(id).lean();
      return current ? "stale" : null;
    },
    async listDue(now) {
      const docs = await AttemptModel.find({ status: "IN_PROGRESS", expiresAt: { $lte: now } }).lean();
      return docs.map((doc) => toAttempt(doc));
    },
  };
}
