// Traces (docs/usage.md, slice 3): an OpenTelemetry span around each job, run, model call and tool
// call, tagged with the org. instrumentation.ts registers the exporter; with none set up, spans cost
// nothing and go nowhere. A span only carries what core/trace-rules.ts allows, and tracing never
// changes or stops the work it wraps.
import { SpanStatusCode, trace, type Span } from "@opentelemetry/api";
import { currentOrgId } from "@/core/tenancy";
import { spanAttrs, spanError, type SpanAttrs, type SpanName } from "@/core/trace-rules";

const tracer = () => trace.getTracer("operator");

/** Runs `fn` inside a span named `name`; `fn` may add facts it learns (tokens, status) through `set`. */
export async function traced<T>(name: SpanName, attrs: SpanAttrs, fn: (set: (more: SpanAttrs) => void) => Promise<T>): Promise<T> {
  let span: Span | null = null;
  const set = (more: SpanAttrs) => { try { span?.setAttributes(spanAttrs(more)); } catch { /* tracing never stops the work */ } };
  const run = async (s: Span | null) => {
    span = s;
    set({ "operator.org": currentOrgId(), ...attrs });
    try {
      const out = await fn(set);
      try { s?.setStatus({ code: SpanStatusCode.OK }); } catch { /* ignore */ }
      return out;
    } catch (e) {
      try { s?.setStatus({ code: SpanStatusCode.ERROR, message: spanError(e) }); } catch { /* ignore */ }
      throw e;
    } finally {
      try { s?.end(); } catch { /* ignore */ }
    }
  };
  let t;
  try { t = tracer(); } catch { return run(null); }
  return t.startActiveSpan(`operator.${name}`, (s) => run(s));
}
