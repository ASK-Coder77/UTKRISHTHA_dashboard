import { model, models, Schema, type InferSchemaType } from "mongoose";

const auditLogSchema = new Schema(
  {
    action: { type: String, required: true, immutable: true, trim: true },
    actorUserId: { type: Schema.Types.ObjectId, ref: "User", default: null, immutable: true, index: true },
    targetType: { type: String, required: true, immutable: true, trim: true },
    targetId: { type: Schema.Types.ObjectId, default: null, immutable: true, index: true },
    previousValue: { type: Schema.Types.Mixed, default: null, immutable: true },
    newValue: { type: Schema.Types.Mixed, default: null, immutable: true },
  },
  { strict: "throw", timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.pre(["updateOne", "updateMany", "findOneAndUpdate", "deleteOne", "deleteMany", "findOneAndDelete"], function () {
  throw new Error("Audit log entries are append-only");
});

export type AuditLogDocument = InferSchemaType<typeof auditLogSchema>;
export const AuditLog = models.AuditLog ?? model("AuditLog", auditLogSchema);
