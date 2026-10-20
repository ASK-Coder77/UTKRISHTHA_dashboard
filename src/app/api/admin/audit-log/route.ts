import { NextResponse } from "next/server";
import { z } from "zod";
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth";
import { connectToDatabase } from "@/lib/db";
import { AuditLog } from "@/models/AuditLog";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

function redactEmails(value: unknown): unknown {
  if (typeof value === "string") return value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted email]");
  if (Array.isArray(value)) return value.map(redactEmails);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactEmails(entry)]));
  }
  return value;
}

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    await requireAdmin("admin");
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({ page: url.searchParams.get("page") ?? undefined, limit: url.searchParams.get("limit") ?? undefined });
    if (!parsed.success) return NextResponse.json({ error: "Invalid page or limit." }, { status: 400 });
    const { page, limit } = parsed.data;
    const skip = (page - 1) * limit;
    const [logs, total] = await Promise.all([
      AuditLog.find({}).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
      AuditLog.countDocuments({}),
    ]);
    return NextResponse.json({
      entries: logs.map((entry) => redactEmails({
        id: String(entry._id),
        action: entry.action,
        actorId: entry.actorUserId ? String(entry.actorUserId) : null,
        targetType: entry.targetType,
        targetId: entry.targetId ? String(entry.targetId) : null,
        previousValue: entry.previousValue,
        newValue: entry.newValue,
        createdAt: new Date(entry.createdAt).toISOString(),
      })),
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    });
  } catch (error) {
    if (error instanceof AdminAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Failed to read audit log", error);
    return NextResponse.json({ error: "Unable to load the audit log." }, { status: 500 });
  }
}
