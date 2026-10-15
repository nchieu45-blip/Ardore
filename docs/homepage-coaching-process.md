# Homepage coaching process

The homepage `/` now pairs the existing yoga-mat photograph with a connected
visual journey in “So funktioniert Ardore”. Abstract search, profile-selection,
and calendar/library scenes replace the visible number circles. The three
original headings and descriptions remain unchanged and readable as an HTML
list. The coach landing page `/landing` keeps its existing photograph and layout.

`CoachingProcess.tsx` owns the static section. Its CSS is prefixed with
`coaching-process-` and imported with the existing global styles. No dependencies,
API calls, interactions, live inventory, prices, availability, or confirmation
claims were added. The existing 92.6 KB WebP is reused with reserved image geometry,
responsive sizes, and default lazy loading. Decorative diagrams are hidden from
assistive technology. There is no new motion or keyboard focus target.

On large screens the photograph sits beside the connected steps; below 1024 px
it becomes a landscape image above them. Body copy stays at 16 px.

## Verification

- Full default local fixture suite: 666 tests passed, no failures or skips.
- TypeScript, production build, and `git diff --check` passed.
- Lint: no errors; four existing React Hook Form compiler warnings remain.
- Browser checks: 320, 390, 768, 1024, and 1440 px. No horizontal overflow;
  image loaded, three steps retained, readable text and list semantics.
- The visual preview renders the actual section and production CSS locally,
  without database, authentication, Stripe, or email calls. It is not an
  authenticated full-site end-to-end test. The build uses CI placeholder service
  configuration; fetching the existing Geist fonts required network access.
- Local Node v24.15.0 differs from CI/production Node 22. Remote CI should verify
  the production runtime before release.

The source photograph and its generation provenance remain documented in
`docs/landing-image-prompt.md`. The new process itself uses responsive HTML/CSS
and the existing Lucide icon family, so it stays sharp without a new raster asset.

This change contains no migration, production data write, or deployment.
