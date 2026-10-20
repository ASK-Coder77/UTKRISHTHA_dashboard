import { model, models, Schema, type InferSchemaType } from "mongoose";

const teamSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    normalizedName: { type: String, required: true, unique: true, trim: true, lowercase: true },
    leaderEmail: { type: String, required: true, unique: true, trim: true, lowercase: true },
    track: { type: String, required: true, enum: ["web_dev", "ai_ml"] },
    previousHackathonExperience: { type: String, enum: ["none", "1-2", "3_or_more"], default: null },
    githubUrl: { type: String, default: null, trim: true },
    linkedinUrl: { type: String, default: null, trim: true },
    rulesAcceptedAt: { type: Date, required: true },
    balance: { type: Number, required: true, default: 0, min: 0 },
    auctionVersion: { type: Number, required: true, default: 0, min: 0 },
    pointsGiven: { type: Boolean, required: true, default: false },
    assignedPsId: { type: Schema.Types.ObjectId, ref: "ProblemStatement", default: null },
    assignmentType: { type: String, enum: ["won", "allocated"], default: null },
    liveUrl: { type: String, default: null, trim: true },
    repoUrl: { type: String, default: null, trim: true },
  },
  { strict: "throw", timestamps: true },
);

export type TeamDocument = InferSchemaType<typeof teamSchema>;
export const Team = models.Team ?? model("Team", teamSchema);
