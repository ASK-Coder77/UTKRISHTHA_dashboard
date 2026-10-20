import { model, models, Schema, type InferSchemaType } from "mongoose";

const creditRedemptionSchema = new Schema(
  {
    teamId: { type: Schema.Types.ObjectId, ref: "Team", required: true, immutable: true, index: true },
    actorUserId: { type: Schema.Types.ObjectId, ref: "User", default: null, immutable: true },
    amount: { type: Number, required: true, immutable: true, min: 1 },
    reason: { type: String, required: true, immutable: true, trim: true, maxlength: 500 },
    previousBalance: { type: Number, required: true, immutable: true, min: 0 },
    newBalance: { type: Number, required: true, immutable: true, min: 0 },
  },
  { strict: "throw", timestamps: { createdAt: true, updatedAt: false } },
);

creditRedemptionSchema.pre(["updateOne", "updateMany", "findOneAndUpdate", "deleteOne", "deleteMany", "findOneAndDelete"], function () {
  throw new Error("Credit redemption records are append-only");
});

export type CreditRedemptionDocument = InferSchemaType<typeof creditRedemptionSchema>;
export const CreditRedemption = models.CreditRedemption ?? model("CreditRedemption", creditRedemptionSchema);
