# Tool gateway (not built yet)

Reserved for the tech spec's gateway: every write tool call goes through here for the
policy check, tier lookup (`agent_tiers`), budget, circuit breakers, `agent_actions`
logging and undo storage, before anything touches a real system.

Until it exists, no agent gets a write integration beyond what runs today: its own
Supabase tables, Notion pages, and Gmail drafts (never send).

First customer: the Bookkeeper stores proposed Mercury writes on `expense_docs`
(`proposal_attach`, `proposal_category_id`, `proposal_memo`, `proposal_status = 'proposed'`).
The gateway should execute only those three fields, only on an existing transaction,
only after Zak approves, and never a category Zak set himself.
