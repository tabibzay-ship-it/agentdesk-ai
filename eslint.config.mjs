import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    ".netlify/**",
    ".codex-pglite-runtime/**",
    // A separate user-owned fixture/project kept beside AgentDesk AI. It has
    // its own CommonJS conventions and must not affect this app's quality gate.
    "Reasonix-Test/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
