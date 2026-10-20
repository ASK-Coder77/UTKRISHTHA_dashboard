import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { connectToDatabase } from "@/lib/db";
import { getRoleForEmail, normalizeEmail } from "@/lib/roles";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/");

  await connectToDatabase();
  if ((await getRoleForEmail(normalizeEmail(email))) !== "super_admin") redirect("/");

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-10 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">Administration</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Settings</h1>
      <p className="mt-3 max-w-2xl text-slate-600">
        Update event-wide rules. Changes are checked against existing auction data and recorded in the audit log.
      </p>
      <SettingsForm />
    </main>
  );
}
