# Ardore visual foundation — Phase 1

This phase changes presentation only. It keeps existing routes, page sections, query scope, pricing, payment/refund/settlement semantics, publishing and auth behavior. No database migration or production fixture writes.

## Tokens

`src/app/design-foundation.css` owns the warm neutral and forest-green palette, semantic surfaces/text/border/status colors, radii, shadows, spacing and container widths. Existing gray/green Tailwind classes inherit the evolved palette, so legacy pages also share the foundation. Status blue/amber/red remain distinct.

- Geist Sans: body 16/24, secondary 14/20, metadata 12/16.
- `card-title`: 16/22, weight 600, wraps long words.
- `section-title`: 24 → 28 → 32; `page-title`: 32 → 48 → 56.
- Spacing: 4, 8, 12, 16, 24, 32, 48, 64.
- `ardore-container`: 1280px public maximum; `ardore-workspace`: 1200px workspace maximum.
- Horizontal gutters: 16px mobile, 24px at 640px, 32px at 1024px.
- Cards: 16px radius and subtle border. Controls: 12px. Dialogs: 20px.
- Shadows: subtle interactive hover; floating menus/dialogs/toasts use the elevated token.
- Contrast tests cover main/secondary text, primary action, status foregrounds and control borders.

## Components

- Button: primary, secondary/outline, tertiary/ghost, destructive/danger and soft. Existing variant names remain compatible. All sizes retain a 44px minimum target. `ButtonLink` is an anchor, never a button inside an anchor. `IconButton` requires an accessible label. Loading disables activation and sets aria-busy.
- Input, Textarea, Select, Checkbox, Radio: shared controls, stable/generated IDs, associated feedback and labels. External aria-describedby is preserved. Feedback supports error, helper and success text.
- Card: default, panel and elevated; optional interactive border/focus treatment.
- Badge: neutral/success/warning/danger/info/outline, explicit text plus optional decorative icon.
- BookingStatusBadge reuses existing authoritative presentation labels/styles. PublishBadge and VerificationBadge only display states supplied by trusted callers; they do not grant authority.
- ProductThumbnail: 16:9; CoachPortrait: 4:5; Avatar: circle. Media reserves geometry and falls back neutrally on absent/failed assets. No invented photography or trust data.
- PageContainer, PageHeader and SectionHeader for subsequent page migrations.
- StatePanel distinguishes empty, error and loading with explicit copy, roles and optional recovery actions.
- Skeleton product geometry matches the actual 16:9 card media.

## Adoption and phase boundary

Shared components, public navigation, auth shell, product/coach card foundations, product media, coach-profile fallbacks, workspace containers, booking badges and representative dashboard panels adopt these rules. Safe terminology is German: Marktplatz, Zurücksetzen, Ausstattung. The unsubstantiated “Hunderte Premium-Inhalte” claim is removed.

Homepage sections, marketplace grids/filter semantics, profile/storefront hierarchy, calendar time-axis architecture and dashboard content priorities are intentionally deferred to later phases. Legacy local compositions remain supported and inherit central tokens; this is not a claim that every local component has been replaced.

Reduced motion and existing cancellation/rescheduling modal behavior are preserved. No Stripe mode, Daily flag, infrastructure, legal text or production data changes.

## Verification harness

Run `node scripts/preview-design-foundation.mjs` after a production build and local Next start on port 3010. Port 3012 binds only to 127.0.0.1 and renders the actual dashboard/calendar components using in-memory synthetic read fixtures. It is a visual SSR preview, not an authenticated end-to-end test. It performs no database writes, payments or email requests. Public pages are also checked through the local production build against read-only public inventory.
