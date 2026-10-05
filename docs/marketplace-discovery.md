# Marketplace discovery — Phase 2

Homepage, shared ProductCard/CoachCard and the two discovery routes use the Phase 1 foundation. Dashboards, full coach profiles and business flows are unchanged. No database migration, inventory update, payment, email or authenticated fixture is needed.

## Discovery and truthful presentation

- Homepage: compact hero with explicit coach/product search intention; goals drawn from published inventory; four coach cards; four newest products; real offer formats; factual guidance; three steps; collapsed optional AI help; one creator section.
- `/coaches` and `/marketplace` retain their existing canonical routes and URL filters. Shared navigation carries only `q` and `category` between them. Both searches normalize spaces, persist in the URL, restore through history and search names/topics. The product search also matches descriptions. There is no combined search backend or combined result list: the active intention is explicit and the other search is one action away.
- Product filters distinguish file/offer format, category, price, level, equipment and duration. Coach attributes belong in coach discovery. Existing `coaching`/`group` product URLs still filter as before, with explanatory active chips, but are no longer promoted as product types. Legacy coach `groupclasses` URLs remain supported without advertising disabled group checkout.
- Default product order is newest. Old popularity URLs retain their actual sales-count sort and a descriptive legacy label; no “Beliebteste” claim. Existing product review sorting remains supported.
- Public coach model uses the same authenticated/anonymous RLS client and published profile scope as before. Optional price comes exclusively from an enabled coaching offer, never a digital product. Its actual duration is shown. Availability is not invented. Product-derived coach reviews are explicitly labelled product reviews. Only trusted `is_verified` produces a verification badge.
- Product data stores `pdf/video/course/image`, not a rich commercial offer taxonomy. Cards use conservative format labels (Digitales Produkt, Video, Online-Kurs, Bildmaterial), with file format as secondary metadata. More specific “Trainingsplan”, “Guide” or service classification requires explicit content metadata; titles/pricing/types are not rewritten.
- No comparison prices, bestseller badges, fabricated faces, ratings, popularity or inventory counts are introduced. Existing demo/test publication states are unchanged.

## Assets

Use actual uploaded assets, not stock stand-ins. Media reserves space and uses the neutral Phase 1 fallback on missing/failed images.

- Product thumbnail: **16:9**, recommended **1600 × 900 px**, minimum useful 800 × 450. Avoid essential text near edges; cards crop to cover.
- Coach portrait: **4:5**, recommended **1200 × 1500 px**. Keep face and shoulders near the center with safe margins. Existing `avatar_url` supplies the image; no duplicate storage field is added.
- Upload a real portrait/thumbnail through existing management. Missing production assets remain a launch-content dependency.

## Accessibility and responsive behavior

One-column cards at 375/390; two at 768; four at wide desktop (1280/1440). Creator identity remains visible on mobile. Product titles reserve two lines; prices carry one-time/free context. Favorites remain independent buttons and creator links are not nested within product links. Controls retain foundation focus/contrast/targets. Existing product filter-sheet focus management is preserved; coach filters use a native modal dialog with focus trap, Escape, inert background and trigger restoration. Loading geometry and empty/error messages match discovery.

## Verification

`node --test scripts/verify-marketplace-discovery.mjs` renders actual components for scope, public prices, truthful badges, shared search URLs, long titles, free products and primary read errors (also covered by foundation regressions).

`node scripts/preview-marketplace-discovery.mjs` binds only to 127.0.0.1:3012 after a production build. `/` renders actual cards with deliberately long synthetic names/titles and missing images; `/empty`, `/loading`, `/error` render actual shared states. No Supabase, auth, Stripe, email or production writes are performed. This SSR preview is for layout edge cases; interactive filters/search are tested through the actual Next app.
