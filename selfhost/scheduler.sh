#!/bin/sh
# The scheduler (docs/self-host.md): what Vercel Schedules does on Vercel. Calls the app's dispatch
# every 15 minutes with CRON_SECRET; dispatch starts due chains, kicks due jobs and sends alerts.
set -eu
: "${APP_URL:?}" "${CRON_SECRET:?}"
while true; do
  wget -q -O - --header "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/dispatch" >/dev/null 2>&1 || echo "dispatch call failed; trying again next round"
  sleep 900
done
