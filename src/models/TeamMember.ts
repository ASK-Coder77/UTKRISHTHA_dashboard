import { model, models, Schema, type InferSchemaType } from "mongoose";

const teamMemberSchema = new Schema(
  {
    teamId: { type: Schema.Types.ObjectId, ref: "Team", required: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    normalizedEmail: { type: String, required: true, unique: true, trim: true, lowercase: true },
    phone: { type: String, default: null, trim: true },
    // These values are cleared by the post-event admin anonymization action.
    rollNumber: { type: String, default: null, trim: true },
    normalizedRollNumber: { type: String, required: true, unique: true, trim: true, uppercase: true },
    year: { type: String, required: true, enum: ["UG1", "UG2", "UG3", "UG4"] },
    branch: { type: String, required: true, trim: true },
  },
  { strict: "throw", timestamps: true },
);

export type TeamMemberDocument = InferSchemaType<typeof teamMemberSchema>;
export const TeamMember = models.TeamMember ?? model("TeamMember", teamMemberSchema);
