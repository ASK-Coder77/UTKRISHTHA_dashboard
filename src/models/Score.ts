import { model, models, Schema, type InferSchemaType } from "mongoose";

const scoreSchema = new Schema(
  {
    roundId: { type: Schema.Types.ObjectId, ref: "Round", required: true },
    judgeEmail: { type: String, required: true, trim: true, lowercase: true },
    teamId: { type: Schema.Types.ObjectId, ref: "Team", required: true },
    points: { type: Number, required: true, min: 0 },
    criterionScores: {
      type: [{ criterionName: { type: String, required: true, trim: true }, points: { type: Number, required: true, min: 0 } }],
      required: true,
      default: [],
    },
  },
  { strict: "throw", timestamps: true },
);

scoreSchema.index({ roundId: 1, judgeEmail: 1, teamId: 1 }, { unique: true });

export type ScoreDocument = InferSchemaType<typeof scoreSchema>;
export const Score = models.Score ?? model("Score", scoreSchema);
