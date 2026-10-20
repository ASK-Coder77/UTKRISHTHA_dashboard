import assert from "node:assert/strict";
// Node executes this TypeScript test directly; the application uses the same module.
import { calculateRankings, calculateRankingsByTrack } from "./rankings.ts";

const round = (aggregation: "average" | "sum") => [{ id: "round", name: "Showdown", order: 1, aggregation, weight: 1 }];
const team = (id: string, track: "web_dev" | "ai_ml", balance = 0) => ({ id, name: id, track, problemStatement: null, balance, assignmentType: "allocated" as const });
const calculate = (teams: ReturnType<typeof team>[], points: Array<{ teamId: string; points: number }>, aggregation: "average" | "sum" = "average") => calculateRankings({ teams, rounds: round(aggregation), scores: points.map((score) => ({ ...score, roundId: "round" })), powerupMultiplier: 1, powerupForAllocatedTeams: true });

assert.equal(calculate([team("average", "web_dev")], [{ teamId: "average", points: 80 }, { teamId: "average", points: 60 }])[0].breakdown.judgesScore, "70.00");
assert.equal(calculate([team("sum", "web_dev")], [{ teamId: "sum", points: 80 }, { teamId: "sum", points: 60 }], "sum")[0].breakdown.judgesScore, "140.00");
assert.equal(calculate([team("missing", "web_dev")], [{ teamId: "missing", points: 80 }])[0].breakdown.judgesScore, "80.00");
const tied = calculate([team("first", "web_dev"), team("second", "web_dev")], [{ teamId: "first", points: 70 }, { teamId: "second", points: 70 }]);
assert.deepEqual(tied.map((entry) => entry.rank), [1, 1]);
const weighted = calculateRankings({
  teams: [team("weighted", "web_dev", 10)],
  rounds: [{ id: "weighted-round", name: "Weighted", order: 1, aggregation: "average", weight: 1.5 }],
  scores: [{ roundId: "weighted-round", teamId: "weighted", points: 40 }],
  powerupMultiplier: 1,
  powerupForAllocatedTeams: true,
})[0];
assert.equal(weighted.breakdown.judgesScore, "60.00");
assert.equal(weighted.totalPoints, "70.00");
const trackInput = { teams: [team("web", "web_dev"), team("ai", "ai_ml")], rounds: round("average"), scores: [{ roundId: "round", teamId: "web", points: 90 }, { roundId: "round", teamId: "ai", points: 80 }], powerupMultiplier: 1, powerupForAllocatedTeams: true };
const perTrack = calculateRankingsByTrack(trackInput);
assert.deepEqual([perTrack.web_dev[0].rank, perTrack.ai_ml[0].rank], [1, 1]);
assert.equal(calculate([team("redeemed", "web_dev", 35)], [{ teamId: "redeemed", points: 60 }])[0].totalPoints, "95.00");
console.log("ranking unit tests passed");
