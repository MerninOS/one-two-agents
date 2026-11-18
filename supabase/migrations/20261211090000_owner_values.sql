-- Open core (card 127): the value that stood for the owner was 'zak'. It is now 'owner': a seat a
-- person holds, a chat line a person wrote, a rule or proposal a person gave, and who added a row.
-- Apply it, then merge the pull request that reads 'owner' straight away.
begin;

alter table seats drop constraint if exists seats_holder_check;
alter table avery_chat drop constraint if exists avery_chat_role_check;
alter table agent_memory drop constraint if exists agent_memory_source_check;
alter table proposals drop constraint if exists proposals_source_check;

update seats set holder = 'owner' where holder = 'zak';
update avery_chat set role = 'owner' where role = 'zak';
update agent_memory set source = 'owner' where source = 'zak';
update proposals set source = 'owner' where source = 'zak';
update agent_defs set created_by = 'owner' where created_by = 'zak';
update email_suppressions set source = 'owner' where source = 'zak';
update plans set items = (
  select coalesce(jsonb_agg(case when i->>'kind' = 'zak' then jsonb_set(i, '{kind}', '"owner"') else i end), '[]'::jsonb)
  from jsonb_array_elements(items) i
) where items::text like '%"zak"%';

alter table seats add constraint seats_holder_check check (holder in ('open', 'owner', 'agent'));
alter table avery_chat add constraint avery_chat_role_check check (role in ('owner', 'avery'));
alter table agent_memory add constraint agent_memory_source_check check (source in ('owner', 'approval', 'agent'));
alter table proposals add constraint proposals_source_check check (source in ('agent', 'claude', 'owner'));

alter table agent_defs alter column created_by set default 'owner';
alter table email_suppressions alter column source set default 'owner';

commit;
