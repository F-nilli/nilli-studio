# Sponsorship opportunities: implementation and continuation

September 28, 2026. First implementation of the approved creator sponsorship menu and episode announcement workflow. Based on main 90b006f, including the six-project pagination fix.

## Implemented

- Creator Content NASCAR tab: reusable menu with three placement types, enable/disable, price, currency, capacity, and asset requirements. Two short-form watermarks are one bundle; capacity counts bundles, not shorts.
- Staff-configured shared price suggestions, initially empty rather than invented prices. Creator rates remain independent.
- Episode opportunity drafts: title, topic, guest, estimated release date, estimated duration, pitch, request deadline, and per-episode placement snapshots. These are sales opportunities, not production episodes; creating one does not generate staff tasks.
- Draft → Nilli review → approved share page → closed. Feedback returns review to draft. Creator can withdraw a review submission. Approved details/prices are frozen. Changes to an approved opportunity currently require a new draft coordinated by Nilli; don't silently overwrite published promises.
- Staff review and brand request intake at `/creator-portal/sponsorship-admin.html` on the **staff app origin**, linked from `/portal-admin`.
- Approved offer page at `/opportunity.html#<random-token>` on the portal origin. Anyone with the link can see only approved creator name, episode pitch, dates, placement prices/requirements and remaining capacity. No buyer contacts, staff notes, account IDs or other requests are exposed. Close a page to stop requests. Archiving the creator makes the page unavailable.
- Brand requests use an email CTA to info@nillistudio.com. Nilli records the request in staff intake. This opens the brand's mail app; it does not send mail automatically or reserve inventory.
- Pending requests reserve nothing; only a creator can accept. Staff cannot impersonate acceptance, including through creator preview. Staff can cancel requests. Cancellation releases capacity without changing other requests.
- Quote snapshots retain the offered price, currency, placement requirements and capacity. All mutations serialize on the creator row in Postgres. Competing brand requests are permitted; confirmed count cannot exceed placement capacity.
- Announcement text preview is available after approval. It states that no emails have been sent. There is no send service, delivery queue, weekly digest or recipient selection in this release.
- Draft input survives tab changes and errors in the same login session. Browser reload/sign-out clears unsaved local drafts, consistent with the portal's current session behavior. Server-saved drafts persist.

## Deployment gate

Apply `supabase/migration_portal_sponsorships.sql` to the **staff/data Supabase project**, after `migration_portal_clients.sql`. It creates five service-role-only tables plus one RPC. No staff task, billing, QBO or completion logic changes. Deploy API and static portal together after the migration. Do not merge/deploy UI while the schema is missing.

Existing `PORTAL_ORIGIN` must be set to the portal origin; public offer links use it. No new credentials required for this release. Staff UI must be opened on app.nillistudio.com, not the separate static portal deployment.

No production migration has been applied by this implementation session. No live emails sent; no production booking data created. Test real creator and staff auth in a staged deployment before production activation.

## API / security

- GET/POST `/api/portal/sponsorships`: existing creator identity and enabled active client mapping. Preview is read-only. POST origin must match PORTAL_ORIGIN.
- GET/POST `/api/portal/admin/sponsorships?client_id=...`: active admin/ops session; writes same-origin; server validates active client. Client ID in POST body.
- GET `/api/portal/opportunity?token=...`: random UUID-pair share identifier; allowlisted response only. API responses are private/no-store and permit only configured portal CORS.
- All tables have RLS with no browser access. RPC executable only by service_role. Service-role callers are responsible for verified actor, is_staff, validated payload and client mapping; do not expose the RPC through a direct browser client.
- Monetary values are positive fixed two-decimal amounts in USD/CAD/EUR/GBP; no currency conversion or tax computation for sponsorship quotes yet.
- Request deadline is an inclusive date evaluated in database UTC; offer page uses UTC too. A future date-range/timezone feature must change both consistently.
- Create IDs and intake keys make retries idempotent. Version checks stop stale menu/draft/status edits. Acceptance is idempotent and capacity-checked under a row lock.
- Responses list latest 100 opportunities. Pagination, search, withdrawal/cancellation notifications, bulk rate editing and per-client suggested rates remain future work.

## Approved product direction after the earlier master handoff

The older handoff's single affiliate link / views-only scope has been expanded by Francis:
- Creator integrations roadmap: YouTube first, then Facebook, Instagram, TikTok and LinkedIn. Show only genuinely supported connections and metrics. OAuth permissions, provider approval and actual connected accounts still need implementation. No fake connected buttons or analytics added in this release.
- YouTube analytics is a required creator feature; initial private metrics include last-28-day views, watch time, average duration, subscriber change, video performance and retention where supported. Channel owner OAuth required; invited Studio editor permission is not equivalent API access.
- Brand experience is email-led with optional portal drill-down: publication notices, important changes, action requests, weekly digest and month-end recap. Explicit recipient selection/preferences, verified sender, queue retries, idempotency and unsubscribe categories must precede automatic delivery. User agreement to build does not mean send unsolicited mail now.
- Reusable brand Offers: destination/product URLs provided once, plus creator–brand affiliate relationship and existing code/link. Nilli generates a unique link for each video × brand placement, preserving original commission ownership.
- Revenue by video requires the affiliate/checkout system to retain a sub-ID/shared reference and report conversions. Without it, show per-video clicks plus creator-level reported revenue, or views/clicks only. Never infer episode sales from a generic code or show disconnected revenue as zero.
- Keep YouTube ad revenue, creator sponsorship fees/commissions and attributed brand sales separate. Brand revenue divided by sponsorship spend is ROAS, not profit ROI.
- Pilot one brand and its actual sales system before generalized integrations. Preserve refunds, transaction deduplication, attribution rules/windows and reporting provenance. Proposed 30-day last-click rule is not yet a finalized accounting rule.

## Next work in sequence

1. Apply migration to a staging database and exercise real staff/creator authentication, inactive mappings, public link revocation through closure/archive and complete request lifecycle.
2. Set Nilli's actual suggested rate card; no suggested dollar values have been agreed.
3. Connect opportunities/confirmed placements to production episodes and track both shorts in a two-short bundle. Published URLs/dates must remain distinct from production completion.
4. Implement provider authorization and YouTube synchronization. Register/verify provider apps and obtain owner consent. Add other creator connectors incrementally according to supported account types/scopes.
5. Add brand contacts, subscriptions, verified email delivery, recipient preview/approval, durable outbox and weekly reporting. Keep confidential draft pitches out of emails until approval.
6. Add reusable offers/affiliate records and stable unique tracked links. Then pilot one conversion integration and revenue reporting.
7. Add brand self-service request intake with verified identity, rather than trusting user-supplied email/brand IDs. Current email-to-Nilli intake is deliberate and honest.

## Validation

`node tests/portal-sponsorships.cjs` runs real SQL in PGlite: idempotent migration, validation, tenant ownership, stale version rejection, immutable approved details, duplicate request/create protection, two competing last-slot acceptance attempts, creator-only acceptance, cancellation, expired request deadlines, service-only privileges. This is not a production connection test; true independent PostgreSQL session concurrency remains a staging check.

Existing portal access, production, dashboard and creator UI regression tests are run alongside TypeScript checking. `tests/portal-sponsorship-ui.mjs` exercises the actual shared module in happy-dom with stubbed API data: menu saving, opportunity creation, draft and idempotency-key preservation across remount, submission and read-only preview. Run with `DOM_TEST_MODULE` pointing to an installed happy-dom module (a temporary installation avoids changing project dependencies). DOM tests do not verify browser layout or production authentication.

Validation performed: production `npm run build` succeeded, TypeScript passed, the sponsorship SQL/validation test passed, the DOM test passed, and all 18 existing access/production/dashboard/creator UI regression cases passed. `git diff --check` passed. Visual desktop/mobile browser QA remains outstanding: the runtime has no Chromium binary and the Playwright browser download returned an invalid archive. No claim of screenshot, mobile layout or live creator testing is made.
