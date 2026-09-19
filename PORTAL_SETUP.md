# Creator portal: activation and acceptance

This branch implements the first live integration slice; it is not activated by committing it. The existing design preview remains separate. No live credentials or financial data are included. No creator invitations are sent.

## Architecture

The current staff Supabase project has broad authenticated policies in parts of its schema and automatically provisions staff profiles. Do not put creators in that auth project. Use a separate Supabase Auth project for creator login, disable public signup, and keep its database empty. The production backend verifies creator tokens against that project, then looks up an explicit `portal_accounts.creator_user_id`. Creator sessions never receive the production database key or a staff identity.

The production app hosts `/api/portal/*` and the staff-only `/portal-admin`. The separate portal origin hosts the static files under `public/creator-portal/`; the visual prototype remains at its existing Site URL. The real invoice page is `live.html`. API calls carry creator bearer tokens; no cross-origin staff cookies are used. Admin preview uses a 60-second single-use ticket in a URL fragment (removed immediately), exchanged for a 15-minute read-only token. Staff role and active status are checked on every preview request. Both real and preview users share the exact invoice API and screen.

## Activation order

1. Review and run `supabase/migration_creator_portal.sql` in the **existing production Supabase SQL editor**. It adds service-role-only tables/functions without changing staff policies. Tested for repeat execution. Take your usual database backup first.
2. Create a **separate creator-auth Supabase project**, turn off public signup, and configure the intended authentication settings. Create the pilot identity through its dashboard using Walker's verified email only when ready to invite him. No application code creates or emails users. For initial QA, use a controlled test identity. Never store creators in the staff auth project.
3. Set the following server environment variables in the existing production app hosting settings. Never paste private values into source or chat:

| Variable | Value |
|---|---|
| `PORTAL_AUTH_URL` | Separate creator Supabase project HTTPS URL |
| `PORTAL_AUTH_ANON_KEY` | Its public anon/publishable key |
| `PORTAL_ORIGIN` | Exact separate portal origin, no trailing slash |
| `PORTAL_TOKEN_KEY` | A new 32-byte random key, base64 encoded; keep stable and backed up |
| `QBO_ENVIRONMENT` | `sandbox` for acceptance testing, then `production` |
| `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET` | Matching Intuit app credentials for that environment |
| `QBO_EXPECTED_REALM_ID` | Verified Nilli company ID for the selected environment |
| `QBO_REDIRECT_URI` | `https://YOUR-PRODUCTION-APP/api/portal/qbo/callback` |
| `QBO_WEBHOOK_VERIFIER` | Intuit webhook verifier for the environment |
| `CRON_SECRET` | Existing strong Vercel cron secret |

Existing production Supabase service-role variables are reused server-side. Production Intuit credentials/access must be enabled in the Intuit developer dashboard; sandbox credentials do not grant production access.

4. Register the exact callback URI and webhook URL `https://YOUR-PRODUCTION-APP/api/portal/qbo/webhook` in Intuit. Subscribe to Invoice and Payment changes. The handler validates the raw signature and works by reconciliation rather than depending on legacy vs CloudEvents payload fields. It marks a durable dirty counter before acknowledging, then attempts a background sync. Failed attempts remain visible. The Vercel daily cron at 09:15 UTC repairs missed changes; use a five-minute schedule instead if the Vercel plan supports it and a faster retry SLA is needed.
5. Deploy the backend branch after the migration/configuration. The integration fails closed if not configured. Staff members cannot enter the admin page or its API; active admin/ops can.
6. Set `API_ORIGIN` in the portal's public `config.js` to the backend's HTTPS origin, and publish these static files at `PORTAL_ORIGIN`. This value is public; no secrets go in this file. The private Sites preview has an additional ChatGPT access gate: do not treat publishing there as granting Walker access. For ordinary independent creator login, deploy the same static files on the chosen customer-facing host/URL, or deliberately configure permitted external Site access.
7. In production app → Creator portals, select the existing Walker client. Enter the **verified** QBO customer ID and separate auth user UUID. Save and enable. Do not guess an ID from a client name. Admin customer remapping is intentionally blocked once set; correct a wrong mapping through a reviewed migration and cache cleanup.
8. Connect QuickBooks and authorize the configured company. Run Sync now. Review as creator before granting external access.

## Behavior and limits

- QBO is authoritative. Reads only: this integration never creates invoices, sends invoices, charges customers, or records payments.
- Imports all invoice pages for each mapped enabled customer. Includes taxes in QBO totals and retains original currency; never aggregates currencies. `Balance` drives open/partial/paid status. Zero-total records say zero balance rather than making a false payment claim. Deleted invoices disappear on successful full reconciliation; voided invoices reflect QBO's current zero amounts.
- Each account snapshot is replaced atomically after complete retrieval. Failed pages preserve the prior account snapshot. A failed later account leaves earlier completed accounts saved and global status flagged; this pilot runner is intentionally bounded to three minutes and should be converted to per-account queued jobs before a large roster is enabled.
- Tokens are encrypted with AES-256-GCM and stored only in service-role tables. A shared database lock serializes sync, refresh and PDF requests. Preview tokens are hashed, short-lived, and cleaned after successful sync.
- PDFs are fetched on demand, with a fresh customer-ownership check at QBO before returning bytes. They are not stored publicly. Cross-client IDs return no invoice.
- Frontend access/refresh tokens remain in memory; refreshing the browser signs the creator out. Password reset is through Nilli's existing contact workflow in this first slice. Automated password recovery/invitations are not implemented.
- OAuth needs occasional human reauthorization. No connector can guarantee zero maintenance. Configuration failures and sync failures surface to ops; no alerts are sent automatically.
- Contract, production/Frame.io and social data remain in the labeled design prototype, not the real invoice page. This slice does not imply those connectors exist.

## Verification

`node --test tests/portal-core.cjs` verifies encrypted-token tamper rejection, webhook signatures, inactive/member denial, invoice balance/currency preservation and payment labels.

`node tests/portal-db.cjs` verifies migration repeatability, atomic rollback on invalid snapshots, authenticated-role denial, lock exclusion and ticket single use in Postgres-compatible PGlite.

`npx tsc --noEmit` validates integration with the existing app.

Live sandbox acceptance (requires configured accounts): import Walker-equivalent sandbox customer, create invoice, await webhook sync, record partial payment and full payment, edit/void/delete invoice, test PDF, replay a webhook, disconnect QBO, verify delayed-status display and successful reconnection. Use two separate creator identities and attempt the other's invoice ID, confirm staff members cannot launch preview, revoke a previewing ops user's active status, and check preview expiration. Never create fake test invoices in the real company.
