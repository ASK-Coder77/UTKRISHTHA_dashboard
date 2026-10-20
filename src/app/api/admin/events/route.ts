import { NextResponse } from "next/server";
import { z } from "zod";
import { connectToDatabase } from "@/lib/db";
import { AdminAuthError, checkOrigin, requireAdmin } from "@/lib/admin-auth";
import { checkAdminMutationRateLimit } from "@/lib/rate-limit";
import { AuditLog } from "@/models/AuditLog";
import { Event } from "@/models/Event";

const eventSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(2000),
    date: z.string().trim().datetime({ offset: true }).or(z.string().trim().date()),
    time: z.string().trim().regex(/^\d{2}:\d{2}$/),
    venue: z.string().trim().min(1).max(200),
    status: z.enum(["upcoming", "live", "completed"]),
  })
  .strict();

function getIdentifier(request: Request, email: string) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return `${email}:${ip}`;
}

export async function POST(request: Request) {
  if (!checkOrigin(request)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  try {
    await connectToDatabase();
    const actor = await requireAdmin("admin");

    const rl = await checkAdminMutationRateLimit(getIdentifier(request, actor.email));
    if (!rl.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

    const parsed = eventSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid event data." }, { status: 400 });

    const [event] = await Event.create([parsed.data]);
    await AuditLog.create([{
      action: "event.created",
      actorUserId: actor.userId,
      targetType: "Event",
      targetId: event._id,
      newValue: { title: event.title },
    }]);

    return NextResponse.json({ id: String(event._id) }, { status: 201 });
  } catch (error) {
    if (error instanceof AdminAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid event data." }, { status: 400 });
    console.error("Failed to create event", error);
    return NextResponse.json({ error: "Unable to create event." }, { status: 500 });
  }
}
