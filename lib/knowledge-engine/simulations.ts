import type { SimulationCategory, SimulationStatus } from "@/types/domain";

/** Friendly URL slug ↔ DB category enum (§3 folder: ecosystems | agents | …). */
export const CATEGORY_BY_SLUG: Record<string, SimulationCategory> = {
  ecosystems: "artificial_ecosystems",
  agents: "agent_intelligence",
  civilizations: "civilizations",
  universes: "universe_simulations",
  consciousness: "consciousness_experiments",
};

export const SLUG_BY_CATEGORY: Record<SimulationCategory, string> = {
  artificial_ecosystems: "ecosystems",
  agent_intelligence: "agents",
  civilizations: "civilizations",
  universe_simulations: "universes",
  consciousness_experiments: "consciousness",
};

export interface CategoryMeta {
  slug: string;
  category: SimulationCategory;
  title: string;
  blurb: string;
}

export const CATEGORY_META: CategoryMeta[] = [
  {
    slug: "ecosystems",
    category: "artificial_ecosystems",
    title: "Artificial Ecosystems",
    blurb: "Synthetic chemistries and food webs — how self-sustaining order emerges from simple rules.",
  },
  {
    slug: "agents",
    category: "agent_intelligence",
    title: "Agent Intelligence",
    blurb: "Multi-agent worlds probing when communication, cooperation, and strategy arise.",
  },
  {
    slug: "civilizations",
    category: "civilizations",
    title: "Civilizations",
    blurb: "Societies under resource and trust constraints — the dynamics of resilience and collapse.",
  },
  {
    slug: "universes",
    category: "universe_simulations",
    title: "Universe Simulations",
    blurb: "Toy cosmologies sweeping the parameters that decide a universe's structure and fate.",
  },
  {
    slug: "consciousness",
    category: "consciousness_experiments",
    title: "Consciousness Experiments",
    blurb: "Computational probes of integration and information across network topologies.",
  },
];

export const SIM_STATUS_LABEL: Record<SimulationStatus, string> = {
  planned: "Planned",
  running: "Running",
  completed: "Completed",
  archived: "Archived",
};

interface SeriesPoint {
  t?: number;
  [key: string]: number | undefined;
}

/**
 * Normalize a run's metrics jsonb into a chartable series. Accepts
 * { series: [{t, <metric>...}] }; returns the x-key plus the numeric metric
 * keys present so a chart can plot each.
 */
export function parseMetrics(
  metrics: Record<string, unknown>,
): { points: SeriesPoint[]; keys: string[] } | null {
  const series = (metrics?.series ?? metrics?.data) as unknown;
  if (!Array.isArray(series) || series.length === 0) return null;
  const points = series.filter(
    (p): p is SeriesPoint => p !== null && typeof p === "object",
  );
  if (points.length === 0) return null;
  const keys = new Set<string>();
  for (const p of points) {
    for (const [k, v] of Object.entries(p)) {
      if (k !== "t" && typeof v === "number") keys.add(k);
    }
  }
  return { points, keys: [...keys] };
}
