import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { publicClient } from "@/lib/supabase/public";
import { getCouncil, listCouncilIds } from "@/lib/queries/councils";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  OUTCOME_META,
  ROLE_META,
  ROLE_ORDER,
  STATUS_META,
  byRound,
} from "@/lib/knowledge-engine/councils";
import type { CouncilRole } from "@/types/domain";

export const revalidate = 3600;

export async function generateStaticParams() {
  const ids = await listCouncilIds(publicClient);
  return ids.map((id) => ({ id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const council = await getCouncil(publicClient, id);
  if (!council) return { title: "Council not found" };
  return {
    title: `Council: ${council.subject_title}`,
    description:
      council.outcome === null
        ? `A council on “${council.subject_title}”.`
        : `${OUTCOME_META[council.outcome].label} — ${OUTCOME_META[council.outcome].description}`,
  };
}

export default async function CouncilPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const council = await getCouncil(publicClient, id);
  if (!council) notFound();

  const statusMeta = STATUS_META[council.status];
  const outcomeMeta = council.outcome ? OUTCOME_META[council.outcome] : null;
  const rounds = byRound(council.turns);
  const subjectHref =
    council.subject_type === "hypothesis"
      ? `/hypotheses/${council.subject_slug}`
      : `/questions/${council.subject_slug}`;
  const votes = ROLE_ORDER.map((role) => ({
    role,
    text: council.vote?.[role] ?? null,
  })).filter((v) => v.text);

  return (
    <div className="mx-auto max-w-content space-y-10 px-4 py-12 sm:px-6">
      <PageHeader
        eyebrow="Council transcript"
        title={council.subject_title || council.subject_slug}
        description={
          <>
            Four roles argued this {council.subject_type} over{" "}
            {council.rounds_run === 1 ? "one round" : `${council.rounds_run} rounds`}. The
            full record is below — including the reasoning each role passed to the
            next. Nothing here changed the map:{" "}
            <Link
              href={subjectHref}
              className="text-ink underline decoration-edge underline-offset-4 hover:decoration-accent"
            >
              the {council.subject_type} itself
            </Link>{" "}
            is unchanged unless a human accepted a proposal from it.
          </>
        }
        actions={
          <span className="flex shrink-0 items-center gap-1.5">
            <span
              aria-hidden
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: `var(${(outcomeMeta ?? statusMeta).cssVar})` }}
            />
            <span
              className="font-mono text-xs"
              style={{ color: `var(${(outcomeMeta ?? statusMeta).cssVar})` }}
            >
              {(outcomeMeta ?? statusMeta).label}
            </span>
          </span>
        }
      />

      {council.status === "aborted" && (
        <section className="card space-y-2 p-6">
          <h2 className="eyebrow">Aborted</h2>
          <p className="text-muted">
            This council stopped before it finished. What was argued up to that
            point is below and is a real record; there is no verdict because the
            debate did not produce one.
          </p>
          <p className="font-mono text-xs text-muted">Reason: {council.abort_reason}</p>
        </section>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_18rem]">
        <div className="min-w-0 space-y-10">
          {council.verdict && (
            <section className="space-y-3">
              <h2 className="eyebrow">Verdict</h2>
              {outcomeMeta && (
                <p className="text-sm text-muted">{outcomeMeta.description}</p>
              )}
              <div className="space-y-3 text-muted">
                {council.verdict.split("\n\n").map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
              </div>
            </section>
          )}

          {votes.length > 0 && (
            <section className="space-y-3">
              <h2 className="eyebrow">Where each role finished</h2>
              <dl className="divide-y divide-edge border-y border-edge">
                {votes.map((v) => (
                  <div key={v.role} className="grid gap-1 py-4 sm:grid-cols-[8rem_1fr] sm:gap-4">
                    <dt className="font-mono text-xs text-muted">
                      {ROLE_META[v.role].label}
                    </dt>
                    <dd className="text-muted">{v.text}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <section className="space-y-6">
            <div className="space-y-2">
              <h2 className="eyebrow">Transcript</h2>
              <p className="text-sm text-muted">
                Each turn shows what the role said and the reasoning it passed
                forward. Later rounds are built from that reasoning, which is why
                it is recorded rather than summarised away.
              </p>
            </div>

            {rounds.length === 0 ? (
              <EmptyState
                title="No turns recorded"
                description="This council has no transcript. If it is still running, turns appear as each role speaks."
              />
            ) : (
              rounds.map(({ round, turns }) => (
                <div key={round} className="space-y-4">
                  {/* One interpolated string, not `Round {round}`: JSX would
                      split that into two text nodes and emit `Round <!-- -->1`,
                      so the rendered page would not literally contain "Round 1"
                      for a reader searching it — or for a smoke assertion. */}
                  <h3 className="font-mono text-xs uppercase tracking-wider text-muted">
                    {`Round ${round}`}
                  </h3>
                  <div className="space-y-4">
                    {turns.map((turn) => (
                      <article key={turn.id} className="card space-y-3 p-6">
                        <header className="flex flex-wrap items-baseline justify-between gap-2">
                          <h4 className="font-display text-lg font-light text-ink">
                            {ROLE_META[turn.role as CouncilRole]?.label ?? turn.role}
                          </h4>
                          {turn.context_truncated && (
                            // The marker is shown, not hidden. A turn that argued
                            // from a trimmed transcript did not see every earlier
                            // argument, and a reader comparing rounds needs to
                            // know that before reading it as a reply to them.
                            <span
                              className="font-mono text-xs"
                              style={{ color: "var(--signal-mid)" }}
                              title="This turn was built from a transcript the context budget had already trimmed, so it did not see every earlier turn."
                            >
                              [earlier turns truncated]
                            </span>
                          )}
                        </header>

                        <div className="space-y-3 text-muted">
                          {turn.content.split("\n\n").map((para, i) => (
                            <p key={i}>{para}</p>
                          ))}
                        </div>

                        {turn.reasoning && (
                          <details className="border-t border-edge pt-3">
                            <summary className="cursor-pointer font-mono text-xs text-muted hover:text-ink">
                              Reasoning passed to the next round
                            </summary>
                            <div className="mt-3 space-y-3 text-sm text-muted">
                              {turn.reasoning.split("\n\n").map((para, i) => (
                                <p key={i}>{para}</p>
                              ))}
                            </div>
                          </details>
                        )}
                      </article>
                    ))}
                  </div>
                </div>
              ))
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <div className="card space-y-4 p-6 lg:sticky lg:top-20">
            <div>
              <p className="eyebrow">This council</p>
              <p className="mt-1 text-xs text-muted">{statusMeta.description}</p>
            </div>

            <div className="space-y-2 border-t border-edge pt-4 font-mono text-xs text-muted">
              <div className="flex justify-between gap-4">
                <span>Subject</span>
                <span className="text-ink">{council.subject_type}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span>Rounds</span>
                <span className="text-ink">{council.rounds_run}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span>Turns</span>
                <span className="text-ink">{council.turns.length}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span>Model</span>
                <span className="break-all text-right text-ink">{council.model || "—"}</span>
              </div>
            </div>

            <p className="border-t border-edge pt-4 text-xs text-muted">
              A split is a result, not a failure. The council has no majority rule
              and no casting vote: where the roles ended apart, the disagreement is
              recorded rather than resolved by force.
            </p>

            <p className="border-t border-edge pt-4 text-xs text-muted">
              {council.suggestion_id
                ? "This council produced a proposal. Like every proposal, it is pending until a human accepts it."
                : "This council produced no proposal. Its verdict is a public argument, not a change to the map."}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
