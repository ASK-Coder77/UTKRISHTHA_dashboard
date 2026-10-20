import { model, models, Schema, type InferSchemaType } from "mongoose";

const roundSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    order: { type: Number, required: true, unique: true, min: 1 },
    description: { type: String, required: true, trim: true },
    criteria: { type: [{ name: { type: String, required: true, trim: true }, maxPoints: { type: Number, required: true, min: 0 } }], default: [] },
    maxPointsPerJudge: { type: Number, required: true, default: 100, min: 0 },
    aggregation: { type: String, required: true, enum: ["average", "sum"], default: "average" },
    weight: { type: Number, required: true, default: 1, min: 0 },
    assignedJudgeEmails: { type: [String], required: true, default: [] },
    status: { type: String, required: true, enum: ["upcoming", "open", "closed"], default: "upcoming" },
  },
  { strict: "throw", timestamps: true },
);

export type RoundDocument = InferSchemaType<typeof roundSchema>;
export const Round = models.Round ?? model("Round", roundSchema);
