import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const MERCURY_MSG = "Mercury writes go through the tool gateway (core/gateway) only.";
const MERCURY_PATHS = ["@/integrations/mercury-write", "../integrations/mercury-write", "../../integrations/mercury-write"].map((name) => ({ name, message: MERCURY_MSG }));
const MERCURY_PATTERN = { group: ["**/mercury-write"], message: MERCURY_MSG };
const MEMORY_MSG = "Memory is notes, never authority: the gateway and integrations must not read it.";
const MEMORY_RULE = { name: "@/core/memory", message: MEMORY_MSG };
const MEMORY_PATTERN = { group: ["**/core/memory", "../memory", "./memory"], message: MEMORY_MSG };
const SETUP_MSG = "A setup is choices, never authority: the gateway and integrations must not read it.";
const SETUP_RULE = { name: "@/core/setup", message: SETUP_MSG };
const SETUP_PATTERN = { group: ["**/core/setup", "../setup", "./setup"], message: SETUP_MSG };
const SPEC_MSG = "An agent spec is choices, never authority: the gateway and integrations must not read it.";
const SPEC_RULES = [{ name: "@/core/agent-spec", message: SPEC_MSG }, { name: "@/core/runner", message: SPEC_MSG }];
const SPEC_PATTERN = { group: ["**/core/agent-spec", "**/core/runner", "../agent-spec", "../runner"], message: SPEC_MSG };

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // Hard rule: Mercury writes go through the tool gateway only.
  {
    files: ["**/*.{ts,tsx}"],
    ignores: ["core/gateway/**"],
    rules: {
      "no-restricted-imports": ["error", { paths: MERCURY_PATHS, patterns: [MERCURY_PATTERN] }],
    },
  },
  // Hard rule: memory is notes, never authority. Nothing that decides access reads it.
  // The same goes for an agent's setup (core/setup.ts): it picks from a menu and grants nothing.
  // (A later block replaces the rule for these files, so integrations/ repeats the Mercury rule.)
  {
    files: ["core/gateway/**/*.ts"],
    rules: { "no-restricted-imports": ["error", { paths: [MEMORY_RULE, SETUP_RULE, ...SPEC_RULES], patterns: [MEMORY_PATTERN, SETUP_PATTERN, SPEC_PATTERN] }] },
  },
  {
    files: ["integrations/**/*.ts"],
    rules: { "no-restricted-imports": ["error", { paths: [MEMORY_RULE, SETUP_RULE, ...SPEC_RULES, ...MERCURY_PATHS], patterns: [MEMORY_PATTERN, SETUP_PATTERN, SPEC_PATTERN, MERCURY_PATTERN] }] },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", ".schemas/**"]),
]);
