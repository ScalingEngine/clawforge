Repo: ScalingEngine/scaling-engine-portal

Find the footer component and/or layout wrapper that renders the Scaling Engine logo at the bottom of the page. This logo is appearing too close to the bottom edge of the screen across all pages.

Add appropriate bottom padding/margin so the logo has breathing room from the screen edge. Aim for `pb-6` to `pb-10` (24–40px) — pick what looks balanced with the existing layout. This should apply globally across all pages.

Check for:
- A shared footer component (e.g., `components/Footer.tsx` or similar)
- A root layout file (`app/layout.tsx` or `pages/_app.tsx`) that might control bottom spacing
- Any wrapper or container that needs `pb-*` added

Make the change in the right place so it applies to all pages, then commit the change.