import Link from "next/link";

export const metadata = { title: "Contribute · Veritas" };

export default function ContributeHome() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-light text-ink">Contribute</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Propose new hypotheses and evidence, or edits to existing ones. Nothing
          you submit changes the public map directly — every proposal enters a
          review queue and an admin approves or rejects it. Approved proposals are
          applied through the same epistemic guards as any admin write, and credit
          you as the author.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/contribute/hypotheses/new" className="card p-5 hover:bg-raised">
          <p className="font-medium text-ink">Propose a hypothesis</p>
          <p className="mt-1 text-sm text-muted">
            A claim with status, assumptions, and falsification criteria.
          </p>
        </Link>
        <Link href="/contribute/evidence/new" className="card p-5 hover:bg-raised">
          <p className="font-medium text-ink">Propose evidence</p>
          <p className="mt-1 text-sm text-muted">
            A citable source summary an admin can later link to hypotheses.
          </p>
        </Link>
      </div>

      <p className="text-sm text-muted">
        Track the status of everything you&rsquo;ve submitted under{" "}
        <Link href="/contribute/suggestions" className="link">
          My suggestions
        </Link>
        .
      </p>
    </div>
  );
}
