# Tool gateway (not built yet)

Reserved for the tech spec's gateway: every write tool call goes through here for the
policy check, tier lookup (`agent_tiers`), budget, circuit breakers, `agent_actions`
logging and undo storage, before anything touches a real system.

Until it exists, no agent gets a write integration beyond what runs today: its own
Supabase tables, Notion pages, and Gmail drafts (never send).
