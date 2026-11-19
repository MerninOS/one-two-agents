-- OPERATOR's starting schema: every migration up to this point, squashed, with no business's rows.
-- Made by scripts/baseline.mjs from a schema-only dump; don't edit by hand. New changes go in new
-- migrations after this one.

--
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;

--
-- Name: jwt_org_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.jwt_org_id() RETURNS uuid
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $_$
  select case when (auth.jwt() ->> 'org_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then (auth.jwt() ->> 'org_id')::uuid end
$_$;

--
-- Name: ledger_run_cost(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ledger_run_cost() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if new.cost_usd > 0 or new.tokens_in > 0 or new.tokens_out > 0 then
    insert into usage_ledger (org_id, kind, at, run_id, agent_id, source, tokens_in, tokens_out, cost_usd)
    values (new.org_id, 'run', new.started_at, new.id, new.agent_id, left(coalesce(nullif(new.trigger, ''), 'unknown'), 40), new.tokens_in, new.tokens_out, new.cost_usd)
    on conflict (org_id, run_id, kind) do update
      set tokens_in = excluded.tokens_in, tokens_out = excluded.tokens_out, cost_usd = excluded.cost_usd;
  end if;
  return new;
end $$;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: agent_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id text NOT NULL,
    run_id uuid,
    tool text NOT NULL,
    action_type text NOT NULL,
    target text NOT NULL,
    args_json jsonb NOT NULL,
    diff_json jsonb,
    status text DEFAULT 'proposed'::text NOT NULL,
    reason text,
    undo_json jsonb,
    result_json jsonb,
    exec_run_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    claimed_at timestamp with time zone,
    executed_at timestamp with time zone,
    org_id uuid NOT NULL,
    CONSTRAINT agent_actions_status_check CHECK ((status = ANY (ARRAY['proposed'::text, 'approved'::text, 'executing'::text, 'applied'::text, 'partial'::text, 'failed'::text, 'rejected'::text, 'expired'::text, 'refused'::text, 'sent_back'::text])))
);

--
-- Name: agent_defs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_defs (
    agent_id text NOT NULL,
    version integer NOT NULL,
    spec jsonb NOT NULL,
    note text,
    created_by text DEFAULT 'owner'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    active boolean DEFAULT false NOT NULL,
    org_id uuid NOT NULL
);

--
-- Name: agent_memory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_memory (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id text,
    grp text NOT NULL,
    text text NOT NULL,
    source text NOT NULL,
    source_tag text,
    notion_page_id text,
    trust text DEFAULT 'note'::text NOT NULL,
    state text DEFAULT 'kept'::text NOT NULL,
    keep text DEFAULT 'always'::text NOT NULL,
    runs_left integer,
    expires_at timestamp with time zone,
    tokens integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    department_id text,
    org_id uuid NOT NULL,
    CONSTRAINT agent_memory_department_id_check CHECK (((department_id IS NULL) OR (department_id ~ '^[a-z][a-z0-9_]{1,39}$'::text))),
    CONSTRAINT agent_memory_grp_check CHECK ((grp = ANY (ARRAY['crew'::text, 'department'::text, 'standing_order'::text, 'lesson'::text, 'note'::text, 'working'::text, 'focus'::text]))),
    CONSTRAINT agent_memory_keep_check CHECK ((keep = ANY (ARRAY['next_run'::text, 'days_7'::text, 'days_30'::text, 'always'::text]))),
    CONSTRAINT agent_memory_owner_check CHECK ((((grp = 'crew'::text) AND (agent_id IS NULL) AND (department_id IS NULL)) OR ((grp = 'department'::text) AND (agent_id IS NULL) AND (department_id IS NOT NULL)) OR ((grp <> ALL (ARRAY['crew'::text, 'department'::text])) AND (agent_id IS NOT NULL) AND (department_id IS NULL)))),
    CONSTRAINT agent_memory_source_check CHECK ((source = ANY (ARRAY['owner'::text, 'approval'::text, 'agent'::text]))),
    CONSTRAINT agent_memory_state_check CHECK ((state = ANY (ARRAY['proposed'::text, 'kept'::text, 'discarded'::text, 'expired'::text, 'forgotten'::text]))),
    CONSTRAINT agent_memory_text_check CHECK (((char_length(text) >= 1) AND (char_length(text) <= 280))),
    CONSTRAINT agent_memory_trust_check CHECK ((trust = ANY (ARRAY['note'::text, 'data'::text])))
);

--
-- Name: agent_outputs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_outputs (
    run_id uuid NOT NULL,
    agent_id text NOT NULL,
    name text NOT NULL,
    summary text NOT NULL,
    numbers jsonb DEFAULT '[]'::jsonb NOT NULL,
    finished boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid NOT NULL
);

--
-- Name: agent_playbook_holds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_playbook_holds (
    agent_id text NOT NULL,
    reason text NOT NULL,
    at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid NOT NULL
);

--
-- Name: agent_playbooks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_playbooks (
    id bigint NOT NULL,
    agent_id text NOT NULL,
    version integer NOT NULL,
    steps jsonb NOT NULL,
    status text NOT NULL,
    from_run uuid,
    changes text,
    auto boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    decided_by text,
    org_id uuid NOT NULL,
    CONSTRAINT agent_playbooks_status_check CHECK ((status = ANY (ARRAY['proposed'::text, 'approved'::text, 'rejected'::text, 'replaced'::text])))
);

--
-- Name: agent_playbooks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.agent_playbooks ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.agent_playbooks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: agent_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id text NOT NULL,
    trigger text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    status text DEFAULT 'running'::text NOT NULL,
    tokens_in integer DEFAULT 0 NOT NULL,
    tokens_out integer DEFAULT 0 NOT NULL,
    cost_usd numeric(10,4) DEFAULT 0 NOT NULL,
    summary text,
    error text,
    memory_json jsonb,
    setup_version integer,
    chain_id uuid,
    chain_key text,
    chain_step integer,
    parent_run_id uuid,
    metrics jsonb,
    org_id uuid NOT NULL,
    CONSTRAINT agent_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'ok'::text, 'failed'::text, 'skipped'::text])))
);

--
-- Name: agents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agents (
    id text NOT NULL,
    name text NOT NULL,
    model text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    daily_budget_usd numeric(8,2) DEFAULT 3 NOT NULL,
    role text DEFAULT ''::text NOT NULL,
    icon text,
    hue text,
    manual_only boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    in_org boolean DEFAULT true NOT NULL,
    org_id uuid NOT NULL,
    CONSTRAINT agents_hue_check CHECK (((hue IS NULL) OR (hue ~ '^#[0-9A-Fa-f]{6}$'::text))),
    CONSTRAINT agents_icon_check CHECK (((icon IS NULL) OR (icon ~ '^[a-z0-9-]{1,40}$'::text))),
    CONSTRAINT agents_role_check CHECK ((char_length(role) <= 60))
);

--
-- Name: approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approvals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    action_id uuid NOT NULL,
    agent_id text NOT NULL,
    title text NOT NULL,
    reasoning text,
    preview jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    reject_reason text,
    decided_at timestamp with time zone,
    decided_by text,
    edit_diff jsonb,
    notion_page_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    department_id text,
    reviewer_agent_id text,
    review_status text,
    review_note text,
    review_at timestamp with time zone,
    review_due timestamp with time zone,
    org_id uuid NOT NULL,
    CONSTRAINT approvals_review_note_check CHECK (((review_note IS NULL) OR (char_length(review_note) <= 400))),
    CONSTRAINT approvals_review_pair CHECK (((reviewer_agent_id IS NULL) = (review_status IS NULL))),
    CONSTRAINT approvals_review_status_check CHECK ((review_status = ANY (ARRAY['waiting'::text, 'noted'::text, 'sent_back'::text, 'skipped'::text]))),
    CONSTRAINT approvals_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'edited'::text, 'rejected'::text, 'expired'::text, 'sent_back'::text])))
);

--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    at timestamp with time zone DEFAULT now() NOT NULL,
    actor text NOT NULL,
    action text NOT NULL,
    target text,
    detail jsonb,
    CONSTRAINT audit_log_action_check CHECK ((action ~ '^[a-z][a-z0-9_]{1,40}$'::text)),
    CONSTRAINT audit_log_actor_check CHECK (((length(actor) >= 3) AND (length(actor) <= 254))),
    CONSTRAINT audit_log_detail_check CHECK (((detail IS NULL) OR ((jsonb_typeof(detail) = 'object'::text) AND (length((detail)::text) <= 2000)))),
    CONSTRAINT audit_log_target_check CHECK (((target IS NULL) OR (length(target) <= 200)))
);

--
-- Name: avery_chat; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.avery_chat (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    role text NOT NULL,
    text text NOT NULL,
    run_id uuid,
    notes jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid NOT NULL,
    CONSTRAINT avery_chat_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'avery'::text]))),
    CONSTRAINT avery_chat_text_check CHECK ((char_length(text) <= 4000))
);

--
-- Name: chain_fires; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chain_fires (
    chain_key text NOT NULL,
    fire_at timestamp with time zone NOT NULL,
    chain_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid NOT NULL
);

--
-- Name: connector_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.connector_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_key text NOT NULL,
    name text NOT NULL,
    asks integer DEFAULT 1 NOT NULL,
    notes jsonb DEFAULT '[]'::jsonb NOT NULL,
    board_url text,
    state text DEFAULT 'open'::text NOT NULL,
    outcome text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_asked_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    org_id uuid NOT NULL,
    CONSTRAINT connector_requests_asks_check CHECK ((asks >= 1)),
    CONSTRAINT connector_requests_board_url_check CHECK (((board_url IS NULL) OR (board_url ~ '^https://'::text))),
    CONSTRAINT connector_requests_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 60))),
    CONSTRAINT connector_requests_outcome_check CHECK (((outcome IS NULL) OR (char_length(outcome) <= 200))),
    CONSTRAINT connector_requests_service_key_check CHECK ((service_key ~ '^[a-z0-9]{1,40}$'::text)),
    CONSTRAINT connector_requests_state_check CHECK ((state = ANY (ARRAY['open'::text, 'closed'::text])))
);

--
-- Name: crew_flow; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crew_flow (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    version integer NOT NULL,
    flow jsonb DEFAULT '{"chains": []}'::jsonb NOT NULL,
    note text,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    active boolean DEFAULT false NOT NULL,
    org_id uuid NOT NULL,
    CONSTRAINT crew_flow_version_check CHECK ((version >= 1))
);

--
-- Name: departments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.departments (
    id text NOT NULL,
    name text NOT NULL,
    sort integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    monthly_budget_usd numeric(8,2),
    max_emails_per_day integer,
    budget_alerted text,
    lead_checks_drafts boolean DEFAULT false NOT NULL,
    org_id uuid NOT NULL,
    CONSTRAINT departments_budget_alerted_check CHECK (((budget_alerted IS NULL) OR (budget_alerted ~ '^\d{4}-\d{2}$'::text))),
    CONSTRAINT departments_id_check CHECK ((id ~ '^[a-z][a-z0-9_]{1,39}$'::text)),
    CONSTRAINT departments_max_emails_per_day_check CHECK (((max_emails_per_day IS NULL) OR ((max_emails_per_day >= 0) AND (max_emails_per_day <= 20)))),
    CONSTRAINT departments_monthly_budget_usd_check CHECK (((monthly_budget_usd IS NULL) OR ((monthly_budget_usd >= (0)::numeric) AND (monthly_budget_usd <= (500)::numeric)))),
    CONSTRAINT departments_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 60)))
);

--
-- Name: email_suppressions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_suppressions (
    email text NOT NULL,
    reason text,
    source text DEFAULT 'owner'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid NOT NULL,
    CONSTRAINT email_suppressions_email_check CHECK ((email = lower(email)))
);

--
-- Name: expense_docs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expense_docs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mercury_txn_id text,
    qbo_expense_id text,
    account_id text,
    date date NOT NULL,
    merchant text NOT NULL,
    amount_usd numeric(12,2) NOT NULL,
    mercury_kind text,
    mercury_category text,
    category_id text,
    category text,
    business_purpose text,
    status text DEFAULT 'open'::text NOT NULL,
    status_note text,
    receipt_path text,
    source text,
    gmail_message_id text,
    receipt_json jsonb,
    matched_at timestamp with time zone,
    photo_asked_at timestamp with time zone,
    search_count smallint DEFAULT 0 NOT NULL,
    last_searched_at timestamp with time zone,
    proposal_category_id text,
    proposal_category text,
    proposal_memo text,
    proposal_attach boolean DEFAULT false NOT NULL,
    proposal_status text,
    run_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    proposal_action_id uuid,
    org_id uuid NOT NULL,
    CONSTRAINT expense_docs_proposal_status_check CHECK ((proposal_status = ANY (ARRAY['proposed'::text, 'approved'::text, 'rejected'::text, 'applied'::text]))),
    CONSTRAINT expense_docs_status_check CHECK ((status = ANY (ARRAY['open'::text, 'matched'::text, 'needs_photo'::text, 'bank_record_only'::text, 'personal'::text, 'not_needed'::text])))
);

--
-- Name: goals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.goals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    department_id text NOT NULL,
    title text NOT NULL,
    measure text,
    target numeric,
    start_value numeric,
    due_on date,
    state text DEFAULT 'active'::text NOT NULL,
    paced_from timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid NOT NULL,
    CONSTRAINT goals_measure_check CHECK (((measure IS NULL) OR (measure ~ '^[a-z][a-z0-9_]{1,40}$'::text))),
    CONSTRAINT goals_state_check CHECK ((state = ANY (ARRAY['active'::text, 'paused'::text, 'done'::text, 'dropped'::text]))),
    CONSTRAINT goals_target_check CHECK (((target IS NULL) OR ((target > (0)::numeric) AND (target <= (1000000000)::numeric)))),
    CONSTRAINT goals_title_check CHECK (((char_length(title) >= 3) AND (char_length(title) <= 120)))
);

--
-- Name: home_office; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.home_office (
    tax_year smallint NOT NULL,
    office_sqft numeric(8,1),
    home_sqft numeric(8,1),
    own_or_rent text,
    costs_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    simplified_usd numeric(12,2),
    actual_usd numeric(12,2),
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid NOT NULL,
    CONSTRAINT home_office_own_or_rent_check CHECK ((own_or_rent = ANY (ARRAY['own'::text, 'rent'::text])))
);

--
-- Name: jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    kind text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    dedupe_key text,
    run_after timestamp with time zone DEFAULT now() NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    claimed_at timestamp with time zone,
    run_id uuid,
    done_at timestamp with time zone,
    failed_at timestamp with time zone,
    outcome text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT jobs_attempts_check CHECK (((attempts >= 0) AND (attempts <= 10))),
    CONSTRAINT jobs_dedupe_key_check CHECK ((length(dedupe_key) <= 200)),
    CONSTRAINT jobs_kind_check CHECK ((kind = 'chain_step'::text)),
    CONSTRAINT jobs_outcome_check CHECK ((length(outcome) <= 1000)),
    CONSTRAINT jobs_payload_check CHECK (((jsonb_typeof(payload) = 'object'::text) AND (length((payload)::text) <= 4000)))
);

--
-- Name: mcp_connection_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mcp_connection_events (
    id bigint NOT NULL,
    connection_id text NOT NULL,
    event text NOT NULL,
    detail text,
    at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid NOT NULL,
    CONSTRAINT mcp_connection_events_connection_id_check CHECK ((connection_id ~ '^[a-z][a-z0-9_]{1,30}$'::text)),
    CONSTRAINT mcp_connection_events_detail_check CHECK ((char_length(detail) <= 300)),
    CONSTRAINT mcp_connection_events_event_check CHECK ((event = ANY (ARRAY['connected'::text, 'refreshed'::text, 'refresh_failed'::text, 'refused'::text, 'revoked'::text, 'revoke_failed'::text, 'disconnected'::text, 'resealed'::text, 'tools_changed'::text, 'tools_checked'::text, 'added'::text, 'tool_on'::text, 'tool_off'::text, 'paused'::text, 'resumed'::text, 'tools_accepted'::text])))
);

--
-- Name: mcp_connection_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.mcp_connection_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.mcp_connection_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: mcp_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mcp_connections (
    id text NOT NULL,
    secret text,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    connected_at timestamp with time zone,
    last_error text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    paused_at timestamp with time zone,
    tools_seen jsonb,
    tools_checked_at timestamp with time zone,
    org_id uuid NOT NULL,
    CONSTRAINT mcp_connections_id_check CHECK ((id ~ '^[a-z][a-z0-9_]{1,30}$'::text))
);

--
-- Name: mcp_custom_servers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mcp_custom_servers (
    id text NOT NULL,
    name text NOT NULL,
    url text NOT NULL,
    auth text NOT NULL,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    scopes_offered text[] DEFAULT '{}'::text[] NOT NULL,
    tools jsonb DEFAULT '[]'::jsonb NOT NULL,
    tools_on jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid NOT NULL,
    CONSTRAINT mcp_custom_servers_auth_check CHECK ((auth = ANY (ARRAY['oauth'::text, 'key'::text]))),
    CONSTRAINT mcp_custom_servers_id_check CHECK ((id ~ '^c_[a-z0-9]{8}$'::text)),
    CONSTRAINT mcp_custom_servers_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 60))),
    CONSTRAINT mcp_custom_servers_url_check CHECK (((url ~ '^https://'::text) AND (char_length(url) <= 300)))
);

--
-- Name: members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    email text NOT NULL,
    user_id uuid,
    role text NOT NULL,
    added_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_sign_in_at timestamp with time zone,
    CONSTRAINT members_email_check CHECK (((email = lower(email)) AND (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'::text) AND (length(email) <= 254))),
    CONSTRAINT members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'approver'::text, 'viewer'::text])))
);

--
-- Name: memory_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memory_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    memory_id uuid,
    agent_id text,
    kind text NOT NULL,
    before text,
    after text,
    by text NOT NULL,
    at timestamp with time zone DEFAULT now() NOT NULL,
    department_id text,
    org_id uuid NOT NULL,
    CONSTRAINT memory_events_kind_check CHECK ((kind = ANY (ARRAY['proposed'::text, 'kept'::text, 'edited'::text, 'discarded'::text, 'forgotten'::text, 'expired'::text, 'rewritten'::text, 'added'::text])))
);

--
-- Name: org_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    key_id text NOT NULL,
    wrapped text NOT NULL,
    wrap_key_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT org_keys_key_id_check CHECK (((length(key_id) >= 4) AND (length(key_id) <= 40))),
    CONSTRAINT org_keys_wrap_key_id_check CHECK ((length(wrap_key_id) <= 100)),
    CONSTRAINT org_keys_wrapped_check CHECK (((wrapped ~~ 'v3.%'::text) AND (length(wrapped) <= 1000)))
);

--
-- Name: orgs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orgs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    about text,
    owner_name text,
    CONSTRAINT orgs_about_check CHECK (((about IS NULL) OR ((length(about) >= 1) AND (length(about) <= 300)))),
    CONSTRAINT orgs_name_check CHECK (((length(name) >= 1) AND (length(name) <= 120))),
    CONSTRAINT orgs_owner_name_check CHECK (((owner_name IS NULL) OR ((length(owner_name) >= 1) AND (length(owner_name) <= 80)))),
    CONSTRAINT orgs_slug_check CHECK ((slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'::text))
);

--
-- Name: plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    department_id text NOT NULL,
    head_agent text,
    week_of date NOT NULL,
    summary text,
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    run_id uuid,
    review text,
    review_run_id uuid,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid NOT NULL,
    CONSTRAINT plans_review_check CHECK (((review IS NULL) OR (char_length(review) <= 2000))),
    CONSTRAINT plans_summary_check CHECK (((summary IS NULL) OR (char_length(summary) <= 2000)))
);

--
-- Name: policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.policies (
    key text NOT NULL,
    value_json jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid NOT NULL
);

--
-- Name: policy_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.policy_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    old_value jsonb,
    new_value jsonb NOT NULL,
    changed_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid NOT NULL
);

--
-- Name: proposals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.proposals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    source text NOT NULL,
    from_agent text,
    department_id text,
    run_id uuid,
    payload jsonb NOT NULL,
    why text NOT NULL,
    state text DEFAULT 'pending'::text NOT NULL,
    outcome text,
    result_ref text,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid NOT NULL,
    CONSTRAINT proposals_kind_check CHECK ((kind = ANY (ARRAY['hire'::text, 'grant_tool'::text, 'new_tool'::text, 'retire'::text]))),
    CONSTRAINT proposals_source_check CHECK ((source = ANY (ARRAY['agent'::text, 'claude'::text, 'owner'::text]))),
    CONSTRAINT proposals_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'built'::text, 'failed'::text]))),
    CONSTRAINT proposals_title_check CHECK (((char_length(title) >= 3) AND (char_length(title) <= 160))),
    CONSTRAINT proposals_why_check CHECK (((char_length(why) >= 10) AND (char_length(why) <= 600)))
);

--
-- Name: reactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id text NOT NULL,
    run_id uuid,
    approval_id uuid,
    item_id uuid,
    item_label text,
    verdict text NOT NULL,
    text text,
    memory_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid NOT NULL,
    CONSTRAINT reactions_check CHECK (((run_id IS NOT NULL) OR (approval_id IS NOT NULL))),
    CONSTRAINT reactions_item_label_check CHECK (((item_label IS NULL) OR (char_length(item_label) <= 120))),
    CONSTRAINT reactions_text_check CHECK (((text IS NULL) OR (char_length(text) <= 280))),
    CONSTRAINT reactions_verdict_check CHECK ((verdict = ANY (ARRAY['good'::text, 'not'::text])))
);

--
-- Name: run_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.run_steps (
    id bigint NOT NULL,
    run_id uuid NOT NULL,
    idx integer NOT NULL,
    kind text NOT NULL,
    tool text,
    input jsonb,
    output text,
    ok boolean DEFAULT true NOT NULL,
    numbers jsonb,
    tokens_in integer DEFAULT 0 NOT NULL,
    tokens_out integer DEFAULT 0 NOT NULL,
    cost_usd numeric(10,4) DEFAULT 0 NOT NULL,
    ms integer DEFAULT 0 NOT NULL,
    at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid NOT NULL,
    CONSTRAINT run_steps_kind_check CHECK ((kind = ANY (ARRAY['model'::text, 'tool'::text, 'stop'::text])))
);

--
-- Name: run_steps_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.run_steps ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.run_steps_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: seats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seats (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    department_id text,
    parent_id uuid,
    title text NOT NULL,
    sub text DEFAULT ''::text NOT NULL,
    holder text DEFAULT 'open'::text NOT NULL,
    agent_id text,
    sort integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid NOT NULL,
    CONSTRAINT seats_agent_id_check CHECK (((agent_id IS NULL) OR (agent_id ~ '^[a-z][a-z0-9_]{1,62}$'::text))),
    CONSTRAINT seats_check CHECK (((holder = 'agent'::text) = (agent_id IS NOT NULL))),
    CONSTRAINT seats_check1 CHECK (((parent_id IS NULL) OR (parent_id <> id))),
    CONSTRAINT seats_check2 CHECK (((department_id IS NOT NULL) OR (parent_id IS NULL))),
    CONSTRAINT seats_holder_check CHECK ((holder = ANY (ARRAY['open'::text, 'owner'::text, 'agent'::text]))),
    CONSTRAINT seats_sub_check CHECK ((char_length(sub) <= 120)),
    CONSTRAINT seats_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 60)))
);

--
-- Name: status_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.status_alerts (
    org_id uuid NOT NULL,
    key text NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT status_alerts_key_check CHECK ((key ~ '^[a-z][a-z0-9_]{1,30}(:[a-z0-9_]{1,40})?$'::text))
);

--
-- Name: tax_packets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tax_packets (
    tax_year smallint NOT NULL,
    built_at timestamp with time zone,
    receipt_coverage_pct numeric(5,2),
    total_miles numeric(10,1),
    mileage_usd numeric(12,2),
    files_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    org_id uuid NOT NULL
);

--
-- Name: trips; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trips (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    date date NOT NULL,
    from_place text NOT NULL,
    to_place text NOT NULL,
    miles numeric(8,1) NOT NULL,
    purpose text NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    linked_txn_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid NOT NULL,
    CONSTRAINT trips_miles_check CHECK ((miles > (0)::numeric))
);

--
-- Name: usage_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usage_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    kind text NOT NULL,
    at timestamp with time zone NOT NULL,
    run_id uuid,
    agent_id text NOT NULL,
    source text NOT NULL,
    tokens_in integer DEFAULT 0 NOT NULL,
    tokens_out integer DEFAULT 0 NOT NULL,
    cost_usd numeric(10,4) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT usage_ledger_cost_usd_check CHECK ((cost_usd >= (0)::numeric)),
    CONSTRAINT usage_ledger_kind_check CHECK ((kind = ANY (ARRAY['run'::text, 'model_call'::text, 'tool_call'::text]))),
    CONSTRAINT usage_ledger_source_check CHECK (((length(source) >= 1) AND (length(source) <= 40))),
    CONSTRAINT usage_ledger_tokens_in_check CHECK ((tokens_in >= 0)),
    CONSTRAINT usage_ledger_tokens_out_check CHECK ((tokens_out >= 0))
);

--
-- Name: vendors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    kind text DEFAULT 'other'::text NOT NULL,
    mercury_recipient_id text,
    contact_email text,
    added_by text NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid NOT NULL,
    CONSTRAINT vendors_kind_check CHECK ((kind = ANY (ARRAY['importer'::text, 'packaging'::text, 'other'::text]))),
    CONSTRAINT vendors_name_check CHECK (((length(TRIM(BOTH FROM name)) >= 1) AND (length(TRIM(BOTH FROM name)) <= 120)))
);

--
-- Name: wholesale_leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wholesale_leads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business text NOT NULL,
    city text,
    type text,
    website text,
    domain text,
    contact_name text,
    email text,
    contact_route text,
    sources jsonb DEFAULT '[]'::jsonb NOT NULL,
    fit_score smallint,
    fit_reason text,
    stage text DEFAULT 'new'::text NOT NULL,
    draft_subject text,
    draft_body text,
    gmail_draft_id text,
    run_id uuid,
    last_touch_at timestamp with time zone,
    next_touch_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid NOT NULL,
    CONSTRAINT wholesale_leads_fit_score_check CHECK (((fit_score >= 1) AND (fit_score <= 5))),
    CONSTRAINT wholesale_leads_stage_check CHECK ((stage = ANY (ARRAY['new'::text, 'drafted'::text, 'contacted'::text, 'replied'::text, 'tasting'::text, 'won'::text, 'lost'::text, 'skip'::text])))
);

--
-- Name: agent_actions agent_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_actions
    ADD CONSTRAINT agent_actions_pkey PRIMARY KEY (id);

--
-- Name: agent_defs agent_defs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_defs
    ADD CONSTRAINT agent_defs_pkey PRIMARY KEY (org_id, agent_id, version);

--
-- Name: agent_memory agent_memory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_memory
    ADD CONSTRAINT agent_memory_pkey PRIMARY KEY (id);

--
-- Name: agent_outputs agent_outputs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_outputs
    ADD CONSTRAINT agent_outputs_pkey PRIMARY KEY (run_id);

--
-- Name: agent_playbook_holds agent_playbook_holds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_playbook_holds
    ADD CONSTRAINT agent_playbook_holds_pkey PRIMARY KEY (org_id, agent_id);

--
-- Name: agent_playbooks agent_playbooks_org_id_agent_id_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_playbooks
    ADD CONSTRAINT agent_playbooks_org_id_agent_id_version_key UNIQUE (org_id, agent_id, version);

--
-- Name: agent_playbooks agent_playbooks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_playbooks
    ADD CONSTRAINT agent_playbooks_pkey PRIMARY KEY (id);

--
-- Name: agent_runs agent_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_pkey PRIMARY KEY (id);

--
-- Name: agents agents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_pkey PRIMARY KEY (org_id, id);

--
-- Name: approvals approvals_action_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approvals
    ADD CONSTRAINT approvals_action_id_key UNIQUE (action_id);

--
-- Name: approvals approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approvals
    ADD CONSTRAINT approvals_pkey PRIMARY KEY (id);

--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);

--
-- Name: avery_chat avery_chat_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.avery_chat
    ADD CONSTRAINT avery_chat_pkey PRIMARY KEY (id);

--
-- Name: chain_fires chain_fires_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chain_fires
    ADD CONSTRAINT chain_fires_pkey PRIMARY KEY (org_id, chain_key, fire_at);

--
-- Name: connector_requests connector_requests_org_id_service_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connector_requests
    ADD CONSTRAINT connector_requests_org_id_service_key_key UNIQUE (org_id, service_key);

--
-- Name: connector_requests connector_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connector_requests
    ADD CONSTRAINT connector_requests_pkey PRIMARY KEY (id);

--
-- Name: crew_flow crew_flow_org_id_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crew_flow
    ADD CONSTRAINT crew_flow_org_id_version_key UNIQUE (org_id, version);

--
-- Name: crew_flow crew_flow_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crew_flow
    ADD CONSTRAINT crew_flow_pkey PRIMARY KEY (id);

--
-- Name: departments departments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_pkey PRIMARY KEY (org_id, id);

--
-- Name: email_suppressions email_suppressions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_suppressions
    ADD CONSTRAINT email_suppressions_pkey PRIMARY KEY (org_id, email);

--
-- Name: expense_docs expense_docs_org_id_mercury_txn_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_docs
    ADD CONSTRAINT expense_docs_org_id_mercury_txn_id_key UNIQUE (org_id, mercury_txn_id);

--
-- Name: expense_docs expense_docs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_docs
    ADD CONSTRAINT expense_docs_pkey PRIMARY KEY (id);

--
-- Name: goals goals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goals
    ADD CONSTRAINT goals_pkey PRIMARY KEY (id);

--
-- Name: home_office home_office_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.home_office
    ADD CONSTRAINT home_office_pkey PRIMARY KEY (org_id, tax_year);

--
-- Name: jobs jobs_org_id_dedupe_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_org_id_dedupe_key_key UNIQUE (org_id, dedupe_key);

--
-- Name: jobs jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);

--
-- Name: mcp_connection_events mcp_connection_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_connection_events
    ADD CONSTRAINT mcp_connection_events_pkey PRIMARY KEY (id);

--
-- Name: mcp_connections mcp_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_connections
    ADD CONSTRAINT mcp_connections_pkey PRIMARY KEY (org_id, id);

--
-- Name: mcp_custom_servers mcp_custom_servers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_custom_servers
    ADD CONSTRAINT mcp_custom_servers_pkey PRIMARY KEY (org_id, id);

--
-- Name: members members_org_id_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_org_id_email_key UNIQUE (org_id, email);

--
-- Name: members members_org_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_org_id_user_id_key UNIQUE (org_id, user_id);

--
-- Name: members members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_pkey PRIMARY KEY (id);

--
-- Name: memory_events memory_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_events
    ADD CONSTRAINT memory_events_pkey PRIMARY KEY (id);

--
-- Name: org_keys org_keys_org_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_keys
    ADD CONSTRAINT org_keys_org_id_key UNIQUE (org_id);

--
-- Name: org_keys org_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_keys
    ADD CONSTRAINT org_keys_pkey PRIMARY KEY (id);

--
-- Name: orgs orgs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orgs
    ADD CONSTRAINT orgs_pkey PRIMARY KEY (id);

--
-- Name: orgs orgs_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orgs
    ADD CONSTRAINT orgs_slug_key UNIQUE (slug);

--
-- Name: plans plans_org_id_department_id_week_of_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_org_id_department_id_week_of_key UNIQUE (org_id, department_id, week_of);

--
-- Name: plans plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_pkey PRIMARY KEY (id);

--
-- Name: policies policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policies
    ADD CONSTRAINT policies_pkey PRIMARY KEY (org_id, key);

--
-- Name: policy_log policy_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policy_log
    ADD CONSTRAINT policy_log_pkey PRIMARY KEY (id);

--
-- Name: proposals proposals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proposals
    ADD CONSTRAINT proposals_pkey PRIMARY KEY (id);

--
-- Name: reactions reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reactions
    ADD CONSTRAINT reactions_pkey PRIMARY KEY (id);

--
-- Name: run_steps run_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.run_steps
    ADD CONSTRAINT run_steps_pkey PRIMARY KEY (id);

--
-- Name: run_steps run_steps_run_id_idx_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.run_steps
    ADD CONSTRAINT run_steps_run_id_idx_key UNIQUE (run_id, idx);

--
-- Name: seats seats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seats
    ADD CONSTRAINT seats_pkey PRIMARY KEY (id);

--
-- Name: status_alerts status_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.status_alerts
    ADD CONSTRAINT status_alerts_pkey PRIMARY KEY (org_id, key);

--
-- Name: tax_packets tax_packets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_packets
    ADD CONSTRAINT tax_packets_pkey PRIMARY KEY (org_id, tax_year);

--
-- Name: trips trips_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trips
    ADD CONSTRAINT trips_pkey PRIMARY KEY (id);

--
-- Name: usage_ledger usage_ledger_org_id_run_id_kind_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_ledger
    ADD CONSTRAINT usage_ledger_org_id_run_id_kind_key UNIQUE (org_id, run_id, kind);

--
-- Name: usage_ledger usage_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_ledger
    ADD CONSTRAINT usage_ledger_pkey PRIMARY KEY (id);

--
-- Name: vendors vendors_org_id_mercury_recipient_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_org_id_mercury_recipient_id_key UNIQUE (org_id, mercury_recipient_id);

--
-- Name: vendors vendors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_pkey PRIMARY KEY (id);

--
-- Name: wholesale_leads wholesale_leads_org_id_domain_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wholesale_leads
    ADD CONSTRAINT wholesale_leads_org_id_domain_key UNIQUE (org_id, domain);

--
-- Name: wholesale_leads wholesale_leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wholesale_leads
    ADD CONSTRAINT wholesale_leads_pkey PRIMARY KEY (id);

--
-- Name: agent_actions_one_open; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX agent_actions_one_open ON public.agent_actions USING btree (org_id, tool, target) WHERE (status = ANY (ARRAY['proposed'::text, 'approved'::text, 'executing'::text]));

--
-- Name: agent_actions_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_actions_org_id_idx ON public.agent_actions USING btree (org_id);

--
-- Name: agent_actions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_actions_status ON public.agent_actions USING btree (status, created_at DESC);

--
-- Name: agent_actions_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_actions_target ON public.agent_actions USING btree (target, created_at DESC);

--
-- Name: agent_defs_one_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX agent_defs_one_active ON public.agent_defs USING btree (org_id, agent_id) WHERE active;

--
-- Name: agent_defs_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_defs_org_id_idx ON public.agent_defs USING btree (org_id);

--
-- Name: agent_memory_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_memory_agent ON public.agent_memory USING btree (agent_id, state, grp);

--
-- Name: agent_memory_department; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_memory_department ON public.agent_memory USING btree (department_id, state) WHERE (department_id IS NOT NULL);

--
-- Name: agent_memory_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_memory_org_id_idx ON public.agent_memory USING btree (org_id);

--
-- Name: agent_outputs_latest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_outputs_latest ON public.agent_outputs USING btree (agent_id, created_at DESC);

--
-- Name: agent_outputs_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_outputs_org_id_idx ON public.agent_outputs USING btree (org_id);

--
-- Name: agent_playbook_holds_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_playbook_holds_org_id_idx ON public.agent_playbook_holds USING btree (org_id);

--
-- Name: agent_playbooks_one_approved; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX agent_playbooks_one_approved ON public.agent_playbooks USING btree (org_id, agent_id) WHERE (status = 'approved'::text);

--
-- Name: agent_playbooks_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_playbooks_org_id_idx ON public.agent_playbooks USING btree (org_id);

--
-- Name: agent_runs_agent_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_runs_agent_started ON public.agent_runs USING btree (agent_id, started_at DESC);

--
-- Name: agent_runs_chain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_runs_chain ON public.agent_runs USING btree (chain_id) WHERE (chain_id IS NOT NULL);

--
-- Name: agent_runs_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_runs_org_id_idx ON public.agent_runs USING btree (org_id);

--
-- Name: agents_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agents_org_id_idx ON public.agents USING btree (org_id);

--
-- Name: approvals_department; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX approvals_department ON public.approvals USING btree (department_id, created_at DESC);

--
-- Name: approvals_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX approvals_org_id_idx ON public.approvals USING btree (org_id);

--
-- Name: approvals_review; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX approvals_review ON public.approvals USING btree (reviewer_agent_id, review_status) WHERE (review_status = 'waiting'::text);

--
-- Name: approvals_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX approvals_status ON public.approvals USING btree (status, created_at DESC);

--
-- Name: audit_log_org_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_org_at ON public.audit_log USING btree (org_id, at DESC);

--
-- Name: avery_chat_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX avery_chat_at ON public.avery_chat USING btree (created_at DESC);

--
-- Name: avery_chat_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX avery_chat_org_id_idx ON public.avery_chat USING btree (org_id);

--
-- Name: chain_fires_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chain_fires_org_id_idx ON public.chain_fires USING btree (org_id);

--
-- Name: connector_requests_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX connector_requests_org_id_idx ON public.connector_requests USING btree (org_id);

--
-- Name: crew_flow_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crew_flow_active ON public.crew_flow USING btree (org_id) WHERE active;

--
-- Name: crew_flow_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crew_flow_org_id_idx ON public.crew_flow USING btree (org_id);

--
-- Name: departments_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX departments_org_id_idx ON public.departments USING btree (org_id);

--
-- Name: email_suppressions_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_suppressions_org_id_idx ON public.email_suppressions USING btree (org_id);

--
-- Name: expense_docs_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX expense_docs_date ON public.expense_docs USING btree (date DESC);

--
-- Name: expense_docs_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX expense_docs_org_id_idx ON public.expense_docs USING btree (org_id);

--
-- Name: expense_docs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX expense_docs_status ON public.expense_docs USING btree (status, date DESC);

--
-- Name: goals_department; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX goals_department ON public.goals USING btree (department_id, state, created_at);

--
-- Name: goals_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX goals_org_id_idx ON public.goals USING btree (org_id);

--
-- Name: home_office_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX home_office_org_id_idx ON public.home_office USING btree (org_id);

--
-- Name: jobs_claimed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jobs_claimed ON public.jobs USING btree (org_id, claimed_at) WHERE ((claimed_at IS NOT NULL) AND (done_at IS NULL) AND (failed_at IS NULL));

--
-- Name: jobs_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jobs_org_id_idx ON public.jobs USING btree (org_id);

--
-- Name: jobs_waiting; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jobs_waiting ON public.jobs USING btree (org_id, run_after) WHERE ((claimed_at IS NULL) AND (done_at IS NULL) AND (failed_at IS NULL));

--
-- Name: mcp_connection_events_by_connection; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mcp_connection_events_by_connection ON public.mcp_connection_events USING btree (connection_id, at DESC);

--
-- Name: mcp_connection_events_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mcp_connection_events_org_id_idx ON public.mcp_connection_events USING btree (org_id);

--
-- Name: mcp_connections_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mcp_connections_org_id_idx ON public.mcp_connections USING btree (org_id);

--
-- Name: mcp_custom_servers_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mcp_custom_servers_org_id_idx ON public.mcp_custom_servers USING btree (org_id);

--
-- Name: members_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX members_org_id_idx ON public.members USING btree (org_id);

--
-- Name: memory_events_agent_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX memory_events_agent_at ON public.memory_events USING btree (agent_id, at DESC);

--
-- Name: memory_events_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX memory_events_org_id_idx ON public.memory_events USING btree (org_id);

--
-- Name: plans_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX plans_org_id_idx ON public.plans USING btree (org_id);

--
-- Name: plans_week; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX plans_week ON public.plans USING btree (week_of DESC);

--
-- Name: policies_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX policies_org_id_idx ON public.policies USING btree (org_id);

--
-- Name: policy_log_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX policy_log_org_id_idx ON public.policy_log USING btree (org_id);

--
-- Name: proposals_from; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX proposals_from ON public.proposals USING btree (from_agent, state);

--
-- Name: proposals_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX proposals_org_id_idx ON public.proposals USING btree (org_id);

--
-- Name: proposals_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX proposals_state ON public.proposals USING btree (state, created_at DESC);

--
-- Name: reactions_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reactions_agent ON public.reactions USING btree (agent_id, created_at DESC);

--
-- Name: reactions_one_per_target; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reactions_one_per_target ON public.reactions USING btree (COALESCE(run_id, approval_id), COALESCE(item_id, '00000000-0000-0000-0000-000000000000'::uuid));

--
-- Name: reactions_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reactions_org_id_idx ON public.reactions USING btree (org_id);

--
-- Name: run_steps_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX run_steps_org_id_idx ON public.run_steps USING btree (org_id);

--
-- Name: run_steps_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX run_steps_run ON public.run_steps USING btree (run_id, idx);

--
-- Name: seats_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX seats_agent ON public.seats USING btree (org_id, agent_id) WHERE (agent_id IS NOT NULL);

--
-- Name: seats_company; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX seats_company ON public.seats USING btree (org_id) WHERE (department_id IS NULL);

--
-- Name: seats_head; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX seats_head ON public.seats USING btree (org_id, department_id) WHERE ((parent_id IS NULL) AND (department_id IS NOT NULL));

--
-- Name: seats_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX seats_org_id_idx ON public.seats USING btree (org_id);

--
-- Name: seats_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX seats_parent ON public.seats USING btree (parent_id);

--
-- Name: tax_packets_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tax_packets_org_id_idx ON public.tax_packets USING btree (org_id);

--
-- Name: trips_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trips_date ON public.trips USING btree (date DESC);

--
-- Name: trips_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trips_org_id_idx ON public.trips USING btree (org_id);

--
-- Name: usage_ledger_org_agent_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX usage_ledger_org_agent_at ON public.usage_ledger USING btree (org_id, agent_id, at);

--
-- Name: usage_ledger_org_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX usage_ledger_org_at ON public.usage_ledger USING btree (org_id, at);

--
-- Name: vendors_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vendors_org_id_idx ON public.vendors USING btree (org_id);

--
-- Name: wholesale_leads_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wholesale_leads_org_id_idx ON public.wholesale_leads USING btree (org_id);

--
-- Name: wholesale_leads_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wholesale_leads_stage ON public.wholesale_leads USING btree (stage, created_at DESC);

--
-- Name: agent_runs agent_runs_ledger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER agent_runs_ledger AFTER INSERT OR UPDATE OF cost_usd, tokens_in, tokens_out ON public.agent_runs FOR EACH ROW EXECUTE FUNCTION public.ledger_run_cost();

--
-- Name: agent_actions agent_actions_exec_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_actions
    ADD CONSTRAINT agent_actions_exec_run_id_fkey FOREIGN KEY (exec_run_id) REFERENCES public.agent_runs(id);

--
-- Name: agent_actions agent_actions_org_id_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_actions
    ADD CONSTRAINT agent_actions_org_id_agent_id_fkey FOREIGN KEY (org_id, agent_id) REFERENCES public.agents(org_id, id);

--
-- Name: agent_actions agent_actions_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_actions
    ADD CONSTRAINT agent_actions_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: agent_actions agent_actions_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_actions
    ADD CONSTRAINT agent_actions_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.agent_runs(id);

--
-- Name: agent_defs agent_defs_org_id_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_defs
    ADD CONSTRAINT agent_defs_org_id_agent_id_fkey FOREIGN KEY (org_id, agent_id) REFERENCES public.agents(org_id, id);

--
-- Name: agent_defs agent_defs_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_defs
    ADD CONSTRAINT agent_defs_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: agent_memory agent_memory_org_id_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_memory
    ADD CONSTRAINT agent_memory_org_id_agent_id_fkey FOREIGN KEY (org_id, agent_id) REFERENCES public.agents(org_id, id);

--
-- Name: agent_memory agent_memory_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_memory
    ADD CONSTRAINT agent_memory_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: agent_outputs agent_outputs_org_id_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_outputs
    ADD CONSTRAINT agent_outputs_org_id_agent_id_fkey FOREIGN KEY (org_id, agent_id) REFERENCES public.agents(org_id, id);

--
-- Name: agent_outputs agent_outputs_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_outputs
    ADD CONSTRAINT agent_outputs_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: agent_outputs agent_outputs_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_outputs
    ADD CONSTRAINT agent_outputs_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.agent_runs(id) ON DELETE CASCADE;

--
-- Name: agent_playbook_holds agent_playbook_holds_org_id_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_playbook_holds
    ADD CONSTRAINT agent_playbook_holds_org_id_agent_id_fkey FOREIGN KEY (org_id, agent_id) REFERENCES public.agents(org_id, id);

--
-- Name: agent_playbook_holds agent_playbook_holds_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_playbook_holds
    ADD CONSTRAINT agent_playbook_holds_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: agent_playbooks agent_playbooks_from_run_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_playbooks
    ADD CONSTRAINT agent_playbooks_from_run_fkey FOREIGN KEY (from_run) REFERENCES public.agent_runs(id) ON DELETE SET NULL;

--
-- Name: agent_playbooks agent_playbooks_org_id_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_playbooks
    ADD CONSTRAINT agent_playbooks_org_id_agent_id_fkey FOREIGN KEY (org_id, agent_id) REFERENCES public.agents(org_id, id);

--
-- Name: agent_playbooks agent_playbooks_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_playbooks
    ADD CONSTRAINT agent_playbooks_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: agent_runs agent_runs_org_id_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_org_id_agent_id_fkey FOREIGN KEY (org_id, agent_id) REFERENCES public.agents(org_id, id);

--
-- Name: agent_runs agent_runs_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: agents agents_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: approvals approvals_action_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approvals
    ADD CONSTRAINT approvals_action_id_fkey FOREIGN KEY (action_id) REFERENCES public.agent_actions(id);

--
-- Name: approvals approvals_org_id_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approvals
    ADD CONSTRAINT approvals_org_id_agent_id_fkey FOREIGN KEY (org_id, agent_id) REFERENCES public.agents(org_id, id);

--
-- Name: approvals approvals_org_id_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approvals
    ADD CONSTRAINT approvals_org_id_department_id_fkey FOREIGN KEY (org_id, department_id) REFERENCES public.departments(org_id, id) ON DELETE SET NULL (department_id);

--
-- Name: approvals approvals_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approvals
    ADD CONSTRAINT approvals_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: approvals approvals_org_id_reviewer_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approvals
    ADD CONSTRAINT approvals_org_id_reviewer_agent_id_fkey FOREIGN KEY (org_id, reviewer_agent_id) REFERENCES public.agents(org_id, id);

--
-- Name: audit_log audit_log_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: avery_chat avery_chat_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.avery_chat
    ADD CONSTRAINT avery_chat_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: avery_chat avery_chat_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.avery_chat
    ADD CONSTRAINT avery_chat_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.agent_runs(id) ON DELETE SET NULL;

--
-- Name: chain_fires chain_fires_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chain_fires
    ADD CONSTRAINT chain_fires_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: connector_requests connector_requests_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connector_requests
    ADD CONSTRAINT connector_requests_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: crew_flow crew_flow_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crew_flow
    ADD CONSTRAINT crew_flow_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: departments departments_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: email_suppressions email_suppressions_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_suppressions
    ADD CONSTRAINT email_suppressions_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: expense_docs expense_docs_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_docs
    ADD CONSTRAINT expense_docs_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: expense_docs expense_docs_proposal_action_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_docs
    ADD CONSTRAINT expense_docs_proposal_action_id_fkey FOREIGN KEY (proposal_action_id) REFERENCES public.agent_actions(id);

--
-- Name: expense_docs expense_docs_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_docs
    ADD CONSTRAINT expense_docs_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.agent_runs(id);

--
-- Name: goals goals_org_id_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goals
    ADD CONSTRAINT goals_org_id_department_id_fkey FOREIGN KEY (org_id, department_id) REFERENCES public.departments(org_id, id) ON DELETE CASCADE;

--
-- Name: goals goals_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goals
    ADD CONSTRAINT goals_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: home_office home_office_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.home_office
    ADD CONSTRAINT home_office_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: jobs jobs_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: mcp_connection_events mcp_connection_events_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_connection_events
    ADD CONSTRAINT mcp_connection_events_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: mcp_connections mcp_connections_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_connections
    ADD CONSTRAINT mcp_connections_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: mcp_custom_servers mcp_custom_servers_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_custom_servers
    ADD CONSTRAINT mcp_custom_servers_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: members members_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: memory_events memory_events_memory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_events
    ADD CONSTRAINT memory_events_memory_id_fkey FOREIGN KEY (memory_id) REFERENCES public.agent_memory(id);

--
-- Name: memory_events memory_events_org_id_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_events
    ADD CONSTRAINT memory_events_org_id_agent_id_fkey FOREIGN KEY (org_id, agent_id) REFERENCES public.agents(org_id, id);

--
-- Name: memory_events memory_events_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_events
    ADD CONSTRAINT memory_events_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: org_keys org_keys_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_keys
    ADD CONSTRAINT org_keys_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: plans plans_org_id_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_org_id_department_id_fkey FOREIGN KEY (org_id, department_id) REFERENCES public.departments(org_id, id) ON DELETE CASCADE;

--
-- Name: plans plans_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: plans plans_org_id_head_agent_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_org_id_head_agent_fkey FOREIGN KEY (org_id, head_agent) REFERENCES public.agents(org_id, id) ON DELETE SET NULL (head_agent);

--
-- Name: policies policies_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policies
    ADD CONSTRAINT policies_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: policy_log policy_log_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policy_log
    ADD CONSTRAINT policy_log_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: proposals proposals_org_id_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proposals
    ADD CONSTRAINT proposals_org_id_department_id_fkey FOREIGN KEY (org_id, department_id) REFERENCES public.departments(org_id, id) ON DELETE SET NULL (department_id);

--
-- Name: proposals proposals_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proposals
    ADD CONSTRAINT proposals_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: proposals proposals_org_id_from_agent_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proposals
    ADD CONSTRAINT proposals_org_id_from_agent_fkey FOREIGN KEY (org_id, from_agent) REFERENCES public.agents(org_id, id) ON DELETE SET NULL (from_agent);

--
-- Name: reactions reactions_approval_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reactions
    ADD CONSTRAINT reactions_approval_id_fkey FOREIGN KEY (approval_id) REFERENCES public.approvals(id);

--
-- Name: reactions reactions_memory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reactions
    ADD CONSTRAINT reactions_memory_id_fkey FOREIGN KEY (memory_id) REFERENCES public.agent_memory(id);

--
-- Name: reactions reactions_org_id_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reactions
    ADD CONSTRAINT reactions_org_id_agent_id_fkey FOREIGN KEY (org_id, agent_id) REFERENCES public.agents(org_id, id);

--
-- Name: reactions reactions_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reactions
    ADD CONSTRAINT reactions_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: reactions reactions_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reactions
    ADD CONSTRAINT reactions_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.agent_runs(id);

--
-- Name: run_steps run_steps_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.run_steps
    ADD CONSTRAINT run_steps_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: run_steps run_steps_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.run_steps
    ADD CONSTRAINT run_steps_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.agent_runs(id) ON DELETE CASCADE;

--
-- Name: seats seats_org_id_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seats
    ADD CONSTRAINT seats_org_id_department_id_fkey FOREIGN KEY (org_id, department_id) REFERENCES public.departments(org_id, id) ON DELETE RESTRICT;

--
-- Name: seats seats_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seats
    ADD CONSTRAINT seats_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: seats seats_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seats
    ADD CONSTRAINT seats_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.seats(id) ON DELETE RESTRICT;

--
-- Name: status_alerts status_alerts_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.status_alerts
    ADD CONSTRAINT status_alerts_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: tax_packets tax_packets_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_packets
    ADD CONSTRAINT tax_packets_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: trips trips_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trips
    ADD CONSTRAINT trips_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: usage_ledger usage_ledger_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_ledger
    ADD CONSTRAINT usage_ledger_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: usage_ledger usage_ledger_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_ledger
    ADD CONSTRAINT usage_ledger_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.agent_runs(id) ON DELETE SET NULL;

--
-- Name: vendors vendors_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: wholesale_leads wholesale_leads_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wholesale_leads
    ADD CONSTRAINT wholesale_leads_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);

--
-- Name: wholesale_leads wholesale_leads_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wholesale_leads
    ADD CONSTRAINT wholesale_leads_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.agent_runs(id);

--
-- Name: agent_actions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_actions ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_defs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_defs ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_memory; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_memory ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_outputs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_outputs ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_playbook_holds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_playbook_holds ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_playbooks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_playbooks ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: agents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

--
-- Name: approvals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: avery_chat; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.avery_chat ENABLE ROW LEVEL SECURITY;

--
-- Name: chain_fires; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chain_fires ENABLE ROW LEVEL SECURITY;

--
-- Name: connector_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.connector_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: crew_flow; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crew_flow ENABLE ROW LEVEL SECURITY;

--
-- Name: departments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

--
-- Name: email_suppressions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;

--
-- Name: expense_docs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.expense_docs ENABLE ROW LEVEL SECURITY;

--
-- Name: goals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;

--
-- Name: home_office; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.home_office ENABLE ROW LEVEL SECURITY;

--
-- Name: jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: mcp_connection_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mcp_connection_events ENABLE ROW LEVEL SECURITY;

--
-- Name: mcp_connections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mcp_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: mcp_custom_servers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mcp_custom_servers ENABLE ROW LEVEL SECURITY;

--
-- Name: members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;

--
-- Name: memory_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.memory_events ENABLE ROW LEVEL SECURITY;

--
-- Name: org_keys; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.org_keys ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_actions org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.agent_actions TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: agent_defs org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.agent_defs TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: agent_memory org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.agent_memory TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: agent_outputs org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.agent_outputs TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: agent_playbook_holds org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.agent_playbook_holds TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: agent_playbooks org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.agent_playbooks TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: agent_runs org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.agent_runs TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: agents org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.agents TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: approvals org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.approvals TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: audit_log org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.audit_log TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: avery_chat org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.avery_chat TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: chain_fires org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.chain_fires TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: connector_requests org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.connector_requests TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: crew_flow org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.crew_flow TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: departments org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.departments TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: email_suppressions org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.email_suppressions TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: expense_docs org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.expense_docs TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: goals org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.goals TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: home_office org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.home_office TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: jobs org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.jobs TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: mcp_connection_events org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.mcp_connection_events TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: mcp_connections org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.mcp_connections TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: mcp_custom_servers org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.mcp_custom_servers TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: members org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.members TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: memory_events org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.memory_events TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: org_keys org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.org_keys TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: plans org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.plans TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: policies org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.policies TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: policy_log org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.policy_log TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: proposals org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.proposals TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: reactions org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.reactions TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: run_steps org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.run_steps TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: seats org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.seats TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: status_alerts org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.status_alerts TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: tax_packets org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.tax_packets TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: trips org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.trips TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: usage_ledger org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.usage_ledger TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: vendors org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.vendors TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: wholesale_leads org_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_rows ON public.wholesale_leads TO authenticated USING ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id))) WITH CHECK ((org_id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: orgs org_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_self ON public.orgs FOR SELECT TO authenticated USING ((id = ( SELECT public.jwt_org_id() AS jwt_org_id)));

--
-- Name: orgs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orgs ENABLE ROW LEVEL SECURITY;

--
-- Name: plans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

--
-- Name: policies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.policies ENABLE ROW LEVEL SECURITY;

--
-- Name: policy_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.policy_log ENABLE ROW LEVEL SECURITY;

--
-- Name: proposals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;

--
-- Name: reactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reactions ENABLE ROW LEVEL SECURITY;

--
-- Name: run_steps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.run_steps ENABLE ROW LEVEL SECURITY;

--
-- Name: seats; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.seats ENABLE ROW LEVEL SECURITY;

--
-- Name: status_alerts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.status_alerts ENABLE ROW LEVEL SECURITY;

--
-- Name: tax_packets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tax_packets ENABLE ROW LEVEL SECURITY;

--
-- Name: trips; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;

--
-- Name: usage_ledger; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.usage_ledger ENABLE ROW LEVEL SECURITY;

--
-- Name: vendors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

--
-- Name: wholesale_leads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wholesale_leads ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated, service_role;

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;

--
-- Name: FUNCTION jwt_org_id(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.jwt_org_id() FROM PUBLIC;
GRANT ALL ON FUNCTION public.jwt_org_id() TO authenticated;
GRANT ALL ON FUNCTION public.jwt_org_id() TO service_role;

--
-- Name: FUNCTION ledger_run_cost(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ledger_run_cost() FROM PUBLIC;
GRANT ALL ON FUNCTION public.ledger_run_cost() TO anon;
GRANT ALL ON FUNCTION public.ledger_run_cost() TO authenticated;
GRANT ALL ON FUNCTION public.ledger_run_cost() TO service_role;

--
-- Name: TABLE agent_actions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.agent_actions TO anon;
GRANT ALL ON TABLE public.agent_actions TO authenticated;
GRANT ALL ON TABLE public.agent_actions TO service_role;

--
-- Name: TABLE agent_defs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.agent_defs TO anon;
GRANT ALL ON TABLE public.agent_defs TO authenticated;
GRANT ALL ON TABLE public.agent_defs TO service_role;

--
-- Name: TABLE agent_memory; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.agent_memory TO anon;
GRANT ALL ON TABLE public.agent_memory TO authenticated;
GRANT ALL ON TABLE public.agent_memory TO service_role;

--
-- Name: TABLE agent_outputs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.agent_outputs TO anon;
GRANT ALL ON TABLE public.agent_outputs TO authenticated;
GRANT ALL ON TABLE public.agent_outputs TO service_role;

--
-- Name: TABLE agent_playbook_holds; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.agent_playbook_holds TO anon;
GRANT ALL ON TABLE public.agent_playbook_holds TO authenticated;
GRANT ALL ON TABLE public.agent_playbook_holds TO service_role;

--
-- Name: TABLE agent_playbooks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.agent_playbooks TO anon;
GRANT ALL ON TABLE public.agent_playbooks TO authenticated;
GRANT ALL ON TABLE public.agent_playbooks TO service_role;

--
-- Name: SEQUENCE agent_playbooks_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.agent_playbooks_id_seq TO anon;
GRANT ALL ON SEQUENCE public.agent_playbooks_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.agent_playbooks_id_seq TO service_role;

--
-- Name: TABLE agent_runs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.agent_runs TO anon;
GRANT ALL ON TABLE public.agent_runs TO authenticated;
GRANT ALL ON TABLE public.agent_runs TO service_role;

--
-- Name: TABLE agents; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.agents TO anon;
GRANT ALL ON TABLE public.agents TO authenticated;
GRANT ALL ON TABLE public.agents TO service_role;

--
-- Name: TABLE approvals; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.approvals TO anon;
GRANT ALL ON TABLE public.approvals TO authenticated;
GRANT ALL ON TABLE public.approvals TO service_role;

--
-- Name: TABLE audit_log; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.audit_log TO anon;
GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.audit_log TO authenticated;
GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.audit_log TO service_role;

--
-- Name: TABLE avery_chat; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.avery_chat TO anon;
GRANT ALL ON TABLE public.avery_chat TO authenticated;
GRANT ALL ON TABLE public.avery_chat TO service_role;

--
-- Name: TABLE chain_fires; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.chain_fires TO anon;
GRANT ALL ON TABLE public.chain_fires TO authenticated;
GRANT ALL ON TABLE public.chain_fires TO service_role;

--
-- Name: TABLE connector_requests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.connector_requests TO anon;
GRANT ALL ON TABLE public.connector_requests TO authenticated;
GRANT ALL ON TABLE public.connector_requests TO service_role;

--
-- Name: TABLE crew_flow; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.crew_flow TO anon;
GRANT ALL ON TABLE public.crew_flow TO authenticated;
GRANT ALL ON TABLE public.crew_flow TO service_role;

--
-- Name: TABLE departments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.departments TO anon;
GRANT ALL ON TABLE public.departments TO authenticated;
GRANT ALL ON TABLE public.departments TO service_role;

--
-- Name: TABLE email_suppressions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.email_suppressions TO anon;
GRANT ALL ON TABLE public.email_suppressions TO authenticated;
GRANT ALL ON TABLE public.email_suppressions TO service_role;

--
-- Name: TABLE expense_docs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.expense_docs TO anon;
GRANT ALL ON TABLE public.expense_docs TO authenticated;
GRANT ALL ON TABLE public.expense_docs TO service_role;

--
-- Name: TABLE goals; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.goals TO anon;
GRANT ALL ON TABLE public.goals TO authenticated;
GRANT ALL ON TABLE public.goals TO service_role;

--
-- Name: TABLE home_office; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.home_office TO anon;
GRANT ALL ON TABLE public.home_office TO authenticated;
GRANT ALL ON TABLE public.home_office TO service_role;

--
-- Name: TABLE jobs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.jobs TO anon;
GRANT ALL ON TABLE public.jobs TO authenticated;
GRANT ALL ON TABLE public.jobs TO service_role;

--
-- Name: TABLE mcp_connection_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.mcp_connection_events TO anon;
GRANT ALL ON TABLE public.mcp_connection_events TO authenticated;
GRANT ALL ON TABLE public.mcp_connection_events TO service_role;

--
-- Name: SEQUENCE mcp_connection_events_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.mcp_connection_events_id_seq TO anon;
GRANT ALL ON SEQUENCE public.mcp_connection_events_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.mcp_connection_events_id_seq TO service_role;

--
-- Name: TABLE mcp_connections; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.mcp_connections TO anon;
GRANT ALL ON TABLE public.mcp_connections TO authenticated;
GRANT ALL ON TABLE public.mcp_connections TO service_role;

--
-- Name: TABLE mcp_custom_servers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.mcp_custom_servers TO anon;
GRANT ALL ON TABLE public.mcp_custom_servers TO authenticated;
GRANT ALL ON TABLE public.mcp_custom_servers TO service_role;

--
-- Name: TABLE members; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.members TO anon;
GRANT ALL ON TABLE public.members TO authenticated;
GRANT ALL ON TABLE public.members TO service_role;

--
-- Name: TABLE memory_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.memory_events TO anon;
GRANT ALL ON TABLE public.memory_events TO authenticated;
GRANT ALL ON TABLE public.memory_events TO service_role;

--
-- Name: TABLE org_keys; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.org_keys TO anon;
GRANT ALL ON TABLE public.org_keys TO authenticated;
GRANT ALL ON TABLE public.org_keys TO service_role;

--
-- Name: TABLE orgs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.orgs TO anon;
GRANT ALL ON TABLE public.orgs TO authenticated;
GRANT ALL ON TABLE public.orgs TO service_role;

--
-- Name: TABLE plans; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.plans TO anon;
GRANT ALL ON TABLE public.plans TO authenticated;
GRANT ALL ON TABLE public.plans TO service_role;

--
-- Name: TABLE policies; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.policies TO anon;
GRANT ALL ON TABLE public.policies TO authenticated;
GRANT ALL ON TABLE public.policies TO service_role;

--
-- Name: TABLE policy_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.policy_log TO anon;
GRANT ALL ON TABLE public.policy_log TO authenticated;
GRANT ALL ON TABLE public.policy_log TO service_role;

--
-- Name: TABLE proposals; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.proposals TO anon;
GRANT ALL ON TABLE public.proposals TO authenticated;
GRANT ALL ON TABLE public.proposals TO service_role;

--
-- Name: TABLE reactions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.reactions TO anon;
GRANT ALL ON TABLE public.reactions TO authenticated;
GRANT ALL ON TABLE public.reactions TO service_role;

--
-- Name: TABLE run_steps; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.run_steps TO anon;
GRANT ALL ON TABLE public.run_steps TO authenticated;
GRANT ALL ON TABLE public.run_steps TO service_role;

--
-- Name: SEQUENCE run_steps_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.run_steps_id_seq TO anon;
GRANT ALL ON SEQUENCE public.run_steps_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.run_steps_id_seq TO service_role;

--
-- Name: TABLE seats; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.seats TO anon;
GRANT ALL ON TABLE public.seats TO authenticated;
GRANT ALL ON TABLE public.seats TO service_role;

--
-- Name: TABLE status_alerts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.status_alerts TO anon;
GRANT ALL ON TABLE public.status_alerts TO authenticated;
GRANT ALL ON TABLE public.status_alerts TO service_role;

--
-- Name: TABLE tax_packets; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tax_packets TO anon;
GRANT ALL ON TABLE public.tax_packets TO authenticated;
GRANT ALL ON TABLE public.tax_packets TO service_role;

--
-- Name: TABLE trips; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.trips TO anon;
GRANT ALL ON TABLE public.trips TO authenticated;
GRANT ALL ON TABLE public.trips TO service_role;

--
-- Name: TABLE usage_ledger; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.usage_ledger TO anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.usage_ledger TO authenticated;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.usage_ledger TO service_role;

--
-- Name: TABLE vendors; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vendors TO anon;
GRANT ALL ON TABLE public.vendors TO authenticated;
GRANT ALL ON TABLE public.vendors TO service_role;

--
-- Name: TABLE wholesale_leads; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.wholesale_leads TO anon;
GRANT ALL ON TABLE public.wholesale_leads TO authenticated;
GRANT ALL ON TABLE public.wholesale_leads TO service_role;

--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

--
--

-- Receipt files (private): the Bookkeeper's receipts and the gateway's attachments.
INSERT INTO storage.buckets (id, name, public) VALUES ('receipts', 'receipts', false) ON CONFLICT (id) DO NOTHING;

-- The home org (HOME_ORG_ID in core/tenancy.ts), empty: the owner names it on Settings and picks a
-- template pack, or starts from nothing, on the Desk. OPERATOR_OWNER_EMAIL becomes its first owner.
INSERT INTO public.orgs (id, slug, name) VALUES ('0e1a7c4e-0001-4000-8000-000000000001', 'home', 'My business') ON CONFLICT (id) DO NOTHING;
