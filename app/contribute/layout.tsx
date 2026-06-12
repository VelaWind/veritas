import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ContributeNav } from "@/components/contribute/ContributeNav";

// Session-bound, never cached (mirrors the admin area).
export const dynamic = "force-dynamic";

/**
 * Phase A: the contributor workspace. Middleware guarantees a session for
 * /contribute/*; this layout enforces the role (researcher OR admin). RLS on
 * `suggestions` is the final gate — contributors can only ever write their own
 * pending suggestions, never the knowledge tables.
 */
export default async function ContributeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/contribute");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, role")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role !== "researcher" && profile.role !== "admin")) {
    redirect("/");
  }

  return (
    <div className="mx-auto max-w-content px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-8 lg:flex-row">
        <ContributeNav displayName={profile.display_name} role={profile.role} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
