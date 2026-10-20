"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";

type Section = "events" | "problem-statements" | "teams" | "allocation" | "users" | "audit-log";
type EventItem = { id: string; title: string; description: string; date: string; time: string; venue: string; status: "upcoming" | "live" | "completed" };
type PsItem = { id: string; title: string; domain: string; track: "web_dev" | "ai_ml"; description: string; basePrice: number; capacity: number | null; status: "upcoming" | "live" | "closed"; auctionOutcome: "sold" | "unsold" | null; revealed: boolean };
type TeamItem = {
  id: string; name: string; leaderEmail: string; track: "web_dev" | "ai_ml"; previousHackathonExperience: string | null; githubUrl: string | null; linkedinUrl: string | null; rulesAcceptedAt: string | null; balance: number; pointsGiven: boolean;
  assignment: { problemStatementId: string; title: string | null; type: "won" | "allocated" | null } | null;
  members: Array<{ name: string; email: string; phone: string | null; rollNumber: string; year: string; branch: string }>;
};
type RoleList = { admins: Array<{ email: string; addedAt: string }>; judges: Array<{ email: string; collegeEmail: boolean; addedAt: string }>; allowNonCollegeJudges: boolean };
type AuditEntry = { id: string; action: string; actorId: string | null; targetType: string; targetId: string | null; previousValue: unknown; newValue: unknown; createdAt: string };

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers } });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "The request could not be completed.");
  return data;
}

function PageHeading({ title, description }: { title: string; description: string }) {
  return <div><p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Administration</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">{title}</h1><p className="mt-3 text-slate-600">{description}</p></div>;
}

function Message({ error, message }: { error: string | null; message: string | null }) {
  return <>{error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}{message && <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800" role="status">{message}</p>}</>;
}

function Card({ children }: { children: ReactNode }) {
  return <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">{children}</section>;
}

function useData<T>(loader: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setData(await loader()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load data."); }
    finally { setLoading(false); }
  }, [loader]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void reload(); }, 0);
    return () => window.clearTimeout(timer);
  }, [reload]);
  return { data, error, loading, reload, setData };
}

function EventsWorkspace() {
  const load = useCallback(async () => (await requestJson<{ events: EventItem[] }>("/api/events")).events, []);
  const { data: events, error, loading, reload } = useData(load);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(null); setActionError(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await requestJson("/api/admin/events", { method: "POST", body: JSON.stringify({ title: form.get("title"), description: form.get("description"), date: form.get("date"), time: form.get("time"), venue: form.get("venue"), status: "upcoming" }) });
      formElement.reset(); setMessage("Event created."); await reload();
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : "Unable to create event."); }
    finally { setBusy(false); }
  }

  async function update(id: string, patch: Partial<EventItem>) {
    setBusy(true); setMessage(null); setActionError(null);
    try { await requestJson(`/api/admin/events/${id}`, { method: "PATCH", body: JSON.stringify(patch) }); setMessage("Event updated."); await reload(); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : "Unable to update event."); }
    finally { setBusy(false); }
  }

  async function editEvent(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault(); setBusy(true); setMessage(null); setActionError(null);
    const form = new FormData(event.currentTarget);
    try {
      await requestJson(`/api/admin/events/${id}`, { method: "PATCH", body: JSON.stringify({ title: form.get("title"), description: form.get("description"), date: form.get("date"), time: form.get("time"), venue: form.get("venue") }) });
      setMessage("Event details saved."); await reload();
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : "Unable to update event."); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this event?")) return;
    setBusy(true); setMessage(null); setActionError(null);
    try { await requestJson(`/api/admin/events/${id}`, { method: "DELETE" }); setMessage("Event deleted."); await reload(); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : "Unable to delete event."); }
    finally { setBusy(false); }
  }

  return <main className="mx-auto max-w-6xl space-y-7 px-4 py-10 sm:px-6"><PageHeading title="Events" description="Create events and update their details or status."/><Message error={actionError} message={message}/><Card><form className="grid gap-3 md:grid-cols-2" onSubmit={create}><h2 className="md:col-span-2 text-lg font-semibold">Create an event</h2><input required name="title" placeholder="Title" className="rounded-md border border-slate-300 px-3 py-2"/><input required name="venue" placeholder="Venue" className="rounded-md border border-slate-300 px-3 py-2"/><input required name="date" type="date" className="rounded-md border border-slate-300 px-3 py-2"/><input required name="time" type="time" className="rounded-md border border-slate-300 px-3 py-2"/><textarea required name="description" placeholder="Description" className="min-h-24 rounded-md border border-slate-300 px-3 py-2 md:col-span-2"/><button disabled={busy} className="w-fit rounded-md bg-primary px-4 py-2 font-semibold text-white disabled:bg-slate-400">{busy ? "Saving…" : "Create event"}</button></form></Card>{loading ? <p>Loading events…</p> : error ? <p className="rounded-md bg-red-50 p-4 text-red-800" role="alert">{error}</p> : <div className="grid gap-4">{(events ?? []).map((event) => <Card key={event.id}><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-semibold text-slate-950">{event.title}</h2><p className="mt-1 text-sm text-slate-600">{event.date.slice(0, 10)} at {event.time} · {event.venue}</p><p className="mt-2 text-sm text-slate-700">{event.description}</p></div><div className="flex gap-2"><select aria-label={`Status for ${event.title}`} value={event.status} disabled={busy} onChange={(e) => void update(event.id, { status: e.target.value as EventItem["status"] })} className="rounded-md border border-slate-300 px-2 py-1"><option value="upcoming">Upcoming</option><option value="live">Live</option><option value="completed">Completed</option></select><button disabled={busy} onClick={() => void remove(event.id)} className="rounded-md border border-red-300 px-3 py-1 text-sm text-red-700">Delete</button></div></div><details className="mt-4 border-t border-slate-200 pt-3"><summary className="cursor-pointer text-sm font-semibold text-primary">Edit details</summary><form className="mt-3 grid gap-3 md:grid-cols-2" onSubmit={(e) => void editEvent(e, event.id)}><input required name="title" defaultValue={event.title} className="rounded-md border border-slate-300 px-3 py-2"/><input required name="venue" defaultValue={event.venue} className="rounded-md border border-slate-300 px-3 py-2"/><input required name="date" type="date" defaultValue={event.date.slice(0, 10)} className="rounded-md border border-slate-300 px-3 py-2"/><input required name="time" type="time" defaultValue={event.time} className="rounded-md border border-slate-300 px-3 py-2"/><textarea required name="description" defaultValue={event.description} className="min-h-24 rounded-md border border-slate-300 px-3 py-2 md:col-span-2"/><button disabled={busy} className="w-fit rounded-md border border-slate-300 px-4 py-2 font-semibold">Save details</button></form></details></Card>)}</div>}</main>;
}

function ProblemStatementsWorkspace() {
  const load = useCallback(async () => (await requestJson<{ problemStatements: PsItem[] }>("/api/problem-statements")).problemStatements, []);
  const { data: items, error, loading, reload } = useData(load);
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState<string | null>(null); const [actionError, setActionError] = useState<string | null>(null);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setNotice(null); setActionError(null); const formElement = event.currentTarget; const form = new FormData(formElement);
    const capacityText = String(form.get("capacity") ?? "");
    try { await requestJson("/api/admin/problem-statements", { method: "POST", body: JSON.stringify({ title: form.get("title"), domain: form.get("domain"), track: form.get("track"), description: form.get("description"), basePrice: Number(form.get("basePrice")), ...(capacityText ? { capacity: Number(capacityText) } : {}) }) }); formElement.reset(); setNotice("Problem statement created."); await reload(); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : "Unable to create problem statement."); }
    finally { setBusy(false); }
  }
  async function action(id: string, op: "open" | "close" | "delete" | "reveal" | "reveal-all" | "reset-delete") {
    const label = op === "reset-delete" ? "Reset and permanently delete this test problem statement, including its bids and assignments" : op === "reveal" || op === "reveal-all" ? "Reveal (this cannot be undone)" : op === "open" ? "Open" : op === "close" ? "Close" : "Delete";
    if (!window.confirm(`${label}?`)) return;
    setBusy(true); setActionError(null); setNotice(null);
    try { await requestJson(op === "reveal-all" ? "/api/admin/problem-statements/reveal-all" : op === "reset-delete" ? `/api/admin/problem-statements/${id}/reset-delete` : `/api/admin/problem-statements/${id}${op === "delete" ? "" : `/${op}`}`, { method: op === "delete" ? "DELETE" : "POST", ...(op === "reset-delete" ? { body: JSON.stringify({ confirmed: true }) } : {}) }); setNotice(`Problem statement ${op === "delete" || op === "reset-delete" ? "deleted" : op === "open" ? "opened" : op === "reveal" || op === "reveal-all" ? "revealed" : "closed"}.`); await reload(); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : "Unable to update problem statement."); }
    finally { setBusy(false); }
  }
  async function updatePs(event: FormEvent<HTMLFormElement>, ps: PsItem) {
    event.preventDefault(); setBusy(true); setActionError(null); setNotice(null);
    const form = new FormData(event.currentTarget);
    const capacityText = String(form.get("capacity") ?? "");
    try {
      await requestJson(`/api/admin/problem-statements/${ps.id}`, { method: "PATCH", body: JSON.stringify({ title: form.get("title"), domain: form.get("domain"), description: form.get("description"), basePrice: Number(form.get("basePrice")) }) });
      await requestJson(`/api/admin/problem-statements/${ps.id}/capacity`, { method: "PATCH", body: JSON.stringify({ capacity: capacityText ? Number(capacityText) : null }) });
      setNotice("Problem statement updated."); await reload();
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : "Unable to update problem statement."); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-6xl space-y-7 px-4 py-10 sm:px-6"><div className="flex flex-wrap items-end justify-between gap-3"><PageHeading title="Problem statements" description="Manage PS items and their auction lifecycle."/><button disabled={busy} onClick={() => void action("reveal-all", "reveal-all")} className="rounded-md border border-primary px-3 py-2 text-sm font-semibold text-primary">Reveal all</button></div><Message error={actionError} message={notice}/><Card><form className="grid gap-3 md:grid-cols-2" onSubmit={create}><h2 className="md:col-span-2 text-lg font-semibold">Create a problem statement</h2><input required name="title" placeholder="Title" className="rounded-md border border-slate-300 px-3 py-2"/><input required name="domain" placeholder="Domain (for example, AI/ML)" className="rounded-md border border-slate-300 px-3 py-2"/><select required name="track" className="rounded-md border border-slate-300 px-3 py-2"><option value="web_dev">Web development</option><option value="ai_ml">AI/ML</option></select><input required name="basePrice" type="number" min="1" step="1" placeholder="Base price" className="rounded-md border border-slate-300 px-3 py-2"/><input name="capacity" type="number" min="1" step="1" placeholder="Capacity (optional)" className="rounded-md border border-slate-300 px-3 py-2"/><textarea required name="description" placeholder="Description" className="min-h-24 rounded-md border border-slate-300 px-3 py-2 md:col-span-2"/><button disabled={busy} className="w-fit rounded-md bg-primary px-4 py-2 font-semibold text-white disabled:bg-slate-400">{busy ? "Saving…" : "Create PS"}</button></form></Card>{loading ? <p>Loading problem statements…</p> : error ? <p className="rounded-md bg-red-50 p-4 text-red-800" role="alert">{error}</p> : <div className="grid gap-4">{(items ?? []).map((ps) => <Card key={ps.id}><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-semibold text-slate-950">{ps.title}</h2><p className="mt-1 text-sm font-medium text-primary">Domain: {ps.domain} · Track: {ps.track}</p><p className="mt-1 text-sm text-slate-600">Base {ps.basePrice} · Capacity {ps.capacity ?? "default"} · {ps.status}{ps.auctionOutcome ? ` (${ps.auctionOutcome})` : ""}</p><p className="mt-2 text-sm text-slate-700">{ps.description}</p></div><div className="flex flex-wrap gap-2">{ps.status === "upcoming" && <>{!ps.revealed && <button disabled={busy} onClick={() => void action(ps.id, "reveal")} className="rounded-md border border-primary px-3 py-2 text-sm font-semibold text-primary">Reveal</button>}{ps.revealed && <button disabled={busy} onClick={() => void action(ps.id, "open")} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white">Open</button>}<button disabled={busy} onClick={() => void action(ps.id, "delete")} className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-700">Delete</button><button disabled={busy} onClick={() => void action(ps.id, "reset-delete")} className="rounded-md border border-red-300 px-3 py-2 text-sm font-semibold text-red-700">Reset test PS</button></>}{ps.status === "live" && <button disabled={busy} onClick={() => void action(ps.id, "close")} className="rounded-md bg-amber-600 px-3 py-2 text-sm font-semibold text-white">Close auction</button>}</div></div>{ps.status === "upcoming" && <details className="mt-4 border-t border-slate-200 pt-3"><summary className="cursor-pointer text-sm font-semibold text-primary">Edit details and capacity</summary><form className="mt-3 grid gap-3 md:grid-cols-2" onSubmit={(event) => void updatePs(event, ps)}><input required name="title" defaultValue={ps.title} className="rounded-md border border-slate-300 px-3 py-2"/><input required name="domain" defaultValue={ps.domain} className="rounded-md border border-slate-300 px-3 py-2"/><p className="self-center text-sm text-slate-600">Track: {ps.track.replace("_", " ")} (immutable)</p><input required name="basePrice" type="number" min="1" step="1" defaultValue={ps.basePrice} className="rounded-md border border-slate-300 px-3 py-2"/><input name="capacity" type="number" min="1" step="1" defaultValue={ps.capacity ?? ""} placeholder="Use default capacity" className="rounded-md border border-slate-300 px-3 py-2"/><textarea required name="description" defaultValue={ps.description} className="min-h-24 rounded-md border border-slate-300 px-3 py-2 md:col-span-2"/><button disabled={busy} className="w-fit rounded-md border border-slate-300 px-4 py-2 font-semibold">Save changes</button></form></details>}</Card>)}</div>}</main>;
}

function TeamsWorkspace() {
  const load = useCallback(async () => (await requestJson<{ teams: TeamItem[] }>("/api/admin/teams")).teams, []);
  const { data: teams, error, loading, reload } = useData(load);
  const [busyId, setBusyId] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null); const [actionError, setActionError] = useState<string | null>(null);
  async function run(teamId: string, label: string, url: string, init: RequestInit, refresh = true): Promise<boolean> {
    setBusyId(teamId); setNotice(null); setActionError(null);
    try {
      try { await requestJson(url, init); }
      catch (cause) {
        const message = cause instanceof Error ? cause.message : "";
        if (message.includes("needs confirmation") && init.method === "PATCH" && typeof init.body === "string" && window.confirm(message.includes("track-year") ? "Confirm this one-team track-year exception?" : "Confirm this one-team size exception?")) {
          const original = JSON.parse(init.body) as Record<string, unknown>;
          await requestJson(url, { ...init, body: JSON.stringify({ ...original, ...(message.includes("track-year") ? { confirmYearException: true } : { confirmSizeException: true }) }) });
        } else throw cause;
      }
      setNotice(label); if (refresh) await reload();
      return true;
    }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : "Unable to update team."); return false; }
    finally { setBusyId(null); }
  }
  async function editMember(event: FormEvent<HTMLFormElement>, teamId: string, action: "add" | "remove", email?: string) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); const rollNumber = action === "add" ? window.prompt("Member roll number:") : null; const year = action === "add" ? window.prompt("Member year (UG1, UG2, UG3, or UG4):") : null; const branch = action === "add" ? window.prompt("Member branch:") : null; if (action === "add" && (!rollNumber || !year || !branch)) return; const payload = action === "add" ? { action, member: { name: form.get("name"), email: form.get("email"), rollNumber, year, branch } } : { action, memberEmail: email };
    const saved = await run(teamId, action === "add" ? "Member added." : "Member removed.", `/api/admin/teams/${teamId}/members`, { method: "PATCH", body: JSON.stringify(payload) });
    if (action === "add" && saved) formElement.reset();
  }
  async function removeMember(teamId: string, email: string) {
    await run(teamId, "Member removed.", `/api/admin/teams/${teamId}/members`, { method: "PATCH", body: JSON.stringify({ action: "remove", memberEmail: email }) });
  }
  return <main className="mx-auto max-w-6xl space-y-7 px-4 py-10 sm:px-6"><div className="flex flex-wrap items-end justify-between gap-4"><PageHeading title="Teams" description="Review teams, give starting points, manage members, and transfer leadership."/><button disabled={Boolean(busyId) || loading} onClick={() => void run("bulk", "Starting points given to eligible teams.", "/api/admin/teams/give-points-all", { method: "POST", body: "{}" })} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-400">Give points to all without points</button></div><Message error={actionError} message={notice}/>{loading ? <p>Loading teams…</p> : error ? <p className="rounded-md bg-red-50 p-4 text-red-800" role="alert">{error}</p> : <div className="grid gap-4">{(teams ?? []).map((team) => <Card key={team.id}><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-semibold text-slate-950">{team.name}</h2><p className="mt-1 text-sm text-slate-600">Leader: {team.leaderEmail} · {team.pointsGiven ? `Balance: ${team.balance}` : "Points not given"}</p><p className="mt-1 text-sm text-slate-600">PS: {team.assignment?.title ?? "Not assigned"}{team.assignment?.type ? ` (${team.assignment.type})` : ""}</p></div><div className="flex flex-wrap gap-2"><button disabled={Boolean(busyId) || team.pointsGiven} onClick={() => void run(team.id, "Starting points given.", `/api/admin/teams/${team.id}/give-points`, { method: "POST", body: "{}" })} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-400">Give points</button><button disabled={Boolean(busyId)} onClick={() => { if (window.confirm(`Delete ${team.name}?`)) void run(team.id, "Team deleted.", `/api/admin/teams/${team.id}`, { method: "DELETE" }); }} className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-700">Delete team</button></div></div><div className="mt-4 grid gap-4 border-t border-slate-200 pt-4 md:grid-cols-2"><div><h3 className="font-semibold">Members ({team.members.length})</h3><ul className="mt-2 space-y-2 text-sm">{team.members.map((member) => <li className="flex flex-wrap items-center justify-between gap-2" key={member.email}><span>{member.name} · {member.email}</span>{member.email !== team.leaderEmail && <button disabled={Boolean(busyId)} className="text-red-700 underline" onClick={() => void removeMember(team.id, member.email)}>Remove</button>}</li>)}</ul><form className="mt-3 grid gap-2 sm:grid-cols-2" onSubmit={(event) => void editMember(event, team.id, "add")}><input required name="name" placeholder="Member name" className="rounded-md border border-slate-300 px-3 py-2"/><input required name="email" type="email" placeholder="Member email" className="rounded-md border border-slate-300 px-3 py-2"/><button disabled={Boolean(busyId)} className="w-fit rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold">Add member</button></form></div><form className="space-y-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const newLeaderEmail = String(form.get("email") ?? ""); void run(team.id, "Leadership transferred.", `/api/admin/teams/${team.id}/transfer-leader`, { method: "POST", body: JSON.stringify({ newLeaderEmail }) }); }}><h3 className="font-semibold">Transfer leadership</h3><p className="text-sm text-slate-600">Choose an existing team member.</p><select required name="email" className="w-full rounded-md border border-slate-300 px-3 py-2"><option value="">Select member</option>{team.members.filter((member) => member.email !== team.leaderEmail).map((member) => <option key={member.email} value={member.email}>{member.name}</option>)}</select><button disabled={Boolean(busyId)} className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold">Transfer leader</button></form></div></Card>)}</div>}</main>;
}

function AllocationWorkspace() {
  const load = useCallback(async () => {
    const [teamResponse, psResponse] = await Promise.all([requestJson<{ teams: TeamItem[] }>("/api/admin/teams"), requestJson<{ problemStatements: PsItem[] }>("/api/problem-statements")]);
    return { teams: teamResponse.teams, statements: psResponse.problemStatements };
  }, []);
  const { data, error, loading, reload } = useData(load);
  const [teamId, setTeamId] = useState(""); const [psId, setPsId] = useState(""); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState<string | null>(null); const [actionError, setActionError] = useState<string | null>(null);
  async function run(url: string, body: unknown, label: string, confirmText: string) {
    if (!window.confirm(confirmText)) return;
    setBusy(true); setNotice(null); setActionError(null);
    try {
      const payload = (body && typeof body === "object" ? { ...(body as Record<string, unknown>) } : {}) as Record<string, unknown>;
      let result: Record<string, unknown> | null = null;
      for (let attempt = 0; attempt < 3 && !result; attempt += 1) {
        try { result = await requestJson<Record<string, unknown>>(url, { method: "POST", body: JSON.stringify(payload) }); }
        catch (cause) {
          const reason = cause instanceof Error ? cause.message : "";
          if (reason.includes("Confirm that this allocation may exceed capacity.") && window.confirm("This assignment will exceed the problem statement capacity. Continue?")) payload.exceedCapacityConfirmed = true;
          else if (reason.includes("A super-admin confirmation is required") && window.confirm("This changes an auction-won assignment and requires super-admin confirmation. Continue?")) payload.superAdminConfirmed = true;
          else throw cause;
        }
      }
      if (!result) throw new Error("Unable to complete allocation.");
      setNotice(`${label} ${"allocatedTeamIds" in result ? `(${(result.allocatedTeamIds as string[]).length} assigned, ${(result.unassignedTeamIds as string[]).length} still unassigned)` : "completed."}`); await reload();
    }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : "Unable to allocate."); }
    finally { setBusy(false); }
  }
  const teams = data?.teams ?? [];
  const unassigned = teams.filter((team) => team.pointsGiven && !team.assignment);
  const noPoints = teams.filter((team) => !team.pointsGiven);
  return <main className="mx-auto max-w-6xl space-y-7 px-4 py-10 sm:px-6"><PageHeading title="Allocation" description="Assign one problem statement to each participating team after auctions have closed."/><Message error={actionError} message={notice}/>{loading ? <p>Loading allocation data…</p> : error ? <p className="rounded-md bg-red-50 p-4 text-red-800" role="alert">{error}</p> : <><div className="grid gap-4 sm:grid-cols-3"><Card><p className="text-sm text-slate-600">Participating teams without a PS</p><p className="mt-1 text-2xl font-bold">{unassigned.length}</p></Card><Card><p className="text-sm text-slate-600">Registered teams without points</p><p className="mt-1 text-2xl font-bold">{noPoints.length}</p></Card><Card><p className="text-sm text-slate-600">Problem statements</p><p className="mt-1 text-2xl font-bold">{data?.statements.length ?? 0}</p></Card></div>{noPoints.length > 0 && <Card><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Teams still needing points</h2><p className="mt-1 text-sm text-slate-600">They are not eligible for allocation until points are given.</p></div><button disabled={busy} onClick={() => void run("/api/admin/teams/give-points-all", {}, "Points given to teams", "Give starting points to every team without points?")} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-400">Give points to all</button></div></Card>}<Card><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-semibold">Random allocation</h2><p className="mt-1 text-sm text-slate-600">Uses available seats and leaves any shortfall unassigned.</p></div><button disabled={busy || unassigned.length === 0} onClick={() => void run("/api/admin/allocation/random", {}, "Random allocation", "Randomly allocate all teams that still need a PS?")} className="rounded-md bg-primary px-4 py-2 font-semibold text-white disabled:bg-slate-400">Allocate randomly</button></div></Card><Card><form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void run("/api/admin/allocation/manual", { teamId, problemStatementId: psId }, "Manual allocation", "Assign this team to the selected problem statement?"); }}><h2 className="sm:col-span-2 font-semibold">Manual allocation</h2><select required value={teamId} onChange={(event) => setTeamId(event.target.value)} className="rounded-md border border-slate-300 px-3 py-2"><option value="">Choose an unassigned participating team</option>{unassigned.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select><select required value={psId} onChange={(event) => setPsId(event.target.value)} className="rounded-md border border-slate-300 px-3 py-2"><option value="">Choose a problem statement</option>{data?.statements.map((ps) => <option key={ps.id} value={ps.id}>{ps.title} ({ps.status})</option>)}</select><button disabled={busy || !teamId || !psId} className="w-fit rounded-md border border-slate-300 px-4 py-2 font-semibold disabled:text-slate-400">Assign team</button></form></Card><Card><h2 className="font-semibold">Current assignments</h2><ul className="mt-3 divide-y divide-slate-200">{teams.filter((team) => team.assignment).map((team) => <li className="flex flex-wrap items-center justify-between gap-3 py-3" key={team.id}><span>{team.name} → {team.assignment?.title ?? "PS"} <span className="text-sm text-slate-500">({team.assignment?.type})</span></span><form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const problemStatementId = String(form.get("problemStatementId") ?? ""); void run("/api/admin/allocation/reassign", { teamId: team.id, problemStatementId }, "Reassignment", `Change ${team.name}'s assigned problem statement?`); }}><select name="problemStatementId" required defaultValue="" className="rounded-md border border-slate-300 px-2 py-1"><option value="">Change PS…</option>{data?.statements.filter((ps) => ps.id !== team.assignment?.problemStatementId).map((ps) => <option key={ps.id} value={ps.id}>{ps.title}</option>)}</select><button disabled={busy} className="rounded-md border border-slate-300 px-3 py-1 text-sm font-semibold">Reassign</button></form></li>)}</ul></Card></>}</main>;
}

function UsersWorkspace() {
  const load = useCallback(async () => requestJson<RoleList>("/api/admin/users"), []);
  const { data, error, loading, reload } = useData(load); const [email, setEmail] = useState(""); const [role, setRole] = useState<"admin" | "judge">("admin"); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState<string | null>(null); const [actionError, setActionError] = useState<string | null>(null);
  async function mutate(method: "POST" | "DELETE", targetRole: "admin" | "judge", targetEmail: string) {
    setBusy(true); setNotice(null); setActionError(null);
    try { await requestJson("/api/admin/users", { method, body: JSON.stringify({ role: targetRole, email: targetEmail }) }); setNotice(method === "POST" ? "Access granted." : "Access revoked."); if (method === "POST") setEmail(""); await reload(); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : "Unable to update access."); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-6xl space-y-7 px-4 py-10 sm:px-6"><PageHeading title="Users" description="Manage admin and judge access. Only super admins can change these allowlists."/><Message error={actionError} message={notice}/>{loading ? <p>Loading users…</p> : error ? <p className="rounded-md bg-red-50 p-4 text-red-800" role="alert">{error}</p> : <><Card><form className="grid gap-3 sm:grid-cols-[1fr_12rem_auto]" onSubmit={(event) => { event.preventDefault(); void mutate("POST", role, email); }}><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email address" className="rounded-md border border-slate-300 px-3 py-2"/><select value={role} onChange={(event) => setRole(event.target.value as "admin" | "judge")} className="rounded-md border border-slate-300 px-3 py-2"><option value="admin">Admin</option><option value="judge">Judge</option></select><button disabled={busy} className="rounded-md bg-primary px-4 py-2 font-semibold text-white disabled:bg-slate-400">Grant access</button></form><p className="mt-3 text-sm text-slate-600">External judges are {data?.allowNonCollegeJudges ? "enabled" : "disabled"} by the current setting.</p></Card><div className="grid gap-4 lg:grid-cols-2">{([ ["Admins", "admin", data?.admins ?? []], ["Judges", "judge", data?.judges ?? []] ] as const).map(([title, targetRole, entries]) => <Card key={targetRole}><h2 className="text-lg font-semibold">{title} ({entries.length})</h2>{entries.length === 0 ? <p className="mt-3 text-sm text-slate-600">No accounts listed.</p> : <ul className="mt-3 divide-y divide-slate-200">{entries.map((entry) => <li className="flex flex-wrap items-center justify-between gap-2 py-3" key={entry.email}><span className="text-sm text-slate-800">{entry.email}{"collegeEmail" in entry && !entry.collegeEmail ? <span className="ml-2 text-xs text-amber-700">External</span> : null}</span><button disabled={busy} onClick={() => { if (window.confirm(`Revoke ${targetRole} access for ${entry.email}?`)) void mutate("DELETE", targetRole, entry.email); }} className="rounded-md border border-red-300 px-3 py-1 text-sm text-red-700">Revoke</button></li>)}</ul>}</Card>)}</div></>}</main>;
}

function AuditWorkspace() {
  const [page, setPage] = useState(1); const [data, setData] = useState<{ entries: AuditEntry[]; pages: number; total: number } | null>(null); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => { setLoading(true); setError(null); try { const result = await requestJson<{ entries: AuditEntry[]; pages: number; total: number }>(`/api/admin/audit-log?page=${page}&limit=50`); setData(result); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load audit log."); } finally { setLoading(false); } }, [page]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void reload(); }, 0);
    return () => window.clearTimeout(timer);
  }, [reload]);
  return <main className="mx-auto max-w-6xl space-y-7 px-4 py-10 sm:px-6"><PageHeading title="Audit log" description="Append-only history of administrative changes and event activity. Email addresses in older entries are redacted."/>{loading ? <p>Loading audit log…</p> : error ? <p className="rounded-md bg-red-50 p-4 text-red-800" role="alert">{error}</p> : <><p className="text-sm text-slate-600">{data?.total ?? 0} entries</p><div className="space-y-3">{(data?.entries ?? []).map((entry) => <Card key={entry.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold text-slate-950">{entry.action}</h2><p className="mt-1 text-sm text-slate-600">{entry.targetType}{entry.targetId ? ` · ${entry.targetId}` : ""}{entry.actorId ? ` · actor ${entry.actorId}` : ""}</p></div><time className="text-sm text-slate-500">{new Date(entry.createdAt).toLocaleString()}</time></div><details className="mt-3 text-sm"><summary className="cursor-pointer font-medium text-primary">View recorded values</summary><pre className="mt-2 overflow-x-auto rounded-md bg-slate-50 p-3 text-xs text-slate-700">{JSON.stringify({ previousValue: entry.previousValue, newValue: entry.newValue }, null, 2)}</pre></details></Card>)}</div><div className="flex items-center justify-between"><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded-md border border-slate-300 px-3 py-2 disabled:opacity-50">Previous</button><span className="text-sm text-slate-600">Page {page} of {Math.max(1, data?.pages ?? 1)}</span><button disabled={page >= (data?.pages ?? 1)} onClick={() => setPage((value) => value + 1)} className="rounded-md border border-slate-300 px-3 py-2 disabled:opacity-50">Next</button></div></>}</main>;
}

export function AdminWorkspace({ section }: { section: Section }) {
  if (section === "events") return <EventsWorkspace/>;
  if (section === "problem-statements") return <ProblemStatementsWorkspace/>;
  if (section === "teams") return <TeamsWorkspace/>;
  if (section === "allocation") return <AllocationWorkspace/>;
  if (section === "users") return <UsersWorkspace/>;
  return <AuditWorkspace/>;
}
