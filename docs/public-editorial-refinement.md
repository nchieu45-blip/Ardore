# Public editorial refinement

This iteration builds on Phase 1 tokens and Phase 2 discovery. It changes presentation only.

## Composition

The homepage uses a split editorial hero, four visual topic cards drawn from current public taxonomy, and a left/right goal section. Goals appear only when a corresponding public category exists and link to the actual category filter. Unknown taxonomy keys are not advertised. Categories with coaches link to coach discovery; product-only categories link to products.

The product selection has a sage surface. A dark green story uses the actual shared ProductCard and current public product data; it is labelled as a marketplace preview and does not impersonate a private account, calendar, booking, or financial screen. A separate green coach CTA finishes the page. No borrowed photos, illustrations, copy, or assets are used.

The guest header prioritizes Coaches, Produkte, Für Coaches and Hilfe. The logo retains the home route; account controls and authenticated navigation remain intact.

## Photography handoff

`MarketplaceClient` accepts optional `heroImage: { src, alt }` and `categoryImages: Record<categoryKey, { src, alt }>` supplied by the public page. These are currently unset: no suitable approved photographs exist. `EditorialVisual` reserves geometry and uses the existing error-safe Next Image media component. Supply local public assets or existing approved storage paths; do not broaden image host permissions. Hero crop is 5:4 on desktop and 2:1 on mobile, so commission photography with a central subject and generous crop room.

Coach cards retain 4:5 real portraits and use names' initials plus “Ohne Profilfoto” when absent. Product covers remain 16:9 with a neutral file-format composition when absent. These are deliberate fallback graphics, not simulated photographs or fake product cover assets. Replace with genuine portraits (1200×1500 recommended) and covers (1600×900 recommended).

## Honest metadata

Trusted verification, actual 1:1 offer price, product review source, and independent favorite controls remain unchanged. No location or next availability is shown because the existing public model does not contain reliable data for those fields. Paid group offers are not promoted. Subscription links are shown in the story only when current public coaches offer subscriptions.

## Verification scope

Verify home, coaches, products, topic/goal links, and missing-image states at 375, 390, 768, 1280 and 1440 pixels. Marketplace remains compact. No database schema, production inventory, authority, payment, availability, auth, or Daily behavior is changed.
