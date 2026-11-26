import { randomUUID } from "node:crypto";
import mongoose, { Schema } from "mongoose";

export type SettingsRecord = {
  id: string;
  studentDirectMessages: boolean;
  groupChat: boolean;
  version: number;
};

export type SettingsPatch = {
  studentDirectMessages?: boolean;
  groupChat?: boolean;
};

const DEFAULTS: SettingsRecord = {
  id: "platform",
  studentDirectMessages: false,
  groupChat: false,
  version: 0,
};

export interface SettingsRepository {
  get(): Promise<SettingsRecord>;
  update(expectedVersion: number, patch: SettingsPatch): Promise<SettingsRecord | "conflict">;
}

export function createMemorySettingsRepository(): SettingsRepository {
  let current: SettingsRecord = { ...DEFAULTS, id: randomUUID() };
  return {
    async get() {
      return { ...current };
    },
    async update(expectedVersion, patch) {
      if (current.version !== expectedVersion) {
        return "conflict";
      }
      current = {
        ...current,
        studentDirectMessages: patch.studentDirectMessages ?? current.studentDirectMessages,
        groupChat: patch.groupChat ?? current.groupChat,
        version: current.version + 1,
      };
      return { ...current };
    },
  };
}

const settingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    studentDirectMessages: { type: Boolean, required: true, default: false },
    groupChat: { type: Boolean, required: true, default: false },
    version: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

const SettingsModel = (mongoose.models.PlatformSettings ?? mongoose.model("PlatformSettings", settingsSchema)) as mongoose.Model<{
  key: string;
  studentDirectMessages: boolean;
  groupChat: boolean;
  version: number;
}>;

function toRecord(doc: { _id: { toString(): string }; studentDirectMessages: boolean; groupChat: boolean; version: number }): SettingsRecord {
  return {
    id: doc._id.toString(),
    studentDirectMessages: doc.studentDirectMessages,
    groupChat: doc.groupChat,
    version: doc.version,
  };
}

export function createMongoSettingsRepository(): SettingsRepository {
  return {
    async get() {
      const existing = await SettingsModel.findOne({ key: "platform" }).lean();
      if (existing) {
        return toRecord(existing);
      }
      const created = await SettingsModel.create({ key: "platform", studentDirectMessages: false, groupChat: false, version: 0 });
      return toRecord(created);
    },
    async update(expectedVersion, patch) {
      const set: Record<string, boolean> = {};
      if (patch.studentDirectMessages !== undefined) {
        set.studentDirectMessages = patch.studentDirectMessages;
      }
      if (patch.groupChat !== undefined) {
        set.groupChat = patch.groupChat;
      }
      const updated = await SettingsModel.findOneAndUpdate(
        { key: "platform", version: expectedVersion },
        { $set: set, $inc: { version: 1 } },
        { new: true },
      ).lean();
      return updated ? toRecord(updated) : "conflict";
    },
  };
}
