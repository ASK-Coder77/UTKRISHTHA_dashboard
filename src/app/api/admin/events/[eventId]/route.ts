import { NextResponse } from "next/server";
import { z } from "zod";
import { connectToDatabase } from "@/lib/db";
import { AdminAuthError, checkOrigin, isValidObjectId, requireAdmin } from "@/lib/admin-auth";
import { checkAdminMutationRateLimit } from "@/lib/rate-limit";
import { AuditLog } from "@/models/AuditLog";
import { Event } from "@/models/Event";

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().min(1).max(2000).optional(),
    date: z.string().trim().datetime({ offset: true }).or(z.string().trim().date()).optional(),
    time: z.string().trim().regex(/^\d{2}:\d{2}$/).optional(),
    venue: z.string().trim().min(1).max(200).optional(),
    status: z.enum(["upcoming", "live", "completed"]).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "At least one field is required.");

type Params = { params: Promise<{ eventId: string }> };

function getIdentifier(request: Request, email: string) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return `${email}:${ip}`;
}

export async function PATCH(request: Request, { params }: Params) {
  if (!checkOrigin(request)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { eventId } = await params;
  if (!isValidObjectId(eventId)) return NextResponse.json({ error: "Invalid event ID." }, { status: 400 });

  try {
    await connectToDatabase();
    const actor = await requireAdmin("admin");

    const rl = await checkAdminMutationRateLimit(getIdentifier(request, actor.email));
    if (!rl.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid event data." }, { status: 400 });

    const existing = await Event.findById(eventId).lean<Record<string, unknown>>();
    if (!existing) return NextResponse.json({ error: "Event not found." }, { status: 404 });

    const updated = await Event.findByIdAndUpdate(eventId, { $set: parsed.data }, { new: true }).lean();
    if (!updated) return NextResponse.json({ error: "Event not found." }, { status: 404 });

    await AuditLog.create([{
      action: "event.updated",
      actorUserId: actor.userId,
      targetType: "Event",
      targetId: eventId,
      previousValue: Object.fromEntries(
        Object.keys(parsed.data).map((k) => [k, existing[k]]),
      ),
      newValue: parsed.data,
    }]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AdminAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid event data." }, { status: 400 });
    console.error("Failed to update event", error);
    return NextResponse.json({ error: "Unable to update event." }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: Params) {
  if (!checkOrigin(request)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { eventId } = await params;
  if (!isValidObjectId(eventId)) return NextResponse.json({ error: "Invalid event ID." }, { status: 400 });

  try {
    await connectToDatabase();
    const actor = await requireAdmin("admin");

    const rl = await checkAdminMutationRateLimit(getIdentifier(request, actor.email));
    if (!rl.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

    const existing = await Event.findByIdAndDelete(eventId).lean<{ _id: unknown; title: string }>();
    if (!existing) return NextResponse.json({ error: "Event not found." }, { status: 404 });

    await AuditLog.create([{
      action: "event.deleted",
      actorUserId: actor.userId,
      targetType: "Event",
      targetId: eventId,
      previousValue: { title: existing.title },
    }]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AdminAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Failed to delete event", error);
    return NextResponse.json({ error: "Unable to delete event." }, { status: 500 });
  }
}
