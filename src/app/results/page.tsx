import { auth } from "@/auth";
import { getRoleForEmail, normalizeEmail } from "@/lib/roles";
import { ResultsWorkspace } from "./results-workspace";

export default async function ResultsPage() {
  const email = (await auth())?.user?.email;
  const role = email ? await getRoleForEmail(normalizeEmail(email)) : null;
  return <ResultsWorkspace showTeamLink={role === "student" || role === "team_leader"} />;
}
