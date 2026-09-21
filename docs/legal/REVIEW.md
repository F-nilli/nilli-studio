# Portal policy preparation and release review

Prepared September 21, 2026 against repository main commit `8481c88`.

## Outcome

The two policy texts now contain the confirmed legal name, mailing address and public contact, and no unresolved bracketed instructions. They remain review drafts, with an explicit not-yet-effective status. No change to retention, client access, accounting data, or provider authorization has been executed.

Prepared production-app URLs after deployment:

- https://app.nillistudio.com/legal/terms.html
- https://app.nillistudio.com/legal/privacy.html

These replace the earlier proposed marketing-site paths. Hosting legal documents on the production-app domain does not move the separate creator portal. Exact static files bypass authentication; all other routes retain their existing behavior. No JavaScript, remote fonts, analytics, database reads, new cron jobs, or image optimization calls are added by these pages. Ordinary static hosting requests and bandwidth still count toward hosting usage.

## Evidence and limits

| Area | Evidence | Result |
| --- | --- | --- |
| Creator authentication | Live public `/api/portal/config` and `lib/portal/store.ts` | Separate creator-auth project configured; identity-to-enabled-account mapping checked on reads. |
| Anonymous access | Live `/api/portal/me` without credentials | HTTP 401. |
| Creator isolation | Existing access tests and account filters | Unmapped creators rejected; account mapping checked; preview staff status rechecked. This is source/unit evidence, not a new live two-client penetration test. |
| Disable account | `creator()` checks `enabled` | Disabling Portal access denies subsequent protected reads. Template deactivation is not equivalent. |
| QBO credentials | `core.ts`, service-role schema | AES-256-GCM encrypted tokens and restricted database access in code/schema. Deployed RLS configuration has not been inspected in this turn. |
| PDF access | `invoicePdf()` | Account lookup plus fresh QBO customer ownership check; fetched on demand, response private/no-store. |
| QBO behavior | `qbo.ts` | Reads invoices/PDFs; no accounting writes. OAuth accounting scope is broader than this behavior. |
| Session storage | Creator `live.js` in repo and existing Site source | In-memory access/refresh tokens, no creator-interface marketing trackers or persistent browser storage. Provider-side cookies and logging were not independently audited. |
| Data locations | Earlier project screenshots | Creator-auth Canada; production database US. Provider subprocessors and account settings need separate verification. |
| Disconnect | Current API routes | No self-service revoke/disconnect implementation. Do not supply a fictional disconnect endpoint to Intuit. |
| Retention | QBO sync and database schema | Expired preview rows removed after successful sync; disabled-account data has no automatic deletion schedule. Policies now describe manual requests without promising automated cleanup. |

Seven existing security/core tests pass. TypeScript checks pass. Next's middleware matcher confirms the four exact legal files are public and protected/lookalike paths still match authentication middleware. The full app has not been redeployed and live policy URLs are not yet available.

## Proposed retention procedure for Francis to adopt

These are recommended operational targets, not existing automated behavior or statutory retention periods. Do not run destructive cleanup until ownership, accounting requirements and legal holds are checked.

| Records | Proposed handling | Who/action needed |
| --- | --- | --- |
| Portal access after permanent client closure | Disable promptly after verifying the request; distinguish temporary suspension from permanent closure | Admin/ops disable Portal account, not just Templates client |
| Creator-auth identity, Portal mapping, payment URL and cached invoices | Review and remove within 30 days of permanent closure, unless a documented legal/security reason requires retention | Manual reviewed deletion across the two Supabase projects; no deletion script is included |
| Required invoices and accounting records | Keep in QuickBooks under accountant-approved tax/accounting schedule | Accountant confirms applicable periods; do not assume Portal deletion deletes source records |
| QBO OAuth credentials | Revoke and remove when the integration is permanently disconnected | Implement and test explicit disconnect flow; no automatic cache erasure promise |
| Expired OAuth/preview entries | Aim to clear within 24 hours after expiry | Current cleanup depends on successful sync; independent cleanup is a future change |
| Routine application logs | Target no more than 30 days where configurable and sufficient; retain specific incident evidence only while needed | Verify actual Vercel, Supabase and Sites settings first; do not promise a provider-wide limit |
| Support requests | Review 12 months after resolution; keep contractual/dispute evidence separately if necessary | Manual review by Francis |
| Backups | Follow verified provider expiration; prevent deleted data from being reintroduced after restoration | Confirm actual plan retention and restore procedures; no invented purge deadline |

No new cron or recurring management task has been scheduled. A later implementation can automate approved cleanup after permanent-closure timestamps and legal-hold controls exist.

## Practical request procedure

Francis owns the info@nillistudio.com inbox for privacy requests. Verify requester identity without collecting unnecessary documents. Record the request, applicable deadline, affected systems, decision and completion. Disable access when requested and authorized. Consult the accountant before deleting source accounting records. Explain any lawful exception and recourse. Handle account closure and QBO company disconnection as separate actions. Record and assess suspected incidents, escalating and notifying as required by law.

## Publication and Intuit next steps

1. Francis reviews the two texts and adopts the proposed manual privacy-request process. Decide whether to adopt the proposed retention targets or keep the current criteria-based manual policy pending automation.
2. Review Quebec legal and French-language requirements with counsel. No compliance attestation has been made.
3. Set the effective date in both Markdown files, remove their draft status and regenerate with `python3 scripts/build-policy-pages.py`. Remove `noindex` if indexing is wanted. Deploy this branch after review.
4. Verify both URLs return public HTML without sign-in, including for signed-in staff. Add the verified public URLs to the separate creator-hosted sign-in screen during its next release, and implement appropriate terms acceptance before relying on click-through agreement. Do not add broken links before these pages are deployed.
5. Paste the two verified URLs into Intuit. Production credentials may also require the separate disconnect implementation and accurate questionnaire answers; these pages alone do not complete that work.

Reference: [Quebec CAI privacy-policy guidance](https://www.cai.gouv.qc.ca/uploads/pdfs/CAI_GU_POL_Confidentialite.pdf). The guidance distinguishes a public notice from consent and internal governance; a policy page does not implement the process it describes.
