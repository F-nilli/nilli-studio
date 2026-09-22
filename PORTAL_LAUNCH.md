# Shared portal launch

Creator uses the existing separate Supabase Auth project and existing portal account mappings. Brand is a coming-soon contact panel. No SQL or account migration is required.

## Vercel frontend

Use a dedicated static project linked to F-nilli/nilli-studio. Reuse nilli-studio-cdfy only after confirming it has no active staff traffic or unrelated domains.

- Root Directory: public/creator-portal
- Framework: Other
- Build Command: leave empty (override any old Next.js build command)
- Install Command: leave empty
- Output Directory: .
- Production Branch: main
- Domain: portal.nillistudio.com

The nested vercel.json provides static output and response headers. Do not change the root production project's settings. No backend, QBO, or service-role secrets belong in the static frontend project. The only frontend configuration is its public API origin.

Add the exact DNS record shown by Vercel for portal.nillistudio.com. Do not guess the target or modify www/app records. Wait until HTTPS is valid before switching the backend origin or publishing the website login link.

## Authentication and backend cutover

In Supabase Nilli Creator Portal, Authentication > URL Configuration:
- Site URL: https://portal.nillistudio.com
- Add exact Redirect URL: https://portal.nillistudio.com/live.html
- Add exact Redirect URL: https://portal.nillistudio.com/live.html?page=settings
- Keep old URLs temporarily for in-flight email links; remove after migration is verified.

In Vercel nilli-studio, edit Production PORTAL_ORIGIN to https://portal.nillistudio.com (no trailing slash), then redeploy Production. This also updates staff View as creator ticket links. CORS remains restricted to the configured exact origin. Changing it intentionally retires API access from the previous Sites origin.

Do not change QBO redirect/webhook URLs, QBO secrets, PORTAL_AUTH_URL, PORTAL_AUTH_ANON_KEY, or production Supabase settings.

## Verification and website

1. Open the new domain root. Creator is selected; Brand shows coming soon with Contact Nilli and no credential fields. Check phone layout, keyboard tabs, and reduced motion.
2. Sign in with an existing creator account. Verify Dashboard, Production, Library, package, invoices, settings, and sign out.
3. Open View as creator from app.nillistudio.com. Confirm the new domain and full preview navigation.
4. Check an email-change confirmation flow using an authorized test account.
5. Publish the nilli-studio-web navigation PR only after the domain and real authentication pass. It adds Log in in desktop navigation and the mobile menu.

The root and live.html entry files intentionally match. Keep them synchronized.

Rollback: revert PORTAL_ORIGIN to its previous value and redeploy the backend to restore the old portal. Keep the old Sites deployment during the cutover.
