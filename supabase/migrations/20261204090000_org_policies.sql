-- Tenancy slice 2b (docs/tenancy.md): the database itself refuses another org's rows.
-- The app reads and writes with a short-lived token for one org (role authenticated, claim org_id),
-- signed by the app's own key. A token reaches only rows whose org_id is its org; a token without
-- the claim (a person's own Supabase session, the anon key) reaches nothing. The service role
-- still bypasses row-level security; the app keeps it only for files and sign-in.

-- The org a request's token is for, or null.
create or replace function public.jwt_org_id() returns uuid
  language sql stable
  set search_path = ''
as $$
  select case when (auth.jwt() ->> 'org_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then (auth.jwt() ->> 'org_id')::uuid end
$$;
revoke all on function public.jwt_org_id() from public, anon;
grant execute on function public.jwt_org_id() to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array[
    'agent_actions','agent_defs','agent_memory','agent_outputs','agent_playbook_holds','agent_playbooks',
    'agent_runs','agents','approvals','avery_chat','chain_fires','chain_waits','connector_requests',
    'crew_flow','departments','email_suppressions','expense_docs','goals','home_office','kpi_snapshots',
    'mcp_connection_events','mcp_connections','mcp_custom_servers','members','memory_events','plans','policies',
    'policy_log','proposals','reactions','run_steps','seats','tax_packets','trips','vendors','wholesale_leads'
  ] loop
    execute format('create policy org_rows on %I for all to authenticated using (org_id = (select public.jwt_org_id())) with check (org_id = (select public.jwt_org_id()))', t);
  end loop;
end $$;

-- An org reads only its own row and never writes it.
create policy org_self on orgs for select to authenticated using (id = (select public.jwt_org_id()));
