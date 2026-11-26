import mongoose, { Schema } from "mongoose";

export type PreferenceRecord = {
  userId: string;
  email: boolean;
};

export interface PreferenceRepository {
  get(userId: string): Promise<PreferenceRecord>;
  set(userId: string, email: boolean): Promise<PreferenceRecord>;
}

export function createMemoryPreferenceRepository(): PreferenceRepository {
  const byUser = new Map<string, boolean>();
  return {
    async get(userId) {
      return { userId, email: byUser.get(userId) ?? false };
    },
    async set(userId, email) {
      byUser.set(userId, email);
      return { userId, email };
    },
  };
}

const preferenceSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, unique: true },
    email: { type: Boolean, required: true, default: false },
  },
  { timestamps: true },
);

const PreferenceModel = (mongoose.models.NotificationPreference ??
  mongoose.model("NotificationPreference", preferenceSchema)) as mongoose.Model<{
  userId: { toString(): string };
  email: boolean;
}>;

export function createMongoPreferenceRepository(): PreferenceRepository {
  return {
    async get(userId) {
      if (!mongoose.isValidObjectId(userId)) {
        return { userId, email: false };
      }
      const doc = await PreferenceModel.findOne({ userId }).lean();
      return { userId, email: doc?.email ?? false };
    },
    async set(userId, email) {
      const doc = await PreferenceModel.findOneAndUpdate(
        { userId },
        { $set: { email } },
        { new: true, upsert: true },
      ).lean();
      return { userId, email: doc?.email ?? email };
    },
  };
}
