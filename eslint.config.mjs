import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const MERCURY_MSG = "Mercury writes go through the tool gateway (core/gateway) only.";
const MERCURY_PATHS = ["@/integrations/mercury-write", "../integrations/mercury-write", "../../integrations/mercury-write"].map((name) => ({ name, message: MERCURY_MSG }));
const MERCURY_PATTERN = { group: ["**/mercury-write"], message: MERCURY_MSG };
const VAULT_MSG = "Sign-ins are opened only by integrations/mcp.ts (reads) and core/gateway (writes): nothing else imports the token vault.";
const VAULT_PATHS = ["@/core/vault", "../core/vault", "../../core/vault", "./vault", "../vault"].map((name) => ({ name, message: VAULT_MSG }));
const VAULT_PATTERN = { group: ["**/core/vault"], message: VAULT_MSG };
const MEMORY_MSG = "Memory is notes, never authority: the gateway and integrations must not read it.";
const MEMORY_RULE = { name: "@/core/memory", message: MEMORY_MSG };
const MEMORY_PATTERN = { group: ["**/core/memory", "../memory", "./memory"], message: MEMORY_MSG };
const SPEC_MSG = "An agent spec is choices, never authority: the gateway and integrations must not read it.";
const SPEC_RULES = [{ name: "@/core/agent-spec", message: SPEC_MSG }, { name: "@/core/runner", message: SPEC_MSG }, { name: "@/core/playbook", message: SPEC_MSG }, { name: "@/core/built", message: SPEC_MSG }];
const SPEC_PATTERN = { group: ["**/core/agent-spec", "**/core/runner", "**/core/playbook", "**/core/built", "../agent-spec", "../runner", "../playbook", "../built"], message: SPEC_MSG };

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // Hard rules: Mercury writes go through the tool gateway only; only the MCP client and the
  // gateway open the token vault.
  {
    files: ["**/*.{ts,tsx}"],
    ignores: ["core/gateway/**"],
    rules: {
      "no-restricted-imports": ["error", { paths: [...MERCURY_PATHS, ...VAULT_PATHS], patterns: [MERCURY_PATTERN, VAULT_PATTERN] }],
    },
  },
  // Hard rule: memory is notes, never authority. Nothing that decides access reads it.
  // The same goes for an agent's spec (core/agent-spec.ts and the engine): it picks from code's list and grants nothing.
  // (A later block replaces the rule for these files, so integrations/ repeats the Mercury rule.)
  {
    files: ["core/gateway/**/*.ts"],
    rules: { "no-restricted-imports": ["error", { paths: [MEMORY_RULE, ...SPEC_RULES], patterns: [MEMORY_PATTERN, SPEC_PATTERN] }] },
  },
  {
    files: ["integrations/**/*.ts"],
    rules: { "no-restricted-imports": ["error", { paths: [MEMORY_RULE, ...SPEC_RULES, ...MERCURY_PATHS, ...VAULT_PATHS], patterns: [MEMORY_PATTERN, SPEC_PATTERN, MERCURY_PATTERN, VAULT_PATTERN] }] },
  },
  // The MCP client is the one integration that opens the vault; its test reads it too.
  {
    files: ["integrations/mcp.ts"],
    rules: { "no-restricted-imports": ["error", { paths: [MEMORY_RULE, ...SPEC_RULES, ...MERCURY_PATHS], patterns: [MEMORY_PATTERN, SPEC_PATTERN, MERCURY_PATTERN] }] },
  },
  {
    files: ["scripts/check-mcp.ts"],
    rules: { "no-restricted-imports": ["error", { paths: MERCURY_PATHS, patterns: [MERCURY_PATTERN] }] },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", ".schemas/**"]),
]);
