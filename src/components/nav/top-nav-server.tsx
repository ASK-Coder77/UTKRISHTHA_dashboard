/**
 * TopNavServer — Server Component wrapper that reads auth + role + team
 * membership and forwards them as plain props to the TopNav client component.
 *
 * Why a separate server wrapper:
 *   Database calls (getRoleForEmail, getSettings, TeamMember.exists) are
 *   server-only; they cannot live in the "use client" TopNav. This wrapper
 *   fetches them once per request, in parallel, and passes primitives down.
 */
import { auth } from "@/auth";
import { connectToDatabase } from "@/lib/db";
import { getRoleForEmail, normalizeEmail } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { TeamMember } from "@/models/TeamMember";
import { TopNav } from "@/components/nav/top-nav";

export async function TopNavServer() {
  const session = await auth();

  if (!session?.user?.email) {
    return (
      <TopNav
        role={null}
        userName={null}
        resultsPublished={false}
        hasTeam={false}
      />
    );
  }

  await connectToDatabase();
  const email = normalizeEmail(session.user.email);

  // Run all three DB queries in parallel to minimise latency.
  const [role, settings, teamMembership] = await Promise.all([
    getRoleForEmail(email),
    getSettings(),
    // Checks whether the user is in any team (as member or leader).
    // Used to hide "Register Team" for users who already belong to a team.
    TeamMember.exists({ email }),
  ]);

  return (
    <TopNav
      role={role}
      userName={session.user.name ?? null}
      resultsPublished={settings.resultsPublished}
      hasTeam={Boolean(teamMembership)}
    />
  );
}
