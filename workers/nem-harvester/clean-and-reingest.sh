#!/bin/bash

echo "Cleaning and re-ingesting NEM data..."

# Get current date in AEST
CURRENT_DATE=$(TZ=Australia/Sydney date +%Y-%m-%d)
echo "Current date in AEST: $CURRENT_DATE"

# Clear the backfill jobs table
echo "Clearing backfill jobs..."
curl -X POST "https://nem-harvester.eddie-37d.workers.dev/admin/clear-jobs" 2>/dev/null

# Queue backfill for the last 7 days (or adjust as needed)
START_DATE=$(TZ=Australia/Sydney date -d "7 days ago" +%Y-%m-%d)
echo "Queuing backfill from $START_DATE to $CURRENT_DATE..."

curl -X GET "https://nem-harvester.eddie-37d.workers.dev/admin/backfill?from=$START_DATE&to=$CURRENT_DATE"

echo ""
echo "Backfill queued. The harvester will process the jobs via its cron schedule."
echo "Check status at: https://nem-harvester.eddie-37d.workers.dev/admin/backfill/status"