import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { connectToDatabase } from "@/lib/db";
import { getRoleForEmail, normalizeEmail } from "@/lib/roles";
import { AdminWorkspace } from "@/app/admin/admin-workspace";

export default async function AdminUsersPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/");
  await connectToDatabase();
  if ((await getRoleForEmail(normalizeEmail(session.user.email))) !== "super_admin") redirect("/admin");
  return <AdminWorkspace section="users" />;
}
