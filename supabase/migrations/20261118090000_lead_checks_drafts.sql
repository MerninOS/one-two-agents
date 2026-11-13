-- Departments slice 4 (docs/org-chart.md): a lead checks drafts first, and approvals carry their department.
--
-- A department can turn on "Lead checks drafts first". Then a draft from an agent in it waits for the
-- nearest agent above it on the chart (its lead or head) for up to a day: that agent adds a note, or
-- sends it back once with a reason. Only Zak's tap approves; a lead can't edit or approve. A draft a
-- lead didn't check in time goes to Zak anyway, saying so.

alter table departments add column lead_checks_drafts boolean not null default false;

alter table approvals
  add column department_id text references departments (id) on delete set null,
  add column reviewer_agent_id text references agents (id),
  add column review_status text check (review_status in ('waiting', 'noted', 'sent_back', 'skipped')),
  add column review_note text check (review_note is null or char_length(review_note) <= 400),
  add column review_at timestamptz,
  add column review_due timestamptz,
  -- a reviewer always has a status, and a status always has a reviewer
  add constraint approvals_review_pair check ((reviewer_agent_id is null) = (review_status is null));

-- sent back by the lead: the approval and its action close (so the agent may propose again), and
-- neither is a decision of Zak's, so it never counts toward or against promotion
alter table approvals drop constraint approvals_status_check;
alter table approvals add constraint approvals_status_check
  check (status in ('pending', 'approved', 'edited', 'rejected', 'expired', 'sent_back'));
alter table agent_actions drop constraint agent_actions_status_check;
alter table agent_actions add constraint agent_actions_status_check
  check (status in ('proposed', 'approved', 'executing', 'applied', 'partial', 'failed', 'rejected', 'expired', 'refused', 'sent_back'));

create index approvals_review on approvals (reviewer_agent_id, review_status) where review_status = 'waiting';
create index approvals_department on approvals (department_id, created_at desc);
