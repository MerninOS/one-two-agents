# The morning brief

The Chief of Staff agent (the company seat on the org chart) sends the owner a morning brief on the
days its schedule says. The email is the brief; Notion is the archive: one row per day in the
Briefs database (`docs/briefs-database.md`), or a page per day while that isn't set up. Core since
card 133.5: `core/brief`, tool `report_morning_brief`.

## What the owner gets

**Subject:** `Thu: Get Land 5 accounts back on track · $412 yesterday`. Weekday, the focus action,
yesterday's revenue. With no daily numbers yet: `Thu: <focus>`.

**Body, in this order:**

1. **Today's focus.** The action, the reason, and one button to the Control Room.
2. **Waiting on you.** Only lines that are true today, each linked where a link exists:
   - approvals pending, with the age of the oldest → Control Room `/approvals`
   - lead email drafts put in Gmail in the last 24 hours → Gmail drafts
   - failed agent runs in the last 24 hours → that run in the Control Room
   - open orders by Shopify's own fulfillment status: to ship, partly shipped, and on hold (by order number)
   - "Nothing is waiting on you." when the list is empty
3. **Numbers.** Three figures from the daily numbers (`docs/daily-numbers.md`): revenue (against the
   average of the previous 7 days), orders (with average order), cash (against 7 days back). Repeat
   rate, and margin when cost of goods is set, on one line under them. Then **your own numbers**:
   each number from your own tools marked "Show in the morning brief" (Connections › Your servers ›
   Use as a goal number), read in code that morning after the same tool check agents get.
4. **Watch.** Up to five items.
5. **Departments.** One line per department on the org chart: each goal's status and code's count of
   its runs in the last 24 hours ("Finance: Runway above 12 months: 14.3 months, on track. 3 runs, all
   OK, $0.12, in the last 24 hours.").
6. **Footer.** Link to the Notion copy when one was written.

## Focus and watch list

The agent's run hands in a `Focus:` line and up to five `- ` lines, written from its tools' numbers.
When the result has neither, or no model can be reached, fixed rules in `core/brief/rules.ts` write
them: the goal that missed its date or is furthest behind first ("Get ‹goal› back on track"), else the
open orders waiting to ship, else "Pick one thing that grows the business". Watch lists goals behind,
orders on hold and failed runs.

## Rules it keeps

- **Fixed recipient.** `integrations/email.ts` has no recipient argument: the brief goes to the owner
  email on Settings, always one of the business's owners. Nothing a model, a web page or an inbound
  email says can change it.
- **Not a gateway action.** A report to the owner is a Report-tier write, like the Notion row.
- **Numbers in code.** Every figure, comparison, goal status and count is worked out in `core/brief`.
  The model writes only the Watch list and the focus.
- **Your own numbers are untrusted data.** They are read by code, shown as numbers, and choose nothing.
- **Model text is escaped.** Watch items, the focus and run summaries are HTML-escaped, and the
  subject is cut to one line.
- **Every run through `withRun`**, so `agents.enabled` and the daily budget still apply.

## Behavior

| Settings | Result |
| --- | --- |
| Email and Notion set | Notion row (or page) written, then the email sent with a link to it |
| Email only | Email sent |
| Notion only | Notion row or page only |
| Neither | The run fails and says which settings are missing |

- A Notion failure does not stop the email; the run summary says the page failed.
- An email failure fails the run, so it shows in the Control Room.
- Shopify not connected: the open orders line is left out.

## Files

- `core/brief/email.ts`: pure; facts and the judgment into `{ subject, html, text }`.
- `core/brief/rules.ts`: pure; the fixed focus rules, reading the run's Focus line, open order counts.
- `core/brief/index.ts`: gathers today's facts, writes the Notion copy and sends.
- Tests: `npm run check:brief`.
