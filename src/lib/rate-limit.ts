import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
type Limiter = ConstructorParameters<typeof Ratelimit>[0]["limiter"];

type RateLimitResult =
  | { allowed: true }
  | { allowed: false; reason: "limited" | "unavailable" };

function makeRedisLimiter(
  limiter: Limiter,
  prefix: string,
): Ratelimit | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Ratelimit({ redis: new Redis({ url, token }), limiter, prefix });
}

async function checkLimit(
  limiterRef: { current: Ratelimit | null | undefined },
  factory: () => Ratelimit | null,
  identifier: string,
  label: string,
): Promise<RateLimitResult> {
  if (limiterRef.current === undefined) limiterRef.current = factory();
  const limiter = limiterRef.current;
  if (!limiter) {
    return process.env.NODE_ENV === "production"
      ? { allowed: false, reason: "unavailable" }
      : { allowed: true };
  }
  try {
    const result = await limiter.limit(identifier);
    return result.success ? { allowed: true } : { allowed: false, reason: "limited" };
  } catch (error) {
    console.error(`${label} rate limit check failed`, error);
    return process.env.NODE_ENV === "production"
      ? { allowed: false, reason: "unavailable" }
      : { allowed: true };
  }
}

// --- Team registration: 5 requests / 10 minutes ---
const teamRegistrationRef: { current: Ratelimit | null | undefined } = { current: undefined };
export async function checkTeamRegistrationRateLimit(identifier: string): Promise<RateLimitResult> {
  return checkLimit(
    teamRegistrationRef,
    () => makeRedisLimiter(Ratelimit.slidingWindow(5, "10 m"), "utkrishta:team-registration"),
    identifier,
    "Team registration",
  );
}

// --- Login: 10 completed OAuth callbacks / 10 minutes per verified account ---
const loginRef: { current: Ratelimit | null | undefined } = { current: undefined };
export async function checkLoginRateLimit(identifier: string): Promise<RateLimitResult> {
  return checkLimit(
    loginRef,
    () => makeRedisLimiter(Ratelimit.slidingWindow(10, "10 m"), "utkrishta:login"),
    identifier,
    "Login",
  );
}

// --- Bid: 10 bids / 10 seconds ---
const bidRef: { current: Ratelimit | null | undefined } = { current: undefined };
export async function checkBidRateLimit(identifier: string): Promise<RateLimitResult> {
  return checkLimit(
    bidRef,
    () => makeRedisLimiter(Ratelimit.slidingWindow(10, "10 s"), "utkrishta:bid"),
    identifier,
    "Bid",
  );
}

// --- Score submission: 20 submissions / 60 seconds ---
const scoreSubmissionRef: { current: Ratelimit | null | undefined } = { current: undefined };
export async function checkScoreSubmissionRateLimit(identifier: string): Promise<RateLimitResult> {
  return checkLimit(
    scoreSubmissionRef,
    () => makeRedisLimiter(Ratelimit.slidingWindow(20, "60 s"), "utkrishta:score-submission"),
    identifier,
    "Score submission",
  );
}

// --- Admin mutation: 30 requests / 60 seconds ---
const adminMutationRef: { current: Ratelimit | null | undefined } = { current: undefined };
export async function checkAdminMutationRateLimit(identifier: string): Promise<RateLimitResult> {
  return checkLimit(
    adminMutationRef,
    () => makeRedisLimiter(Ratelimit.slidingWindow(30, "60 s"), "utkrishta:admin-mutation"),
    identifier,
    "Admin mutation",
  );
}
