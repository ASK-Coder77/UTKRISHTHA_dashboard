import Link from "next/link";

const cards = [
  ["Events", "Create and update event announcements.", "/admin/events"],
  ["Problem statements", "Manage PS details, capacities, and auction status.", "/admin/problem-statements"],
  ["Teams", "Review teams, award points, update members, and transfer leadership.", "/admin/teams"],
  ["Allocation", "Assign problem statements to participating teams.", "/admin/allocation"],
  ["Rounds", "Configure judging and manage round status.", "/admin/rounds"],
  ["Results", "Preview rankings and published results.", "/results"],
  ["Users", "Grant or revoke admin and judge access.", "/admin/users"],
  ["Audit log", "Review recorded administrative and event actions.", "/admin/audit-log"],
] as const;

export default function AdminOverviewPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Control center</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Admin overview</h1>
      <p className="mt-3 max-w-2xl text-slate-600">Manage the event from one place. Choose an area below to continue.</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(([title, description, href]) => (
          <Link className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-border hover:shadow" href={href} key={href}>
            <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
            <span className="mt-4 inline-block text-sm font-semibold text-primary">Open {title.toLowerCase()} →</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
