# Tool gateway

Every write an agent wants to make outside its own tables goes through here. Agents never
import a write integration: `integrations/mercury-write.ts` can only be imported from
`core/gateway/` (enforced in `eslint.config.mjs`, so `npm run check` fails otherwise).

- `policy.ts`: the rules in plain code. `TOOLS` is the allow-list of write tools, which
  agents may use each one, its tier and its fields. `refuseProposal` checks a proposal;
  `planWrite` re-checks it against Mercury's live state right before a write.
- `index.ts`: `propose` (refuse, or record in `agent_actions` and queue in `approvals`),
  `queueBookkeeperProposals`, `decide`, `expireStale`, `retry`, `applyApproved`.

Sending, payments and posting are allowed by the tech spec only as gateway action types
with approval levels and caps (see CLAUDE.md). None of them is built yet, so no agent has
one of those integrations.

## Proposals from agents built in the app (docs/agent-builder.md, slice 5)

The runner (`core/runner.ts`) stages a proposal when the model calls an action tool, and after a
run that finishes calls `propose` here, with the run id. The gateway's checks are the same as for
Quinn's proposals: `refuseProposal` (allow-list of agents and fields), then the live re-check in
`applyOne` before any write. The runner never imports a write integration.

## `gmail.create_draft` (slice 7)

A plain-text draft in One Two's Gmail, to a lead on the leads list (`wholesale_leads`). Only
`wholesale_hunter`. Draft tier, and `promotable: false`: a first email to someone stays
approval-only for good. Zak still sends each draft himself from Gmail.

- The proposal holds only `subject` and `body` (no links, no control characters; the body keeps
  line breaks). The target is the lead's id. There is no recipient field: the gateway reads the
  address from the lead's row, at proposal time and again when it makes the draft.
- Refused when the lead has no address, the address is in `email_suppressions`, or the lead is
  marked lost or skip (`refuseDraftTo`).
- Proposed by Rowan's leads list report (`report_leads`, for each new lead with an address,
  when the spec also grants `gmail_draft_lead` and Gmail is connected) or by the model through
  `gmail_draft_lead`, naming a lead from a Leads list result.
- Applying needs `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` (compose
  scope), `DASHBOARD_CONTROLS=on` and Rowan on duty; at most
  `policies.max_gmail_drafts_per_run` (10) per apply. The lead moves from new to drafted.

## `mercury.annotate_transaction`

Receipt attachment, category and memo on a Mercury transaction that already exists. Only
`bookkeeper` and `cfo`. Draft tier: every action waits for Zak.

1. Quinn saves proposals on `expense_docs` (`proposal_*`) and, at the end of a real run,
   calls `queueBookkeeperProposals`: one `agent_actions` row (`proposed`) and one `approvals`
   row (`pending`) per charge. The Control Room's "Check for Quinn's proposals" does the same.
2. Zak approves or rejects in the Control Room (`/approvals`). Pending items older than
   `policies.approval_expiry_hours` (72) expire as stale.
3. Applying needs `MERCURY_WRITE_TOKEN`, `DASHBOARD_CONTROLS=on`, and the agent on duty
   (`applyApproved` runs inside `withRun(agent, "approval")`, so it is logged at $0 and
   skipped while `agents.enabled = false`). Approved items wait until all three hold.
4. Before each write the gateway re-checks: the fields are on the allow-list; the charge is
   in `expense_docs` and not marked personal; Mercury still has it, settled, for the same
   amount; the category is in Mercury's list. It never replaces a category, memo or
   attachment that is already there (that field is skipped and the reason logged). The
   receipt file must be that transaction's own object in the private `receipts` bucket.
5. Result, before/after (`diff_json`) and what to put back (`undo_json`) are stored on the
   action. At most `policies.max_mercury_writes_per_run` (20) per apply.

Mercury endpoints used (the only writes in the repo): `PATCH /api/v1/transaction/{id}` with
`note` and/or `categoryId`, and `POST /api/v1/transaction/{id}/attachments` (multipart,
`attachmentType=receipt`). `GET /api/v1/transaction/{id}` (read token) for the live check.

## Caps, vendors and suppressed addresses

The fences the payment and email action types will have to pass. Neither action type exists yet.

- `CAPS` in `policy.ts`: per purchase ($500), per calendar month ($1,500), emails per day (20),
  undo window (30 minutes). Zak's values are rows in `policies`; each has a limit in code that
  `effectiveCap` never lets a row pass. Zak changes them in an agent's Guardrails box; agents
  never write `policies`.
- `checkPurchase`: payee must be in `vendors` with a Mercury recipient; amount within the
  per-purchase cap; this month plus the amount within the monthly cap (cents, in code). A first
  payment to a vendor is flagged so it always waits for Zak.
- `checkEmail`: never to an address in `email_suppressions`, never past today's cap.
- `index.ts`: `loadCaps`, `monthSpentUsd` and `emailsSentToday` (Chicago month and day, from
  applied actions), `paidVendorIds`, and `onBreach`, where the trust levels card will demote
  the action type to Draft.
- Only a signed-in Zak adds vendors (Settings, `DASHBOARD_CONTROLS=on`).
- `npm run check:policy` exercises the checks.

Not built yet: the Notion approvals database, Act tier and promotion, circuit breakers,
an Undo button, and Edit on an approval (reject it instead).
