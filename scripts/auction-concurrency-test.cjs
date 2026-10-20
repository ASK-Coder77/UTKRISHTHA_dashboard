/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { readFileSync } = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const typescript = require("typescript");

const projectRoot = path.resolve(__dirname, "..");
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
  const mappedRequest = request.startsWith("@/") ? path.join(projectRoot, "src", request.slice(2)) : request;
  return originalResolveFilename.call(this, mappedRequest, parent, isMain, options);
};

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = readFileSync(filename, "utf8");
  const output = typescript.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
    },
    fileName: filename,
  });
  module._compile(output.outputText, filename);
};

const mongoose = require("mongoose");
const { closeAuction, placeBid } = require("@/lib/auction");
const { connectToDatabase } = require("@/lib/db");
const { AdminAllowlist } = require("@/models/AdminAllowlist");
const { AuditLog } = require("@/models/AuditLog");
const { Bid } = require("@/models/Bid");
const { Holding } = require("@/models/Holding");
const { ProblemStatement } = require("@/models/ProblemStatement");
const { Team } = require("@/models/Team");
const { User } = require("@/models/User");

if (process.env.RUN_AUCTION_CONCURRENCY_TEST !== "1") {
  throw new Error("Set RUN_AUCTION_CONCURRENCY_TEST=1 before running this script.");
}
if (process.env.NODE_ENV === "production") {
  throw new Error("This test script must not run against a production database.");
}

const testRunId = randomUUID().replaceAll("-", "").slice(0, 12);
const leaderEmails = Array.from({ length: 5 }, (_, index) => `auction-test-${testRunId}-${index}@example.test`);
const adminEmail = `auction-test-admin-${testRunId}@example.test`;
const createdTeamIds = [];
const createdPsIds = [];
const createdUserEmails = [...leaderEmails, adminEmail];

async function cleanup() {
  const targetIds = [...createdTeamIds, ...createdPsIds];
  if (targetIds.length > 0) {
    await Promise.all([
      AuditLog.deleteMany({ targetId: { $in: targetIds } }),
      Bid.deleteMany({ problemStatementId: { $in: createdPsIds } }),
      Holding.deleteMany({ problemStatementId: { $in: createdPsIds } }),
      Team.deleteMany({ _id: { $in: createdTeamIds } }),
      ProblemStatement.deleteMany({ _id: { $in: createdPsIds } }),
    ]);
  }
  await Promise.all([
    User.deleteMany({ email: { $in: createdUserEmails } }),
    AdminAllowlist.deleteOne({ email: adminEmail }),
  ]);
}

void (async () => {
  try {
    await connectToDatabase();
    await AdminAllowlist.create({ email: adminEmail });
    await User.insertMany(createdUserEmails.map((email) => ({ email, name: "Auction concurrency test" })));

    const teams = await Team.insertMany(
      leaderEmails.map((leaderEmail, index) => ({
        name: `Auction Test Team ${testRunId} ${index}`,
        normalizedName: `auction-test-team-${testRunId}-${index}`,
        leaderEmail,
        balance: 100,
        pointsGiven: true,
      })),
    );
    createdTeamIds.push(...teams.map((team) => team._id));

    const problemStatement = await ProblemStatement.create({
      title: `Auction concurrency test ${testRunId}`,
      description: "Temporary test record.",
      basePrice: 10,
      capacity: 1,
      status: "live",
    });
    createdPsIds.push(problemStatement._id);

    const bidAttempts = await Promise.allSettled(
      teams.map((team, index) =>
        placeBid({
          teamId: String(team._id),
          problemStatementId: String(problemStatement._id),
          amount: 10 + index * 10,
          leaderEmail: leaderEmails[index],
        }),
      ),
    );
    const successfulBids = bidAttempts.filter((attempt) => attempt.status === "fulfilled");
    const rejectedBids = bidAttempts.filter((attempt) => attempt.status === "rejected");
    assert.ok(successfulBids.length >= 1, "at least one concurrent bid must succeed");
    for (const attempt of rejectedBids) {
      assert.equal(attempt.reason?.code, "bid_increment_too_small", "only lower concurrent bids may be rejected");
    }

    const [holdings, bids] = await Promise.all([
      Holding.find({ problemStatementId: problemStatement._id }).lean(),
      Bid.find({ problemStatementId: problemStatement._id }).lean(),
    ]);
    assert.equal(holdings.length, 1, "exactly one team must hold the single available spot");
    assert.equal(holdings[0].amount, 50, "the highest concurrent bid must be the remaining holding");
    assert.equal(bids.length, successfulBids.length, "every accepted bid must have an immutable Bid record");

    const closeResult = await closeAuction({ problemStatementId: String(problemStatement._id), actorEmail: adminEmail });
    assert.deepEqual(closeResult, { status: "closed", outcome: "sold", winnerCount: 1 });

    const [closedPs, assignedTeam, remainingHoldings] = await Promise.all([
      ProblemStatement.findById(problemStatement._id).lean(),
      Team.findById(teams[4]._id).lean(),
      Holding.countDocuments({ problemStatementId: problemStatement._id }),
    ]);
    assert.equal(closedPs?.status, "closed");
    assert.equal(closedPs?.auctionOutcome, "sold");
    assert.equal(String(assignedTeam?.assignedPsId), String(problemStatement._id));
    assert.equal(assignedTeam?.assignmentType, "won");
    assert.equal(assignedTeam?.balance, 50);
    assert.equal(remainingHoldings, 0);

    const repeatClose = await closeAuction({ problemStatementId: String(problemStatement._id), actorEmail: adminEmail });
    assert.deepEqual(repeatClose, { status: "already_closed", outcome: "sold", winnerCount: 0 });

    const emptyProblemStatement = await ProblemStatement.create({
      title: `Empty auction test ${testRunId}`,
      description: "Temporary test record.",
      basePrice: 10,
      capacity: 1,
      status: "live",
    });
    createdPsIds.push(emptyProblemStatement._id);
    const emptyClose = await closeAuction({ problemStatementId: String(emptyProblemStatement._id), actorEmail: adminEmail });
    assert.deepEqual(emptyClose, { status: "closed", outcome: "unsold", winnerCount: 0 });

    console.log("Auction concurrency test passed.");
  } finally {
    await cleanup();
    await mongoose.disconnect();
  }
})().catch((error) => {
  console.error("Auction concurrency test failed", error);
  process.exitCode = 1;
});
