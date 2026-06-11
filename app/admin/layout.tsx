import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminNav } from "@/components/admin/AdminNav";

// §1.3: admin is fully dynamic, no caching.
export const dynamic = "force-dynamic";

/**
 * §4.1 server-side admin verification: middleware guarantees a session exists
 * for /admin/*; this layout enforces the role. RLS remains the final gate.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "admin") redirect("/");

  return (
    <div className="mx-auto max-w-content px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-8 lg:flex-row">
        <AdminNav displayName={profile.display_name} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
