export type RankingTeam = {
  id: string;
  name: string;
  track: "web_dev" | "ai_ml";
  problemStatement: string | null;
  balance: number;
  assignmentType: "won" | "allocated" | null;
};

export type RankingRound = {
  id: string;
  name: string;
  order: number;
  aggregation: "average" | "sum";
  weight: number;
};

export type RankingScore = {
  roundId: string;
  teamId: string;
  points: number;
};

type Fraction = { numerator: bigint; denominator: bigint };

export type RankedTeam = {
  teamName: string;
  track: "web_dev" | "ai_ml";
  problemStatement: string | null;
  rank: number;
  totalPoints: string;
  breakdown: {
    credits: string;
    judgesScore: string;
    rounds: Array<{ name: string; score: string; weightedScore: string }>;
  };
};

const BIGINT_ZERO = BigInt(0);
const BIGINT_ONE = BigInt(1);
const BIGINT_TWO = BigInt(2);
const BIGINT_TEN = BigInt(10);
const BIGINT_HUNDRED = BigInt(100);
const zero: Fraction = { numerator: BIGINT_ZERO, denominator: BIGINT_ONE };

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left < BIGINT_ZERO ? -left : left;
  let b = right < BIGINT_ZERO ? -right : right;
  while (b !== BIGINT_ZERO) [a, b] = [b, a % b];
  return a;
}

function reduce(numerator: bigint, denominator: bigint): Fraction {
  if (denominator === BIGINT_ZERO) throw new Error("A ranking fraction cannot have a zero denominator.");
  const sign = denominator < BIGINT_ZERO ? -BIGINT_ONE : BIGINT_ONE;
  const divisor = greatestCommonDivisor(numerator, denominator);
  return { numerator: (numerator / divisor) * sign, denominator: (denominator / divisor) * sign };
}

function add(left: Fraction, right: Fraction): Fraction {
  return reduce(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

function multiply(left: Fraction, right: Fraction): Fraction {
  return reduce(left.numerator * right.numerator, left.denominator * right.denominator);
}

function compare(left: Fraction, right: Fraction): number {
  const difference = left.numerator * right.denominator - right.numerator * left.denominator;
  return difference === BIGINT_ZERO ? 0 : difference > BIGINT_ZERO ? 1 : -1;
}

function decimalToFraction(value: number): Fraction {
  if (!Number.isFinite(value)) throw new Error("Ranking values must be finite.");
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(value.toString());
  if (!match) throw new Error("Ranking values must be decimal numbers.");

  const [, sign, whole, decimal = "", exponentText] = match;
  const exponent = exponentText ? Number(exponentText) : 0;
  const digits = `${whole}${decimal}`.replace(/^0+(?=\d)/, "") || "0";
  const scale = decimal.length - exponent;
  const unsignedNumerator = BigInt(digits);
  const numerator = sign === "-" ? -unsignedNumerator : unsignedNumerator;
  return scale <= 0
    ? reduce(numerator * BIGINT_TEN ** BigInt(-scale), BIGINT_ONE)
    : reduce(numerator, BIGINT_TEN ** BigInt(scale));
}

function toWholeNumber(value: number): Fraction {
  if (!Number.isSafeInteger(value)) throw new Error("Ranking point values must be safe integers.");
  return { numerator: BigInt(value), denominator: BIGINT_ONE };
}

function formatTwoDecimals(value: Fraction): string {
  const scale = BIGINT_HUNDRED;
  let scaled = (value.numerator * scale) / value.denominator;
  const remainder = (value.numerator * scale) % value.denominator;
  if (remainder * BIGINT_TWO >= value.denominator) scaled += BIGINT_ONE;

  const negative = scaled < BIGINT_ZERO;
  const absolute = negative ? -scaled : scaled;
  const whole = absolute / scale;
  const decimal = (absolute % scale).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${decimal}`;
}

function calculateRoundScore(scores: number[], aggregation: RankingRound["aggregation"]): Fraction {
  if (scores.length === 0) return zero;
  const total = scores.reduce((sum, points) => sum + BigInt(points), BIGINT_ZERO);
  return aggregation === "sum" ? { numerator: total, denominator: BIGINT_ONE } : reduce(total, BigInt(scores.length));
}

/**
 * Calculates score totals and tie-breaks as fractions so ranking never depends
 * on binary floating-point comparisons. Values returned to the client are
 * consistently rounded to two decimal places for display.
 */
export function calculateRankings({
  teams,
  rounds,
  scores,
  powerupMultiplier,
  powerupForAllocatedTeams,
}: {
  teams: RankingTeam[];
  rounds: RankingRound[];
  scores: RankingScore[];
  powerupMultiplier: number;
  powerupForAllocatedTeams: boolean;
}): RankedTeam[] {
  const orderedRounds = [...rounds].sort((left, right) => left.order - right.order);
  const scoresByRoundAndTeam = new Map<string, number[]>();
  for (const score of scores) {
    if (!Number.isSafeInteger(score.points)) throw new Error("Stored scores must be safe integers.");
    const key = `${score.roundId}:${score.teamId}`;
    scoresByRoundAndTeam.set(key, [...(scoresByRoundAndTeam.get(key) ?? []), score.points]);
  }

  const multiplier = decimalToFraction(powerupMultiplier);
  const calculated = teams.map((team) => {
    const receivesPowerup =
      team.assignmentType === "won" || (team.assignmentType === "allocated" && powerupForAllocatedTeams);
    const powerup = receivesPowerup ? multiply(toWholeNumber(team.balance), multiplier) : zero;
    const roundScores = orderedRounds.map((round) => {
      const score = calculateRoundScore(scoresByRoundAndTeam.get(`${round.id}:${team.id}`) ?? [], round.aggregation);
      return { name: round.name, score, weightedScore: multiply(score, decimalToFraction(round.weight)) };
    });
    const judgesScore = roundScores.reduce((sum, round) => add(sum, round.weightedScore), zero);
    const total = add(judgesScore, powerup);
    return { team, powerup, judgesScore, roundScores, total };
  });

  calculated.sort((left, right) => {
    const totalComparison = compare(right.total, left.total);
    if (totalComparison !== 0) return totalComparison;
    const judgesComparison = compare(right.judgesScore, left.judgesScore);
    if (judgesComparison !== 0) return judgesComparison;
    return left.team.name.localeCompare(right.team.name);
  });

  let previous: (typeof calculated)[number] | null = null;
  let previousRank = 0;
  return calculated.map((entry, index) => {
    const prior = previous;
    const tiedWithPrevious =
      prior !== null &&
      compare(entry.total, prior.total) === 0 &&
      compare(entry.judgesScore, prior.judgesScore) === 0;
    const rank = tiedWithPrevious ? previousRank : index + 1;
    previous = entry;
    previousRank = rank;
    return {
      teamName: entry.team.name,
      track: entry.team.track,
      problemStatement: entry.team.problemStatement,
      rank,
      totalPoints: formatTwoDecimals(entry.total),
      breakdown: {
        credits: formatTwoDecimals(entry.powerup),
        judgesScore: formatTwoDecimals(entry.judgesScore),
        rounds: entry.roundScores.map((round) => ({
          name: round.name,
          score: formatTwoDecimals(round.score),
          weightedScore: formatTwoDecimals(round.weightedScore),
        })),
      },
    };
  });
}

export function calculateRankingsByTrack(input: Parameters<typeof calculateRankings>[0]) {
  return {
    web_dev: calculateRankings({ ...input, teams: input.teams.filter((team) => team.track === "web_dev") }),
    ai_ml: calculateRankings({ ...input, teams: input.teams.filter((team) => team.track === "ai_ml") }),
  };
}
