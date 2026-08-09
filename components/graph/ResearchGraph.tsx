"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { X } from "lucide-react";
import {
  EDGE_STYLE,
  NODE_SHAPE,
  NODE_TYPE_LABEL,
  nodeColorVar,
  nodeRadius,
} from "@/lib/knowledge-engine/graph-style";
import { STATUS_META } from "@/lib/knowledge-engine/taxonomy";
import type {
  EdgeType,
  GraphPayload,
  NodeType,
} from "@/types/domain";
import { GraphControls } from "./GraphControls";

interface SimNode extends SimulationNodeDatum {
  id: string;
  type: NodeType;
  label: string;
  slug: string;
  status: string | null;
  confidence: number | null;
  domainSlug?: string | null;
  r: number;
}
interface SimLink extends SimulationLinkDatum<SimNode> {
  type: EdgeType;
}

function cssVar(name: string): string {
  if (typeof window === "undefined") return "#888";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

const PATH: Partial<Record<NodeType, string>> = {
  hypothesis: "/hypotheses",
  question: "/questions",
  evidence: "/evidence",
  domain: "/domains",
};

export function ResearchGraph({
  payload,
  focusSlug,
}: {
  payload: GraphPayload;
  focusSlug?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const transformRef = useRef({ x: 0, y: 0, k: 1 });
  const hoverRef = useRef<SimNode | null>(null);

  const [selected, setSelected] = useState<SimNode | null>(null);
  const [typeFilter, setTypeFilter] = useState<Set<NodeType>>(
    new Set(["hypothesis", "question", "evidence", "domain", "simulation"]),
  );
  const [domainFilter, setDomainFilter] = useState<string>("");
  const [size, setSize] = useState({ w: 800, h: 560 });

  const domains = useMemo(
    () =>
      payload.nodes
        .filter((n) => n.type === "domain")
        .map((n) => ({ slug: n.slug, label: n.label })),
    [payload.nodes],
  );

  // Filtered view of the payload.
  const view = useMemo(() => {
    const nodes = payload.nodes.filter((n) => {
      if (!typeFilter.has(n.type)) return false;
      if (domainFilter) {
        if (n.type === "domain") return n.slug === domainFilter;
        return n.domainSlug === domainFilter;
      }
      return true;
    });
    const ids = new Set(nodes.map((n) => n.id));
    const edges = payload.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
    return { nodes, edges };
  }, [payload, typeFilter, domainFilter]);

  // Resize observer.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0].contentRect;
      setSize({ w: Math.max(320, cr.width), h: Math.max(420, cr.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Build/refresh the simulation when the filtered view changes.
  useEffect(() => {
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const nodes: SimNode[] = view.nodes.map((n) => ({
      ...n,
      r: nodeRadius(n.type, n.confidence),
    }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links: SimLink[] = view.edges
      .map((e) => ({ source: byId.get(e.from)!, target: byId.get(e.to)!, type: e.type }))
      .filter((l) => l.source && l.target);

    nodesRef.current = nodes;
    linksRef.current = links;

    simRef.current?.stop();
    const sim = forceSimulation<SimNode, SimLink>(nodes)
      .force("charge", forceManyBody().strength(-140))
      .force("link", forceLink<SimNode, SimLink>(links).id((d) => d.id).distance(70).strength(0.4))
      .force("center", forceCenter(size.w / 2, size.h / 2))
      .force("collide", forceCollide<SimNode>().radius((d) => d.r + 4))
      .alphaDecay(0.035);

    simRef.current = sim;

    if (prefersReduced) {
      // Settle synchronously, no animated tick.
      sim.tick(180);
      sim.stop();
      draw();
    } else {
      sim.on("tick", draw);
    }

    // Center on the focused node if requested.
    if (focusSlug) {
      const target = nodes.find((n) => n.slug === focusSlug);
      if (target) {
        setSelected(target);
      }
    }

    return () => {
      sim.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, size.w, size.h]);

  // Drawing.
  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const { w, h } = size;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const t = transformRef.current;
    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);

    // Edges.
    for (const l of linksRef.current) {
      const s = l.source as SimNode;
      const tg = l.target as SimNode;
      if (s.x == null || tg.x == null) continue;
      const style = EDGE_STYLE[l.type] ?? EDGE_STYLE.related_to;
      ctx.beginPath();
      ctx.setLineDash(style.dash);
      ctx.strokeStyle = cssVar(style.colorVar);
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = style.width / t.k;
      ctx.moveTo(s.x, s.y!);
      ctx.lineTo(tg.x, tg.y!);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // Nodes.
    for (const n of nodesRef.current) {
      if (n.x == null || n.y == null) continue;
      const color = cssVar(nodeColorVar(n.type, n.status as never));
      const shape = NODE_SHAPE[n.type];
      const selectedThis = selected?.id === n.id;
      const hovered = hoverRef.current?.id === n.id;
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5 / t.k;

      ctx.beginPath();
      if (shape === "circle") {
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      } else if (shape === "square") {
        ctx.fillRect(n.x - n.r, n.y - n.r, n.r * 2, n.r * 2);
      } else if (shape === "diamond") {
        ctx.moveTo(n.x, n.y - n.r);
        ctx.lineTo(n.x + n.r, n.y);
        ctx.lineTo(n.x, n.y + n.r);
        ctx.lineTo(n.x - n.r, n.y);
        ctx.closePath();
        ctx.fill();
      } else if (shape === "triangle") {
        ctx.moveTo(n.x, n.y - n.r);
        ctx.lineTo(n.x + n.r, n.y + n.r);
        ctx.lineTo(n.x - n.r, n.y + n.r);
        ctx.closePath();
        ctx.fill();
      } else if (shape === "ring") {
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.lineWidth = 2.5 / t.k;
        ctx.stroke();
      }

      if (selectedThis || hovered) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 4 / t.k, 0, Math.PI * 2);
        ctx.strokeStyle = cssVar("--text-primary");
        ctx.lineWidth = 1.5 / t.k;
        ctx.stroke();
      }

      // Labels for focused/hovered nodes and all domains.
      if (selectedThis || hovered || n.type === "domain") {
        ctx.fillStyle = cssVar("--text-primary");
        ctx.font = `${12 / t.k}px var(--font-inter), sans-serif`;
        ctx.fillText(
          n.label.length > 40 ? `${n.label.slice(0, 40)}…` : n.label,
          n.x + n.r + 4 / t.k,
          n.y + 4 / t.k,
        );
      }
    }
  }

  // Redraw on selection/theme change without restarting the sim.
  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, size]);

  // Zoom. Attached imperatively rather than through React's `onWheel` because
  // the synthetic wheel listener is registered passively at the root: React
  // cannot honour preventDefault() there, so the browser scrolled the page at
  // the same time as the graph zoomed. Most visible zooming out, where the page
  // slides down under the cursor.
  //
  // Scoped to the canvas element, so this is not a scroll lock: a wheel event
  // anywhere else on the page keeps its default behaviour.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      // Unconditional while over the canvas: the gesture is always consumed as
      // zoom, so the page must never move. Falling through at the zoom clamps
      // would make the page lurch exactly when the graph stopped responding.
      e.preventDefault();

      const t = transformRef.current;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const k = Math.max(0.3, Math.min(4, t.k * factor));
      // Anchor the zoom on the cursor: the graph point under it stays put.
      t.x = mx - ((mx - t.x) * k) / t.k;
      t.y = my - ((my - t.y) * k) / t.k;
      t.k = k;
      draw();
    };

    // { passive: false } is the whole point — the default is passive for wheel.
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
    // `draw` is re-created each render (it closes over `size`/`selected`), so
    // this re-binds with it and never calls a stale one. Re-running every
    // render is also what re-attaches the listener when the canvas mounts after
    // the "no nodes match" empty state.
  }, [draw]);

  // Pointer interactions: pan, click-select, hover.
  function toGraphCoords(clientX: number, clientY: number) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const t = transformRef.current;
    return {
      x: (clientX - rect.left - t.x) / t.k,
      y: (clientY - rect.top - t.y) / t.k,
    };
  }

  function nodeAt(clientX: number, clientY: number): SimNode | null {
    const { x, y } = toGraphCoords(clientX, clientY);
    let best: SimNode | null = null;
    let bestDist = Infinity;
    for (const n of nodesRef.current) {
      if (n.x == null || n.y == null) continue;
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < n.r + 4 && d < bestDist) {
        best = n;
        bestDist = d;
      }
    }
    return best;
  }

  const dragState = useRef<{ panning: boolean; lastX: number; lastY: number }>(
    { panning: false, lastX: 0, lastY: 0 },
  );

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="min-w-0 flex-1 space-y-3">
        <GraphControls
          domains={domains}
          typeFilter={typeFilter}
          onToggleType={(t) => {
            setTypeFilter((prev) => {
              const next = new Set(prev);
              if (next.has(t)) next.delete(t);
              else next.add(t);
              return next;
            });
          }}
          domainFilter={domainFilter}
          onDomainFilter={setDomainFilter}
        />
        <div
          ref={wrapRef}
          className="relative h-[560px] w-full overflow-hidden rounded-lg border border-edge bg-void"
        >
          {view.nodes.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted">
              No nodes match the current filters.
            </div>
          ) : (
            <canvas
              ref={canvasRef}
              role="img"
              aria-label={`Research graph: ${view.nodes.length} nodes, ${view.edges.length} edges`}
              style={{ width: size.w, height: size.h, cursor: "grab", touchAction: "none" }}
              onPointerDown={(e) => {
                const hit = nodeAt(e.clientX, e.clientY);
                if (hit) {
                  setSelected(hit);
                } else {
                  dragState.current = {
                    panning: true,
                    lastX: e.clientX,
                    lastY: e.clientY,
                  };
                  (e.target as HTMLElement).style.cursor = "grabbing";
                }
              }}
              onPointerMove={(e) => {
                if (dragState.current.panning) {
                  const dx = e.clientX - dragState.current.lastX;
                  const dy = e.clientY - dragState.current.lastY;
                  dragState.current.lastX = e.clientX;
                  dragState.current.lastY = e.clientY;
                  transformRef.current.x += dx;
                  transformRef.current.y += dy;
                  draw();
                } else {
                  const hit = nodeAt(e.clientX, e.clientY);
                  if (hit !== hoverRef.current) {
                    hoverRef.current = hit;
                    (e.target as HTMLElement).style.cursor = hit ? "pointer" : "grab";
                    draw();
                  }
                }
              }}
              onPointerUp={(e) => {
                dragState.current.panning = false;
                (e.target as HTMLElement).style.cursor = "grab";
              }}
              onPointerLeave={() => {
                dragState.current.panning = false;
                hoverRef.current = null;
              }}
              // Zoom is bound in a useEffect above, not here: onWheel is
              // passive and cannot preventDefault the page scroll.
            />
          )}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 font-mono text-xs text-muted">
          <span>● hypothesis</span>
          <span>◆ question</span>
          <span>■ evidence</span>
          <span>◯ domain</span>
          <span>▲ simulation</span>
          <span className="ml-auto">scroll to zoom · drag to pan · click to inspect</span>
        </div>
      </div>

      {/* Inspector side panel (§7) */}
      <aside className="w-full shrink-0 lg:w-80">
        {selected ? (
          <div className="card space-y-4 p-5 lg:sticky lg:top-20">
            <div className="flex items-start justify-between gap-2">
              <span className="font-mono text-xs uppercase text-muted">
                {NODE_TYPE_LABEL[selected.type]}
              </span>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Close inspector"
                className="rounded p-1 text-muted hover:bg-raised hover:text-ink"
              >
                <X size={14} aria-hidden />
              </button>
            </div>
            <h2 className="font-display text-base text-ink">{selected.label}</h2>
            {selected.status && (
              <p className="font-mono text-xs text-muted">
                {STATUS_META[selected.status as never] &&
                  STATUS_META[selected.status as keyof typeof STATUS_META].label}
              </p>
            )}
            {selected.confidence != null && selected.type === "hypothesis" && (
              <p className="font-mono text-xs text-muted">
                confidence {selected.confidence}/100
              </p>
            )}
            {selected.confidence != null && selected.type === "evidence" && (
              <p className="font-mono text-xs text-muted">strength {selected.confidence}/100</p>
            )}
            {PATH[selected.type] && (
              <Link
                href={`${PATH[selected.type]}/${selected.slug}`}
                className="block rounded bg-accent px-4 py-2 text-center text-sm font-medium text-void hover:opacity-90"
              >
                Open {NODE_TYPE_LABEL[selected.type].toLowerCase()} →
              </Link>
            )}
          </div>
        ) : (
          <div className="card p-5 text-sm text-muted lg:sticky lg:top-20">
            <p className="eyebrow pb-2">Inspector</p>
            Click any node to inspect it and jump to its page. Everything in
            Veritas is a node — questions, hypotheses, evidence, domains.
          </div>
        )}
      </aside>
    </div>
  );
}
