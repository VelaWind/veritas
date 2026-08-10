import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

// AUDIT.md F-03: before this file existed there was no ESLint config at all, so
// `next build`'s "Linting and checking validity of types" step was doing only
// the type half. Kept deliberately minimal — Next's recommended rules plus
// core-web-vitals, plus the TypeScript ruleset. No stylistic rules: formatting
// churn would bury the correctness findings these are here to surface.
const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "supabase/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default eslintConfig;
