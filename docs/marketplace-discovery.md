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

## Horizontal discovery shelves

`/marketplace` and `/coaches` reuse the homepage's `DiscoveryRail` and compact coach layout. The default product overview contains newest, genuinely reviewed products, available courses/free offers and useful topic subsets. Coach shelves contain new profiles, enabled 1:1 offers, active subscriptions and useful topic subsets. All published inventory topics remain accessible through horizontally scrollable topic links, including topics too small for a separate shelf.

Preview shelves show up to twelve items and link to their complete filtered collection. An explicit sort, search or active filter opens one horizontal results rail in the requested order. Product results retain twenty items per page and their existing page controls; coach results retain every matching profile. The “Übersicht” sort option returns an unfiltered collection to its shelves. Product rating previews and complete results share the existing weighted rating comparator; the homepage's established rating order is unchanged.

Topic links preserve search and applicable filters, including a zero price, and reset product pagination. Existing query URLs, history restoration, legacy coach/group filters, favorites, product/profile links and mobile filter behavior remain supported. No data queries, publication scope or commercial flows change.

## Accessibility and responsive behavior

Discovery cards form one horizontally scrollable row per section at every width, with a partial next card on narrow screens. Native touch/trackpad scrolling, labelled previous/next buttons and focused-list ArrowLeft/ArrowRight/Home/End navigation remain available. Controls preserve focus at scroll boundaries, and pointer scrolling honors reduced motion; keyboard scrolling is immediate. Results rails reset their position after query changes, and loading placeholders use the same horizontal geometry. Creator identity remains visible on mobile. Product titles reserve two lines; prices carry one-time/free context. Favorites remain independent buttons and creator links are not nested within product links. Controls retain foundation focus/contrast/targets. Existing product filter-sheet focus management is preserved; coach filters use a native modal dialog with focus trap, Escape, inert background and trigger restoration. Empty/error messages retain their recovery actions.

## Verification

`node --test scripts/verify-marketplace-discovery.mjs` renders actual components for scope, public prices, truthful badges, shared search URLs, long titles, free products and primary read errors (also covered by foundation regressions).

`scripts/verify-marketplace-shelves.mjs` and `scripts/verify-coach-discovery-shelves.mjs` add isolated component/navigation fixtures for honest shelves, 45-product pagination, complete coach results beyond preview limits, combined filters, topic URLs, sort transitions and empty recovery. Browser checks cover desktop and mobile discovery, horizontal pointer/keyboard scrolling, search, sorting, topics, history restoration and mobile dialogs against public read-only local inventory.

`node scripts/preview-marketplace-discovery.mjs` binds only to 127.0.0.1:3012 after a production build. `/` renders actual cards with deliberately long synthetic names/titles and missing images; `/empty`, `/loading`, `/error` render actual shared states. No Supabase, auth, Stripe, email or production writes are performed. This SSR preview is for layout edge cases; interactive filters/search are tested through the actual Next app.
