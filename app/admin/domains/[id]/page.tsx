import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DomainForm } from "@/components/admin/DomainForm";
import type { Domain } from "@/types/domain";

export const metadata = { title: "Admin · Edit domain" };

export default async function EditDomainPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("domains").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();

  return (
    <div className="space-y-6">
      <h1 className="font-display text-xl font-light text-ink">
        Edit domain: {(data as Domain).name}
      </h1>
      <DomainForm initial={data as Domain} />
    </div>
  );
}
