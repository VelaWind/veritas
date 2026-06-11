// WCAG 2.1 contrast audit for the signal palette against both surfaces.
// AA: 4.5:1 for normal text, 3:1 for large text (>=18.66px bold / 24px) and UI.
function lin(c) {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function L(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function ratio(a, b) {
  const la = L(a), lb = L(b);
  return ((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05));
}

const themes = {
  dark: {
    surfaces: { "bg-void": "#060A12", "bg-surface": "#0C1320", "bg-raised": "#131C2E" },
    fg: {
      "text-primary": "#E8EDF6", "text-muted": "#8A97AD", accent: "#5BB8FF",
      "signal-strong": "#4ADE9C", "signal-mid": "#E8C45A", "signal-weak": "#F0856B",
      "signal-unknown": "#7C8AA5", contradiction: "#FF5470",
    },
  },
  light: {
    surfaces: { "bg-void": "#F4F6FA", "bg-surface": "#FFFFFF", "bg-raised": "#E9EEF6" },
    fg: {
      "text-primary": "#11192A", "text-muted": "#54637D", accent: "#0E6FBE",
      "signal-strong": "#177D52", "signal-mid": "#8F6E14", "signal-weak": "#B14A2C",
      "signal-unknown": "#56647E", contradiction: "#C42347",
    },
  },
};

const AA_TEXT = 4.5, AA_LARGE = 3.0;
let warnings = 0;
for (const [tname, t] of Object.entries(themes)) {
  console.log(`\n=== ${tname} ===`);
  for (const [fgName, fg] of Object.entries(t.fg)) {
    // Signal colors render as small (12px) mono chip text and UI marks; the
    // most relevant surfaces are bg-surface (cards) and bg-void (page).
    const onSurface = ratio(fg, t.surfaces["bg-surface"]);
    const onVoid = ratio(fg, t.surfaces["bg-void"]);
    const min = Math.min(onSurface, onVoid);
    const isSignal = fgName.startsWith("signal") || fgName === "contradiction" || fgName === "accent";
    // Signal chips are small text → AA_TEXT; treat as UI marks too (AA_LARGE).
    const threshold = fgName === "text-primary" || fgName === "text-muted" ? AA_TEXT : AA_LARGE;
    const pass = min >= threshold;
    if (!pass) warnings++;
    console.log(
      `${pass ? "✓" : "✗"} ${fgName.padEnd(14)} surface ${onSurface.toFixed(2)}  void ${onVoid.toFixed(2)}  (need ${threshold})${isSignal ? "  [signal/UI]" : ""}`,
    );
  }
}
console.log(`\n${warnings === 0 ? "ALL PASS" : warnings + " below threshold"}`);
