import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const MERCURY_MSG = "Our receipt-file server is reached only through integrations/mcp.ts (callWriteTool, core/gateway only).";
const MERCURY_PATHS = ["@/integrations/mercury-files-server", "./mercury-files-server", "../integrations/mercury-files-server"].map((name) => ({ name, message: MERCURY_MSG }));
const MERCURY_PATTERN = { group: ["**/mercury-files-server"], message: MERCURY_MSG };
const VAULT_MSG = "Sign-ins are opened only by integrations/mcp.ts (reads) and core/gateway (writes): nothing else imports the token vault.";
const VAULT_PATHS = ["@/core/vault", "../core/vault", "../../core/vault", "./vault", "../vault"].map((name) => ({ name, message: VAULT_MSG }));
const VAULT_PATTERN = { group: ["**/core/vault"], message: VAULT_MSG };
// Our own Notion server (slice 4): only it calls Notion's API, and only the MCP client reaches it.
const NAPI_MSG = "Notion's API is called only by our Notion MCP server (integrations/notion-server.ts). Use integrations/notion.ts.";
const NAPI = { paths: ["@/integrations/notion-api", "./notion-api", "../integrations/notion-api"].map((name) => ({ name, message: NAPI_MSG })), pattern: { group: ["**/notion-api"], message: NAPI_MSG } };
const NSRV_MSG = "Our Notion MCP server is reached only through integrations/mcp.ts (callLocalTool), which opens its key from the vault.";
const NSRV = { paths: ["@/integrations/notion-server", "./notion-server", "../integrations/notion-server"].map((name) => ({ name, message: NSRV_MSG })), pattern: { group: ["**/notion-server"], message: NSRV_MSG } };
// Our own Gmail server (slice 6): only it calls Gmail's API, and only the MCP client reaches it.
const GAPI_MSG = "Gmail's API is called only by our Gmail MCP server (integrations/gmail-server.ts). Use integrations/gmail-read.ts.";
const GAPI = { paths: ["@/integrations/gmail-api", "./gmail-api", "../integrations/gmail-api"].map((name) => ({ name, message: GAPI_MSG })), pattern: { group: ["**/gmail-api"], message: GAPI_MSG } };
const GSRV_MSG = "Our Gmail MCP server is reached only through integrations/mcp.ts, which opens the Google sign-in from the vault.";
const GSRV = { paths: ["@/integrations/gmail-server", "./gmail-server", "../integrations/gmail-server"].map((name) => ({ name, message: GSRV_MSG })), pattern: { group: ["**/gmail-server"], message: GSRV_MSG } };
// Our own Shopify server (slice 7): only it calls Shopify's API, and only the MCP client reaches it.
const SAPI_MSG = "Shopify's API is called only by our Shopify MCP server (integrations/shopify-server.ts). Use integrations/shopify/*.";
const SAPI = { paths: ["@/integrations/shopify-api", "./shopify-api", "../integrations/shopify-api"].map((name) => ({ name, message: SAPI_MSG })), pattern: { group: ["**/shopify-api"], message: SAPI_MSG } };
const SSRV_MSG = "Our Shopify MCP server is reached only through integrations/mcp.ts (callLocalTool), which opens its key from the vault.";
const SSRV = { paths: ["@/integrations/shopify-server", "./shopify-server", "../integrations/shopify-server"].map((name) => ({ name, message: SSRV_MSG })), pattern: { group: ["**/shopify-server"], message: SSRV_MSG } };
// MCP write tools (slice 5b): only the gateway calls one, after an approver approves.
const MCPW_MSG = "Only core/gateway calls an MCP write tool, after an approver approves.";
const MCPW = { name: "@/integrations/mcp", importNames: ["callWriteTool"], message: MCPW_MSG };
// Custom-server tools (docs/custom-servers.md, slice 2): only the tool list for a run calls one.
const MCPC_MSG = "Only core/tools/custom.ts calls a custom server's tool: as a read tool granted for a run, or for a goal number.";
const MCPC = { name: "@/integrations/mcp", importNames: ["callCustomTool", "callCustomToolData"], message: MCPC_MSG };
const MEMORY_MSG = "Memory is notes, never authority: the gateway and integrations must not read it.";
const MEMORY_RULE = { name: "@/core/memory", message: MEMORY_MSG };
const MEMORY_PATTERN = { group: ["**/core/memory", "../memory", "./memory"], message: MEMORY_MSG };
const SPEC_MSG = "An agent spec is choices, never authority: the gateway and integrations must not read it.";
const SPEC_RULES = [{ name: "@/core/agent-spec", message: SPEC_MSG }, { name: "@/core/runner", message: SPEC_MSG }, { name: "@/core/playbook", message: SPEC_MSG }, { name: "@/core/built", message: SPEC_MSG }];
const SPEC_PATTERN = { group: ["**/core/agent-spec", "**/core/runner", "**/core/playbook", "**/core/built", "../agent-spec", "../runner", "../playbook", "../built"], message: SPEC_MSG };

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // Hard rules: writes go through the tool gateway only (callWriteTool); only the MCP client and
  // the gateway open the token vault; each of our own servers is reached only through the MCP client.
  {
    files: ["**/*.{ts,tsx}"],
    ignores: ["core/gateway/**"],
    rules: {
      "no-restricted-imports": ["error", { paths: [...MERCURY_PATHS, ...VAULT_PATHS, ...NAPI.paths, ...NSRV.paths, ...GAPI.paths, ...GSRV.paths, ...SAPI.paths, ...SSRV.paths, MCPW, MCPC], patterns: [MERCURY_PATTERN, VAULT_PATTERN, NAPI.pattern, NSRV.pattern, GAPI.pattern, GSRV.pattern, SAPI.pattern, SSRV.pattern] }],
    },
  },
  {
    files: ["core/tools/custom.ts"],
    rules: {
      "no-restricted-imports": ["error", { paths: [...MERCURY_PATHS, ...VAULT_PATHS, ...NAPI.paths, ...NSRV.paths, ...GAPI.paths, ...GSRV.paths, ...SAPI.paths, ...SSRV.paths, MCPW], patterns: [MERCURY_PATTERN, VAULT_PATTERN, NAPI.pattern, NSRV.pattern, GAPI.pattern, GSRV.pattern, SAPI.pattern, SSRV.pattern] }],
    },
  },
  // Hard rule: memory is notes, never authority. Nothing that decides access reads it.
  // The same goes for an agent's spec (core/agent-spec.ts and the engine): it picks from code's list and grants nothing.
  // (A later block replaces the rule for these files, so integrations/ repeats the Mercury rule.)
  {
    files: ["core/gateway/**/*.ts"],
    rules: { "no-restricted-imports": ["error", { paths: [MEMORY_RULE, ...SPEC_RULES, ...MERCURY_PATHS, ...NAPI.paths, ...NSRV.paths, ...GAPI.paths, ...GSRV.paths, ...SAPI.paths, ...SSRV.paths], patterns: [MEMORY_PATTERN, SPEC_PATTERN, MERCURY_PATTERN, NAPI.pattern, NSRV.pattern, GAPI.pattern, GSRV.pattern, SAPI.pattern, SSRV.pattern] }] },
  },
  {
    files: ["integrations/**/*.ts"],
    rules: { "no-restricted-imports": ["error", { paths: [MEMORY_RULE, ...SPEC_RULES, ...MERCURY_PATHS, ...VAULT_PATHS, ...NAPI.paths, ...NSRV.paths, ...GAPI.paths, ...GSRV.paths, ...SAPI.paths, ...SSRV.paths, MCPW, MCPC], patterns: [MEMORY_PATTERN, SPEC_PATTERN, MERCURY_PATTERN, VAULT_PATTERN, NAPI.pattern, NSRV.pattern, GAPI.pattern, GSRV.pattern, SAPI.pattern, SSRV.pattern] }] },
  },
  // Our Notion server is the one file that calls Notion's API.
  {
    files: ["integrations/notion-server.ts"],
    rules: { "no-restricted-imports": ["error", { paths: [MEMORY_RULE, ...SPEC_RULES, ...MERCURY_PATHS, ...VAULT_PATHS, ...NSRV.paths, ...GAPI.paths, ...GSRV.paths, ...SAPI.paths, ...SSRV.paths, MCPW], patterns: [MEMORY_PATTERN, SPEC_PATTERN, MERCURY_PATTERN, VAULT_PATTERN, NSRV.pattern, GAPI.pattern, GSRV.pattern, SAPI.pattern, SSRV.pattern] }] },
  },
  // Our Gmail server is the one file that calls Gmail's API.
  {
    files: ["integrations/gmail-server.ts"],
    rules: { "no-restricted-imports": ["error", { paths: [MEMORY_RULE, ...SPEC_RULES, ...MERCURY_PATHS, ...VAULT_PATHS, ...NAPI.paths, ...NSRV.paths, ...GSRV.paths, ...SAPI.paths, ...SSRV.paths, MCPW], patterns: [MEMORY_PATTERN, SPEC_PATTERN, MERCURY_PATTERN, VAULT_PATTERN, NAPI.pattern, NSRV.pattern, GSRV.pattern, SAPI.pattern, SSRV.pattern] }] },
  },
  // Our Shopify server is the one file that calls Shopify's API.
  {
    files: ["integrations/shopify-server.ts"],
    rules: { "no-restricted-imports": ["error", { paths: [MEMORY_RULE, ...SPEC_RULES, ...MERCURY_PATHS, ...VAULT_PATHS, ...NAPI.paths, ...NSRV.paths, ...GAPI.paths, ...GSRV.paths, ...SSRV.paths, MCPW], patterns: [MEMORY_PATTERN, SPEC_PATTERN, MERCURY_PATTERN, VAULT_PATTERN, NAPI.pattern, NSRV.pattern, GAPI.pattern, GSRV.pattern, SSRV.pattern] }] },
  },
  // The MCP client is the one integration that opens the vault; its test reads it too.
  {
    files: ["integrations/mcp.ts"],
    rules: { "no-restricted-imports": ["error", { paths: [MEMORY_RULE, ...SPEC_RULES, ...NAPI.paths, ...GAPI.paths, ...SAPI.paths], patterns: [MEMORY_PATTERN, SPEC_PATTERN, NAPI.pattern, GAPI.pattern, SAPI.pattern] }] },
  },
  {
    files: ["scripts/check-mcp.ts"],
    rules: { "no-restricted-imports": ["error", { paths: [...MERCURY_PATHS, ...NAPI.paths, ...NSRV.paths, ...GAPI.paths, ...GSRV.paths, ...SAPI.paths, ...SSRV.paths, MCPW], patterns: [MERCURY_PATTERN, NAPI.pattern, NSRV.pattern, GAPI.pattern, GSRV.pattern, SAPI.pattern, SSRV.pattern] }] },
  },
  // Tenancy (docs/tenancy.md): core/db.ts is the one file that makes a Supabase client, so every
  // query goes through the org-scoped db(). A separate rule, so it doesn't replace the import rules above.
  {
    files: ["**/*.{ts,tsx,mjs,js}"],
    ignores: ["core/db.ts"],
    rules: {
      "no-restricted-syntax": ["error",
        { selector: "ImportDeclaration[source.value=/^@supabase/]", message: "Only core/db.ts makes a Supabase client: use db(), which scopes every query to the current org." },
        { selector: "ImportExpression[source.value=/^@supabase/]", message: "Only core/db.ts makes a Supabase client: use db(), which scopes every query to the current org." },
        { selector: "CallExpression[callee.name='require'][arguments.0.value=/^@supabase/]", message: "Only core/db.ts makes a Supabase client: use db(), which scopes every query to the current org." },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", ".schemas/**"]),
]);
