"use client";

// Catches errors in the root layout itself. Must render <html>/<body>.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" data-theme="dark">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          background: "#060A12",
          color: "#E8EDF6",
          fontFamily: "system-ui, sans-serif",
          padding: 24,
          textAlign: "center",
        }}
      >
        <p style={{ fontFamily: "monospace", fontSize: 12, color: "#8A97AD", letterSpacing: 2 }}>
          FATAL
        </p>
        <h1 style={{ fontWeight: 300, fontSize: 28 }}>The observatory went dark.</h1>
        <p style={{ color: "#8A97AD", maxWidth: 480 }}>
          A fatal error occurred and no data could be loaded. This is a fault in
          the instrument, not an empty record. Reload to try again.
        </p>
        <button
          onClick={reset}
          style={{
            background: "#5BB8FF",
            color: "#060A12",
            border: "none",
            borderRadius: 6,
            padding: "10px 20px",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          Reload
        </button>
        {error.digest && (
          <p style={{ fontFamily: "monospace", fontSize: 12, color: "#8A97AD" }}>
            ref: {error.digest}
          </p>
        )}
      </body>
    </html>
  );
}
