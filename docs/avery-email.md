# Avery: the morning brief by email

Avery (Chief of Staff) emails the morning brief to Zak on weekdays at 6:45 AM CT. The
email is the brief; Notion is the archive: one row per day in the Briefs database
(`docs/avery-briefs-database.md`), or a page per day while that isn't set up.

## Why

A Notion page has to be found, and nothing on it links anywhere. An email arrives where
Zak already looks first, says the day's one job in the subject line, and links each item
to the place where it gets done.

## What Zak gets

**Subject:** `Thu: Reorder Guji · $412 yesterday`. Weekday, the focus action, yesterday's
revenue. With no snapshot: `Thu: Reorder Guji`.

**Body, in this order:**

1. **Today's focus.** The action, the reason, and one button to the Control Room.
2. **Waiting on you.** Only lines that are true today, each linked where a link exists:
   - approvals pending, with the age of the oldest → Control Room `/approvals`
   - Gmail drafts Rowan wrote in the last 24 hours → Gmail drafts
   - failed agent runs in the last 24 hours → that run in the Control Room
   - orders paid, roasting and packing; orders on QC hold; green never deducted
   - "Nothing is waiting on you." when the list is empty
3. **Numbers.** Three figures: revenue (against the average of the previous 7 snapshots),
   orders (with AOV), cash (against the snapshot 7 days back). Repeat rate and green
   margin on one line under them.
4. **Watch.** Up to five items.
5. **What ran.** One line ("4 runs, all OK") unless a run failed; failures are listed.
6. **Footer.** Link to the Notion copy (the day's row in the Briefs database) when one was written.

## Rules it keeps

- **Fixed recipient.** `integrations/email.ts` exposes one function, `emailZak`, with no
  recipient argument. The address comes from `BRIEF_TO`. Nothing a model, a web page or an
  inbound email says can change it.
- **No Gmail send scope.** The email goes through Resend's API from a sending address on
  the One Two domain. The agents' Gmail tokens stay compose-only and read-only.
- **Not a gateway action.** The gateway governs messages to other people, purchases and
  posts. A report to Zak is a Report-tier write, like the Notion page.
- **Numbers in code.** Every figure and every comparison is computed in
  `agents/chief-of-staff`. The model still writes only the Watch list and the focus.
- **Model text is escaped.** Watch items, the focus and run summaries are HTML-escaped,
  and the subject is cut to one line.
- **Every run through `withRun`**, so `agents.enabled` and the daily budget still apply.

## Behavior

| Settings | Result |
| --- | --- |
| Email and Notion set | Notion row (or page) written, then the email sent with a link to it |
| Email only | Email sent |
| Notion only | Notion page only, as before |
| Neither | The run fails and says which settings are missing |

- A Notion failure does not stop the email; the run summary says the page failed.
- An email failure fails the run, so it shows in the Control Room.
- A dry run builds the whole email, sends nothing, writes nothing, and reports the subject.
- Cost is unchanged: about $0.003 of Sonnet a run. Resend's free tier covers one email a day.

## Settings

| Variable | Value |
| --- | --- |
| `RESEND_API_KEY` | Resend API key with sending access only |
| `BRIEF_FROM` | `Avery <avery@updates.onetwocoffeelab.com>` (a domain verified in Resend) |
| `BRIEF_TO` | `zak@onetwocoffeelab.com` |
| `DASHBOARD_URL` | The Control Room's address. Defaults to the Vercel production URL. |

## Files

- `integrations/email.ts`: `emailZak(subject, html, text)` and `hasEmail()`.
- `agents/chief-of-staff/email.ts`: pure function that turns the facts and the judgment
  into `{ subject, html, text }`. No I/O, so it can be rendered and checked on its own.
- `agents/chief-of-staff/index.ts`: adds approvals, drafts and comparisons to the facts,
  and sends.
- `dashboard/crew.ts`, `dashboard/data.ts`, `app/api/health`, the Integrations page: a new
  "Email to Zak" integration.

## Not in this change

- Phone push with the top 3.
- Morgan's Monday CFO section and alerts.
