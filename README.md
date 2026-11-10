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

## Childcare 101

The induction course lives in the Hub under **Training** (moved from the separate rss-training app in Nov 2026).
Staff take it signed in as themselves, so results are tied to their email. Quizzes are marked on the server.
The RSS office sees the tracker, previews and edits modules, and changes course settings from the Training tab.
On first use the course content is copied from the old app's database (`TRAINING` binding) into Hub settings, and each
person's old results are carried over by matching their name (or "Name used in the old Childcare 101 app") once.
Old records that didn't match are listed on the tracker so RSS can link them by hand.

## Sign-in station and clocking in

Nursery managers open **Sign-in station** on the branch iPad. It lists today's booked RSS staff; each person taps their
name and enters their own 4-digit PIN (set in the Hub under My checks or My shifts) when they arrive and leave. If they
have no PIN or forget it, the manager can confirm instead (recorded under the manager's name). Five wrong PINs lock that
person for 15 minutes. Backup: staff tap "I've arrived" / "I'm leaving" on their own phone; the phone's location must be
within about 300 m of the nursery (location found from the postcode in the nursery's address, or set from the iPad).
Signing out fills in the timesheet (from the booked start, or later if they arrived late, to when they left, less the
booked break) and sends it to the manager to approve. Staff can also record "Start break" and "End break"; when they do, the break actually taken is deducted instead of the booked one. New shifts default to a 30-minute unpaid break. The office sees arrivals and anyone 15+ minutes late on Today.

## Weekly availability

Staff tell RSS when they can work, day by day, under **My availability** (not available, all day, mornings, afternoons,
or set times). Next week's availability (Monday to Sunday) is due by **Tuesday 23:59 UK time** the week before; anything
sent after that is marked late. Staff see a reminder on My shifts until they send it, and can update days that haven't
passed, up to four weeks ahead. The office sees who has and hasn't sent it on **Today** and the full week grid under the **Availability** tab, and when
filling a shift each ready candidate shows whether they said they're available, with available staff listed first.
Availability guides booking; it doesn't block it. Nursery managers can't see it.
