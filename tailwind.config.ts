import type { Config } from "tailwindcss";

/**
 * Design tokens per §5 of veritas-architecture-v1.md.
 * All colors resolve to CSS variables defined in app/globals.css so the
 * dark (default) and light themes share one utility vocabulary.
 * Signal hues are RESERVED for epistemic state — never decorative use.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        void: "var(--bg-void)",
        surface: "var(--bg-surface)",
        raised: "var(--bg-raised)",
        edge: "var(--border)",
        ink: "var(--text-primary)",
        muted: "var(--text-muted)",
        accent: "var(--accent)",
        signal: {
          strong: "var(--signal-strong)",
          mid: "var(--signal-mid)",
          weak: "var(--signal-weak)",
          unknown: "var(--signal-unknown)",
        },
        contradiction: "var(--contradiction)",
      },
      fontFamily: {
        display: ["var(--font-spectral)", "Georgia", "serif"],
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-plex-mono)", "ui-monospace", "monospace"],
      },
      // §5.3 type scale: 12 / 14 / 16 / 20 / 28 / 40 / 56
      fontSize: {
        xs: ["12px", { lineHeight: "1.5" }],
        sm: ["14px", { lineHeight: "1.6" }],
        base: ["16px", { lineHeight: "1.6" }],
        lg: ["20px", { lineHeight: "1.5" }],
        xl: ["28px", { lineHeight: "1.25" }],
        "2xl": ["40px", { lineHeight: "1.15" }],
        "3xl": ["56px", { lineHeight: "1.15" }],
      },
      maxWidth: {
        content: "1200px",
      },
    },
  },
  plugins: [],
};

export default config;
