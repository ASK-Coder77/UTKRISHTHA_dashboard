import { model, models, Schema, type InferSchemaType } from "mongoose";

const problemStatementSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    domain: { type: String, required: true, trim: true, default: "General" },
    track: { type: String, required: true, enum: ["web_dev", "ai_ml"] },
    description: { type: String, required: true, trim: true },
    basePrice: { type: Number, required: true, min: 1 },
    capacity: { type: Number, min: 1, default: null },
    revealed: { type: Boolean, required: true, default: false },
    status: { type: String, required: true, enum: ["upcoming", "live", "closed"], default: "upcoming" },
    auctionOutcome: { type: String, enum: ["sold", "unsold"], default: null },
    version: { type: Number, required: true, default: 0, min: 0 },
    bidSequence: { type: Number, required: true, default: 0, min: 0 },
  },
  { strict: "throw", timestamps: true },
);

export type ProblemStatementDocument = InferSchemaType<typeof problemStatementSchema>;
export const ProblemStatement = models.ProblemStatement ?? model("ProblemStatement", problemStatementSchema);
