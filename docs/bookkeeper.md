# Bookkeeper (Quinn): implementation spec

Agent 10 in the tech spec ("One Two Coffee Lab Agent System Tech Spec.md", section Bookkeeper; proposal https://claude.ai/artifact/P8JM9JuckRJYog2fj69kTV). Target: repo `MerninOS/one-two-agents`, Vercel project `one-two-agents`, Supabase project `one-two-agents`. Written 2026-11-09.

## 1. What ships in this first build

Quinn keeps the evidence for every business charge so tax time is an export, not a scramble. This build does the daily part and the monthly close. It **writes nothing to Mercury or QuickBooks**: the tech spec allows Bookkeeper attachment, category and memo writes only once the tool gateway enforces them, and the gateway is not built. Until then every Mercury change is a *proposal* stored in Supabase and listed on a Notion page.

| Part | In this build | Later |
| --- | --- | --- |
| Pull business charges from Mercury (read-only, business org token) | Yes, last 45 days by posted date, every account the token sees | |
| One `expense_docs` row per charge, status decided in code | Yes | |
| Receipt already attached in Mercury → `matched` | Yes | |
| Find receipts in Gmail (zak@onetwocoffeelab.com) | Yes, when a **read-only** Gmail token is set (`gmail.readonly`, its own refresh token, separate from the Hunter's compose token) | Gmail watch on a receipts label (push) |
| Read candidate receipt emails | claude-haiku-5-5 extracts merchant, total, date (structured output). Code decides the match | |
| Save matched receipt to Supabase Storage (`receipts` bucket, private, kept 7 years) | Yes: the PDF/image attachment if there is one, else the email text | |
| Suggest a category | claude-haiku-5-5 picks from Mercury's own custom category list (the chart of accounts until One Two has a QuickBooks company). Code rejects anything not on the list. Never on a charge that already has a category | QuickBooks chart of accounts |
| Write receipt, category, memo to Mercury | **No.** Stored as `proposal_status = 'proposed'` | Gateway executes after Zak approves (Draft tier), then exact matches can earn Act |
| "Receipts needed" list | A section of the daily Notion page | Notion database with photo upload, email to zak+receipts@ |
| Monthly close (on the 3rd, for last month) | Numbers in code: charges, spend, receipt coverage, uncategorized, open photo asks, miles. Notion page | Sonnet-written open-items note |
| Mileage and home office | Tables, policies and the math in `domain/books.ts` (IRS standard rate, simplified $5/sq ft up to 300 sq ft, actual-expense share) | Trip entry (QuickBooks tracker export / Notion form), home office inputs |
| Tax packet (Jan 15) | Table only | Build before January |
| QuickBooks | Not connected (One Two has no QBO company yet; Claude's connector is "Mernin Coffee (NOT MAIN ACCOUNT)") | Read expenses + chart of accounts once a company exists |

## 2. Ships off

- `agents` row inserted with `enabled = false`, `daily_budget_usd = 1`.
- No entry in `vercel.json`, so no Vercel Schedule exists. The intended schedule is daily 6:00 AM CT; add it at launch.
- `manualOnly` in the registry until launch: anything but `?trigger=manual` (or a dry run) is skipped.
- Dry run (`?dryRun=1`, or the Control Room's Dry run button) reads Mercury and Gmail, works out what it would do, and writes nothing and calls no model.

## 3. A daily run, step by step

1. Load policies (`receipt_match_window_days` 3, `receipt_photo_min_usd` 75, `receipt_mixed_merchants`, `bank_record_after_days` 30, `irs_mileage_rate`).
2. Mercury `GET /api/v1/transactions?postedStart&postedEnd&status=sent` (all pages), plus `GET /api/v1/categories`. Keep money out: `amount < 0`. Internal transfers between One Two's own accounts and card payments are `not_needed`.
3. Upsert new charges into `expense_docs` (key `mercury_txn_id`). Existing rows keep their status; Zak's edits to a row are never overwritten.
4. Charges with a Mercury attachment become `matched` (source `mercury`).
5. For each still-open charge (newest first, at most 25 a run), search Gmail: the exact amount, within the date window, with receipt words. Up to 3 candidate emails each. Haiku reads each candidate (untrusted text, structured output only). **Code** decides: total equals the charge to the cent, date within the window, and the merchant shares a word with Mercury's counterparty. A match saves the receipt file and sets `matched` (source `gmail`).
6. No match: at or above $75, lodging, or a mixed store (Costco, Walmart, Target, Amazon, H-E-B, Sam's Club) → `needs_photo`. Under that → `bank_record_only` (the bank record is enough). A `needs_photo` older than 30 days → `bank_record_only` with a note.
7. Charges with no Mercury category get a Haiku category suggestion, checked against the list, stored as a proposal.
8. A Notion page ("Books · Mon, Nov 9") only when something changed: matched receipts with proposed category and memo (marked "waiting for approval, not applied"), receipts needed, counts.

## 4. Data

Migration `supabase/migrations/20261109200000_bookkeeper.sql`: tables `expense_docs`, `trips`, `home_office`, `tax_packets` (columns from the tech spec, plus proposal columns on `expense_docs`), the private Storage bucket `receipts`, the `agents` row (off) and the policies above. RLS on, no policies, service role only, same as every other agent table. **Zak applies it** (SQL editor of `one-two-agents`, or `supabase db push`); until then the Control Room shows Quinn as "Not in the database".

## 5. Settings (Vercel project `one-two-agents`)

- `MERCURY_API_TOKEN`: already set (business org, read-only). Bookkeeper does not need `MERCURY_ACCOUNT_IDS`.
- `GMAIL_RECEIPTS_REFRESH_TOKEN`: new. A refresh token for zak@onetwocoffeelab.com with only `https://www.googleapis.com/auth/gmail.readonly`, from the same OAuth client as `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET`. Blank = Quinn skips Gmail and lists every unmatched charge.
- `ANTHROPIC_API_KEY`, `NOTION_TOKEN`, `NOTION_BRIEF_PARENT_ID`, Supabase: already there.

## 6. Guardrails in code

- `integrations/mercury.ts` has only GET calls. No attachment, category or note endpoint exists in the repo.
- `integrations/gmail-read.ts` only searches and reads (readonly scope). It never sends, drafts, labels or deletes.
- Email content is untrusted: it only fills extraction fields. It can't pick the charge, category, file name or recipient; the category must be an id from Mercury's list and the charge comes from Mercury.
- Money and counts (coverage, totals, miles, mileage $, home office $) are computed in code.
- Every run goes through `withRun` (log, `enabled`, budget). Cost: Haiku at $0.10 / $0.50 per million tokens, a few cents a day at most.
- Record keeping, not tax advice: pages say so.

## 7. Control Room

Quinn moves from "Joining the crew" to the built crew in `dashboard/crew.ts` (pink, receipt icon, Draft tier, manual until launch), with access rows for Mercury (read + proposals), Gmail (read receipts), Claude (Haiku), Notion, Supabase. The profile gets a "Receipts" card with `expense_docs` counts by status and the open photo asks; Needs you lists charges waiting on a photo; the Integrations page shows the receipts Gmail token.

## 8. Open questions (from the tech spec, still open)

One Two QuickBooks company (and whether Mercury syncs to it), entity type, CPA and their receipt threshold, home roasting/storage sq ft, mileage source, the 2026 IRS mileage rate (seeded only for 2025 at $0.70).
