"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";

type Team = { id: string; name: string; balance: number; pointsGiven: boolean; assignedPs: { title: string; domain: string; description: string; assignmentType: string } | null; holding: { psId: string; amount: number } | null; members: string[]; isLeader: boolean; canChangeMembership: boolean; submissionsOpen: boolean; liveUrl: string | null; repoUrl: string | null };
const fetcher = async (url: string) => { const response = await fetch(url); const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Unable to load team data."); return body; };
const card = "rounded-xl border border-slate-200 bg-white p-5 shadow-sm";

export function TeamWorkspace({ showResults }: { showResults: boolean }) {
  const router = useRouter();
  const { data, error, isLoading } = useSWR<{ team: Team | null }>("/api/teams", fetcher);
  const team = data?.team;
  const [actionError, setActionError] = useState<string | null>(null);
  const [isChangingTeam, setIsChangingTeam] = useState(false);

  async function changeMembership(action: "leave" | "disband") {
    const prompt = action === "disband"
      ? "Disband this team? This permanently removes the team and all members can register again."
      : "Leave this team? You can register a new team afterward.";
    if (!window.confirm(prompt)) return;
    setActionError(null);
    setIsChangingTeam(true);
    try {
      const response = await fetch(`/api/teams/${action}`, { method: "DELETE" });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to update your team.");
      router.replace("/");
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Unable to update your team.");
      setIsChangingTeam(false);
    }
  }


  return <main className="mx-auto min-h-screen max-w-4xl px-4 py-8 sm:px-6">
    <nav aria-label="Main navigation" className="mb-8 flex flex-wrap gap-4 text-sm font-semibold text-primary"><Link href="/">Home</Link><Link href="/auction">Auction</Link><Link href="/team">My team</Link><Link href="/events">Events</Link>{showResults && <Link href="/results">Results</Link>}</nav>
    <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">Team workspace</p><h1 className="mt-2 text-3xl font-bold">My team</h1>
    {isLoading && <p role="status" className="mt-5">Loading your team…</p>}{error && <p role="alert" className="mt-5 text-red-700">{error.message}</p>}
    {!isLoading && !error && !team && <section className={`${card} mt-6`}><p>You are not a team leader. Team information is available to the team leader account.</p><Link className="mt-4 inline-block font-semibold text-primary underline" href="/register-team">Register a team</Link></section>}
    {actionError && <p className="mt-5 rounded-md bg-red-50 p-4 text-red-800" role="alert">{actionError}</p>}
    {team && <div className="mt-6 grid gap-4 sm:grid-cols-2"><section className={card}><h2 className="text-xl font-semibold">{team.name}</h2><p className="mt-3 text-sm">Points: {team.pointsGiven ? team.balance : "Not yet given"}</p><p className="mt-1 text-sm">Current holding: {team.holding ? `${team.holding.amount} points` : "None"}</p></section><section className={card}><h2 className="font-semibold">Problem statement</h2>{team.assignedPs ? <><p className="mt-2">{team.assignedPs.title}</p><p className="mt-1 text-sm font-medium text-primary">Domain: {team.assignedPs.domain}</p><p className="mt-1 text-sm text-slate-600">{team.assignedPs.description}</p><p className="mt-2 text-xs uppercase text-slate-500">{team.assignedPs.assignmentType}</p></> : <p className="mt-2 text-sm text-slate-600">No problem statement assigned yet. Check the live auction or allocation updates.</p>}</section><section className={`${card} sm:col-span-2`}><h2 className="font-semibold">Team members</h2><ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">{team.members.map((name, index) => <li key={`${name}-${index}`}>{name}</li>)}</ul></section>{team.canChangeMembership && <section className={`${card} sm:col-span-2`}><h2 className="font-semibold">Leave or disband</h2><p className="mt-2 text-sm text-slate-600">This is available only while registration is open and before the team has been given points, placed a bid, or received a problem statement.</p><button disabled={isChangingTeam} onClick={() => void changeMembership(team.isLeader ? "disband" : "leave")} className="mt-4 rounded-md border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60">{isChangingTeam ? "Updating…" : team.isLeader ? "Disband team" : "Leave team"}</button></section>}</div>}
  </main>;
}
