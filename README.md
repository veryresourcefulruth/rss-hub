# RSS Hub

Shift booking, compliance and billing for Resourceful Staffing Support (RSS).

**Who uses it**
- **RSS office** (owner, coordinators): nurseries, staff files and compliance checks, shifts, timesheets,
  invoices, pay export, settings and activity log.
- **Nursery managers**: request cover, see who is coming and a summary of their checks, approve or query hours.
- **RSS staff**: take shifts offered to them, submit hours, keep their checks and documents up to date.

**Sign-in**: Cloudflare Access (one-time code to email) protects the whole site. The Worker verifies the
Access token on every API call and looks the person up in the `users` table. The owner email in
`wrangler.toml` is created automatically on first sign-in.

**Booking rules** (enforced on the server): nobody can be booked unless their enhanced DBS (children's barred
list), right to work, photo ID, two references and RSS terms are verified and in date, and they have completed
Childcare 101 (read from the `rss-training` database by name). Shifts can also require a verified Level 3 and/or
in-date paediatric first aid. Overlapping shifts and visa weekly-hour limits are blocked. The owner can override,
and every override is logged.

**Money** is stored in pence. Pay and charge rates are copied onto each shift when it's booked, so later rate
changes don't alter past shifts or invoices.

## Running locally
`npm install`, `npx wrangler d1 migrations apply rss-hub --local`, then `npx wrangler dev` with `DEV_MODE=1`
in `.dev.vars`. In dev mode, pick who you are with `localStorage.setItem("rss-dev-email", "...")`.
`node test/e2e.mjs` and `node test/e2e2.mjs` run the end-to-end checks against a fresh local database.

## Deploying
Cloudflare builds this repo on every push to `main`. Schema changes go in `migrations/` and are applied with
`npm run migrate`.

## Terms of engagement

Staff read the Key Information Document, confirm they received it, then read and sign the Terms of Engagement
in the hub (My checks → Read and sign). Signing records the typed name, time, IP and a fingerprint of the exact text,
and marks "RSS terms of engagement signed" as verified. Every published version is kept (`agreement_versions`), so a
signed copy always shows the text that was signed. The owner publishes new versions from Settings → Terms of engagement,
optionally requiring everyone to sign again before their next booking. `content/*.md` holds version 1.
