# Avery: the Briefs database in Notion

Avery (Chief of Staff) emails Zak the morning brief. The email is the brief. Notion keeps
the archive, and this change turns that archive from one loose page per day into one row
per day in a database called **Briefs**.

## Why

A page per day can't be sorted, filtered or charted, and nothing on it records whether the
day's focus got done. A row per day gives a history of the numbers, a list of every focus
Avery recommended, and a box Zak ticks when he did it.

## The database

"Briefs" lives inside the "Morning Briefs" page, so the Notion integration the agents use
can already reach it. Nothing new has to be shared.

| Property | Type | Filled by | Value |
| --- | --- | --- | --- |
| Name | Title | Avery | `Wed, Nov 11` |
| Date | Date | Avery | The day the brief was sent (America/Chicago) |
| Focus | Text | Avery | The focus action and its reason, one line |
| Focus done | Checkbox | **Zak** | Avery never changes it |
| Revenue | Number ($) | Avery | From the latest `kpi_snapshots` row |
| Orders | Number | Avery | Same row |
| AOV | Number ($) | Avery | Same row |
| Cash | Number ($) | Avery | Same row |
| Repeat rate | Number (%) | Avery | Same row |
| Green margin | Number (%) | Avery | Same row |
| Numbers from | Date | Avery | The day those numbers are for. Normally the day before; older when Morgan hasn't run |
| Approvals waiting | Number | Avery | Pending approvals when the brief ran |
| Failed runs | Number | Avery | Failed agent runs in the last 24 hours |
| Emailed | Checkbox | Avery | Ticked once the email has gone |

The row's page body is the brief itself: Numbers, Waiting on you, What ran, Watch, Today's
focus. Same blocks the daily page had.

A number that isn't known is left blank, never written as zero.

## Behavior

| Settings | Result |
| --- | --- |
| `NOTION_BRIEFS_DB_ID` set | One row per brief in the database |
| Blank | One page per brief under `NOTION_BRIEF_PARENT_ID`, as before |

- **One row per day.** If the brief runs twice on one day, the new row replaces the old
  one. The old row goes to Notion's trash (restorable for 30 days) and its "Focus done"
  tick is carried to the new row. Anything Zak typed into the old row's page is in the
  trash copy, not the new row.
- **Order.** The row is written first so the email footer can link to it. Then the email
  is sent. Then "Emailed" is ticked.
- **Failures.** A Notion failure never stops the email; the run summary says what failed.
  With no email set up, a Notion failure fails the run.
- **Dry run.** Writes nothing. It does read the database once, which costs nothing and
  proves the id and the sharing are right. The summary says "Briefs database: reachable,
  would add today's row", "would replace today's row", or why it can't be read.

## Rules it keeps

- **Numbers in code.** Every property comes from facts computed in
  `agents/chief-of-staff/index.ts`. The model still writes only the Watch list and the focus.
- **"Focus done" is Zak's.** Avery reads it only to carry it across a same-day rerun.
- **Model text is plain text** in Notion, cut to Notion's 2,000 character limit per value.
- **No new access.** Same Notion integration and token. It can reach the Morning Briefs
  page and what is inside it, nothing else.
- **Every run through `withRun`**, so `agents.enabled` and the daily budget still apply.

## Settings

| Variable | Value |
| --- | --- |
| `NOTION_BRIEFS_DB_ID` | The Briefs database id: the 32 characters in its URL |

## Files

- `integrations/notion.ts`: `notionRow`, `notionRowOn`, `notionSetProps`, `notionArchive`
  and the `prop` helpers, next to the existing `notionPage`.
- `agents/chief-of-staff/index.ts`: `briefRow` (the properties) and the row-or-page choice
  in `runBrief`.
- `core/env.ts`, `.env.example`: the new setting.
- `dashboard/crew.ts`, the Integrations page: wording.

## Not in this change

- Avery reading yesterday's row to say "yesterday's focus wasn't done".
- Moving the old daily pages into rows.
- Rowan's and Quinn's Notion pages. They still go under Morning Briefs until their own
  database cards are built.
