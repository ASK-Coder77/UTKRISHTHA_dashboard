"use client";

import { useEffect, useState, type FormEvent } from "react";

type ProblemStatement = {
  id: string;
  title: string;
  domain: string;
  description: string;
  basePrice: number;
  capacity: number | null;
  status: "upcoming" | "live" | "closed";
};

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "The request could not be completed.");
  return data;
}

/** Client component because it loads current PS data and submits edit/delete actions. */
export function PostAuctionProblemStatementControls() {
  const [items, setItems] = useState<ProblemStatement[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    try {
      const data = await requestJson<{ problemStatements: ProblemStatement[] }>("/api/problem-statements");
      setItems(data.problemStatements);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load problem statements.");
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function save(event: FormEvent<HTMLFormElement>, ps: ProblemStatement) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusyId(ps.id); setError(null); setMessage(null);
    try {
      const capacityText = String(form.get("capacity") ?? "");
      await requestJson(`/api/admin/problem-statements/${ps.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: form.get("title"), domain: form.get("domain"), description: form.get("description"), basePrice: Number(form.get("basePrice")),
        }),
      });
      await requestJson(`/api/admin/problem-statements/${ps.id}/capacity`, {
        method: "PATCH",
        body: JSON.stringify({ capacity: capacityText ? Number(capacityText) : null }),
      });
      setMessage("Problem statement updated.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update the problem statement.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(ps: ProblemStatement) {
    if (!window.confirm(`Delete ${ps.title}? Teams assigned through an auction will be unassigned and refunded.`)) return;
    setBusyId(ps.id); setError(null); setMessage(null);
    try {
      await requestJson(`/api/admin/problem-statements/${ps.id}`, { method: "DELETE" });
      setMessage("Problem statement deleted.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to delete the problem statement.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="mx-auto max-w-6xl space-y-4 px-4 pb-10 sm:px-6" aria-labelledby="post-auction-management">
      <div>
        <h2 id="post-auction-management" className="text-xl font-bold text-slate-950">Edit or delete any problem statement</h2>
        <p className="mt-1 text-sm text-slate-600">Available to admins and super admins even after bidding or auction closure.</p>
      </div>
      {message && <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800" role="status">{message}</p>}
      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      <div className="grid gap-4">
        {items.map((ps) => (
          <form key={ps.id} onSubmit={(event) => void save(event, ps)} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-2">
            <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-slate-950">{ps.title} <span className="text-sm font-normal text-slate-600">({ps.status})</span></p>
              <button type="button" disabled={Boolean(busyId)} onClick={() => void remove(ps)} className="rounded-md border border-red-300 px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-50">Delete</button>
            </div>
            <input required name="title" defaultValue={ps.title} aria-label={`Title for ${ps.title}`} className="rounded-md border border-slate-300 px-3 py-2" />
            <input required name="domain" defaultValue={ps.domain} aria-label={`Domain for ${ps.title}`} className="rounded-md border border-slate-300 px-3 py-2" />
            <input required name="basePrice" type="number" min="1" step="1" defaultValue={ps.basePrice} aria-label={`Base price for ${ps.title}`} className="rounded-md border border-slate-300 px-3 py-2" />
            <input name="capacity" type="number" min="1" step="1" defaultValue={ps.capacity ?? ""} placeholder="Use default capacity" aria-label={`Capacity for ${ps.title}`} className="rounded-md border border-slate-300 px-3 py-2" />
            <textarea required name="description" defaultValue={ps.description} aria-label={`Description for ${ps.title}`} className="min-h-24 rounded-md border border-slate-300 px-3 py-2 md:col-span-2" />
            <button disabled={Boolean(busyId)} className="w-fit rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-400">{busyId === ps.id ? "Saving…" : "Save changes"}</button>
          </form>
        ))}
      </div>
    </section>
  );
}
