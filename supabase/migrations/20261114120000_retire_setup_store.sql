-- Builder flow slice 6 (docs/builder-flow.md): every agent runs its live version on the shared
-- engine, so nothing reads the old setup store or the own-code switch any more.
-- Old runs keep agent_runs.setup_version as history.
drop table if exists agent_setup;
alter table agents drop column if exists on_runner;
