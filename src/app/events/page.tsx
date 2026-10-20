import { auth } from "@/auth";
import { getRoleForEmail, normalizeEmail } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { EventsWorkspace } from "./events-workspace";

export default async function EventsPage() {
  const email = (await auth())?.user?.email;
  const role = email ? await getRoleForEmail(normalizeEmail(email)) : null;
  const showResults = role === "admin" || role === "super_admin" || (await getSettings()).resultsPublished;
  return <EventsWorkspace showResults={showResults} showTeamLink={role === "student" || role === "team_leader"} />;
}
