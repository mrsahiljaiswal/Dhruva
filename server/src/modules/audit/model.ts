import mongoose, { Schema } from "mongoose";

const auditLogSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, default: null },
    action: { type: String, required: true },
    subjectType: { type: String, required: true },
    subjectId: { type: Schema.Types.ObjectId, default: null },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    reason: { type: String, default: null },
    requestId: { type: String, default: null },
    ip: { type: String, default: null },
    createdAt: { type: Date, default: () => new Date(), immutable: true },
  },
  { versionKey: false, timestamps: false },
);

function rejectMutation(): never {
  throw new Error("AuditLog is append-only");
}

for (const hook of [
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
] as const) {
  auditLogSchema.pre(hook, rejectMutation);
}

auditLogSchema.index({ subjectType: 1, subjectId: 1, createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

export const AuditLog = mongoose.model("AuditLog", auditLogSchema);
