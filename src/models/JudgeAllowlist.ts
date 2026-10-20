import { model, models, Schema } from "mongoose";

const judgeAllowlistSchema = new Schema(
  { email: { type: String, required: true, unique: true, lowercase: true, trim: true }, addedBy: { type: String, required: true } },
  { timestamps: true },
);

export const JudgeAllowlist = models.JudgeAllowlist ?? model("JudgeAllowlist", judgeAllowlistSchema);
