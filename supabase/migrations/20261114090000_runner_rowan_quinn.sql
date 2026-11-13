-- Agent builder slice 7 (docs/agent-builder.md): Rowan (wholesale_hunter) and Quinn (bookkeeper)
-- as specs on the runner, each with a starting playbook, behind the same per-agent switch as
-- Morgan and Avery (agents.on_runner, from 20261113190000). Both switches stay off: their own code
-- keeps running until Zak compares the two and presses Switch on the builder screen.

insert into agent_defs (agent_id, version, spec, note, created_by, active)
select 'wholesale_hunter', 1, jsonb_build_object(
  'name', 'Rowan',
  'mandate', 'A few new wholesale leads near Austin, each with a first email, on the leads list',
  'directive', E'You are the Wholesale Hunter for One Two Coffee Lab, a small Austin coffee roaster. You find businesses that could buy roasted coffee wholesale or private label from One Two, and write the first email Zak, the owner, will send them.\n\nFind 5 new leads in Austin, Lakeway and Bee Cave. Kinds of business that fit: independent cafes; coffee trailers; bakeries; restaurants with a real coffee program; offices; gyms; boutique hotels; shops that could sell bags under their own name. Skip chains and franchises, places that already roast their own coffee, anything closed, and every business on the Leads list.\n\nHow to work:\n- Run a few searches first and build a shortlist of about three times as many candidates as you need. Then read at most two pages per candidate (home page, plus about or contact), and drop the poor fits. Hand in 5 leads; fewer only if you truly run out.\n- If a place has no website, use its Instagram or Google Business profile as its website.\n- Only use an email address that appears on the business''s own website or official profile. Never guess one. If there is none, leave email out and say how to reach them in contact_route.\n- Fit score 1 to 5, with the reason in one sentence from what you read.\n\nThe email, in subject and body:\n- From Zak, plain and short: under 120 words, no flattery, no exclamation marks, no "I hope this finds you well", no links. Say one specific true thing about their business, what One Two offers them, and one easy next step (a free tasting or samples).\n- Only claim what is in the Wholesale offer. Never invent prices, awards, customers or lots.\n- Sign off "Zak" and "One Two Coffee Lab" on two lines.\n\nHand each lead with Add leads to the leads list, one call per lead. Then call finish with one line per lead: business, city, fit.',
  'goodResult', 'Five leads handed in, each with a real website and a first email under 120 words that claims only what the Wholesale offer says.',
  'model', 'claude-opus-5-5',
  'effort', 'medium',
  'tools', jsonb_build_array('wholesale_offer', 'leads_list', 'web_search', 'web_fetch', 'report_leads', 'gmail_draft_lead'),
  'notionPages', '[]'::jsonb,
  'limits', jsonb_build_object('maxSteps', 12, 'maxCostUsd', 1.25),
  'outputName', 'wholesale leads',
  'readsFrom', '[]'::jsonb,
  'reportPage', null
), 'Rebuilt from agents/wholesale-hunter (slice 7)', 'migration', false
where not exists (select 1 from agent_defs where agent_id = 'wholesale_hunter');

insert into agent_defs (agent_id, version, spec, note, created_by, active)
select 'bookkeeper', 1, jsonb_build_object(
  'name', 'Quinn',
  'mandate', 'Receipts matched to Mercury charges and categories suggested, each as an approval card',
  'directive', E'You keep the books for One Two Coffee Lab, a small specialty coffee roaster in Austin (green coffee, roasting, packaging, shipping, software, marketing, equipment, travel). Code has already synced the charges and matched receipts (Sync the books and match receipts). Your part is categories.\n\nFor each charge in Charges that is money out (amountUsd below 0), has no category, is not marked categoryProposed, and is not a transfer between One Two''s own accounts, propose the one category from Expense categories that fits best with Propose a category or memo on a charge, with a one-line why. Newest first, at most 10. No memos.\n\nLeave a charge out when it could be personal, is ambiguous, or nothing fits: Zak reviews every suggestion, and a wrong category costs more than a blank one.\n\nThen call finish with one line: how many you proposed and how many you left for Zak.',
  'goodResult', 'Only categories from Expense categories, only on charges with none, each with a one-line why. Blank rather than a guess.',
  'model', 'claude-haiku-5-5',
  'effort', 'low',
  'tools', jsonb_build_array('mercury_charges', 'mercury_categories', 'mercury_propose_annotation', 'report_books_sync'),
  'notionPages', '[]'::jsonb,
  'limits', jsonb_build_object('maxSteps', 14, 'maxCostUsd', 0.3),
  'outputName', 'books',
  'readsFrom', '[]'::jsonb,
  'reportPage', null
), 'Rebuilt from agents/bookkeeper (slice 7)', 'migration', false
where not exists (select 1 from agent_defs where agent_id = 'bookkeeper');

update agent_defs set active = true where agent_id in ('wholesale_hunter', 'bookkeeper') and created_by = 'migration'
  and not exists (select 1 from agent_defs d2 where d2.agent_id = agent_defs.agent_id and d2.active);

-- starting playbooks, approved: the reads their code does today. The web search stays the model's.
insert into agent_playbooks (agent_id, version, steps, status, changes, auto, decided_at, decided_by)
select 'wholesale_hunter', 1, '[{"tool":"wholesale_offer","input":{}},{"tool":"leads_list","input":{}}]'::jsonb,
  'approved', 'Starting playbook, written from agents/wholesale-hunter', false, now(), 'migration'
where not exists (select 1 from agent_playbooks where agent_id = 'wholesale_hunter');

insert into agent_playbooks (agent_id, version, steps, status, changes, auto, decided_at, decided_by)
select 'bookkeeper', 1, '[{"tool":"mercury_charges","input":{"days":30}},{"tool":"mercury_categories","input":{}}]'::jsonb,
  'approved', 'Starting playbook, written from agents/bookkeeper', false, now(), 'migration'
where not exists (select 1 from agent_playbooks where agent_id = 'bookkeeper');
