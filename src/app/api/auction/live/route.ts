import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { auth } from "@/auth";
import { connectToDatabase } from "@/lib/db";
import { Holding } from "@/models/Holding";
import { ProblemStatement } from "@/models/ProblemStatement";
import { Setting } from "@/models/Setting";
import { Team } from "@/models/Team";
import { getRoleForEmail, normalizeEmail } from "@/lib/roles";

type LiveHolding = {
  teamId: string;
  teamName: string;
  amount: number;
};

type LivePs = {
  id: string;
  title: string;
  domain: string;
  description: string;
  basePrice: number;
  capacity: number;
  spotsTotal: number;
  spotsFilled: number;
  spotsFree: number;
  minBidToEnter: number;
  track: "web_dev" | "ai_ml";
  holdings: LiveHolding[];
};

/**
 * User-independent snapshot of live auction data.
 * Cached for 2 seconds so many concurrent clients share one DB read.
 * Personal data (own holding, own balance) is NOT included here.
 */
const getLiveAuctionData = unstable_cache(
  async (): Promise<LivePs[]> => {
    await connectToDatabase();

    const [livePsList, settings] = await Promise.all([
      ProblemStatement.find({ status: "live", revealed: true }).sort({ createdAt: 1 }).lean<{
        _id: unknown;
        title: string;
        domain?: string;
        description: string;
        basePrice: number;
        capacity: number | null;
        track: "web_dev" | "ai_ml";
      }[]>(),
      Setting.findOne({ singletonKey: "global" }).lean<{ defaultTeamsPerPs: number | null; minIncrement: number }>(),
    ]);

    if (!livePsList.length) return [];

    const psIds = livePsList.map((ps) => ps._id);

    // holdings with team names (no emails, no balances)
    const [holdings, assignedCounts] = await Promise.all([
      Holding.aggregate<{ _id: string; teamId: string; amount: number; teamName: string; createdAt: Date }>([
        { $match: { problemStatementId: { $in: psIds } } },
        {
          $lookup: {
            from: "teams",
            localField: "teamId",
            foreignField: "_id",
            as: "team",
          },
        },
        { $unwind: "$team" },
        {
          $project: {
            _id: 0,
            psId: "$problemStatementId",
            teamId: "$teamId",
            amount: "$amount",
            teamName: "$team.name",
            createdAt: "$createdAt",
          },
        },
        { $sort: { amount: -1 } },
      ]),
      Team.aggregate<{ _id: string; count: number }>([
        { $match: { assignedPsId: { $in: psIds } } },
        { $group: { _id: "$assignedPsId", count: { $sum: 1 } } },
      ]),
    ]);

    const holdingsByPs = new Map<string, typeof holdings>();
    for (const h of holdings) {
      const key = String((h as unknown as { psId: unknown }).psId);
      if (!holdingsByPs.has(key)) holdingsByPs.set(key, []);
      holdingsByPs.get(key)!.push(h);
    }
    const assignedCountByPs = new Map<string, number>();
    for (const a of assignedCounts) assignedCountByPs.set(String(a._id), a.count);

    return livePsList.map((ps) => {
      const psId = String(ps._id);
      const capacity = ps.capacity ?? (settings?.defaultTeamsPerPs ?? 0);
      const psHoldings = holdingsByPs.get(psId) ?? [];
      const assignedCount = assignedCountByPs.get(psId) ?? 0;
      const spotsFilled = psHoldings.length + assignedCount;
      const spotsFree = Math.max(0, capacity - spotsFilled);
      const minIncrement = settings?.minIncrement ?? 1;

      // Min bid to enter: if full, lowest holding + minIncrement; else basePrice
      let minBidToEnter = ps.basePrice;
      if (spotsFree === 0 && psHoldings.length > 0) {
        const sorted = [...psHoldings].sort((a, b) => a.amount - b.amount);
        minBidToEnter = sorted[0].amount + minIncrement;
      }

      return {
        id: psId,
        title: ps.title,
        domain: ps.domain ?? "General",
        description: ps.description,
        basePrice: ps.basePrice,
        capacity,
        spotsTotal: capacity,
        spotsFilled,
        spotsFree,
        minBidToEnter,
        track: ps.track,
        holdings: psHoldings.map((h) => ({
          teamId: String(h.teamId),
          teamName: h.teamName,
          amount: h.amount,
        })),
      };
    });
  },
  ["auction-live"],
  { revalidate: 2 },
);

export async function GET() {
  // Session check is outside the cache — personal identity verified before returning shared data.
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  try {
    await connectToDatabase();
    const email = normalizeEmail(session.user.email);
    const role = await getRoleForEmail(email);
    const team = role === "team_leader" ? await Team.findOne({ leaderEmail: email }).select({ track: 1 }).lean<{ track: "web_dev" | "ai_ml" }>() : null;
    const data = await getLiveAuctionData();
    return NextResponse.json({ problemStatements: team ? data.filter((ps) => ps.track === team.track) : role === "admin" || role === "super_admin" ? data : [] });
  } catch (error) {
    console.error("Failed to fetch live auction data", error);
    return NextResponse.json({ error: "Unable to load live auction data." }, { status: 500 });
  }
}
