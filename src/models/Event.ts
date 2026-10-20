import { model, models, Schema, type InferSchemaType } from "mongoose";

const eventSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    date: { type: Date, required: true },
    time: { type: String, required: true, trim: true },
    venue: { type: String, required: true, trim: true },
    status: { type: String, required: true, enum: ["upcoming", "live", "completed"], default: "upcoming" },
  },
  { strict: "throw", timestamps: true },
);

export type EventDocument = InferSchemaType<typeof eventSchema>;
export const Event = models.Event ?? model("Event", eventSchema);
