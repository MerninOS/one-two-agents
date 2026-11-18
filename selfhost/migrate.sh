#!/bin/sh
# Applies supabase/migrations in order to DATABASE_URL, each once (docs/self-host.md). Applied files
# are recorded in operator_migrations, so running it again only applies new ones. Stops at the first
# failure, leaving that file unrecorded.
set -eu
: "${DATABASE_URL:?set DATABASE_URL to the Supabase database (postgres://...)}"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "create table if not exists public.operator_migrations (name text primary key, applied_at timestamptz not null default now()); alter table public.operator_migrations enable row level security;"
for f in /migrations/*.sql; do
  name=$(basename "$f")
  done=$(psql "$DATABASE_URL" -tA -c "select 1 from public.operator_migrations where name = '$name'")
  [ "$done" = "1" ] && continue
  echo "applying $name"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -1 -f "$f"
  psql "$DATABASE_URL" -q -c "insert into public.operator_migrations (name) values ('$name')"
done
echo "migrations up to date"
