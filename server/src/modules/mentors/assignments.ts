import { randomUUID } from "node:crypto";
import mongoose, { Schema } from "mongoose";
import { AppError } from "../../middleware/errors.js";
import type { EventBus } from "../../events/bus.js";
import type { UserRepository } from "../users/repository.js";

export type AssignmentRecord = {
  id: string;
  mentorId: string;
  studentId: string;
  assignedBy: string;
  status: "ACTIVE" | "ENDED";
  startDate: Date;
  endDate: Date | null;
  endReason: "REASSIGNED" | "COMPLETED" | "WITHDRAWN" | null;
};

export class ActiveMentorExistsError extends Error {
  constructor() {
    super("This student already has a mentor.");
    this.name = "ActiveMentorExistsError";
  }
}

export interface AssignmentRepository {
  findActiveByStudent(studentId: string): Promise<AssignmentRecord | null>;
  listActiveByMentor(mentorId: string): Promise<AssignmentRecord[]>;
  listByStudent(studentId: string): Promise<AssignmentRecord[]>;
  create(input: Omit<AssignmentRecord, "id">): Promise<AssignmentRecord>;
  reassign(currentId: string | null, next: Omit<AssignmentRecord, "id">): Promise<AssignmentRecord>;
}

export function createMemoryAssignmentRepository(): AssignmentRepository {
  const rows: AssignmentRecord[] = [];
  return {
    async findActiveByStudent(studentId) {
      return rows.find((row) => row.studentId === studentId && row.status === "ACTIVE") ?? null;
    },
    async listActiveByMentor(mentorId) {
      return rows.filter((row) => row.mentorId === mentorId && row.status === "ACTIVE");
    },
    async listByStudent(studentId) {
      return rows
        .filter((row) => row.studentId === studentId)
        .sort((left, right) => left.startDate.getTime() - right.startDate.getTime());
    },
    async create(input) {
      if (rows.some((row) => row.studentId === input.studentId && row.status === "ACTIVE")) {
        throw new ActiveMentorExistsError();
      }
      const record = { ...input, id: randomUUID() };
      rows.push(record);
      return record;
    },
    async reassign(currentId, next) {
      if (currentId) {
        const current = rows.find((row) => row.id === currentId && row.status === "ACTIVE");
        if (current) {
          current.status = "ENDED";
          current.endDate = next.startDate;
          current.endReason = "REASSIGNED";
        }
      }
      if (rows.some((row) => row.studentId === next.studentId && row.status === "ACTIVE")) {
        throw new ActiveMentorExistsError();
      }
      const record = { ...next, id: randomUUID() };
      rows.push(record);
      return record;
    },
  };
}

const assignmentSchema = new Schema(
  {
    mentorId: { type: Schema.Types.ObjectId, required: true, index: true },
    studentId: { type: Schema.Types.ObjectId, required: true },
    assignedBy: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, required: true, enum: ["ACTIVE", "ENDED"] },
    startDate: { type: Date, required: true },
    endDate: { type: Date, default: null },
    endReason: { type: String, enum: ["REASSIGNED", "COMPLETED", "WITHDRAWN", null], default: null },
  },
  { timestamps: true },
);

assignmentSchema.index({ studentId: 1 }, { unique: true, partialFilterExpression: { status: "ACTIVE" } });

const AssignmentModel = (mongoose.models.MentorAssignment ??
  mongoose.model("MentorAssignment", assignmentSchema)) as mongoose.Model<{
  mentorId: mongoose.Types.ObjectId;
  studentId: mongoose.Types.ObjectId;
  assignedBy: mongoose.Types.ObjectId;
  status: AssignmentRecord["status"];
  startDate: Date;
  endDate?: Date | null;
  endReason?: AssignmentRecord["endReason"];
}>;

function toRecord(doc: {
  _id: { toString(): string };
  mentorId: { toString(): string };
  studentId: { toString(): string };
  assignedBy: { toString(): string };
  status: AssignmentRecord["status"];
  startDate: Date;
  endDate?: Date | null;
  endReason?: AssignmentRecord["endReason"];
}): AssignmentRecord {
  return {
    id: doc._id.toString(),
    mentorId: doc.mentorId.toString(),
    studentId: doc.studentId.toString(),
    assignedBy: doc.assignedBy.toString(),
    status: doc.status,
    startDate: doc.startDate,
    endDate: doc.endDate ?? null,
    endReason: doc.endReason ?? null,
  };
}

export function createMongoAssignmentRepository(): AssignmentRepository {
  return {
    async findActiveByStudent(studentId) {
      if (!mongoose.isValidObjectId(studentId)) {
        return null;
      }
      const doc = await AssignmentModel.findOne({ studentId, status: "ACTIVE" }).lean();
      return doc ? toRecord(doc) : null;
    },
    async listActiveByMentor(mentorId) {
      if (!mongoose.isValidObjectId(mentorId)) {
        return [];
      }
      const docs = await AssignmentModel.find({ mentorId, status: "ACTIVE" }).lean();
      return docs.map((doc) => toRecord(doc));
    },
    async listByStudent(studentId) {
      if (!mongoose.isValidObjectId(studentId)) {
        return [];
      }
      const docs = await AssignmentModel.find({ studentId }).sort({ startDate: 1 }).lean();
      return docs.map((doc) => toRecord(doc));
    },
    async create(input) {
      try {
        const doc = await AssignmentModel.create(input);
        return toRecord(doc);
      } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
          throw new ActiveMentorExistsError();
        }
        throw error;
      }
    },
    async reassign(currentId, next) {
      const session = await mongoose.startSession();
      const box: { record: AssignmentRecord | null } = { record: null };
      try {
        await session.withTransaction(async () => {
          if (currentId) {
            await AssignmentModel.updateOne(
              { _id: currentId, status: "ACTIVE" },
              { status: "ENDED", endDate: next.startDate, endReason: "REASSIGNED" },
              { session },
            );
          }
          const docs = await AssignmentModel.create([next], { session });
          const doc = docs[0];
          if (!doc) {
            throw new ActiveMentorExistsError();
          }
          box.record = toRecord(doc);
        });
        if (!box.record) {
          throw new ActiveMentorExistsError();
        }
        return box.record;
      } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
          throw new ActiveMentorExistsError();
        }
        throw error;
      } finally {
        await session.endSession();
      }
    },
  };
}

export async function assignStudents(options: {
  users: UserRepository;
  assignments: AssignmentRepository;
  bus: EventBus;
  actorId: string;
  mentorId: string;
  studentIds: string[];
}): Promise<number> {
  const mentor = await options.users.findById(options.mentorId);
  if (!mentor || mentor.role !== "MENTOR" || mentor.status === "DEACTIVATED") {
    throw new AppError(400, "VALIDATION_ERROR", "Choose an active mentor.");
  }

  let assigned = 0;
  for (const studentId of options.studentIds) {
    const student = await options.users.findById(studentId);
    if (!student || student.role !== "STUDENT" || student.status === "DEACTIVATED") {
      throw new AppError(400, "VALIDATION_ERROR", "Choose an active student.");
    }
    const current = await options.assignments.findActiveByStudent(studentId);
    if (current?.mentorId === mentor.id) {
      continue;
    }
    if (current) {
      throw new AppError(409, "CONFLICT", "This student already has a mentor.");
    }
    await options.assignments.create({
      mentorId: mentor.id,
      studentId: student.id,
      assignedBy: options.actorId,
      status: "ACTIVE",
      startDate: new Date(),
      endDate: null,
      endReason: null,
    });
    await options.bus.emit({
      action: "mentor.assigned",
      actorId: options.actorId,
      subjectType: "User",
      subjectId: student.id,
      after: { mentorId: mentor.id },
    });
    assigned += 1;
  }
  return assigned;
}

export async function reassignStudents(options: {
  users: UserRepository;
  assignments: AssignmentRepository;
  bus: EventBus;
  actorId: string;
  mentorId: string;
  studentIds: string[];
}): Promise<number> {
  const mentor = await options.users.findById(options.mentorId);
  if (!mentor || mentor.role !== "MENTOR" || mentor.status === "DEACTIVATED") {
    throw new AppError(400, "VALIDATION_ERROR", "Choose an active mentor.");
  }

  let moved = 0;
  for (const studentId of options.studentIds) {
    const student = await options.users.findById(studentId);
    if (!student || student.role !== "STUDENT" || student.status === "DEACTIVATED") {
      throw new AppError(400, "VALIDATION_ERROR", "Choose an active student.");
    }
    const current = await options.assignments.findActiveByStudent(studentId);
    if (current?.mentorId === mentor.id) {
      continue;
    }
    const startDate = new Date();
    await options.assignments.reassign(current?.id ?? null, {
      mentorId: mentor.id,
      studentId: student.id,
      assignedBy: options.actorId,
      status: "ACTIVE",
      startDate,
      endDate: null,
      endReason: null,
    });
    await options.bus.emit({
      action: current ? "mentor.reassigned" : "mentor.assigned",
      actorId: options.actorId,
      subjectType: "User",
      subjectId: student.id,
      before: current ? { mentorId: current.mentorId } : null,
      after: { mentorId: mentor.id },
    });
    moved += 1;
  }
  return moved;
}
