import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { connectToDatabase } from "@/lib/db";
import { checkBidRateLimit } from "@/lib/rate-limit";
import { getRoleForEmail, normalizeEmail } from "@/lib/roles";
import { checkOrigin } from "@/lib/admin-auth";
import { placeBid, AuctionError } from "@/lib/auction";

const bidSchema = z
  .object({
    teamId: z.string().trim(),
    problemStatementId: z.string().trim(),
    amount: z.number().int().min(1),
  })
  .strict();

function getClientIdentifier(request: Request, email: string) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? "unknown";
  return `${email}:${ip}`;
}

const auctionErrorMessages: Record<AuctionError["code"], [string, number]> = {
  invalid_input: ["Invalid bid data.", 400],
  not_team_leader: ["Only a team leader with an active team can place a bid.", 403],
  not_admin: ["Not an admin.", 403],
  problem_statement_not_found: ["Problem statement not found.", 404],
  auction_not_live: ["This problem statement is not currently open for bidding.", 409],
  track_mismatch: ["Your team can bid only on problem statements in its own track.", 403],
  already_assigned: ["Your team already has a problem statement.", 409],
  already_holding_other: ["Your team is already holding a spot on a different problem statement.", 409],
  bid_below_base_price: ["Your bid must be at least the base price.", 400],
  bid_exceeds_balance: ["Your bid exceeds your team's balance.", 400],
  bid_increment_too_small: ["Your bid must be at least the minimum increment above the current bid or the lowest holding.", 400],
  missing_capacity: ["This problem statement has no capacity configured.", 409],
  auction_integrity_error: ["An unexpected error occurred. Please try again.", 500],
};

export async function POST(request: Request) {
  if (!checkOrigin(request)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  try {
    await connectToDatabase();
    const session = await auth();
    const rawEmail = session?.user?.email;
    if (!rawEmail) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

    const email = normalizeEmail(rawEmail);
    const role = await getRoleForEmail(email);
    if (role !== "team_leader") {
      return NextResponse.json({ error: "Only team leaders can place bids." }, { status: 403 });
    }

    const rateLimit = await checkBidRateLimit(getClientIdentifier(request, email));
    if (!rateLimit.allowed) {
      const error = rateLimit.reason === "limited"
        ? "Too many bid attempts. Please wait before trying again."
        : "Bidding is temporarily unavailable.";
      return NextResponse.json({ error }, { status: rateLimit.reason === "limited" ? 429 : 503 });
    }

    const parsed = bidSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid bid data." }, { status: 400 });

    const result = await placeBid({
      teamId: parsed.data.teamId,
      problemStatementId: parsed.data.problemStatementId,
      amount: parsed.data.amount,
      leaderEmail: email,
    });

    return NextResponse.json({ holdingAmount: result.holdingAmount, displacedTeamId: result.displacedTeamId });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid bid data." }, { status: 400 });
    if (error instanceof AuctionError) {
      const [message, status] = auctionErrorMessages[error.code] ?? ["Bid failed.", 400];
      return NextResponse.json({ error: message }, { status });
    }
    console.error("Bid failed", error);
    return NextResponse.json({ error: "Unable to place bid. Please try again." }, { status: 500 });
  }
}
