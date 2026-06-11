import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { listDomains } from "@/lib/queries/domains";
import { Button } from "@/components/ui/Button";

export const metadata = { title: "Admin · Domains" };

export default async function AdminDomainsPage() {
  const supabase = await createClient();
  const domains = await listDomains(supabase);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-xl font-light text-ink">Domains</h1>
        <Link href="/admin/domains/new">
          <Button variant="primary">New domain</Button>
        </Link>
      </div>

      {domains.length === 0 ? (
        <p className="card p-8 text-center text-sm text-muted">
          No domains yet. Create the first region of the map.
        </p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-edge text-left">
                <th className="eyebrow px-4 py-3">Order</th>
                <th className="eyebrow px-4 py-3">Name</th>
                <th className="eyebrow px-4 py-3">Slug</th>
                <th className="eyebrow px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {domains.map((d) => (
                <tr key={d.id} className="border-b border-edge last:border-0">
                  <td className="px-4 py-3 font-mono text-xs text-muted">{d.sort_order}</td>
                  <td className="px-4 py-3 text-ink">{d.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">{d.slug}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/admin/domains/${d.id}`} className="link text-sm">
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
