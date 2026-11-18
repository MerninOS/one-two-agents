// Traces on the Node.js runtime (instrumentation.ts loads this file only there; see that file).
import { registerOTel } from "@vercel/otel";
import type { ReadableSpan, SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { cleanExported } from "@/core/trace-rules";

const scrub: SpanProcessor = {
  onStart() {},
  onEnd(span: ReadableSpan) {
    const a = span.attributes as Record<string, unknown>;
    const clean = cleanExported(a);
    for (const k of Object.keys(a)) delete a[k];
    Object.assign(a, clean);
  },
  forceFlush: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
};

// scrub first, so the exporter after it only ever sees clean spans
registerOTel({ serviceName: "operator", spanProcessors: [scrub, "auto"] });
