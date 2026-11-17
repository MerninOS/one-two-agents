-- Tenancy slice 1 (docs/tenancy.md): every row belongs to an org.
-- One Two Coffee Lab is the home org (HOME_ORG_ID in core/tenancy.ts). Nothing changes for it.
begin;

create table orgs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name text not null check (length(name) between 1 and 120),
  created_at timestamptz not null default now()
);
alter table orgs enable row level security;
insert into orgs (id, slug, name) values ('0e1a7c4e-0001-4000-8000-000000000001', 'one-two', 'One Two Coffee Lab');

-- org_id on every table: backfilled to the home org, then no default, so a row that forgets
-- its org fails instead of landing in the wrong business.
do $$
declare t text;
begin
  foreach t in array array[
    'agent_actions','agent_defs','agent_memory','agent_outputs','agent_playbook_holds','agent_playbooks',
    'agent_runs','agents','approvals','avery_chat','chain_fires','chain_waits','connector_requests',
    'crew_flow','departments','email_suppressions','expense_docs','goals','home_office','kpi_snapshots',
    'mcp_connection_events','mcp_connections','mcp_custom_servers','memory_events','plans','policies',
    'policy_log','proposals','reactions','run_steps','seats','tax_packets','trips','vendors','wholesale_leads'
  ] loop
    execute format('alter table %I add column org_id uuid not null default %L references orgs(id)', t, '0e1a7c4e-0001-4000-8000-000000000001');
    execute format('alter table %I alter column org_id drop default', t);
    execute format('create index %I on %I (org_id)', t || '_org_id_idx', t);
  end loop;
end $$;

-- Links to agents and departments: dropped here, put back with org_id below.
alter table agent_actions drop constraint agent_actions_agent_id_fkey;
alter table agent_defs drop constraint agent_defs_agent_id_fkey;
alter table agent_memory drop constraint agent_memory_agent_id_fkey;
alter table agent_outputs drop constraint agent_outputs_agent_id_fkey;
alter table agent_playbook_holds drop constraint agent_playbook_holds_agent_id_fkey;
alter table agent_playbooks drop constraint agent_playbooks_agent_id_fkey;
alter table agent_runs drop constraint agent_runs_agent_id_fkey;
alter table approvals drop constraint approvals_agent_id_fkey;
alter table approvals drop constraint approvals_reviewer_agent_id_fkey;
alter table memory_events drop constraint memory_events_agent_id_fkey;
alter table plans drop constraint plans_head_agent_fkey;
alter table proposals drop constraint proposals_from_agent_fkey;
alter table reactions drop constraint reactions_agent_id_fkey;
alter table approvals drop constraint approvals_department_id_fkey;
alter table goals drop constraint goals_department_id_fkey;
alter table plans drop constraint plans_department_id_fkey;
alter table proposals drop constraint proposals_department_id_fkey;
alter table seats drop constraint seats_department_id_fkey;

-- Ids people or code choose are unique per org.
alter table agents drop constraint agents_pkey, add primary key (org_id, id);
alter table departments drop constraint departments_pkey, add primary key (org_id, id);
alter table agent_defs drop constraint agent_defs_pkey, add primary key (org_id, agent_id, version);
alter table agent_playbook_holds drop constraint agent_playbook_holds_pkey, add primary key (org_id, agent_id);
alter table chain_fires drop constraint chain_fires_pkey, add primary key (org_id, chain_key, fire_at);
alter table email_suppressions drop constraint email_suppressions_pkey, add primary key (org_id, email);
alter table home_office drop constraint home_office_pkey, add primary key (org_id, tax_year);
alter table tax_packets drop constraint tax_packets_pkey, add primary key (org_id, tax_year);
alter table kpi_snapshots drop constraint kpi_snapshots_pkey, add primary key (org_id, date);
alter table mcp_connections drop constraint mcp_connections_pkey, add primary key (org_id, id);
alter table mcp_custom_servers drop constraint mcp_custom_servers_pkey, add primary key (org_id, id);
alter table policies drop constraint policies_pkey, add primary key (org_id, key);

alter table agent_playbooks drop constraint agent_playbooks_agent_id_version_key, add unique (org_id, agent_id, version);
alter table connector_requests drop constraint connector_requests_service_key_key, add unique (org_id, service_key);
alter table crew_flow drop constraint crew_flow_version_key, add unique (org_id, version);
alter table expense_docs drop constraint expense_docs_mercury_txn_id_key, add unique (org_id, mercury_txn_id);
alter table plans drop constraint plans_department_id_week_of_key, add unique (org_id, department_id, week_of);
alter table vendors drop constraint vendors_mercury_recipient_id_key, add unique (org_id, mercury_recipient_id);
alter table wholesale_leads drop constraint wholesale_leads_domain_key, add unique (org_id, domain);

drop index agent_actions_one_open;
create unique index agent_actions_one_open on agent_actions (org_id, tool, target) where status in ('proposed', 'approved', 'executing');
drop index crew_flow_active;
create unique index crew_flow_active on crew_flow (org_id) where active;
drop index agent_defs_one_active;
create unique index agent_defs_one_active on agent_defs (org_id, agent_id) where active;
drop index agent_playbooks_one_approved;
create unique index agent_playbooks_one_approved on agent_playbooks (org_id, agent_id) where status = 'approved';
drop index seats_agent;
create unique index seats_agent on seats (org_id, agent_id) where agent_id is not null;
drop index seats_head;
create unique index seats_head on seats (org_id, department_id) where parent_id is null and department_id is not null;
drop index seats_company;
create unique index seats_company on seats (org_id) where department_id is null;

-- A row can only point at an agent or department of its own org. "Set null" clears only the
-- agent or department column, never org_id.
alter table agent_actions add foreign key (org_id, agent_id) references agents (org_id, id);
alter table agent_defs add foreign key (org_id, agent_id) references agents (org_id, id);
alter table agent_memory add foreign key (org_id, agent_id) references agents (org_id, id);
alter table agent_outputs add foreign key (org_id, agent_id) references agents (org_id, id);
alter table agent_playbook_holds add foreign key (org_id, agent_id) references agents (org_id, id);
alter table agent_playbooks add foreign key (org_id, agent_id) references agents (org_id, id);
alter table agent_runs add foreign key (org_id, agent_id) references agents (org_id, id);
alter table approvals add foreign key (org_id, agent_id) references agents (org_id, id);
alter table approvals add foreign key (org_id, reviewer_agent_id) references agents (org_id, id);
alter table memory_events add foreign key (org_id, agent_id) references agents (org_id, id);
alter table plans add foreign key (org_id, head_agent) references agents (org_id, id) on delete set null (head_agent);
alter table proposals add foreign key (org_id, from_agent) references agents (org_id, id) on delete set null (from_agent);
alter table reactions add foreign key (org_id, agent_id) references agents (org_id, id);
alter table approvals add foreign key (org_id, department_id) references departments (org_id, id) on delete set null (department_id);
alter table goals add foreign key (org_id, department_id) references departments (org_id, id) on delete cascade;
alter table plans add foreign key (org_id, department_id) references departments (org_id, id) on delete cascade;
alter table proposals add foreign key (org_id, department_id) references departments (org_id, id) on delete set null (department_id);
alter table seats add foreign key (org_id, department_id) references departments (org_id, id) on delete restrict;

commit;
