import { model, models, Schema, type InferSchemaType } from "mongoose";

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, default: "" },
    image: { type: String, default: "" },
    lastLoginAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export type UserDocument = InferSchemaType<typeof userSchema>;
export const User = models.User ?? model("User", userSchema);
