-- Product facts in core (card 132, docs/product-facts.md): the pack's "Wholesale offer" tool
-- (wholesale_offer) is gone; core's "Product facts" (product_facts) replaces it, reading the
-- collections, fields and offer terms each business sets on Settings. A rename, so every spec
-- version and playbook that names the old tool is changed in place: the old id no longer exists,
-- and a spec or playbook naming it would be refused at run time. The directive words that name
-- the tool change with it. No table changes.

update agent_defs set spec = replace(replace(replace(replace(spec::text,
    '"wholesale_offer"', '"product_facts"'),
    'Only claim what is in the Wholesale offer.', 'Only claim what is in Product facts.'),
    'claims only what the Wholesale offer says.', 'claims only what Product facts says.'),
    'check each one against the wholesale offer', 'check each one against Product facts')::jsonb
where spec::text like '%wholesale_offer%' or spec::text ilike '%wholesale offer%';

update agent_playbooks set steps = replace(steps::text, '"wholesale_offer"', '"product_facts"')::jsonb
where steps::text like '%"wholesale_offer"%';

do $$
begin
  if exists (select 1 from agent_defs where spec::text like '%wholesale_offer%')
     or exists (select 1 from agent_playbooks where steps::text like '%wholesale_offer%') then
    raise exception 'wholesale_offer is still named somewhere';
  end if;
end $$;
