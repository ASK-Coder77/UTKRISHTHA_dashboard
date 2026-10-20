import { auth } from "@/auth";
import { connectToDatabase } from "@/lib/db";
import { getRoleForEmail, normalizeEmail, type AppRole } from "@/lib/roles";
import { User } from "@/models/User";
import type mongoose from "mongoose";

export class AdminAuthError extends Error {
  public readonly status: 401 | 403;
  constructor(message: string, status: 401 | 403) {
    super(message);
    this.name = "AdminAuthError";
    this.status = status;
  }
}

export type AdminActor = {
  email: string;
  role: AppRole;
  userId: mongoose.Types.ObjectId | null;
};

/**
 * Verifies the session and checks the actor's role against the DB.
 * Throws AdminAuthError (401 or 403) if not authorised.
 * minRole "admin" accepts admin or super_admin.
 * minRole "super_admin" accepts super_admin only.
 */
export async function requireAdmin(minRole: "admin" | "super_admin"): Promise<AdminActor> {
  const session = await auth();
  const rawEmail = session?.user?.email;
  if (!rawEmail) throw new AdminAuthError("Authentication required.", 401);

  await connectToDatabase();
  const email = normalizeEmail(rawEmail);
  const role = await getRoleForEmail(email);

  const allowed =
    minRole === "super_admin" ? role === "super_admin" : role === "admin" || role === "super_admin";
  if (!allowed) throw new AdminAuthError("You do not have permission to perform this action.", 403);

  const user = await User.findOne({ email }).select({ _id: 1 }).lean<{ _id: mongoose.Types.ObjectId }>();
  return { email, role, userId: user?._id ?? null };
}

/** Reads the Origin header and rejects requests from unknown origins. */
export function checkOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    // Production requires the configured canonical site origin. Local development
    // may use the incoming dev-server origin without an AUTH_URL value.
    const requestOrigin = new URL(request.url).origin;
    const configuredOrigin = process.env.AUTH_URL ? new URL(process.env.AUTH_URL).origin : null;
    if (configuredOrigin) return origin === configuredOrigin;
    return process.env.NODE_ENV !== "production" && origin === requestOrigin;
  } catch {
    return false;
  }
}

/**
 * Validates that a path-segment value is a valid MongoDB ObjectId hex string.
 */
export function isValidObjectId(value: string): boolean {
  return /^[0-9a-f]{24}$/i.test(value);
}
