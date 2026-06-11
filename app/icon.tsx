import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

// The reticle motif — an instrument pointed at the unknown.
export default function Icon() {
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
        }}
      >
        <svg width="380" height="380" viewBox="0 0 18 18" fill="none">
          <circle cx="9" cy="9" r="7" stroke="#5BB8FF" strokeWidth="1.1" />
          <circle cx="9" cy="9" r="1.6" fill="#5BB8FF" />
          <path d="M9 0v4M9 14v4M0 9h4M14 9h4" stroke="#5BB8FF" strokeWidth="1.1" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
