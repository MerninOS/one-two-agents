-- Departments slice 2: a monthly AI budget and an email cap per department, and department rules.
-- Spec: docs/org-chart.md (slice 2). Checked in core/runs.ts (budget), core/gateway/policy.ts
-- (emails) and loaded by core/memory.ts (rules).
--
-- A department can only be stricter than the company: its email cap is checked against
-- policies.max_emails_per_day in code, and its budget sits on top of each agent's daily budget.
-- Null means no department limit, so only the company and agent limits apply.

alter table departments
  -- AI spend of the agents seated in the department, per Chicago calendar month. 500 is the ceiling in code (DEPT_BUDGET_CEILING).
  add column monthly_budget_usd numeric(8,2) check (monthly_budget_usd is null or monthly_budget_usd between 0 and 500),
  -- outbound emails a day from the department's agents; code also holds it at or under the company cap
  add column max_emails_per_day integer check (max_emails_per_day is null or max_emails_per_day between 0 and 20),
  -- "2026-11": the month Zak was last emailed that the department reached its budget, so he gets one alert a month
  add column budget_alerted text check (budget_alerted is null or budget_alerted ~ '^\d{4}-\d{2}$');

-- Department rules live in the memory store as their own group. A rule belongs to a department,
-- not an agent: every agent seated there loads it. No foreign key, so removing a department keeps
-- its lines (marked forgotten) for the timeline: nothing in agent_memory is ever deleted.
alter table agent_memory add column department_id text check (department_id is null or department_id ~ '^[a-z][a-z0-9_]{1,39}$');
alter table agent_memory drop constraint agent_memory_check;
alter table agent_memory drop constraint agent_memory_grp_check;
alter table agent_memory add constraint agent_memory_grp_check check (grp in ('crew', 'department', 'standing_order', 'lesson', 'note', 'working'));
alter table agent_memory add constraint agent_memory_owner_check check (
  (grp = 'crew' and agent_id is null and department_id is null)
  or (grp = 'department' and agent_id is null and department_id is not null)
  or (grp not in ('crew', 'department') and agent_id is not null and department_id is null)
);
create index agent_memory_department on agent_memory (department_id, state) where department_id is not null;

alter table memory_events add column department_id text;
