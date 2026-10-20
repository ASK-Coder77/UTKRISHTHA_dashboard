"use client";

import { useEffect, useState, type FormEvent } from "react";

type Team = { id: string; name: string; assignment: { title: string | null } | null };

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "The request could not be completed.");
  return data;
}

/** Client component because it loads teams and submits post-auction name edits. */
export function PostAuctionTeamControls() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    try {
      const data = await requestJson<{ teams: Team[] }>("/api/admin/teams");
      setTeams(data.teams);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load teams.");
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function save(event: FormEvent<HTMLFormElement>, team: Team) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusyId(team.id); setError(null); setMessage(null);
    try {
      await requestJson(`/api/admin/teams/${team.id}`, { method: "PATCH", body: JSON.stringify({ name: form.get("name") }) });
      setMessage("Team name updated.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update the team.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="mx-auto max-w-6xl space-y-4 px-4 pb-10 sm:px-6" aria-labelledby="post-auction-team-management">
      <div>
        <h2 id="post-auction-team-management" className="text-xl font-bold text-slate-950">Rename any team</h2>
        <p className="mt-1 text-sm text-slate-600">Available to admins and super admins even after bidding or auction closure.</p>
      </div>
      {message && <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800" role="status">{message}</p>}
      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      <div className="grid gap-3">
        {teams.map((team) => (
          <form key={team.id} onSubmit={(event) => void save(event, team)} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <label className="sr-only" htmlFor={`team-name-${team.id}`}>Team name</label>
            <input id={`team-name-${team.id}`} required name="name" defaultValue={team.name} className="min-w-52 flex-1 rounded-md border border-slate-300 px-3 py-2" />
            <span className="text-sm text-slate-600">{team.assignment?.title ?? "No PS assigned"}</span>
            <button disabled={Boolean(busyId)} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-400">{busyId === team.id ? "Saving…" : "Save name"}</button>
          </form>
        ))}
      </div>
    </section>
  );
}
