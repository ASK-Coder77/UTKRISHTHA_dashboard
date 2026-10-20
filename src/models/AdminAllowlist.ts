import { model, models, Schema } from "mongoose";

const adminAllowlistSchema = new Schema(
  { email: { type: String, required: true, unique: true, lowercase: true, trim: true }, addedBy: { type: String, required: true } },
  { timestamps: true },
);

export const AdminAllowlist = models.AdminAllowlist ?? model("AdminAllowlist", adminAllowlistSchema);
