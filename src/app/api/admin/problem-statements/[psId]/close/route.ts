import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import { AdminAuthError, checkOrigin, isValidObjectId, requireAdmin } from "@/lib/admin-auth";
import { checkAdminMutationRateLimit } from "@/lib/rate-limit";
import { closeAuction, AuctionError } from "@/lib/auction";

type Params = { params: Promise<{ psId: string }> };

const auctionErrorMessages: Record<AuctionError["code"], [string, number]> = {
  invalid_input: ["Invalid request.", 400],
  not_team_leader: ["Not a team leader.", 403],
  not_admin: ["Admin access required.", 403],
  problem_statement_not_found: ["Problem statement not found.", 404],
  auction_not_live: ["This auction is not live.", 409],
  track_mismatch: ["Teams can bid only on problem statements in their own track.", 403],
  already_assigned: ["Team already assigned.", 409],
  already_holding_other: ["Team is holding another spot.", 409],
  bid_below_base_price: ["Bid below base price.", 400],
  bid_exceeds_balance: ["Bid exceeds balance.", 400],
  bid_increment_too_small: ["Bid increment too small.", 400],
  missing_capacity: ["No capacity set.", 409],
  auction_integrity_error: ["An unexpected error occurred.", 500],
};

function getIdentifier(request: Request, email: string) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return `${email}:${ip}`;
}

export async function POST(request: Request, { params }: Params) {
  if (!checkOrigin(request)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { psId } = await params;
  if (!isValidObjectId(psId)) return NextResponse.json({ error: "Invalid problem statement ID." }, { status: 400 });

  try {
    await connectToDatabase();
    const actor = await requireAdmin("admin");

    const rl = await checkAdminMutationRateLimit(getIdentifier(request, actor.email));
    if (!rl.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

    const result = await closeAuction({
      problemStatementId: psId,
      actorEmail: actor.email,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AdminAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof AuctionError) {
      const [message, status] = auctionErrorMessages[error.code] ?? ["Close failed.", 500];
      return NextResponse.json({ error: message }, { status });
    }
    console.error("Failed to close auction", error);
    return NextResponse.json({ error: "Unable to close auction." }, { status: 500 });
  }
}
