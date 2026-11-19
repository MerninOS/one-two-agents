# The Briefs database in Notion

The morning brief (`docs/morning-brief.md`) is an email. Notion keeps the archive: one row per day in
a database the owner picks on Settings › Where things go (the briefs database). Without one, a page
per day goes under the briefs page.

## The database

Make a database in a page the agents' Notion integration can reach, with these properties:

| Property | Type | Filled by | Value |
| --- | --- | --- | --- |
| Name | Title | Code | `Wed, Nov 11` |
| Date | Date | Code | The day the brief was sent (the app's time zone) |
| Focus | Text | Code | The focus action and its reason, one line |
| Focus done | Checkbox | **The owner** | Code never changes it |
| Revenue | Number ($) | Code | From the latest daily numbers row (`kpi_snapshots`) |
| Orders | Number | Code | Same row |
| AOV | Number ($) | Code | Same row |
| Cash | Number ($) | Code | Same row |
| Repeat rate | Number (%) | Code | Same row |
| Margin | Number (%) | Code | Same row; blank when cost of goods isn't set |
| Numbers from | Date | Code | The day those numbers are for. Normally the day before |
| Approvals waiting | Number | Code | Pending approvals when the brief ran |
| Failed runs | Number | Code | Failed agent runs in the last 24 hours |
| Emailed | Checkbox | Code | Ticked once the email has gone |

The row's page body is the brief itself, in the same sections as the email. A number that isn't known
is left blank, never written as zero.

**An older database with "Green margin":** rename that property to **Margin** in Notion (click the
property's name › Rename). Until then Notion refuses the row and the run summary says so; the email
still goes.

## Behavior

- **One row per day.** If the brief runs twice on one day, the new row replaces the old one. The old
  row goes to Notion's trash (restorable for 30 days) and its "Focus done" tick is carried over.
- **Order.** The row is written first so the email footer can link to it. Then the email is sent.
  Then "Emailed" is ticked.
- **Failures.** A Notion failure never stops the email; the run summary says what failed. With no
  email set up, a Notion failure fails the run.

## Rules it keeps

- **Numbers in code.** Every property comes from facts worked out in `core/brief/index.ts`. The model
  writes only the Watch list and the focus.
- **"Focus done" is the owner's.** Code reads it only to carry it across a same-day rerun.
- **No new access.** Same Notion integration, through the report tools on our own Notion server.
