import type { AssignmentTarget, Branch, Priority, RecipientState, ResourceStatus, SubmissionType } from "@dhruva/shared";
import { randomUUID } from "node:crypto";
import mongoose, { Schema } from "mongoose";

export type WorkTestCase = {
  name: string;
  input: string;
  expectedOutput: string;
  hidden: boolean;
};

export type RubricItem = {
  criterion: string;
  maxPoints: number;
};

export type WorkRecord = {
  id: string;
  title: string;
  description: string;
  resourceId: string | null;
  assignedBy: string;
  targetType: AssignmentTarget;
  targetIds: string[];
  branches: Branch[];
  dueDate: Date;
  priority: Priority;
  submissionType: SubmissionType;
  language: string | null;
  testCases: WorkTestCase[];
  rubric: RubricItem[];
  status: ResourceStatus;
  publishedAt: Date | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
};

export type RecipientRecord = {
  id: string;
  assignmentId: string;
  studentId: string;
  state: RecipientState;
  startedAt: Date | null;
  submittedAt: Date | null;
  completedAt: Date | null;
  score: number | null;
};

export type WorkWrite = Omit<WorkRecord, "id" | "assignedBy" | "status" | "publishedAt" | "revision" | "createdAt" | "updatedAt">;

export type WorkMutation = WorkRecord | "conflict" | "invalid" | null;

export interface WorkRepository {
  list(): Promise<WorkRecord[]>;
  findById(id: string): Promise<WorkRecord | null>;
  create(input: WorkWrite & { assignedBy: string }): Promise<WorkRecord>;
  update(id: string, expectedRevision: number, input: WorkWrite): Promise<WorkMutation>;
  publish(id: string, expectedRevision: number, publishedAt: Date, studentIds: string[]): Promise<WorkMutation>;
  archive(id: string, expectedRevision: number): Promise<WorkMutation>;
  listPublished(): Promise<WorkRecord[]>;
  addMissing(assignmentId: string, studentIds: string[]): Promise<string[]>;
  listRecipients(assignmentId: string): Promise<RecipientRecord[]>;
  listRecipientsForStudent(studentId: string): Promise<RecipientRecord[]>;
  listRecipientsForStudents(studentIds: string[]): Promise<RecipientRecord[]>;
  resourceIdsForStudents(studentIds: string[]): Promise<Set<string>>;
}

function recipientFor(assignmentId: string, studentId: string): RecipientRecord {
  return {
    id: randomUUID(),
    assignmentId,
    studentId,
    state: "NOT_STARTED",
    startedAt: null,
    submittedAt: null,
    completedAt: null,
    score: null,
  };
}

function isDuplicate(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

export function createMemoryWorkRepository(): WorkRepository {
  const assignments = new Map<string, WorkRecord>();
  const recipients: RecipientRecord[] = [];

  function countsFor(studentIds: string[]): Set<string> {
    const wanted = new Set(studentIds);
    const ids = new Set<string>();
    for (const recipient of recipients) {
      if (!wanted.has(recipient.studentId)) {
        continue;
      }
      const assignment = assignments.get(recipient.assignmentId);
      if (assignment?.resourceId && assignment.status !== "DRAFT") {
        ids.add(assignment.resourceId);
      }
    }
    return ids;
  }

  return {
    async list() {
      return [...assignments.values()].map((row) => structuredClone(row));
    },
    async findById(id) {
      const found = assignments.get(id);
      return found ? structuredClone(found) : null;
    },
    async create(input) {
      const now = new Date();
      const record: WorkRecord = {
        ...input,
        targetIds: [...input.targetIds],
        branches: [...input.branches],
        testCases: input.testCases.map((item) => ({ ...item })),
        rubric: input.rubric.map((item) => ({ ...item })),
        id: randomUUID(),
        status: "DRAFT",
        publishedAt: null,
        revision: 0,
        createdAt: now,
        updatedAt: now,
      };
      assignments.set(record.id, record);
      return structuredClone(record);
    },
    async update(id, expectedRevision, input) {
      const current = assignments.get(id);
      if (!current) {
        return null;
      }
      if (current.revision !== expectedRevision) {
        return "conflict";
      }
      if (current.status !== "DRAFT") {
        return "invalid";
      }
      Object.assign(current, {
        ...input,
        targetIds: [...input.targetIds],
        branches: [...input.branches],
        testCases: input.testCases.map((item) => ({ ...item })),
        rubric: input.rubric.map((item) => ({ ...item })),
        revision: current.revision + 1,
        updatedAt: new Date(),
      });
      return structuredClone(current);
    },
    async publish(id, expectedRevision, publishedAt, studentIds) {
      const current = assignments.get(id);
      if (!current) {
        return null;
      }
      if (current.revision !== expectedRevision) {
        return "conflict";
      }
      if (current.status !== "DRAFT") {
        return "invalid";
      }
      const uniqueStudents = [...new Set(studentIds)];
      current.status = "PUBLISHED";
      current.publishedAt = publishedAt;
      current.revision += 1;
      current.updatedAt = new Date();
      for (const studentId of uniqueStudents) {
        recipients.push(recipientFor(current.id, studentId));
      }
      return structuredClone(current);
    },
    async archive(id, expectedRevision) {
      const current = assignments.get(id);
      if (!current) {
        return null;
      }
      if (current.revision !== expectedRevision) {
        return "conflict";
      }
      if (current.status === "ARCHIVED") {
        return "invalid";
      }
      current.status = "ARCHIVED";
      current.revision += 1;
      current.updatedAt = new Date();
      return structuredClone(current);
    },
    async listPublished() {
      return [...assignments.values()].filter((row) => row.status === "PUBLISHED").map((row) => structuredClone(row));
    },
    async addMissing(assignmentId, studentIds) {
      const assignment = assignments.get(assignmentId);
      if (!assignment || assignment.status !== "PUBLISHED") {
        return [];
      }
      const existing = new Set(recipients.filter((row) => row.assignmentId === assignmentId).map((row) => row.studentId));
      const added: string[] = [];
      for (const studentId of new Set(studentIds)) {
        if (existing.has(studentId)) {
          continue;
        }
        recipients.push(recipientFor(assignmentId, studentId));
        added.push(studentId);
      }
      return added;
    },
    async listRecipients(assignmentId) {
      return recipients.filter((row) => row.assignmentId === assignmentId).map((row) => ({ ...row }));
    },
    async listRecipientsForStudent(studentId) {
      return recipients.filter((row) => row.studentId === studentId).map((row) => ({ ...row }));
    },
    async listRecipientsForStudents(studentIds) {
      const wanted = new Set(studentIds);
      return recipients.filter((row) => wanted.has(row.studentId)).map((row) => ({ ...row }));
    },
    async resourceIdsForStudents(studentIds) {
      return countsFor(studentIds);
    },
  };
}

const testCaseSchema = new Schema(
  {
    name: { type: String, required: true },
    input: { type: String, required: true },
    expectedOutput: { type: String, required: true },
    hidden: { type: Boolean, required: true },
  },
  { _id: false },
);

const rubricSchema = new Schema(
  {
    criterion: { type: String, required: true },
    maxPoints: { type: Number, required: true },
  },
  { _id: false },
);

const workSchema = new Schema(
  {
    title: { type: String, required: true },
    description: { type: String, default: "" },
    resourceId: { type: Schema.Types.ObjectId, default: null },
    assignedBy: { type: Schema.Types.ObjectId, required: true, index: true },
    targetType: { type: String, required: true, enum: ["COHORT", "BRANCH", "MENTOR_GROUP", "INDIVIDUAL"] },
    targetIds: { type: [Schema.Types.ObjectId], default: [] },
    branches: { type: [String], default: [] },
    dueDate: { type: Date, required: true },
    priority: { type: String, required: true, enum: ["LOW", "NORMAL", "HIGH"] },
    submissionType: { type: String, required: true, enum: ["TEXT", "FILE", "REPOSITORY", "EDITOR_LINK", "NONE"] },
    language: { type: String, default: null },
    testCases: { type: [testCaseSchema], default: [] },
    rubric: { type: [rubricSchema], default: [] },
    status: { type: String, required: true, enum: ["DRAFT", "PUBLISHED", "ARCHIVED"] },
    publishedAt: { type: Date, default: null },
    revision: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);
workSchema.index({ status: 1 });
workSchema.index({ targetIds: 1 });

const recipientSchema = new Schema(
  {
    assignmentId: { type: Schema.Types.ObjectId, required: true },
    studentId: { type: Schema.Types.ObjectId, required: true },
    state: {
      type: String,
      required: true,
      enum: ["NOT_STARTED", "IN_PROGRESS", "SUBMITTED", "UNDER_REVIEW", "REVISION_REQUESTED", "COMPLETED"],
    },
    startedAt: { type: Date, default: null },
    submittedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    score: { type: Number, default: null },
  },
  { timestamps: true },
);
recipientSchema.index({ assignmentId: 1, studentId: 1 }, { unique: true });
recipientSchema.index({ studentId: 1, state: 1 });
recipientSchema.index({ assignmentId: 1, state: 1 });

type WorkDoc = {
  _id: { toString(): string };
  title: string;
  description?: string;
  resourceId?: { toString(): string } | null;
  assignedBy: { toString(): string };
  targetType: AssignmentTarget;
  targetIds?: { toString(): string }[];
  branches?: Branch[];
  dueDate: Date;
  priority: Priority;
  submissionType: SubmissionType;
  language?: string | null;
  testCases?: WorkTestCase[];
  rubric?: RubricItem[];
  status: ResourceStatus;
  publishedAt?: Date | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
};

type RecipientDoc = {
  _id: { toString(): string };
  assignmentId: { toString(): string };
  studentId: { toString(): string };
  state: RecipientState;
  startedAt?: Date | null;
  submittedAt?: Date | null;
  completedAt?: Date | null;
  score?: number | null;
};

const WorkModel = (mongoose.models.Assignment ?? mongoose.model("Assignment", workSchema)) as mongoose.Model<WorkDoc>;
const RecipientModel = (mongoose.models.AssignmentRecipient ??
  mongoose.model("AssignmentRecipient", recipientSchema)) as mongoose.Model<RecipientDoc>;

function toWork(doc: WorkDoc): WorkRecord {
  return {
    id: doc._id.toString(),
    title: doc.title,
    description: doc.description ?? "",
    resourceId: doc.resourceId ? doc.resourceId.toString() : null,
    assignedBy: doc.assignedBy.toString(),
    targetType: doc.targetType,
    targetIds: (doc.targetIds ?? []).map((id) => id.toString()),
    branches: doc.branches ?? [],
    dueDate: doc.dueDate,
    priority: doc.priority,
    submissionType: doc.submissionType,
    language: doc.language ?? null,
    testCases: (doc.testCases ?? []).map((item) => ({ ...item })),
    rubric: (doc.rubric ?? []).map((item) => ({ ...item })),
    status: doc.status,
    publishedAt: doc.publishedAt ?? null,
    revision: doc.revision,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toRecipient(doc: RecipientDoc): RecipientRecord {
  return {
    id: doc._id.toString(),
    assignmentId: doc.assignmentId.toString(),
    studentId: doc.studentId.toString(),
    state: doc.state,
    startedAt: doc.startedAt ?? null,
    submittedAt: doc.submittedAt ?? null,
    completedAt: doc.completedAt ?? null,
    score: doc.score ?? null,
  };
}

function writeFields(input: WorkWrite) {
  return {
    title: input.title,
    description: input.description,
    resourceId: input.resourceId,
    targetType: input.targetType,
    targetIds: input.targetIds,
    branches: input.branches,
    dueDate: input.dueDate,
    priority: input.priority,
    submissionType: input.submissionType,
    language: input.language,
    testCases: input.testCases,
    rubric: input.rubric,
  };
}

export function createMongoWorkRepository(): WorkRepository {
  return {
    async list() {
      const docs = await WorkModel.find().lean();
      return docs.map((doc) => toWork(doc));
    },
    async findById(id) {
      if (!mongoose.isValidObjectId(id)) {
        return null;
      }
      const doc = await WorkModel.findById(id).lean();
      return doc ? toWork(doc) : null;
    },
    async create(input) {
      const doc = await WorkModel.create({
        ...writeFields(input),
        assignedBy: input.assignedBy,
        status: "DRAFT",
        publishedAt: null,
        revision: 0,
      });
      return toWork(doc);
    },
    async update(id, expectedRevision, input) {
      if (!mongoose.isValidObjectId(id)) {
        return null;
      }
      const doc = await WorkModel.findOneAndUpdate(
        { _id: id, revision: expectedRevision, status: "DRAFT" },
        { $set: writeFields(input), $inc: { revision: 1 } },
        { new: true },
      ).lean();
      if (doc) {
        return toWork(doc);
      }
      const current = await WorkModel.findById(id).lean();
      if (!current) {
        return null;
      }
      if (current.revision !== expectedRevision) {
        return "conflict";
      }
      return "invalid";
    },
    async publish(id, expectedRevision, publishedAt, studentIds) {
      if (!mongoose.isValidObjectId(id)) {
        return null;
      }
      const uniqueStudents = [...new Set(studentIds)];
      const session = await mongoose.startSession();
      const box: { result: WorkMutation } = { result: null };
      try {
        await session.withTransaction(async () => {
          const updated = await WorkModel.findOneAndUpdate(
            { _id: id, revision: expectedRevision, status: "DRAFT" },
            { $set: { status: "PUBLISHED", publishedAt }, $inc: { revision: 1 } },
            { new: true, session },
          ).lean();
          if (!updated) {
            const current = await WorkModel.findById(id).session(session).lean();
            box.result = !current ? null : current.revision !== expectedRevision ? "conflict" : "invalid";
            return;
          }
          if (uniqueStudents.length > 0) {
            await RecipientModel.insertMany(
              uniqueStudents.map((studentId) => ({
                assignmentId: id,
                studentId,
                state: "NOT_STARTED",
                startedAt: null,
                submittedAt: null,
                completedAt: null,
                score: null,
              })),
              { session },
            );
          }
          box.result = toWork(updated);
        });
        return box.result;
      } catch (error) {
        if (isDuplicate(error)) {
          return "conflict";
        }
        throw error;
      } finally {
        await session.endSession();
      }
    },
    async archive(id, expectedRevision) {
      if (!mongoose.isValidObjectId(id)) {
        return null;
      }
      const doc = await WorkModel.findOneAndUpdate(
        { _id: id, revision: expectedRevision, status: { $ne: "ARCHIVED" } },
        { $set: { status: "ARCHIVED" }, $inc: { revision: 1 } },
        { new: true },
      ).lean();
      if (doc) {
        return toWork(doc);
      }
      const current = await WorkModel.findById(id).lean();
      if (!current) {
        return null;
      }
      if (current.revision !== expectedRevision) {
        return "conflict";
      }
      return "invalid";
    },
    async listPublished() {
      const docs = await WorkModel.find({ status: "PUBLISHED" }).lean();
      return docs.map((doc) => toWork(doc));
    },
    async addMissing(assignmentId, studentIds) {
      if (!mongoose.isValidObjectId(assignmentId)) {
        return [];
      }
      const assignment = await WorkModel.findOne({ _id: assignmentId, status: "PUBLISHED" }).lean();
      if (!assignment) {
        return [];
      }
      const existing = await RecipientModel.find({ assignmentId }).select("studentId").lean();
      const have = new Set(existing.map((row) => row.studentId.toString()));
      const added: string[] = [];
      for (const studentId of new Set(studentIds)) {
        if (have.has(studentId) || !mongoose.isValidObjectId(studentId)) {
          continue;
        }
        try {
          await RecipientModel.create({
            assignmentId,
            studentId,
            state: "NOT_STARTED",
            startedAt: null,
            submittedAt: null,
            completedAt: null,
            score: null,
          });
          added.push(studentId);
        } catch (error) {
          if (!isDuplicate(error)) {
            throw error;
          }
        }
      }
      return added;
    },
    async listRecipients(assignmentId) {
      if (!mongoose.isValidObjectId(assignmentId)) {
        return [];
      }
      const docs = await RecipientModel.find({ assignmentId }).lean();
      return docs.map((doc) => toRecipient(doc));
    },
    async listRecipientsForStudent(studentId) {
      if (!mongoose.isValidObjectId(studentId)) {
        return [];
      }
      const docs = await RecipientModel.find({ studentId }).lean();
      return docs.map((doc) => toRecipient(doc));
    },
    async listRecipientsForStudents(studentIds) {
      const ids = studentIds.filter((id) => mongoose.isValidObjectId(id));
      if (ids.length === 0) {
        return [];
      }
      const docs = await RecipientModel.find({ studentId: { $in: ids } }).lean();
      return docs.map((doc) => toRecipient(doc));
    },
    async resourceIdsForStudents(studentIds) {
      const rows = await this.listRecipientsForStudents(studentIds);
      const assignmentIds = [...new Set(rows.map((row) => row.assignmentId))];
      const ids = new Set<string>();
      if (assignmentIds.length === 0) {
        return ids;
      }
      const docs = await WorkModel.find({ _id: { $in: assignmentIds }, status: { $ne: "DRAFT" }, resourceId: { $ne: null } })
        .select("resourceId")
        .lean();
      for (const doc of docs) {
        if (doc.resourceId) {
          ids.add(doc.resourceId.toString());
        }
      }
      return ids;
    },
  };
}
