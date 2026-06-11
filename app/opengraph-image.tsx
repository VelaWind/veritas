import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Veritas — An observatory for knowledge";

export default function OpengraphImage() {
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
          padding: "72px",
          color: "#E8EDF6",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <svg width="44" height="44" viewBox="0 0 18 18" fill="none">
            <circle cx="9" cy="9" r="7" stroke="#5BB8FF" strokeWidth="1.1" />
            <circle cx="9" cy="9" r="1.6" fill="#5BB8FF" />
            <path d="M9 0v4M9 14v4M0 9h4M14 9h4" stroke="#5BB8FF" strokeWidth="1.1" />
          </svg>
          <span style={{ fontSize: 30, letterSpacing: 6, color: "#8A97AD" }}>VERITAS</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: 60, lineHeight: 1.1, maxWidth: 980 }}>
            A living map of what humanity knows, suspects, and cannot yet answer.
          </div>
          <div style={{ fontSize: 26, color: "#8A97AD" }}>
            Every claim carries its epistemic status, confidence, and evidence.
          </div>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          {["#4ADE9C", "#E8C45A", "#F0856B", "#7C8AA5"].map((c) => (
            <div key={c} style={{ width: 56, height: 8, background: c, borderRadius: 4 }} />
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
