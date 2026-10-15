# Homepage discovery shelves

The homepage `/` reuses the existing yoga-mat photograph behind its intro and
search form. A forest-green overlay keeps the white text readable; the form
remains opaque. The photograph is decorative, eagerly loaded, and uses the
existing image asset and provenance. The original three-step process section
and its photograph remain available further down the page.

`DiscoveryRail.tsx` renders native horizontal lists with scroll snapping,
44 px previous/next controls, and visible following-card previews. Visitors can
swipe or horizontally scroll, use the arrows, Tab through links normally, or focus
the list and use Left/Right/Home/End. Pointer navigation can scroll smoothly;
keyboard navigation is immediate and reduced-motion preference disables smooth
scrolling. Edge controls use guarded `aria-disabled` so keyboard focus survives
reaching the end. Only edge booleans are stored, never continuous scroll position.

Coach cards use an optional compact rail layout with the existing 80 px 4:5
portrait geometry. Coach-card defaults on other pages are unchanged. There is no
invented photography when a coach or product has no image.

`homeDiscovery.ts` derives up to 12 cards per product row from the existing public
inventory. It adds newest, best-rated, online courses, free items when present,
and up to two useful topic subsets. Valid positive review counts and actual
averages alone qualify a product for best-rated; unrated items never fill it.
Without available ratings, the row explains that rated products will appear
there later. Topic rows need at least two matches and cannot simply repeat the
whole inventory. All existing topic links are retained, without the old six-topic
display limit. The demo video moves below browsing and the process section.

All full-list links retain supported marketplace filter parameters. No server
queries, publication scopes, favorites, pricing, checkout, auth, or payment logic
were changed. No new dependency, data write, migration, or production release.

## Verification

- Full default local test suite: 675 passed, including nine new tests for honest
  rating eligibility, deterministic sorting, topic filtering, row limits, and
  non-mutation of input data.
- Lint: zero errors; four existing React Hook Form warnings. TypeScript,
  production build with CI placeholder service settings, and diff checks pass.
- Actual local homepage checked at 320, 390, 768, 1024, and 1440 px: no page-level
  horizontal overflow. Each populated list scrolls when its contents exceed the
  viewport; short rows keep inactive arrow controls.
- Browser checks cover pointer arrows, native horizontal scrolling, list arrow
  keys/Home/End, focus retention at the final item, and the Products/Yoga search
  route. All navigation buttons retain a 44 px target. Mobile testing used browser
  viewport sizes, not physical phones. Reduced-motion gating was reviewed in code.
- Public inventory was read through the existing local app; no authenticated
  account, favorite, checkout, payment, or email mutation was exercised.
- Local Node is v24.15.0; GitHub CI uses Node 22. The final PR CI verifies that
  runtime before release.
