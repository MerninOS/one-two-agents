// Traces (docs/usage.md, slice 3): registers OpenTelemetry for the app, on the Node.js runtime only
// (instrumentation.node.ts). Spans go to whatever the environment sets up: a Vercel trace drain, or
// any OTel backend through the standard OTEL_EXPORTER_OTLP_* settings. With neither, nothing is
// sent. Our spans carry only ids, names and numbers (core/trace-rules.ts); every span, Next.js's own
// included, is cleaned before it leaves: URLs lose their query strings (a sign-in callback carries a
// code there) and strings are scrubbed.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./instrumentation.node");
}
