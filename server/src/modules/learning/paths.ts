import type { DayItemKind, ResourceStatus } from "@dhruva/shared";
import { randomUUID } from "node:crypto";
import mongoose, { Schema } from "mongoose";

export type DayItemRecord = {
  kind: DayItemKind;
  refId: string;
  required: boolean;
};

export type DayNode = {
  id: string;
  dayNumber: number;
  title: string;
  items: DayItemRecord[];
};

export type WeekNode = {
  id: string;
  weekNumber: number;
  title: string;
  days: DayNode[];
};

export type ModuleNode = {
  id: string;
  order: number;
  title: string;
  weeks: WeekNode[];
};

export type PathRecord = {
  id: string;
  title: string;
  description: string;
  cohortId: string;
  durationDays: number;
  status: ResourceStatus;
  createdBy: string;
  publishedAt: Date | null;
  revision: number;
  modules: ModuleNode[];
  createdAt: Date;
  updatedAt: Date;
};

export type PathWrite = {
  title: string;
  description: string;
  cohortId: string;
  durationDays: number;
  modules: {
    order: number;
    title: string;
    weeks: {
      weekNumber: number;
      title: string;
      days: { dayNumber: number; title: string; items: DayItemRecord[] }[];
    }[];
  }[];
};

export type PathMutation = PathRecord | "conflict" | "invalid" | null;

export interface LearningPathRepository {
  list(): Promise<PathRecord[]>;
  findById(id: string): Promise<PathRecord | null>;
  findLatestPublished(cohortId: string): Promise<PathRecord | null>;
  create(input: PathWrite & { createdBy: string }): Promise<PathRecord>;
  replace(id: string, expectedRevision: number, input: PathWrite): Promise<PathMutation>;
  setStatus(
    id: string,
    expectedRevision: number,
    status: ResourceStatus,
    publishedAt: Date | null,
  ): Promise<PathMutation>;
}

function cloneModules(modules: PathWrite["modules"]): ModuleNode[] {
  return modules.map((module) => ({
    id: randomUUID(),
    order: module.order,
    title: module.title,
    weeks: module.weeks.map((week) => ({
      id: randomUUID(),
      weekNumber: week.weekNumber,
      title: week.title,
      days: week.days.map((day) => ({
        id: randomUUID(),
        dayNumber: day.dayNumber,
        title: day.title,
        items: day.items.map((item) => ({ ...item })),
      })),
    })),
  }));
}

export function createMemoryLearningPathRepository(): LearningPathRepository {
  const byId = new Map<string, PathRecord>();

  function latest(cohortId: string): PathRecord | null {
    const published = [...byId.values()].filter((path) => path.cohortId === cohortId && path.status === "PUBLISHED");
    published.sort((left, right) => (right.publishedAt?.getTime() ?? 0) - (left.publishedAt?.getTime() ?? 0));
    return published[0] ?? null;
  }

  return {
    async list() {
      return [...byId.values()];
    },
    async findById(id) {
      const found = byId.get(id);
      return found ? structuredClone(found) : null;
    },
    async findLatestPublished(cohortId) {
      const found = latest(cohortId);
      return found ? structuredClone(found) : null;
    },
    async create(input) {
      const now = new Date();
      const record: PathRecord = {
        id: randomUUID(),
        title: input.title,
        description: input.description,
        cohortId: input.cohortId,
        durationDays: input.durationDays,
        status: "DRAFT",
        createdBy: input.createdBy,
        publishedAt: null,
        revision: 0,
        modules: cloneModules(input.modules),
        createdAt: now,
        updatedAt: now,
      };
      byId.set(record.id, record);
      return structuredClone(record);
    },
    async replace(id, expectedRevision, input) {
      const current = byId.get(id);
      if (!current) {
        return null;
      }
      if (current.revision !== expectedRevision) {
        return "conflict";
      }
      if (current.status === "ARCHIVED") {
        return "invalid";
      }
      current.title = input.title;
      current.description = input.description;
      current.cohortId = input.cohortId;
      current.durationDays = input.durationDays;
      current.modules = cloneModules(input.modules);
      current.revision += 1;
      current.updatedAt = new Date();
      return structuredClone(current);
    },
    async setStatus(id, expectedRevision, status, publishedAt) {
      const current = byId.get(id);
      if (!current) {
        return null;
      }
      if (current.revision !== expectedRevision) {
        return "conflict";
      }
      if (current.status === "ARCHIVED" || (status === "PUBLISHED" && current.status !== "DRAFT")) {
        return "invalid";
      }
      current.status = status;
      current.publishedAt = publishedAt;
      current.revision += 1;
      current.updatedAt = new Date();
      return structuredClone(current);
    },
  };
}

const itemSchema = new Schema(
  {
    kind: { type: String, required: true, enum: ["RESOURCE", "ASSIGNMENT", "ASSESSMENT"] },
    refId: { type: String, required: true },
    required: { type: Boolean, required: true },
  },
  { _id: false },
);

const pathSchema = new Schema(
  {
    title: { type: String, required: true },
    description: { type: String, default: "" },
    cohortId: { type: Schema.Types.ObjectId, required: true, index: true },
    durationDays: { type: Number, required: true },
    status: { type: String, required: true, enum: ["DRAFT", "PUBLISHED", "ARCHIVED"] },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    publishedAt: { type: Date, default: null },
    revision: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

const moduleSchema = new Schema(
  {
    pathId: { type: Schema.Types.ObjectId, required: true },
    order: { type: Number, required: true },
    title: { type: String, required: true },
  },
  { timestamps: false },
);
moduleSchema.index({ pathId: 1, order: 1 }, { unique: true });

const weekSchema = new Schema(
  {
    moduleId: { type: Schema.Types.ObjectId, required: true },
    weekNumber: { type: Number, required: true },
    title: { type: String, required: true },
  },
  { timestamps: false },
);
weekSchema.index({ moduleId: 1, weekNumber: 1 }, { unique: true });

const daySchema = new Schema(
  {
    weekId: { type: Schema.Types.ObjectId, required: true },
    dayNumber: { type: Number, required: true },
    title: { type: String, required: true },
    items: { type: [itemSchema], default: [] },
  },
  { timestamps: false },
);
daySchema.index({ weekId: 1, dayNumber: 1 }, { unique: true });

type PathDoc = {
  _id: mongoose.Types.ObjectId;
  title: string;
  description?: string;
  cohortId: { toString(): string };
  durationDays: number;
  status: ResourceStatus;
  createdBy: { toString(): string };
  publishedAt?: Date | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
};

type ModuleDoc = { _id: mongoose.Types.ObjectId; pathId: { toString(): string }; order: number; title: string };
type WeekDoc = { _id: mongoose.Types.ObjectId; moduleId: { toString(): string }; weekNumber: number; title: string };
type DayDoc = {
  _id: mongoose.Types.ObjectId;
  weekId: { toString(): string };
  dayNumber: number;
  title: string;
  items?: DayItemRecord[];
};

const PathModel = (mongoose.models.LearningPath ?? mongoose.model("LearningPath", pathSchema)) as mongoose.Model<PathDoc>;
const ModuleModel = (mongoose.models.LearningModule ?? mongoose.model("LearningModule", moduleSchema)) as mongoose.Model<ModuleDoc>;
const WeekModel = (mongoose.models.LearningWeek ?? mongoose.model("LearningWeek", weekSchema)) as mongoose.Model<WeekDoc>;
const DayModel = (mongoose.models.LearningDay ?? mongoose.model("LearningDay", daySchema)) as mongoose.Model<DayDoc>;

function stitch(paths: PathDoc[], modules: ModuleDoc[], weeks: WeekDoc[], days: DayDoc[]): PathRecord[] {
  const daysByWeek = new Map<string, DayNode[]>();
  for (const day of days) {
    const weekId = day.weekId.toString();
    const list = daysByWeek.get(weekId) ?? [];
    list.push({
      id: day._id.toString(),
      dayNumber: day.dayNumber,
      title: day.title,
      items: (day.items ?? []).map((item) => ({ kind: item.kind, refId: item.refId, required: item.required })),
    });
    daysByWeek.set(weekId, list);
  }
  const weeksByModule = new Map<string, WeekNode[]>();
  for (const week of weeks) {
    const moduleId = week.moduleId.toString();
    const list = weeksByModule.get(moduleId) ?? [];
    list.push({
      id: week._id.toString(),
      weekNumber: week.weekNumber,
      title: week.title,
      days: (daysByWeek.get(week._id.toString()) ?? []).sort((left, right) => left.dayNumber - right.dayNumber),
    });
    weeksByModule.set(moduleId, list);
  }
  const modulesByPath = new Map<string, ModuleNode[]>();
  for (const module of modules) {
    const pathId = module.pathId.toString();
    const list = modulesByPath.get(pathId) ?? [];
    list.push({
      id: module._id.toString(),
      order: module.order,
      title: module.title,
      weeks: (weeksByModule.get(module._id.toString()) ?? []).sort((left, right) => left.weekNumber - right.weekNumber),
    });
    modulesByPath.set(pathId, list);
  }
  return paths.map((path) => ({
    id: path._id.toString(),
    title: path.title,
    description: path.description ?? "",
    cohortId: path.cohortId.toString(),
    durationDays: path.durationDays,
    status: path.status,
    createdBy: path.createdBy.toString(),
    publishedAt: path.publishedAt ?? null,
    revision: path.revision,
    modules: (modulesByPath.get(path._id.toString()) ?? []).sort((left, right) => left.order - right.order),
    createdAt: path.createdAt,
    updatedAt: path.updatedAt,
  }));
}

async function load(filter: Record<string, unknown>): Promise<PathRecord[]> {
  const paths = await PathModel.find(filter).lean();
  if (paths.length === 0) {
    return [];
  }
  const pathIds = paths.map((path) => path._id);
  const modules = await ModuleModel.find({ pathId: { $in: pathIds } }).lean();
  const weeks = await WeekModel.find({ moduleId: { $in: modules.map((module) => module._id) } }).lean();
  const days = await DayModel.find({ weekId: { $in: weeks.map((week) => week._id) } }).lean();
  return stitch(paths, modules, weeks, days);
}

async function insertTree(
  pathId: mongoose.Types.ObjectId,
  modules: PathWrite["modules"],
  session: mongoose.ClientSession,
): Promise<void> {
  for (const module of modules) {
    const created = await ModuleModel.create([{ pathId, order: module.order, title: module.title }], { session });
    const moduleId = created[0]?._id;
    if (!moduleId) {
      throw new Error("Module was not stored.");
    }
    for (const week of module.weeks) {
      const weekDocs = await WeekModel.create([{ moduleId, weekNumber: week.weekNumber, title: week.title }], { session });
      const weekId = weekDocs[0]?._id;
      if (!weekId) {
        throw new Error("Week was not stored.");
      }
      if (week.days.length > 0) {
        await DayModel.insertMany(
          week.days.map((day) => ({
            weekId,
            dayNumber: day.dayNumber,
            title: day.title,
            items: day.items,
          })),
          { session },
        );
      }
    }
  }
}

async function deleteTree(pathId: string, session: mongoose.ClientSession): Promise<void> {
  const modules = await ModuleModel.find({ pathId }).session(session).lean();
  const moduleIds = modules.map((module) => module._id);
  const weeks = await WeekModel.find({ moduleId: { $in: moduleIds } }).session(session).lean();
  const weekIds = weeks.map((week) => week._id);
  await DayModel.deleteMany({ weekId: { $in: weekIds } }).session(session);
  await WeekModel.deleteMany({ moduleId: { $in: moduleIds } }).session(session);
  await ModuleModel.deleteMany({ pathId }).session(session);
}

export function createMongoLearningPathRepository(): LearningPathRepository {
  return {
    async list() {
      return load({});
    },
    async findById(id) {
      if (!mongoose.isValidObjectId(id)) {
        return null;
      }
      const rows = await load({ _id: id });
      return rows[0] ?? null;
    },
    async findLatestPublished(cohortId) {
      if (!mongoose.isValidObjectId(cohortId)) {
        return null;
      }
      const rows = await load({ cohortId, status: "PUBLISHED" });
      rows.sort((left, right) => (right.publishedAt?.getTime() ?? 0) - (left.publishedAt?.getTime() ?? 0));
      return rows[0] ?? null;
    },
    async create(input) {
      const session = await mongoose.startSession();
      let createdId = "";
      try {
        await session.withTransaction(async () => {
          const created = await PathModel.create(
            [
              {
                title: input.title,
                description: input.description,
                cohortId: input.cohortId,
                durationDays: input.durationDays,
                status: "DRAFT",
                createdBy: input.createdBy,
                publishedAt: null,
                revision: 0,
              },
            ],
            { session },
          );
          const doc = created[0];
          if (!doc) {
            throw new Error("Path was not stored.");
          }
          createdId = doc._id.toString();
          await insertTree(doc._id, input.modules, session);
        });
      } finally {
        await session.endSession();
      }
      const rows = await load({ _id: createdId });
      const record = rows[0];
      if (!record) {
        throw new Error("Path was not stored.");
      }
      return record;
    },
    async replace(id, expectedRevision, input) {
      if (!mongoose.isValidObjectId(id)) {
        return null;
      }
      const session = await mongoose.startSession();
      const box: { outcome: "ok" | "missing" | "conflict" | "invalid" } = { outcome: "missing" };
      try {
        await session.withTransaction(async () => {
          const current = await PathModel.findById(id).session(session);
          if (!current) {
            box.outcome = "missing";
            return;
          }
          if (current.revision !== expectedRevision) {
            box.outcome = "conflict";
            return;
          }
          if (current.status === "ARCHIVED") {
            box.outcome = "invalid";
            return;
          }
          await deleteTree(id, session);
          await insertTree(current._id, input.modules, session);
          current.title = input.title;
          current.description = input.description;
          current.set("cohortId", input.cohortId);
          current.durationDays = input.durationDays;
          current.revision += 1;
          await current.save({ session });
          box.outcome = "ok";
        });
      } finally {
        await session.endSession();
      }
      if (box.outcome === "missing") {
        return null;
      }
      if (box.outcome === "conflict") {
        return "conflict";
      }
      if (box.outcome === "invalid") {
        return "invalid";
      }
      const rows = await load({ _id: id });
      return rows[0] ?? null;
    },
    async setStatus(id, expectedRevision, status, publishedAt) {
      if (!mongoose.isValidObjectId(id)) {
        return null;
      }
      const current = await PathModel.findById(id);
      if (!current) {
        return null;
      }
      if (current.revision !== expectedRevision) {
        return "conflict";
      }
      if (current.status === "ARCHIVED" || (status === "PUBLISHED" && current.status !== "DRAFT")) {
        return "invalid";
      }
      current.status = status;
      current.publishedAt = publishedAt;
      current.revision += 1;
      await current.save();
      const rows = await load({ _id: id });
      return rows[0] ?? null;
    },
  };
}
