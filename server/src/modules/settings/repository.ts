import { DEFAULT_SUPPORT_THRESHOLDS, type SupportThresholds } from "@dhruva/shared";
import { randomUUID } from "node:crypto";
import mongoose, { Schema } from "mongoose";

export type SettingsRecord = {
  id: string;
  studentDirectMessages: boolean;
  groupChat: boolean;
  supportThresholds: SupportThresholds;
  version: number;
};

export type SettingsPatch = {
  studentDirectMessages?: boolean;
  groupChat?: boolean;
  supportThresholds?: SupportThresholds;
};

const DEFAULTS: SettingsRecord = {
  id: "platform",
  studentDirectMessages: false,
  groupChat: false,
  supportThresholds: { ...DEFAULT_SUPPORT_THRESHOLDS },
  version: 0,
};

export interface SettingsRepository {
  get(): Promise<SettingsRecord>;
  update(expectedVersion: number, patch: SettingsPatch): Promise<SettingsRecord | "conflict">;
}

function thresholdsOf(value: Partial<SupportThresholds> | null | undefined): SupportThresholds {
  return { ...DEFAULT_SUPPORT_THRESHOLDS, ...(value ?? {}) };
}

export function createMemorySettingsRepository(): SettingsRepository {
  let current: SettingsRecord = { ...DEFAULTS, supportThresholds: { ...DEFAULT_SUPPORT_THRESHOLDS }, id: randomUUID() };
  return {
    async get() {
      return { ...current, supportThresholds: { ...current.supportThresholds } };
    },
    async update(expectedVersion, patch) {
      if (current.version !== expectedVersion) {
        return "conflict";
      }
      current = {
        ...current,
        studentDirectMessages: patch.studentDirectMessages ?? current.studentDirectMessages,
        groupChat: patch.groupChat ?? current.groupChat,
        supportThresholds: patch.supportThresholds ? { ...patch.supportThresholds } : { ...current.supportThresholds },
        version: current.version + 1,
      };
      return { ...current, supportThresholds: { ...current.supportThresholds } };
    },
  };
}

const thresholdSchema = new Schema(
  {
    attentionCompletionPct: { type: Number, required: true, default: DEFAULT_SUPPORT_THRESHOLDS.attentionCompletionPct },
    interventionCompletionPct: { type: Number, required: true, default: DEFAULT_SUPPORT_THRESHOLDS.interventionCompletionPct },
    attentionAverageScore: { type: Number, required: true, default: DEFAULT_SUPPORT_THRESHOLDS.attentionAverageScore },
    interventionAverageScore: { type: Number, required: true, default: DEFAULT_SUPPORT_THRESHOLDS.interventionAverageScore },
    attentionOverdueCount: { type: Number, required: true, default: DEFAULT_SUPPORT_THRESHOLDS.attentionOverdueCount },
    interventionOverdueCount: { type: Number, required: true, default: DEFAULT_SUPPORT_THRESHOLDS.interventionOverdueCount },
    inactiveDays: { type: Number, required: true, default: DEFAULT_SUPPORT_THRESHOLDS.inactiveDays },
  },
  { _id: false },
);

const settingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    studentDirectMessages: { type: Boolean, required: true, default: false },
    groupChat: { type: Boolean, required: true, default: false },
    supportThresholds: { type: thresholdSchema, required: true, default: () => ({ ...DEFAULT_SUPPORT_THRESHOLDS }) },
    version: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

type SettingsDoc = {
  _id: { toString(): string };
  studentDirectMessages: boolean;
  groupChat: boolean;
  supportThresholds?: Partial<SupportThresholds> | null;
  version: number;
};

const SettingsModel = (mongoose.models.PlatformSettings ??
  mongoose.model("PlatformSettings", settingsSchema)) as mongoose.Model<SettingsDoc>;

function toRecord(doc: SettingsDoc): SettingsRecord {
  return {
    id: doc._id.toString(),
    studentDirectMessages: doc.studentDirectMessages,
    groupChat: doc.groupChat,
    supportThresholds: thresholdsOf(doc.supportThresholds),
    version: doc.version,
  };
}

export function createMongoSettingsRepository(): SettingsRepository {
  return {
    async get() {
      const existing = await SettingsModel.findOne({ key: "platform" }).lean<SettingsDoc | null>();
      if (existing) {
        return toRecord(existing);
      }
      const created = await SettingsModel.create({
        key: "platform",
        studentDirectMessages: false,
        groupChat: false,
        supportThresholds: { ...DEFAULT_SUPPORT_THRESHOLDS },
        version: 0,
      });
      return toRecord(created.toObject() as SettingsDoc);
    },
    async update(expectedVersion, patch) {
      const set: Record<string, unknown> = {};
      if (patch.studentDirectMessages !== undefined) {
        set.studentDirectMessages = patch.studentDirectMessages;
      }
      if (patch.groupChat !== undefined) {
        set.groupChat = patch.groupChat;
      }
      if (patch.supportThresholds !== undefined) {
        set.supportThresholds = patch.supportThresholds;
      }
      const updated = await SettingsModel.findOneAndUpdate(
        { key: "platform", version: expectedVersion },
        { $set: set, $inc: { version: 1 } },
        { new: true },
      ).lean<SettingsDoc | null>();
      return updated ? toRecord(updated) : "conflict";
    },
  };
}
