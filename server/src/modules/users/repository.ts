import type { Branch, Capabilities, Role, UserStatus } from "@dhruva/shared";
import { randomUUID } from "node:crypto";
import mongoose, { Schema } from "mongoose";

export type UserRecord = {
  id: string;
  name: string;
  email: string;
  passwordHash: string | null;
  role: Role;
  branch: Branch | null;
  cohortId: string | null;
  status: UserStatus;
  capabilities: Capabilities;
  invitedAt: Date | null;
  activatedAt: Date | null;
};

export type NewUser = Omit<UserRecord, "id">;

export class DuplicateEmailError extends Error {
  constructor() {
    super("An account with this email already exists.");
    this.name = "DuplicateEmailError";
  }
}

export interface UserRepository {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  list(filter?: { role?: Role; status?: UserStatus }): Promise<UserRecord[]>;
  create(input: NewUser): Promise<UserRecord>;
  update(id: string, patch: Partial<Omit<UserRecord, "id" | "email">>): Promise<UserRecord | null>;
}

const emptyCapabilities = (): Capabilities => ({
  canCreateResources: false,
  canCreateAssessments: false,
  canGradeAssessments: false,
});

export function createMemoryUserRepository(): UserRepository {
  const byId = new Map<string, UserRecord>();

  return {
    async findByEmail(email) {
      const normalized = email.toLowerCase();
      return [...byId.values()].find((user) => user.email === normalized) ?? null;
    },
    async findById(id) {
      return byId.get(id) ?? null;
    },
    async list(filter = {}) {
      return [...byId.values()].filter(
        (user) => (filter.role ? user.role === filter.role : true) && (filter.status ? user.status === filter.status : true),
      );
    },
    async create(input) {
      const email = input.email.toLowerCase();
      if ([...byId.values()].some((user) => user.email === email)) {
        throw new DuplicateEmailError();
      }
      const record: UserRecord = { ...input, id: randomUUID(), email, capabilities: input.capabilities ?? emptyCapabilities() };
      byId.set(record.id, record);
      return record;
    },
    async update(id, patch) {
      const current = byId.get(id);
      if (!current) {
        return null;
      }
      const next = { ...current, ...patch };
      byId.set(id, next);
      return next;
    },
  };
}

const userSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, default: null, select: false },
    role: { type: String, required: true, enum: ["STUDENT", "MENTOR", "ADMIN"] },
    branch: { type: String, default: null },
    cohortId: { type: Schema.Types.ObjectId, default: null },
    status: { type: String, required: true, enum: ["INVITED", "ACTIVE", "DEACTIVATED"] },
    capabilities: {
      canCreateResources: { type: Boolean, default: false },
      canCreateAssessments: { type: Boolean, default: false },
      canGradeAssessments: { type: Boolean, default: false },
    },
    invitedAt: { type: Date, default: null },
    activatedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

const UserModel = (mongoose.models.User ?? mongoose.model("User", userSchema)) as mongoose.Model<{
  name: string;
  email: string;
  passwordHash?: string | null;
  role: Role;
  branch?: Branch | null;
  cohortId?: mongoose.Types.ObjectId | null;
  status: UserStatus;
  capabilities?: Partial<Capabilities>;
  invitedAt?: Date | null;
  activatedAt?: Date | null;
}>;

function toRecord(doc: {
  _id: { toString(): string };
  name: string;
  email: string;
  passwordHash?: string | null;
  role: Role;
  branch?: Branch | null;
  cohortId?: { toString(): string } | null;
  status: UserStatus;
  capabilities?: Partial<Capabilities>;
  invitedAt?: Date | null;
  activatedAt?: Date | null;
}): UserRecord {
  return {
    id: doc._id.toString(),
    name: doc.name,
    email: doc.email,
    passwordHash: doc.passwordHash ?? null,
    role: doc.role,
    branch: doc.branch ?? null,
    cohortId: doc.cohortId ? doc.cohortId.toString() : null,
    status: doc.status,
    capabilities: {
      canCreateResources: doc.capabilities?.canCreateResources ?? false,
      canCreateAssessments: doc.capabilities?.canCreateAssessments ?? false,
      canGradeAssessments: doc.capabilities?.canGradeAssessments ?? false,
    },
    invitedAt: doc.invitedAt ?? null,
    activatedAt: doc.activatedAt ?? null,
  };
}

function isDuplicate(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

export function createMongoUserRepository(): UserRepository {
  return {
    async findByEmail(email) {
      const doc = await UserModel.findOne({ email: email.toLowerCase() }).select("+passwordHash").lean();
      return doc ? toRecord(doc) : null;
    },
    async findById(id) {
      if (!mongoose.isValidObjectId(id)) {
        return null;
      }
      const doc = await UserModel.findById(id).select("+passwordHash").lean();
      return doc ? toRecord(doc) : null;
    },
    async list(filter = {}) {
      const query: Record<string, string> = {};
      if (filter.role) {
        query.role = filter.role;
      }
      if (filter.status) {
        query.status = filter.status;
      }
      const docs = await UserModel.find(query).select("+passwordHash").lean();
      return docs.map((doc) => toRecord(doc));
    },
    async create(input) {
      try {
        const doc = await UserModel.create(input);
        return toRecord(doc);
      } catch (error) {
        if (isDuplicate(error)) {
          throw new DuplicateEmailError();
        }
        throw error;
      }
    },
    async update(id, patch) {
      if (!mongoose.isValidObjectId(id)) {
        return null;
      }
      const doc = await UserModel.findByIdAndUpdate(id, patch, { new: true }).select("+passwordHash").lean();
      return doc ? toRecord(doc) : null;
    },
  };
}
