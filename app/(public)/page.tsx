import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { publicClient } from "@/lib/supabase/public";
import { listDomainsWithCounts } from "@/lib/queries/domains";
import { listHypotheses } from "@/lib/queries/hypotheses";
import { listQuestions } from "@/lib/queries/questions";
import { getDashboardStats } from "@/lib/queries/stats";
import { HypothesisCard } from "@/components/epistemics/HypothesisCard";
import { EpistemicBadge } from "@/components/epistemics/EpistemicBadge";
import { Stat } from "@/components/ui/Stat";
import { STATUS_META } from "@/lib/knowledge-engine/taxonomy";

export const revalidate = 3600; // §1.3: home is SSG + ISR (1 hour)

export default async function HomePage() {
  const [domains, hypotheses, questions, stats] = await Promise.all([
    listDomainsWithCounts(publicClient),
    listHypotheses(publicClient, { sort: "confidence", limit: 6 }),
    listQuestions(publicClient, { sort: "importance", limit: 6 }),
    getDashboardStats(publicClient),
  ]);

  return (
    <div className="mx-auto max-w-content px-4 sm:px-6">
      {/* Hero */}
      <section className="flex flex-col items-start gap-6 py-20 sm:py-28">
        <p className="eyebrow">An observatory for knowledge</p>
        <h1 className="max-w-4xl font-display text-2xl font-light leading-tight text-ink sm:text-3xl">
          A living map of what humanity knows, suspects, and cannot yet answer.
        </h1>
        <p className="max-w-2xl text-lg text-muted">
          Every claim carries its epistemic status, a confidence score with a
          recorded rationale, and the evidence for and against it. The interface
          never looks more certain than the knowledge it displays.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/hypotheses"
            className="inline-flex items-center gap-2 rounded bg-accent px-5 py-2.5 text-sm font-medium text-void transition-opacity hover:opacity-90"
          >
            Explore the hypotheses <ArrowRight size={15} aria-hidden />
          </Link>
          <Link
            href="/questions"
            className="rounded border border-edge bg-surface px-5 py-2.5 text-sm text-ink transition-colors hover:bg-raised"
          >
            The unanswered questions
          </Link>
        </div>
      </section>

      {/* Stats strip */}
      {stats && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat value={stats.total_hypotheses} label="Hypotheses tracked" />
          <Stat value={stats.total_evidence} label="Evidence entries" />
          <Stat value={stats.open_questions} label="Open questions" accent />
          <Stat value={stats.open_contradictions} label="Open contradictions" />
          <Stat value={stats.total_simulation_runs} label="Simulation runs" />
        </section>
      )}

      {/* Taxonomy legend */}
      <section className="mt-16 space-y-5">
        <p className="eyebrow">The epistemic taxonomy</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Object.values(STATUS_META).map((m) => (
            <div key={m.value} className="card flex flex-col gap-2 p-4">
              <EpistemicBadge status={m.value} />
              <p className="text-sm text-muted">{m.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Domains */}
      <section className="mt-16 space-y-5">
        <div className="flex items-end justify-between">
          <div>
            <p className="eyebrow">Ten domains</p>
            <h2 className="mt-1 font-display text-xl font-light text-ink">
              Regions of the map
            </h2>
          </div>
          <Link href="/domains" className="link text-sm">
            All domains →
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {domains.map((d) => (
            <Link
              key={d.id}
              href={`/domains/${d.slug}`}
              className="card group p-5 transition-colors hover:bg-raised"
            >
              <h3 className="font-display text-base font-medium text-ink group-hover:text-accent">
                {d.name}
              </h3>
              <p className="mt-2 line-clamp-2 text-sm text-muted">{d.overview}</p>
              <p className="mt-3 font-mono text-xs text-muted">
                {d.hypothesis_count} hypotheses · {d.question_count} questions
              </p>
            </Link>
          ))}
        </div>
      </section>

      {/* Best-supported hypotheses */}
      {hypotheses.length > 0 && (
        <section className="mt-16 space-y-5">
          <div className="flex items-end justify-between">
            <div>
              <p className="eyebrow">Strongest current support</p>
              <h2 className="mt-1 font-display text-xl font-light text-ink">
                Where the evidence points
              </h2>
            </div>
            <Link href="/hypotheses" className="link text-sm">
              All hypotheses →
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {hypotheses.map((h) => (
              <HypothesisCard key={h.id} hypothesis={h} />
            ))}
          </div>
        </section>
      )}

      {/* Open questions */}
      {questions.length > 0 && (
        <section className="mb-8 mt-16 space-y-5">
          <div className="flex items-end justify-between">
            <div>
              <p className="eyebrow">The frontier</p>
              <h2 className="mt-1 font-display text-xl font-light text-ink">
                Questions we cannot yet answer
              </h2>
            </div>
            <Link href="/questions" className="link text-sm">
              All questions →
            </Link>
          </div>
          <ul className="card divide-y divide-edge">
            {questions.map((q) => (
              <li key={q.id}>
                <Link
                  href={`/questions/${q.slug}`}
                  className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-raised"
                >
                  <span className="font-display text-base text-ink">{q.title}</span>
                  <span className="ml-auto shrink-0">
                    <EpistemicBadge status={q.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
