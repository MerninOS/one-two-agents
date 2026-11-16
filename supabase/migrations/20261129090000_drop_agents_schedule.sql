-- Turn on the org, slice 3 (docs/org-schedule.md): drop agents.schedule. It was a human-readable
-- note from when schedules lived in vercel.json; an agent's schedule is now its place in the crew
-- flow (dashboard/roster.ts scheduleOf), and no code reads or writes the column.
-- Apply AFTER the pull request that stops selecting it is merged and deployed.
alter table agents drop column if exists schedule;
