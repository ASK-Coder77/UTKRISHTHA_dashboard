import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { connectToDatabase } from "@/lib/db";
import { getRoleForEmail, normalizeEmail } from "@/lib/roles";
import { TeamMember } from "@/models/TeamMember";
import { TeamRegistrationForm } from "./team-registration-form";

export default async function RegisterTeamPage() {
  const session = await auth();
  const rawEmail = session?.user?.email;
  if (!rawEmail) redirect("/");

  await connectToDatabase();
  const email = normalizeEmail(rawEmail);

  // Already on a team (leader or member): no registration allowed
  if (await TeamMember.exists({ email })) redirect("/team");

  // Admins, judges, etc. don't register teams
  if ((await getRoleForEmail(email)) !== "student") redirect("/");

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-10 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">Utkrishta</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Register your team</h1>
      <p className="mt-3 max-w-2xl text-slate-600">You are added automatically as the team leader. Add your teammates below.</p>
      <TeamRegistrationForm initialLeaderName={session!.user?.name ?? ""} leaderEmail={email} />
    </main>
  );
}