# Ardore

Next.js marketplace for health coaching. Production runs on
[www.ardore-health.com](https://www.ardore-health.com) with Hostinger Node.js hosting.

## Development

Install dependencies with `npm ci`, configure the local `.env.local`, then run:

```bash
npm run dev
```

The development server runs on `http://localhost:3000`. See [SETUP.md](SETUP.md)
for service configuration. Keep credentials out of source control.

## Validation

```bash
npm run lint
npx tsc --noEmit
npm run build
```

## Production

Hostinger builds the connected GitHub `main` branch using Node.js 22 and
`npm run build`, with `.next` as the output directory. Production environment
variables are managed in hPanel. Confirm each deployment completes before checking
the public site.

Scheduled reminders, review prompts, and verification-document cleanup run through
[GitHub Actions](.github/workflows/ardore-cron.yml). `ARDORE_BASE_URL` is
`https://www.ardore-health.com`; GitHub and Hostinger use the same `CRON_SECRET`.

Stripe remains in test mode. Daily video is disabled in `src/lib/features.ts`.
