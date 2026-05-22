# Ardore – Setup-Anleitung

## 1. Supabase einrichten

1. Erstelle ein Projekt auf [supabase.com](https://supabase.com)
2. Gehe zu **SQL Editor** und führe `supabase/schema.sql` aus
3. Gehe zu **Settings → API** und kopiere:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Unter **Authentication → URL Configuration**, setze:
   - Site URL: `http://localhost:3000` (Dev) / deine Produktions-URL

## 2. Stripe einrichten

1. Erstelle ein Konto auf [stripe.com](https://stripe.com)
2. Aktiviere **Stripe Connect** unter Dashboard → Connect
3. Kopiere aus **Developers → API Keys**:
   - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
   - `STRIPE_SECRET_KEY`
4. Webhook erstellen unter **Developers → Webhooks**:
   - Endpoint: `https://deine-domain.com/api/webhooks/stripe`
   - Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Kopiere den **Signing Secret** → `STRIPE_WEBHOOK_SECRET`

## 3. .env.local befüllen

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...

NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## 4. Entwicklungsserver starten

```bash
npm run dev
```

## 5. Auf Vercel deployen

```bash
# Vercel CLI
npm i -g vercel
vercel --prod
```

Setze alle Umgebungsvariablen in den Vercel-Projekteinstellungen.

Für lokale Webhook-Tests verwende [Stripe CLI](https://stripe.com/docs/stripe-cli):
```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```
