# Trusted authority and coach-controlled commercial offers

Coaches retain all existing owner-scoped commercial write privileges for product
prices, service prices, monthly subscription prices and coaching-offer prices.
Titles, descriptions, durations, availability, publication/active switches,
benefits and offer configuration remain coach-controlled. No price cap, pricing
approval, price freeze or new commercial field restriction was introduced.

Authority is separate from commercial configuration:

- Browser clients cannot insert/update Stripe account identity, Stripe
  payout/charge eligibility, Ardore verification timestamps/flags or demo flags.
  Creator identity cannot be reassigned to impersonate another storage owner.
- Subscription, purchase, booking, group-class entitlement and verification
  decision records are server-written. Owners retain scoped reads.
- Validated free offers still issue legitimate free benefits through the server.
  Paid subscription benefits require a trusted active, unexpired live subscription;
  Stripe test subscriptions do not unlock production paid functionality.
- Checkout checks every billed product, tier/creator binding and discount scope.
  New subscription charges use the coach's current configured price, ignoring
  stale/client-controlled Stripe price caches. Existing contracts are not repriced.
- A coach disabling future tier sales does not hide an existing buyer's tier or
  erase correctly issued benefits. Coach edits to tier pricing do not invalidate
  previously issued legitimate free subscriptions.
- Private product access requires an exact purchase and the product's own creator
  storage folder; changing a product URL cannot grant another coach's files.

Deployment order: deploy the compatible service-write API routes first, then apply
`20261001230728_protect_trusted_entitlements.sql`. The production Supabase migration
history uses the same version. No existing rows or commercial values are migrated.

## Verification on 2026-10-02 (Europe/Berlin)

- Lint: no errors, five preexisting warnings. TypeScript and production build passed.
- 40 focused real-code behavior tests passed, with mocked providers/database.
- `supabase/tests/trusted_entitlements_test.sql`: 453 read-only catalog assertions
  passed against production.
- Production tests: 37 unauthorized authority writes rejected; 17 permitted coach
  content/commercial operations succeeded, including product/tier/service pricing,
  offer pricing including zero, and availability.
- Production server free subscription, previously purchased inactive-tier access,
  and subscriber chat succeeded. A foreign coach's free tier was rejected.
- One unpaid Stripe TEST checkout used the updated product price and only billed
  product metadata. It was expired without payment or booking.
- The application-generated safe synthetic subscriber notification was delivered
  by Resend. No real customer/coach was emailed.
- Three synthetic accounts and all their new dependent fixtures were removed.
  Existing user/data counts and product, tier and creator row digests matched the
  pre-test snapshot exactly. Existing two free subscriptions were preserved.
- Supabase security advisor findings were unchanged. Existing public projection /
  scoped read-only function notices and leaked-password protection configuration
  are outside this focused authority change.

Useful tests:

```sh
node --test scripts/verify-checkout-authority.mjs scripts/verify-subscription-authority.mjs scripts/verify-stripe-connect-authority.mjs scripts/verify-product-download-authority.mjs scripts/verify-group-entitlement.mjs scripts/verify-purchase-receipts.mjs
npm run lint
npx tsc --noEmit --incremental false
npm run build
```

This closes the audited authority/entitlement write bypasses. Other product audit
launch blockers still require separate work; it is not a claim of complete launch
readiness or a comprehensive penetration test.
