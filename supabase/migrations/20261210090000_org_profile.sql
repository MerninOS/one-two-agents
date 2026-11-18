-- The business's own words (card 127, open core): what every agent is told about who it works
-- for, in place of text that named One Two in code. Owners edit them on Settings.
begin;

alter table orgs add column if not exists about text check (about is null or length(about) between 1 and 300);
alter table orgs add column if not exists owner_name text check (owner_name is null or length(owner_name) between 1 and 80);

update orgs set
  about = coalesce(about, 'a small Austin coffee roaster selling custom blends online, roasted to order, plus private label wholesale'),
  owner_name = coalesce(owner_name, 'Zak')
where id = '0e1a7c4e-0001-4000-8000-000000000001';

commit;
