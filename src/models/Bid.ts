import { model, models, Schema, type InferSchemaType } from "mongoose";

const bidSchema = new Schema(
  {
    teamId: { type: Schema.Types.ObjectId, ref: "Team", required: true, index: true },
    problemStatementId: { type: Schema.Types.ObjectId, ref: "ProblemStatement", required: true, index: true },
    amount: { type: Number, required: true, min: 1 },
    placedByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { strict: "throw", timestamps: true },
);

bidSchema.index({ problemStatementId: 1, createdAt: -1 });

export type BidDocument = InferSchemaType<typeof bidSchema>;
export const Bid = models.Bid ?? model("Bid", bidSchema);
