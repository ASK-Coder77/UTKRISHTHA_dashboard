"use client";

import Link from "next/link";
import useSWR from "swr";

type EventItem = { id: string; title: string; description: string; date: string; time: string; venue: string; status: string };
const fetcher = async (url: string) => { const response = await fetch(url); const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Unable to load events."); return body; };
const card = "rounded-xl border border-slate-200 bg-white p-5 shadow-sm";

export function EventsWorkspace({ showResults, showTeamLink }: { showResults: boolean; showTeamLink: boolean }) {
  const { data, error, isLoading } = useSWR<{ events: EventItem[] }>("/api/events", fetcher);
  return <main className="mx-auto min-h-screen max-w-5xl px-4 py-8 sm:px-6">
    <nav aria-label="Main navigation" className="mb-8 flex flex-wrap gap-4 text-sm font-semibold text-primary"><Link href="/">Home</Link><Link href="/auction">Auction</Link>{showTeamLink && <Link href="/team">My team</Link>}<Link href="/events">Events</Link>{showResults && <Link href="/results">Results</Link>}</nav>
    <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">Utkrishta</p><h1 className="mt-2 text-3xl font-bold">Events</h1><p className="mt-2 text-slate-600">Event schedule, venues, and updates.</p>
    {isLoading && <p role="status" className="mt-6">Loading events…</p>}{error && <p role="alert" className="mt-6 text-red-700">{error.message}</p>}
    {!isLoading && !error && data?.events.length === 0 && <p className={`${card} mt-6 text-slate-600`}>No events have been announced yet.</p>}
    <div className="mt-6 grid gap-4 md:grid-cols-2">{data?.events.map((event) => <article key={event.id} className={card}><div className="flex items-start justify-between gap-3"><h2 className="text-lg font-semibold">{event.title}</h2><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold capitalize text-slate-700">{event.status}</span></div><p className="mt-2 text-sm text-slate-600">{event.description}</p><dl className="mt-4 grid grid-cols-[5rem_1fr] gap-y-1 text-sm"><dt className="font-medium">Date</dt><dd>{new Date(event.date).toLocaleDateString()}</dd><dt className="font-medium">Time</dt><dd>{event.time}</dd><dt className="font-medium">Venue</dt><dd>{event.venue}</dd></dl></article>)}</div>
  </main>;
}
