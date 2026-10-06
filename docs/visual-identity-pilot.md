# Ardore visual identity pilot

A deliberately limited presentation pilot: Practice & Rhythm's person-to-offer relationship, Personal Editions' calm hierarchy and Open Catalogue's comparable commercial information. No decorative connecting line, new design system, stock portraits or invented proof.

## Scope

- Shared CoachCard: actual 4:5 portrait, stronger name, short positioning, up to three textual specialties, existing offer formats, real 1:1 price/duration and trusted verification only.
- Shared ProductCard: actual 16:9 cover, format, strong title, persistent creator/avatar attribution, metadata, price and genuine reviews. Separate product/creator/favorite targets remain.
- Public storefront: **only `/creators/jonas-weber`**, an existing public demo profile. Compact identity and real offer navigation; shared product cards with existing purchase/review controls, actual subscription/booking widgets, then about/coach-supplied qualifications. Other creator profiles retain their composition. No inventory/slug changes; unavailable offer types are not invented. Pilot subscription presentation does not imply popularity based on tier order.
- Authenticated `/creator` home: upcoming/current appointments and task links first, compact ledger information second, existing products/subscribers and expandable financial details. Existing calendar, session, offer and financial destinations remain. This does not redesign other workspace routes or the shared shell.

The homepage composition, navigation, marketplace filtering/search, foundation tokens and all business logic are unchanged. Shared cards naturally update wherever already reused, including homepage discovery; no additional page redesign is propagated.

## Protected reads

The dashboard continues to resolve the authenticated user and their creator profile before loading data. Bounded session-client/RLS reads fetch their next five confirmed/pending bookings and ten most recent starts within the last 24 hours; only still ongoing/upcoming appointments are displayed. Finished appointments cannot exhaust the future query limit. The two result sets are merged by booking ID and ordered by appointment time. Payment/status labels come from the existing presentation model; no inferred completion or new eligibility rules.

Meeting readiness reads only `booking_id` from the existing participant-protected table. Private meeting URLs and customer email addresses are not fetched for this overview. Missing and failed reads are distinguished. Earnings come from the unchanged canonical report and warnings remain available in native expandable details; test mode, outstanding refund/reversal tasks and the distinction between transfers and bank payouts stay explicit.

No write query, migration, new auth claim, authority change, checkout behavior or production fixture is added. Stripe test mode and Daily disabled state are untouched.

## Verification

`node --test scripts/verify-visual-identity-pilot.mjs` renders actual pages/components with in-memory synthetic reads: pilot-only scope, publication filters, existing purchase/subscribe controls, qualification provenance, authenticated coach isolation, meeting URL minimization, pending/free labels, read failures and appointment-before-finance ordering. Existing creator recovery adapters support the new read-only methods; their recovery assertions remain intact.

`node scripts/preview-visual-identity-pilot.mjs` uses the production build CSS and actual SSR pages/components on loopback port 3012, with synthetic reads and clearly labelled local data. Preview purchase/subscribe controls are inert adapters; they do not test payment execution. Workspace fixtures do not constitute an authenticated production end-to-end test. No production users or bookings are created.

Check cards, storefront and coach home at 375, 390, 768, 1280 and 1440 px, plus empty/error states and keyboard access to native details/links. Public production storefront/cards can be checked anonymously; authenticated production home remains protected.

## Remaining content dependencies

Real coach portraits and product covers are still missing from the current demo inventory. Neutral existing fallbacks are intentional. Review the pilot with real authorized assets before extending its composition to more pages; homepage remains Phase 2.
