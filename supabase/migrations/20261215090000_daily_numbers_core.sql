-- The daily numbers move into core (card 133.5, docs/daily-numbers.md). Cost of goods and margin no
-- longer come from one roaster's green coffee: each business picks the source on Settings › Daily
-- numbers (none, Shopify's unit cost, or a number from its own tool), and each row says which it used.
-- kpi_snapshots is now a core table (supabase/baseline, no longer the One Two pack's).
alter table kpi_snapshots rename column green_cost to cost_of_goods;
alter table kpi_snapshots rename column green_margin to margin;
alter table kpi_snapshots add column cost_source text not null default 'none'
  check (cost_source in ('none', 'shopify', 'own'));
-- rows saved before this came from the business's own green coffee numbers
update kpi_snapshots set cost_source = 'own' where cost_of_goods is not null;
