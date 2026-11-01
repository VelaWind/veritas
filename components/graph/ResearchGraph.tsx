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

const ARROWS: Record<string, { dx: number; dy: number; word: string }> = {
  ArrowUp: { dx: 0, dy: -1, word: "above" },
  ArrowDown: { dx: 0, dy: 1, word: "below" },
  ArrowLeft: { dx: -1, dy: 0, word: "to the left" },
  ArrowRight: { dx: 1, dy: 0, word: "to the right" },
};

/**
 * The candidate that lies most nearly in direction (dx, dy) from `from`, or
 * null. A candidate counts only if it is within `maxAngle` of the arrow; among
 * those, distance is weighted up the further off-axis it sits, so a node
 * straight ahead beats a slightly closer one at 80 degrees.
 */
function pickInDirection(
  from: SimNode,
  candidates: SimNode[],
  dx: number,
  dy: number,
  maxAngleDeg: number,
): SimNode | null {
  const minCos = Math.cos((maxAngleDeg * Math.PI) / 180);
  let best: SimNode | null = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    if (c.id === from.id || c.x == null || c.y == null) continue;
    const vx = c.x - from.x!;
    const vy = c.y - from.y!;
    const dist = Math.hypot(vx, vy);
    if (dist < 1e-6) continue;
    const cos = (vx * dx + vy * dy) / dist;
    if (cos < minCos) continue;
    const score = dist * (1 + 2 * (1 - cos));
    if (score < bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

export function ResearchGraph({
  payload,
  focusSlug,
}: {
  payload: GraphPayload;
  focusSlug?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const inspectorHeadingRef = useRef<HTMLHeadingElement>(null);
  // Set when Enter opens the inspector, consumed once it has rendered.
  const inspectorOpenedByKey = useRef(false);
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

  // Keyboard navigation (see onKeyDown below). Built from the filtered view, so
  // a key only ever moves along edges the reader can see.
  const nodeById = useMemo(() => new Map(view.nodes.map((n) => [n.id, n])), [view.nodes]);
  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of view.edges) {
      if (e.from === e.to) continue;
      if (!m.has(e.from)) m.set(e.from, new Set());
      if (!m.has(e.to)) m.set(e.to, new Set());
      m.get(e.from)!.add(e.to);
      m.get(e.to)!.add(e.from);
    }
    return m;
  }, [view.edges]);
  const [focusedIdState, setFocusedId] = useState<string | null>(null);
  // A focused node that a filter has since removed is no focus at all.
  const focusedId = focusedIdState && nodeById.has(focusedIdState) ? focusedIdState : null;
  // The focus ring is for keyboard users: shown after a key press while the
  // canvas has focus, hidden again on pointer use or blur.
  const [showFocus, setShowFocus] = useState(false);
  // Spoken through the canvas aria-label: what the last key press did when the
  // focused node alone does not say it (no node that way, inspector closed).
  const [navNote, setNavNote] = useState("");

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
      // Through drawRef, so a tick paints the current selection and keyboard
      // focus rather than those of the render that built the simulation.
      sim.on("tick", () => drawRef.current());
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
      const keyboardFocused = showFocus && focusedId === n.id;
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

      // Keyboard focus: a thick dashed ring outside the selection ring. Dashed
      // and in the text colour, because domain nodes are themselves drawn as
      // solid accent rings and an accent focus ring read as one more domain.
      if (keyboardFocused) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 8 / t.k, 0, Math.PI * 2);
        ctx.setLineDash([4 / t.k, 3 / t.k]);
        ctx.strokeStyle = cssVar("--text-primary");
        ctx.lineWidth = 2.5 / t.k;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Labels for focused/hovered nodes and all domains.
      if (selectedThis || hovered || keyboardFocused || n.type === "domain") {
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

  // The latest `draw`. It is re-created every render (it closes over `size` and
  // `selected`), so long-lived listeners call it through this ref instead of
  // capturing one render's copy.
  const drawRef = useRef(draw);
  drawRef.current = draw;

  // Redraw on selection/focus/theme change without restarting the sim.
  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, size, focusedId, showFocus]);

  // The canvas is absent while "no nodes match" is shown, and a new canvas
  // element mounts when nodes return; the wheel listener re-binds on that edge.
  const hasCanvas = view.nodes.length > 0;

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
      drawRef.current();
    };

    // { passive: false } is the whole point — the default is passive for wheel.
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
    // Calls `draw` through drawRef, so it never runs a stale copy without
    // re-binding on every render. `hasCanvas` re-attaches the listener when the
    // canvas mounts after the "no nodes match" empty state.
  }, [hasCanvas]);

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

  // At narrow widths the inspector stacks below the 560px graph, so Enter would
  // open it out of view. There it is scrolled into view and takes focus (its
  // heading), so a screen reader reads it and Tab continues to its controls.
  // At lg and up it sits beside the graph and focus stays on the graph.
  useEffect(() => {
    if (!selected || !inspectorOpenedByKey.current) return;
    inspectorOpenedByKey.current = false;
    if (window.matchMedia("(min-width: 1024px)").matches) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    inspectorHeadingRef.current?.focus({ preventScroll: true });
    inspectorRef.current?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [selected]);

  /** Closes the inspector and puts focus back on the graph, on the same node. */
  function closeInspectorToGraph() {
    setSelected(null);
    setNavNote("Inspector closed.");
    canvasRef.current?.focus();
  }

  // ── Keyboard ──────────────────────────────────────────────────────────────
  // Tab focuses the canvas and puts the keyboard cursor on a start node. Arrow
  // keys move it to the connected node lying most nearly in that direction;
  // when no connected node lies that way, to the nearest node of any kind that
  // way, so isolated nodes and separate clusters stay reachable (the label says
  // so). Enter opens the inspector on it; Escape clears the inspector.

  /** The selected node if visible, else the most-connected node (ties by label). */
  function startNodeId(): string | null {
    if (selected && nodeById.has(selected.id)) return selected.id;
    let best: string | null = null;
    let bestDeg = -1;
    for (const n of view.nodes) {
      const deg = neighbours.get(n.id)?.size ?? 0;
      if (deg > bestDeg || (deg === bestDeg && best && n.label < nodeById.get(best)!.label)) {
        best = n.id;
        bestDeg = deg;
      }
    }
    return best;
  }

  /** Pans so a node the keyboard moved to is not left off-screen. */
  function keepInView(n: SimNode) {
    if (n.x == null || n.y == null) return;
    const t = transformRef.current;
    const sx = n.x * t.k + t.x;
    const sy = n.y * t.k + t.y;
    const margin = 48;
    if (sx < margin || sx > size.w - margin || sy < margin || sy > size.h - margin) {
      t.x = size.w / 2 - n.x * t.k;
      t.y = size.h / 2 - n.y * t.k;
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLCanvasElement>) {
    const arrow = ARROWS[e.key];
    if (!arrow && e.key !== "Enter" && e.key !== "Escape") return;
    setShowFocus(true);
    const sims = new Map(nodesRef.current.map((n) => [n.id, n]));
    const current = focusedId ?? startNodeId();
    if (!current) return;

    if (arrow) {
      e.preventDefault(); // the page must not scroll under the graph
      if (!focusedId) {
        setFocusedId(current);
        setNavNote("");
        return;
      }
      const from = sims.get(current);
      if (!from) return;
      const connected = [...(neighbours.get(current) ?? [])]
        .map((id) => sims.get(id))
        .filter((n): n is SimNode => !!n);
      let next = pickInDirection(from, connected, arrow.dx, arrow.dy, 90);
      let note = "";
      if (!next) {
        next = pickInDirection(from, nodesRef.current, arrow.dx, arrow.dy, 60);
        note = next ? "Moved to the nearest node, not along a connection." : `No node ${arrow.word}.`;
      }
      if (next) {
        keepInView(next);
        setFocusedId(next.id);
      }
      setNavNote(note);
      drawRef.current();
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const node = sims.get(current);
      if (node) {
        setFocusedId(current);
        inspectorOpenedByKey.current = true;
        setSelected(node);
        setNavNote("");
      }
      return;
    }

    // Escape: only consumed when there is something to clear.
    if (selected) {
      e.preventDefault();
      setSelected(null);
      setNavNote("Inspector closed.");
    }
  }

  const focusedNode = focusedId ? nodeById.get(focusedId) : undefined;
  const focusedDegree = focusedId ? neighbours.get(focusedId)?.size ?? 0 : 0;
  const graphLabel =
    `Research graph: ${view.nodes.length} nodes, ${view.edges.length} edges.` +
    (focusedNode
      ? ` Focused: ${NODE_TYPE_LABEL[focusedNode.type]} ${focusedNode.label}, ` +
        `${focusedDegree} connected ${focusedDegree === 1 ? "node" : "nodes"}` +
        (selected?.id === focusedNode.id ? ", open in the inspector." : ".")
      : "") +
    (navNote ? ` ${navNote}` : "");

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
              // `application` rather than `img`: a screen reader in browse mode
              // takes the arrow keys for itself on an img, so they would never
              // reach onKeyDown. The label below is what it announces.
              role="application"
              aria-roledescription="graph"
              aria-label={graphLabel}
              aria-describedby="graph-keys"
              tabIndex={0}
              // The global :focus-visible outline sits 2px outside its element,
              // where this wrapper's overflow-hidden would clip it; draw it inside.
              // scroll-mt-16 keeps a focus scroll from parking the canvas top
              // under the sticky h-14 site header.
              className="scroll-mt-16 focus-visible:[outline-offset:-3px]"
              style={{ width: size.w, height: size.h, cursor: "grab", touchAction: "none" }}
              onKeyDown={onKeyDown}
              onFocus={(e) => {
                const id = focusedId ?? startNodeId();
                if (!focusedId) setFocusedId(id);
                // Keyboard arrival (Tab) shows the node ring at once and brings
                // the node on screen; a mouse click focuses without either.
                if (e.currentTarget.matches(":focus-visible")) {
                  setShowFocus(true);
                  const sim = id ? nodesRef.current.find((n) => n.id === id) : undefined;
                  if (sim) keepInView(sim);
                }
              }}
              onBlur={() => {
                setShowFocus(false);
                setNavNote("");
              }}
              onPointerDown={(e) => {
                setShowFocus(false);
                const hit = nodeAt(e.clientX, e.clientY);
                if (hit) {
                  setSelected(hit);
                  setFocusedId(hit.id);
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
          <span id="graph-keys" className="ml-auto">
            scroll to zoom · drag to pan · click to inspect · keyboard: Tab to the graph,
            arrow keys follow connections, Enter inspects, Esc clears
          </span>
        </div>
      </div>

      {/* Inspector side panel (§7) */}
      <aside
        className="w-full shrink-0 lg:w-80"
        // Escape from anywhere in the inspector closes it and returns to the graph.
        onKeyDown={(e) => {
          if (e.key === "Escape" && selected) {
            e.preventDefault();
            closeInspectorToGraph();
          }
        }}
      >
        {selected ? (
          <div
            ref={inspectorRef}
            role="region"
            aria-label="Inspector"
            className="card scroll-mt-16 space-y-4 p-5 lg:sticky lg:top-20"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="font-mono text-xs uppercase text-muted">
                {NODE_TYPE_LABEL[selected.type]}
              </span>
              <button
                type="button"
                onClick={closeInspectorToGraph}
                aria-label="Close inspector"
                className="rounded p-1 text-muted hover:bg-raised hover:text-ink"
              >
                <X size={14} aria-hidden />
              </button>
            </div>
            <h2 ref={inspectorHeadingRef} tabIndex={-1} className="font-display text-base text-ink">
              {selected.label}
            </h2>
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
            Click any node, or move to it with the arrow keys and press Enter, to
            inspect it and jump to its page. Everything in Veritas is a node:
            questions, hypotheses, evidence, domains.
          </div>
        )}
      </aside>
    </div>
  );
}
