import { randomUUID } from "node:crypto";
import mongoose, { Schema } from "mongoose";

export type CohortRecord = {
  id: string;
  name: string;
  academicYear: string;
  startDate: Date;
  endDate: Date;
  status: "UPCOMING" | "ACTIVE" | "ARCHIVED";
};

export type NewCohort = Omit<CohortRecord, "id" | "status">;

export class DuplicateCohortError extends Error {
  constructor() {
    super("A cohort with this name already exists.");
    this.name = "DuplicateCohortError";
  }
}

export interface CohortRepository {
  list(): Promise<CohortRecord[]>;
  findById(id: string): Promise<CohortRecord | null>;
  create(input: NewCohort): Promise<CohortRecord>;
}

export function createMemoryCohortRepository(): CohortRepository {
  const byId = new Map<string, CohortRecord>();
  return {
    async list() {
      return [...byId.values()];
    },
    async findById(id) {
      return byId.get(id) ?? null;
    },
    async create(input) {
      if ([...byId.values()].some((cohort) => cohort.name.toLowerCase() === input.name.toLowerCase())) {
        throw new DuplicateCohortError();
      }
      const record: CohortRecord = { ...input, id: randomUUID(), status: "ACTIVE" };
      byId.set(record.id, record);
      return record;
    },
  };
}

const cohortSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    academicYear: { type: String, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    status: { type: String, required: true, enum: ["UPCOMING", "ACTIVE", "ARCHIVED"], default: "ACTIVE" },
  },
  { timestamps: true },
);

const CohortModel = (mongoose.models.Cohort ?? mongoose.model("Cohort", cohortSchema)) as mongoose.Model<{
  name: string;
  academicYear: string;
  startDate: Date;
  endDate: Date;
  status: CohortRecord["status"];
}>;

function toRecord(doc: {
  _id: { toString(): string };
  name: string;
  academicYear: string;
  startDate: Date;
  endDate: Date;
  status: CohortRecord["status"];
}): CohortRecord {
  return {
    id: doc._id.toString(),
    name: doc.name,
    academicYear: doc.academicYear,
    startDate: doc.startDate,
    endDate: doc.endDate,
    status: doc.status,
  };
}

export function createMongoCohortRepository(): CohortRepository {
  return {
    async list() {
      const docs = await CohortModel.find().lean();
      return docs.map((doc) => toRecord(doc));
    },
    async findById(id) {
      if (!mongoose.isValidObjectId(id)) {
        return null;
      }
      const doc = await CohortModel.findById(id).lean();
      return doc ? toRecord(doc) : null;
    },
    async create(input) {
      try {
        const doc = await CohortModel.create({ ...input, status: "ACTIVE" });
        return toRecord(doc);
      } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
          throw new DuplicateCohortError();
        }
        throw error;
      }
    },
  };
}
