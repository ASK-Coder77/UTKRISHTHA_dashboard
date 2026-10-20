import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getSettings } from "@/lib/settings";
import { TeamWorkspace } from "./team-workspace";

export default async function TeamPage() {
  const session = await auth();
  const role = session?.user?.role;
  if (role !== "student" && role !== "team_leader") redirect("/");

  return <TeamWorkspace showResults={(await getSettings()).resultsPublished} />;
}
