-- Turn on the org (docs/org-schedule.md, slice 1).
--
-- policies.org: the one switch for the whole org. Off (or missing) means nothing starts on its own:
-- the dispatcher starts no scheduled chain and a decided approval starts no chain. Turning it on is
-- launch; only Zak does it, in the Control Room (Crew > Schedule), with Controls on and a confirm.
--
-- agents.in_org: false for an agent that turning on the org must never wake (a test agent). Every
-- agent is in the org unless set otherwise; Scratch, the runner test, is not.

insert into policies (key, value_json) values ('org', '{"on": false}'::jsonb)
on conflict (key) do nothing;

alter table agents add column in_org boolean not null default true;

update agents set in_org = false where id = 'scratch';
