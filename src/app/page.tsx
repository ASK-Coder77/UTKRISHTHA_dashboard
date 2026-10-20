/**
 * Home page — Server Component.
 *
 * Data fetched on the server (no client fetch):
 *   • auth session + role (same as before)
 *   • settings.eventYear + settings.resultsPublished (via getSettings)
 *
 * No logic changes: auth, role derivation, CTA routing, and resultsPublished
 * guard are identical to the previous version.
 */
import Link from "next/link";
import { auth } from "@/auth";
import { connectToDatabase } from "@/lib/db";
import { getRoleForEmail, normalizeEmail } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { Card, CardIconTile } from "@/components/ui/card";
import { registerWithGoogle } from "@/app/actions";
import {
  SparkleIcon,
  GavelIcon,
  CodeIcon,
  AwardIcon,
  CoinsIcon,
  GitHubIcon,
  InstagramIcon,
  LinkedInIcon,
  MailIcon,
} from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { MagneticButton, Reveal } from "@/components/effects/reveal";
import { clubName, email as contactEmail, locationText, socials, websiteUrl } from "@/config/site";

/* ─── Section title (centered, accent underline, muted subtitle) ─────── */

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-10 text-center">
      <h2 className="text-3xl font-bold text-deep">{title}</h2>
      <div className="mx-auto mt-3 h-1 w-12 rounded-full bg-primary" />
      <p className="mx-auto mt-4 max-w-xl text-muted">{subtitle}</p>
    </div>
  );
}

/* ─── About cards ────────────────────────────────────────────────────── */

const aboutCards = [
  {
    Icon:  GavelIcon,
    title: "Auction",
    desc:  "Bid on problem statements using your starting credits. Each team holds one bid at a time.",
  },
  {
    Icon:  CodeIcon,
    title: "Build",
    desc:  "Spend Day 1 building a solution for the problem statement you won or were allocated.",
  },
  {
    Icon:  AwardIcon,
    title: "Showdown",
    desc:  "Present your prototype on Day 2. Judges score on innovation, execution, and relevance.",
  },
  {
    Icon:  CoinsIcon,
    title: "Credits",
    desc:  "Unused credits add to your final score. Bid smart — every credit you save counts.",
  },
] as const;

/* ─── Timeline ───────────────────────────────────────────────────────── */

const timelineItems = [
  {
    day:   "Day 1",
    title: "Auction & Build",
    desc:  "Problem statements are revealed. Teams bid with starting credits to claim their PS. After the auction closes, unmatched teams are allocated a PS. Build phase begins immediately.",
    side:  "left",
  },
  {
    day:   "Day 2",
    title: "Prototype & Showdown",
    desc:  "Teams submit their live URL and repository. Judges score each team across five criteria. Final score = judges' score + remaining credits. Rankings are published after judging.",
    side:  "right",
  },
] as const;

const socialIcons = {
  Instagram: InstagramIcon,
  LinkedIn: LinkedInIcon,
  GitHub: GitHubIcon,
} as const;

/* ─── CTA button (role-aware) ────────────────────────────────────────── */

function HeroCta({
  role,
  hasTeam,
  session,
}: {
  role:    string | null;
  hasTeam: boolean;
  session: boolean;
}) {
  const pillClass = cn(
    "inline-flex items-center gap-2 rounded-full bg-primary px-7 py-3.5",
    "text-base font-semibold text-white shadow-glow",
    "hover:bg-primary-hover hover:shadow-glow transition-all",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
  );

  if (!session) {
    return (
      <MagneticButton>
        <form action={registerWithGoogle}>
          <button type="submit" className={pillClass}>
            <SparkleIcon className="size-4" />
            Register
          </button>
        </form>
      </MagneticButton>
    );
  }

  if (role === "super_admin") {
    return (
      <Link href="/admin/settings" className={pillClass}>
        <SparkleIcon className="size-4" />
        Open settings
      </Link>
    );
  }
  if (role === "admin") {
    return (
      <Link href="/admin" className={pillClass}>
        <SparkleIcon className="size-4" />
        Open admin panel
      </Link>
    );
  }
  if (role === "judge") {
    return (
      <Link href="/judge" className={pillClass}>
        <SparkleIcon className="size-4" />
        Open judging workspace
      </Link>
    );
  }
  if (role === "team_leader") {
    return (
      <Link href="/auction" className={pillClass}>
        <SparkleIcon className="size-4" />
        Go to auction
      </Link>
    );
  }
  // student: show "Register Team" if they don't have one, else "Go to Auction"
  if (hasTeam) {
    return (
      <Link href="/auction" className={pillClass}>
        <SparkleIcon className="size-4" />
        Go to auction
      </Link>
    );
  }
  return (
    <Link href="/register-team" className={pillClass}>
      <SparkleIcon className="size-4" />
      Register a team
    </Link>
  );
}

/* ─── Page ───────────────────────────────────────────────────────────── */

export default async function HomePage() {
  /* Auth & role — identical logic to previous page.tsx */
  const session = await auth();
  const email   = session?.user?.email ? normalizeEmail(session.user.email) : null;

  await connectToDatabase();

  const [role, settings] = await Promise.all([
    email ? getRoleForEmail(email) : Promise.resolve(null),
    getSettings(),
  ]);

  const resultsPublished = session?.user ? settings.resultsPublished : false;
  const canViewResults   = role === "admin" || role === "super_admin" || resultsPublished;

  /* Check team membership for CTA logic */
  const { TeamMember } = await import("@/models/TeamMember");
  const hasTeam = email ? Boolean(await TeamMember.exists({ email })) : false;

  return (
    <main>
      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden px-4 pb-24 pt-20 sm:px-6">
        <div className="relative mx-auto max-w-3xl text-center">
          <Reveal load stagger={0.06}>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">
              Epoch AIML Club
            </p>

            <h1 className="mt-4">
              <span className="block text-5xl font-extrabold uppercase tracking-tight text-primary sm:text-7xl lg:text-8xl">
                Utkrishta
              </span>
              <span className="mt-2 block text-3xl font-bold text-deep sm:text-5xl">
                PS <span className="text-primary">Bid Wars</span>
              </span>
            </h1>

            <p className="mt-4 text-lg font-semibold text-primary">
              {settings.eventYear} · Day 1 Auction · Day 2 Showdown
            </p>

            <p className="mx-auto mt-4 max-w-lg text-base text-muted">
              Bid for your problem statement, build your solution, and battle for
              the top spot at the Showdown.
            </p>

            <div className="mt-10 flex justify-center">
              <HeroCta
                role={role}
                hasTeam={hasTeam}
                session={Boolean(session?.user)}
              />
            </div>

            {canViewResults && (
              <p className="mt-5 text-sm text-muted">
                <Link
                  href="/results"
                  className="rounded font-semibold text-primary underline underline-offset-4 transition-colors hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  View results →
                </Link>
              </p>
            )}
          </Reveal>
        </div>
      </section>

      {/* ── About cards ───────────────────────────────────────────── */}
      <section className="bg-tint/60 px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <SectionTitle
            title="How It Works"
            subtitle="A two-day hackathon with a twist — teams compete in an auction before they can build."
          />

          <Reveal stagger={0.25} className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {aboutCards.map(({ Icon, title, desc }) => (
              <Card key={title} hover className="flex flex-col">
                <CardIconTile>
                  <Icon className="size-5" />
                </CardIconTile>
                <h3 className="text-base font-bold text-deep">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{desc}</p>
              </Card>
            ))}
          </Reveal>
        </div>
      </section>

      {/* ── Timeline ──────────────────────────────────────────────── */}
      <section className="px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-4xl">
          <SectionTitle
            title="Event Timeline"
            subtitle="Two days, one goal: build the best solution for your problem statement."
          />

          {/* Desktop: center line + alternating cards. Mobile: left line + single col. */}
          <div className="relative">
            {/* Vertical center line — desktop */}
            <div
              aria-hidden="true"
              className="absolute left-4 top-0 h-full w-px bg-border md:left-1/2"
            />

            <div className="space-y-10">
              {timelineItems.map((item) => {
                const isLeft = item.side === "left";
                return (
                  <div key={item.day} className="relative flex items-start md:justify-center">
                    {/* Node circle */}
                    <div
                      aria-hidden="true"
                      className={cn(
                        "absolute left-4 top-5 z-10 size-3 -translate-x-1/2 rounded-full border-2 border-primary bg-surface",
                        "md:left-1/2",
                      )}
                    />

                    {/* Card — offset left or right on desktop */}
                    <Reveal
                      from={isLeft ? "left" : "right"}
                      className={cn(
                        "ml-10 w-full md:ml-0 md:w-[46%]",
                        isLeft  ? "md:mr-auto md:pr-8"  : "md:ml-auto md:pl-8",
                        // On even items shift to right side on desktop
                        !isLeft && "md:order-last",
                      )}
                    >
                      <Card className="relative">
                        {/* Day badge */}
                        <span className="inline-block rounded-full bg-primary/10 px-3 py-0.5 text-xs font-semibold text-primary">
                          {item.day}
                        </span>
                        <h3 className="mt-3 text-lg font-bold text-deep">
                          {item.title}
                        </h3>
                        <p className="mt-2 text-sm leading-relaxed text-muted">
                          {item.desc}
                        </p>
                      </Card>
                    </Reveal>

                    {/* Invisible spacer on the other side (desktop layout) */}
                    {/* Ensures alternating cards sit on opposite sides */}
                    <div
                      aria-hidden="true"
                      className={cn(
                        "hidden md:block md:w-[46%]",
                        isLeft ? "md:pl-8" : "md:pr-8",
                      )}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ── Contact ───────────────────────────────────────────────── */}
      <section id="contact" className="bg-tint/60 px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col gap-12 md:flex-row md:items-start md:justify-between">
            <Reveal from="left" load className="max-w-sm">
              <section>
                <h2 className="text-2xl font-bold text-deep">Contact</h2>
                <div className="mt-3 h-1 w-10 rounded-full bg-primary" />
                <p className="mt-4 text-sm text-muted">For any queries, reach out to us</p>
                <div className="mt-3 space-y-3 text-sm text-muted">
                  {contactEmail ? (
                    <a
                      href={`mailto:${contactEmail}`}
                      className="inline-flex min-h-11 items-center gap-2 font-medium text-primary hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <MailIcon className="size-5" />
                      {contactEmail}
                    </a>
                  ) : (
                    <p>Contact details coming soon.</p>
                  )}
                  {locationText && <p>{locationText}</p>}
                  {websiteUrl && (
                    <a
                      href={websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 items-center font-medium text-primary hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      Visit our website
                    </a>
                  )}
                </div>
              </section>
            </Reveal>

            <Reveal from="right" load className="flex max-w-sm flex-col md:items-end md:text-right">
              <section>
                <h2 className="text-2xl font-bold text-deep">Follow us</h2>
                <div className="mt-3 h-1 w-10 rounded-full bg-primary md:ml-auto" />
                <div className="mt-4 flex flex-wrap gap-3 md:justify-end">
                  {contactEmail && (
                    <a
                      href={`mailto:${contactEmail}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Email Epoch"
                      className="flex size-12 items-center justify-center rounded-xl border border-border bg-surface text-primary transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <MailIcon className="size-5" />
                    </a>
                  )}
                  {socials.map((social) => {
                    if (!social.href) return null;
                    const Icon = socialIcons[social.label];
                    return (
                      <a
                        key={social.label}
                        href={social.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Epoch on ${social.label}`}
                        className="flex size-12 items-center justify-center rounded-xl border border-border bg-surface text-primary transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <Icon className="size-5" />
                      </a>
                    );
                  })}
                  {!contactEmail && !socials.some((social) => social.href) && (
                    <p className="text-sm text-muted">Links coming soon.</p>
                  )}
                </div>
              </section>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────── */}
      <footer className="border-t border-border px-4 py-8 text-center text-xs text-muted sm:px-6">
        Utkrishta {settings.eventYear} · {clubName}
      </footer>
    </main>
  );
}
