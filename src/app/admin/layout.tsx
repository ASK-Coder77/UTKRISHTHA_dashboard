import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { connectToDatabase } from "@/lib/db";
import { getRoleForEmail, normalizeEmail } from "@/lib/roles";

const pages = [
  ["/admin", "Overview"],
  ["/admin/events", "Events"],
  ["/admin/problem-statements", "Problem statements"],
  ["/admin/teams", "Teams"],
  ["/admin/allocation", "Allocation"],
  ["/admin/rounds", "Rounds"],
  ["/results", "Results"],
  ["/admin/users", "Users"],
  ["/admin/audit-log", "Audit log"],
] as const;

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();
  if (!session?.user?.email) redirect("/");
  await connectToDatabase();
  const role = await getRoleForEmail(normalizeEmail(session.user.email));
  if (role !== "admin" && role !== "super_admin") redirect("/");

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-5 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Link className="text-sm font-semibold uppercase tracking-[0.18em] text-primary" href="/admin">Utkrishta Admin</Link>
              <p className="mt-1 text-sm text-slate-600">Signed in as {role === "super_admin" ? "super admin" : "admin"}</p>
            </div>
            {role === "super_admin" && <Link className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50" href="/admin/settings">Settings</Link>}
          </div>
          <nav aria-label="Admin pages" className="flex gap-2 overflow-x-auto pb-1">
            {pages.map(([href, label]) => (
              <Link className="shrink-0 rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-tint hover:text-primary-hover focus:outline-none focus:ring-2 focus:ring-primary" href={href} key={href}>
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}
