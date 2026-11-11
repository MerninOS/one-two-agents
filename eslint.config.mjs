import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // Hard rule: Mercury writes go through the tool gateway only.
  {
    files: ["**/*.{ts,tsx}"],
    ignores: ["core/gateway/**"],
    rules: {
      "no-restricted-imports": ["error", { paths: [
        { name: "@/integrations/mercury-write", message: "Mercury writes go through the tool gateway (core/gateway) only." },
        { name: "../integrations/mercury-write", message: "Mercury writes go through the tool gateway (core/gateway) only." },
        { name: "../../integrations/mercury-write", message: "Mercury writes go through the tool gateway (core/gateway) only." },
      ], patterns: [{ group: ["**/mercury-write"], message: "Mercury writes go through the tool gateway (core/gateway) only." }] }],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", ".schemas/**"]),
]);
