Target repo: ScalingEngine/scaling-engine-portal

A previous debug job (2093bb0b) investigated why a daily report synced for **Cnstrux** is not appearing on the client page reports section or `/daily-reports` route. The root cause has been identified — now apply the fix.

**Steps:**
- Review the debug findings from the previous investigation. Check git log or any notes left by the prior job for context on what was found.
- Apply the fix — whether that's correcting a query filter, fixing a client ID/slug mapping in the sync logic, updating an RLS policy, or patching a data issue directly in Supabase.
- Verify the fix makes sense by tracing through the affected code paths.
- Commit with a clear message describing what was broken and what was changed.
- Open a PR if the change is non-trivial, otherwise commit directly to main.

Use /gsd:execute-phase to implement the fix cleanly.