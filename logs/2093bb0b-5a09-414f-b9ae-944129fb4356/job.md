Target repo: ScalingEngine/scaling-engine-portal

Troubleshoot why a daily report synced for **Cnstrux** is not appearing in:
1. The reports section of the client page (likely `/clients/[id]` or similar)
2. The `/daily-reports` route

**Investigation steps:**
- Find where daily reports are stored (Supabase table — likely `daily_reports` or similar). Check if the Cnstrux report actually exists in the DB with the correct data, client association, and any status/visibility flags.
- Trace the data fetching logic for both the client page reports section and the `/daily-reports` page — find the queries/API routes pulling report data and check for filtering issues (e.g., wrong client ID, date range filters, status checks, missing joins).
- Check the sync logic that writes reports — look for where daily reports get created/upserted and see if Cnstrux is mapped correctly (client ID, org ID, or slug mismatch).
- Check for any RLS (Row Level Security) policies in Supabase that might be hiding the record.
- Identify the root cause and fix it — whether that's a data issue, a query bug, a mapping mismatch, or an RLS policy gap.
- Commit the fix with a clear message explaining what was wrong.

Use /gsd:debug to work through this systematically.