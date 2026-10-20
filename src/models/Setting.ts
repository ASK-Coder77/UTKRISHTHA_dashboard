import { model, models, Schema, type InferSchemaType } from "mongoose";

const settingSchema = new Schema(
  {
    singletonKey: { type: String, required: true, unique: true, immutable: true, default: "global" },
    startingPoints: { type: Number, required: true, default: 100, min: 0 },
    eventYear: { type: Number, required: true, default: 2026, min: 2000, max: 2100 },
    defaultTeamsPerPs: { type: Number, min: 1, default: 5 },
    minIncrement: { type: Number, required: true, default: 1, min: 1 },
    minTeamSize: { type: Number, required: true, default: 2, min: 1 },
    maxTeamSize: { type: Number, required: true, default: 3, min: 1 },
    registrationOpen: { type: Boolean, required: true, default: false },
    powerupMultiplier: { type: Number, required: true, default: 1, min: 0 },
    powerupForAllocatedTeams: { type: Boolean, required: true, default: true },
    allowNonCollegeJudges: { type: Boolean, required: true, default: false },
    allowSameJudgeAcrossRounds: { type: Boolean, required: true, default: false },
    resultsPublished: { type: Boolean, required: true, default: false },
    submissionsOpen: { type: Boolean, required: true, default: false },
    redemptionOpen: { type: Boolean, required: true, default: false },
  },
  { strict: "throw", timestamps: true },
);

export type SettingDocument = InferSchemaType<typeof settingSchema>;

// During Next.js development, a previously loaded version of this model can
// remain cached after the schema changes. Replace only that incompatible cache.
if (models.Setting && (!models.Setting.schema.path("singletonKey") || !models.Setting.schema.path("eventYear") || !models.Setting.schema.path("redemptionOpen"))) {
  delete models.Setting;
}

export const Setting = models.Setting ?? model("Setting", settingSchema);
