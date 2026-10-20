import { model, models, Schema, type InferSchemaType } from "mongoose";

const holdingSchema = new Schema(
  {
    teamId: { type: Schema.Types.ObjectId, ref: "Team", required: true, unique: true },
    problemStatementId: { type: Schema.Types.ObjectId, ref: "ProblemStatement", required: true, index: true },
    amount: { type: Number, required: true, min: 1 },
    sequence: { type: Number, required: true, min: 0, default: 0 },
  },
  { strict: "throw", timestamps: true },
);

export type HoldingDocument = InferSchemaType<typeof holdingSchema>;
export const Holding = models.Holding ?? model("Holding", holdingSchema);
