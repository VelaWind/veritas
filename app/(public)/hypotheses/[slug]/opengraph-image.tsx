import { ImageResponse } from "next/og";
import { publicClient } from "@/lib/supabase/public";
import { getHypothesisBySlug } from "@/lib/queries/hypotheses";
import { STATUS_META, bandForConfidence } from "@/lib/knowledge-engine/taxonomy";
import { stripMarkdown, truncate } from "@/lib/utils";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Veritas hypothesis";

// Signal hues resolved to literals (next/og has no CSS variables).
const SIGNAL: Record<string, string> = {
  "--signal-strong": "#4ADE9C",
  "--signal-mid": "#E8C45A",
  "--signal-weak": "#F0856B",
  "--signal-unknown": "#7C8AA5",
};

export default async function HypothesisOgImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const h = await getHypothesisBySlug(publicClient, slug);

  if (!h) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#060A12",
            color: "#E8EDF6",
            fontSize: 40,
          }}
        >
          Hypothesis not found
        </div>
      ),
      { ...size },
    );
  }

  const meta = STATUS_META[h.status];
  const color = SIGNAL[meta.cssVar] ?? "#7C8AA5";
  const band = bandForConfidence(h.confidence);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#060A12",
          padding: "64px",
          color: "#E8EDF6",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 24, letterSpacing: 6, color: "#8A97AD" }}>
            VERITAS · {h.domain.name.toUpperCase()}
          </span>
          <span
            style={{
              fontSize: 22,
              letterSpacing: 2,
              color,
              border: `2px solid ${color}`,
              borderRadius: 8,
              padding: "8px 18px",
            }}
          >
            {meta.chip}
          </span>
        </div>

        <div style={{ fontSize: 56, lineHeight: 1.12, maxWidth: 1040 }}>
          {truncate(h.title, 130)}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
            <span style={{ fontSize: 88, color }}>{h.confidence}</span>
            <span style={{ fontSize: 28, color: "#8A97AD" }}>
              / 100 confidence · {band.label}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              width: "100%",
              height: 14,
              background: "#131C2E",
              borderRadius: 7,
              position: "relative",
            }}
          >
            <div
              style={{
                width: `${h.confidence}%`,
                height: "100%",
                background: color,
                borderRadius: 7,
              }}
            />
          </div>
          <span style={{ fontSize: 22, color: "#8A97AD" }}>
            {truncate(stripMarkdown(h.confidence_rationale) || "No rationale recorded.", 110)}
          </span>
        </div>
      </div>
    ),
    { ...size },
  );
}
