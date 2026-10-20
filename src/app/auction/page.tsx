import { auth } from "@/auth";
import { getRoleForEmail, normalizeEmail } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { AuctionWorkspace } from "./auction-workspace";

export default async function AuctionPage() {
  const email = (await auth())?.user?.email;
  const role = email ? await getRoleForEmail(normalizeEmail(email)) : null;
  const showTeamLink = role === "student" || role === "team_leader";
  const showResults = role === "admin" || role === "super_admin" || (await getSettings()).resultsPublished;

  return <AuctionWorkspace showResults={showResults} showTeamLink={showTeamLink} />;
}
