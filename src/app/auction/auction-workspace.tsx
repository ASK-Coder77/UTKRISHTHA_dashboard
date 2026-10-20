"use client";

import Link from "next/link";
import useSWR from "swr";
import { useState } from "react";

type Ps = { id: string; title: string; domain: string; description: string; basePrice: number; capacity: number | null; status: string; auctionOutcome: string | null };
type LivePs = { id: string; title: string; domain?: string; description: string; basePrice: number; capacity: number; spotsFilled: number; spotsFree: number; minBidToEnter: number; holdings: { teamName: string; amount: number }[] };
type MyData = { teamId?: string; balance: number | null; assignedPsId: string | null; holding: { psId: string; amount: number } | null };
const fetcher = async (url: string) => { const response = await fetch(url); const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Unable to load auction data."); return body; };
const card = "rounded-xl border border-slate-200 bg-white p-5 shadow-sm";

export function AuctionWorkspace({ showResults, showTeamLink }: { showResults: boolean; showTeamLink: boolean }) {
  const { data: list, error: listError, isLoading: listLoading } = useSWR<{ problemStatements: Ps[] }>("/api/problem-statements", fetcher);
  const { data: live, error: liveError, isLoading: liveLoading } = useSWR<{ problemStatements: LivePs[] }>("/api/auction/live", fetcher, { refreshInterval: 5000, refreshWhenHidden: false, refreshWhenOffline: false });
  const { data: mine, mutate: refreshMine } = useSWR<MyData>("/api/auction/my-holding", fetcher);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const submitBid = async (ps: LivePs) => {
    if (!mine?.holding && mine?.balance !== null && mine?.balance !== undefined && !Number.isSafeInteger(Number(amounts[ps.id]))) { setMessage("Enter a whole number of points."); return; }
    setPending(ps.id); setMessage("");
    try {
      if (!mine?.teamId) throw new Error("Only the team leader can place a bid.");
      const response = await fetch("/api/auction/bids", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teamId: mine.teamId, problemStatementId: ps.id, amount: Number(amounts[ps.id]) }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Bid rejected.");
      setMessage("Bid placed. The live board will refresh shortly."); setAmounts((current) => ({ ...current, [ps.id]: "" })); await refreshMine();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to place the bid."); }
    finally { setPending(null); }
  };
  const active = live?.problemStatements ?? [];
  const liveById = new Map(active.map((ps) => [ps.id, ps]));

  return <main className="mx-auto min-h-screen max-w-6xl px-4 py-8 sm:px-6">
    <nav aria-label="Main navigation" className="mb-8 flex flex-wrap gap-4 text-sm font-semibold text-primary"><Link href="/">Home</Link><Link href="/auction">Auction</Link>{showTeamLink && <Link href="/team">My team</Link>}<Link href="/events">Events</Link>{showResults && <Link href="/results">Results</Link>}</nav>
    <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">Day 1</p><h1 className="mt-2 text-3xl font-bold tracking-tight">Problem statement auction</h1>
    <p className="mt-2 text-slate-600">Live boards refresh every five seconds while this tab is visible. Holdings show team names and bids only.</p>
    {mine?.balance !== null && mine?.balance !== undefined && <p className={`${card} mt-5 inline-block text-sm`}>Your available points: <strong>{mine.balance}</strong>{mine.holding && <span> · Your current bid: {mine.holding.amount}</span>}</p>}
    {message && <p role="status" aria-live="polite" className="mt-4 rounded-lg bg-tint p-3 text-sm text-deep">{message}</p>}
    <h2 className="mb-3 mt-8 text-xl font-semibold">Live auctions</h2>
    {liveLoading && <p role="status">Loading live auctions…</p>}{liveError && <p role="alert" className="text-red-700">{liveError.message}</p>}
    {!liveLoading && !liveError && active.length === 0 && <p className={`${card} text-slate-600`}>There are no live auctions right now.</p>}
    <div className="grid gap-4 md:grid-cols-2">{active.map((ps) => <section className={card} key={ps.id}>
      <div className="flex items-start justify-between gap-3"><div><h3 className="text-lg font-semibold">{ps.title}</h3><p className="mt-1 text-sm font-medium text-primary">Domain: {ps.domain ?? "General"}</p><p className="mt-1 text-sm text-slate-600">{ps.description}</p></div><span className="shrink-0 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">Live</span></div>
      <p className="mt-4 text-sm">Seats: <strong>{ps.spotsFilled}/{ps.capacity}</strong> · Minimum bid: <strong>{ps.minBidToEnter}</strong></p>
      <ul className="mt-3 space-y-1 text-sm text-slate-700">{ps.holdings.map((holding, index) => <li key={`${holding.teamName}-${index}`}>{holding.teamName} — {holding.amount} points</li>)}</ul>
      {mine?.balance !== null && mine?.balance !== undefined && !mine.assignedPsId && <div className="mt-4 flex gap-2"><label className="sr-only" htmlFor={`bid-${ps.id}`}>Bid amount for {ps.title}</label><input id={`bid-${ps.id}`} className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2" type="number" min={ps.minBidToEnter} max={mine.balance} step={1} inputMode="numeric" value={amounts[ps.id] ?? ""} onChange={(event) => setAmounts((current) => ({ ...current, [ps.id]: event.target.value }))} /><button disabled={pending !== null || !amounts[ps.id]} onClick={() => void submitBid(ps)} className="rounded-md bg-primary px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400">{pending === ps.id ? "Bidding…" : "Place bid"}</button></div>}
    </section>)}</div>
    <h2 className="mb-3 mt-10 text-xl font-semibold">All problem statements</h2>
    {listLoading && <p role="status">Loading problem statements…</p>}{listError && <p role="alert" className="text-red-700">{listError.message}</p>}
    <div className="grid gap-3 sm:grid-cols-2">{(list?.problemStatements ?? []).map((ps) => <article className={card} key={ps.id}><div className="flex justify-between gap-3"><h3 className="font-semibold">{ps.title}</h3><span className="text-xs font-semibold uppercase text-slate-600">{ps.status}</span></div><p className="mt-2 text-sm font-medium text-primary">Domain: {ps.domain}</p><p className="mt-2 text-sm text-slate-600">{ps.description}</p><p className="mt-3 text-sm">Base price: {ps.basePrice} · Capacity: {ps.capacity ?? "default"}{liveById.has(ps.id) ? ` · ${liveById.get(ps.id)?.spotsFilled}/${liveById.get(ps.id)?.capacity} filled` : ""}</p></article>)}</div>
  </main>;
}
