# The books: charges, receipts, mileage, home office

Core keeps the evidence for every business charge, so tax time is an export and not a scramble.
The code is `core/books`; any business gets it. It moved out of the first business's template pack
on card 131 (restructure slice 1).

| File | What it holds |
| --- | --- |
| `core/books/rules.ts` | The rules, pure: which charges need a receipt, whether a receipt matches a charge, when to ask for a photo, mileage and home office math, coverage. Tested by `npm run check:books`. |
| `core/books/sync.ts` | One books sync: charges from Mercury, receipts found in Gmail, statuses, approval cards, the Notion page, the monthly close. |
| `core/books/prompt.ts` | What the small model is told when it reads one receipt email. It names the business from its own row (Settings). |

An agent runs the sync through the report tool `report_books_sync` (`core/tools/catalog.ts`). Code
runs it after a finished run; a model never calls it.

## What the sync never does

It never writes to Mercury or to any accounting system. A receipt, category or memo for a charge is
stored on the row as a proposal and handed to the tool gateway (`core/gateway`), which queues one
approval card per charge and applies only what an approver approves: attachment, category and memo
on the existing transaction, nothing else.

## One sync, step by step

1. Load the policies: `receipt_match_window_days` (3), `receipt_photo_min_usd` (75),
   `receipt_mixed_merchants`, `bank_record_after_days` (30), `irs_mileage_rate`.
2. Read the last 45 days of posted Mercury transactions through the read tools. Keep money out
   (`amount < 0`). Transfers between the business's own accounts and card payments are `not_needed`.
3. Add new charges to `expense_docs` (one row per `mercury_txn_id`). Existing rows keep their status;
   a person's edit to a row is never overwritten, and a category set in Mercury always wins.
4. A charge with an attachment in Mercury becomes `matched` (source `mercury`).
5. For each still-open charge (newest first, at most 25 a run, at most 3 searches over a charge's
   life), search Gmail (read-only) for the exact amount inside the date window. A small model reads
   up to 3 candidate emails and only fills four fields: is it a receipt, merchant, total, date.
   **Code** decides the match: the total equals the charge to the cent, the date is inside the
   window, and the merchant shares a word with Mercury's counterparty. A match saves the receipt in
   the private `receipts` bucket and sets `matched` (source `gmail`).
6. No match: at or above the photo threshold, lodging, or a store that also sells personal things
   becomes `needs_photo`. Under that it becomes `bank_record_only`. A `needs_photo` older than the
   limit becomes `bank_record_only` with a note.
7. Every proposal goes to the gateway as an approval card.
8. A Notion page ("Books · <day>") under the books page on Settings, only when something changed.
9. On the 3rd, last month is closed: charges, spend, receipt coverage, uncategorized charges, open
   photo asks and miles, all counted in code.

## Tables

All four are tenant tables: `org_id`, a place in `TENANT_TABLES`, an `org_rows` policy.

| Table | Rows |
| --- | --- |
| `expense_docs` | One per business charge: status, receipt path, and the proposal waiting for approval |
| `trips` | Business trips by date, with miles |
| `home_office` | Office and home square feet and the home's costs, per year |
| `tax_packets` | One per tax year |

## Rules in code

- Mercury reads go through `callMcpTool`. The repo has no code path that writes to Mercury outside
  the gateway.
- Gmail is read-only (`gmail.readonly`, our own Gmail server). The sync never sends, drafts, labels
  or deletes.
- An email is untrusted data. It only fills the four fields above. It can't pick the charge, the
  category, the file name or a recipient: the charge comes from Mercury, the file path from
  Mercury's id, and a category must be an id on Mercury's own list.
- Money and counts (coverage, totals, miles, mileage dollars, home office dollars) are computed in
  code.
- Every run goes through `withRun`: logged, and held to the agent's on/off switch and daily budget.
- Record keeping, not tax advice. The pages say so.

## Not built yet

Trip entry and home office inputs (the tables and the math exist), the yearly tax packet, and an
accounting system's chart of accounts.
