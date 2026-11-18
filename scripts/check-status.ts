// Status and alerts (docs/usage.md, slice 4): `npm run check:status`. Pure: no database, no email.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { migration } from "./lib/schema";
import { alertEmail, alertsDue, statusProblems, type StatusFacts } from "../core/status-rules";

const now = Date.parse("2026-11-18T12:00:00Z");
const clear: StatusFacts = { deadJobs: { count: 0, latest: null }, waitingJobs: 2, overdueJobs: { count: 0, oldestDue: null }, paused: [], refused: { count: 0, latest: null }, failedRuns: { count: 0, agents: [] }, unread: [] };
assert.deepEqual(statusProblems(clear, now), [], "waiting jobs that aren't late are fine");

const bad: StatusFacts = {
  ...clear,
  deadJobs: { count: 2, latest: { outcome: "Morgan: model unreachable", at: "2026-11-18T11:00:00Z" } },
  overdueJobs: { count: 1, oldestDue: "2026-11-18T11:00:00Z" },
  paused: [{ id: "klaviyo", name: "Klaviyo", why: "its sign-in stopped working", custom: false }, { id: "c_ab12cd34", name: "Roast log", why: "the server changed a tool", custom: true }],
  refused: { count: 3, latest: "Over the $500 purchase cap" },
  failedRuns: { count: 1, agents: ["morgan"] },
  unread: ["jobs"],
};
const ps = statusProblems(bad, now);
assert.deepEqual(ps.map((p) => [p.key, p.level]), [["dead_jobs", "alert"], ["overdue_jobs", "alert"], ["paused:klaviyo", "alert"], ["paused:c_ab12cd34", "alert"], ["failed_runs", "warn"], ["refused", "warn"], ["unread:jobs", "warn"]]);
assert.match(ps[1].detail, /due 60 minutes ago/);
assert.match(ps[2].detail, /Sign in again/);
assert.match(ps[3].detail, /accept the change/);
for (const p of ps) assert.match(p.key, /^[a-z][a-z0-9_]{1,30}(:[a-z0-9_]{1,40})?$/, "every key fits the status_alerts check");

// once, then at most once a day; warnings never email
assert.deepEqual(alertsDue(ps, {}, now).map((p) => p.key), ["dead_jobs", "overdue_jobs", "paused:klaviyo", "paused:c_ab12cd34"]);
const sent = { dead_jobs: "2026-11-18T06:00:00Z", overdue_jobs: "2026-11-17T11:00:00Z", "paused:klaviyo": "2026-11-18T11:59:00Z" };
assert.deepEqual(alertsDue(ps, sent, now).map((p) => p.key), ["overdue_jobs", "paused:c_ab12cd34"]);

// the email: escaped, one link to Status, no recipient
const m = alertEmail([{ key: "x", level: "alert", title: "<b>Roast</b> & co is paused", detail: "x", href: "/connections" }], "https://app.example");
assert.equal(m.subject, "Alert: <b>Roast</b> & co is paused");
assert.match(m.html, /&lt;b&gt;Roast&lt;\/b&gt; &amp; co/);
assert.match(m.text, /Status: https:\/\/app\.example\/status/);
assert.match(alertEmail(ps.slice(0, 3), "https://a.b").subject, /3 things need a look/);

// alerts go only through integrations/email.ts, only for the home org, and the scheduler sends them
const src = readFileSync("core/status.ts", "utf8");
assert.match(src, /if \(!\(await hasEmail\(\)\)\) return \[\];/);
assert.match(readFileSync("app/api/dispatch/route.ts", "utf8"), /sendStatusAlerts\(origin, now\)\.catch/);
const sql = migration("20261209090000_status_alerts.sql"); // check:baseline checks every policy in the public repo
if (sql) assert.match(sql, /create policy org_rows on status_alerts/);
console.log("check:status ok");
