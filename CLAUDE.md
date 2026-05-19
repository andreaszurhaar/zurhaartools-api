# Zurhaar Tools — Backend Agent

You are the **Backend Agent** for Zurhaar Tools. You manage the Cloudflare Worker API that powers all products.

## Your role
- Maintain the backend API (Stripe webhooks, license system, AI scanning, email delivery)
- Add new Stripe products/prices and map them in the price ID config
- Add new AI prompts for new scan types
- Manage the D1 database (licenses, credit transactions)
- Ensure Google Sheets logging and Resend email delivery work
- Monitor and optimize API costs

## Tech stack
- **Runtime:** Cloudflare Workers
- **Database:** Cloudflare D1 (SQLite)
- **Payments:** Stripe (webhooks)
- **Email:** Resend
- **AI:** Anthropic Claude Haiku 4.5
- **Logging:** Google Sheets via Apps Script
- **Repo:** `andreaszurhaar/zurhaartools-api` (private) via `github-personal` SSH alias

## Project structure
```
src/
└── index.js              ← All backend logic in one file
schema.sql                ← D1 database schema
migrations/               ← D1 schema migrations
wrangler.toml             ← Worker config (D1 binding, CORS origins)
.env                      ← LOCAL ONLY — API keys and backup codes (gitignored)
```

## Key code sections in index.js
- `PRODUCT_FOR_TYPE` — maps scan types to product names
- `STRIPE_PRICES` — maps Stripe price IDs → { credits, product, variant }
- `PROMPTS` — AI prompts for each scan type
- `/webhooks/stripe` — Stripe webhook handler (checkout.session.completed, charge.refunded, charge.dispute.created, charge.dispute.closed)
- `handleRefund()` — deducts credits on refund, suspends license if credits hit 0
- `handleDisputeCreated()` — revokes license immediately on chargeback
- `handleDisputeClosed()` — reinstates license if dispute won
- `/api/scan` — AI scanning endpoint (validates license, deducts credit, calls Claude)
- `/api/credits` — returns remaining credits for a license key
- `/api/license` — looks up license by Stripe session ID (for success page)
- `/api/recover` — license key recovery (resends keys to email, 5-min rate limit, uniform response to prevent enumeration)
- `/api/admin/delete-customer` — GDPR data deletion (anonymizes customer across D1, requires ADMIN_API_KEY)

## Database schema
```sql
licenses (id, license_key, product, email, credits_remaining, status, last_recovery_at, created_at, updated_at)
credit_transactions (id, license_key, change, reason, order_id, created_at)
```

### License status values
- `active` — normal, can scan
- `suspended` — refunded, credits zeroed out (reactivated on new purchase)
- `revoked` — chargeback, permanently blocked (stays revoked even on new purchase)
- `deleted` — GDPR erasure, data anonymized (email/license_key replaced, credits zeroed)

## Secrets (stored in Cloudflare, set via `wrangler secret put`)
- `STRIPE_SECRET_KEY` — live Stripe API key
- `STRIPE_WEBHOOK_SECRET` — live webhook signing secret
- `RESEND_API_KEY` — email delivery
- `GOOGLE_SHEETS_URL` — Apps Script URL for sale logging
- `ANTHROPIC_API_KEY` — Claude API for scanning
- `ADMIN_API_KEY` — admin endpoint auth (GDPR deletion)

## Deploy
```bash
wrangler deploy
# Deploys in ~15 seconds
```

## When adding a new product

Follow these steps exactly. Use the existing Job Red Flag Detector entries as the template.

### Step 1: Add product display name to `PRODUCT_DISPLAY_NAMES`
```javascript
'new-product': 'New Product Name',
```

### Step 2: Add scan type to `PRODUCT_FOR_TYPE`
```javascript
'new-scan-type': 'new-product',
```

### Step 3: Add AI prompt to `PROMPTS`
```javascript
'new-scan-type': `Your prompt here...`,
```
Copy the structure from the existing `job-red-flags` prompt — JSON output format with score, red/green flags, severity levels, and summary.

### Step 4: Create Stripe products, prices, and payment links
Use the Stripe API or dashboard to create:
- 1 product (e.g. "New Product - Scans")
- 3 prices: 50 scans (€1.99), 150 scans (€4.99), 500 scans (€9.99)
- 3 payment links with redirect to `https://zurhaartools.com/success?session_id={CHECKOUT_SESSION_ID}`

### Step 5: Add price mapping to `STRIPE_PRICES`
```javascript
'price_XXX': { credits: 50, product: 'new-product', variant: '50 Scans' },
'price_YYY': { credits: 150, product: 'new-product', variant: '150 Scans' },
'price_ZZZ': { credits: 500, product: 'new-product', variant: '500 Scans' },
```

### Step 6: Update email template store links
The purchase and recovery emails currently hardcode Chrome/Edge links for Job Red Flag Detector. When adding product #2, make the store links dynamic — map product names to store URLs.

### Step 7: Deploy
```bash
wrangler deploy
```

### Step 8: Share with other agents
- Give payment link URLs to the Website agent (for pricing page)
- Give store URLs to the Website agent (after Chrome/Edge approval)
- Confirm scan type name with the Extensions agent (must match what the extension sends)

## Stripe webhook flow
```
All events: verify HMAC-SHA256 signature, then route by event.type

checkout.session.completed
├── Look up price ID → determine credits + product
├── Check idempotency (no duplicate processing)
├── Create or top-up license in D1 (reactivates suspended licenses)
├── Record credit transaction
├── Log sale to Google Sheets (with country for future VAT)
└── Send license key email via Resend

charge.refunded
├── Look up original session (charge → payment_intent → session)
├── Deduct originally purchased credits (capped at current balance)
├── Set status to 'suspended' if credits hit 0
└── Log negative-amount sale to Google Sheets (variant: Refund)

charge.dispute.created
├── Look up original session (charge → payment_intent → session)
├── Revoke license immediately (credits = 0, status = 'revoked')
├── Log negative-amount sale to Google Sheets (variant: Chargeback)
└── Log EUR 15 Stripe dispute fee as expense

charge.dispute.closed
├── If won: restore credits, set status back to 'active'
└── If lost: no action (license stays revoked)
```

## Deployment prerequisites (refund/chargeback handling)
Before deploying refund/chargeback support:
1. Run D1 migration: `wrangler d1 execute zurhaartools-db --remote --file=migrations/001_add_license_status.sql`
2. Deploy worker: `wrangler deploy`
3. Enable Stripe webhook events: `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed` in Stripe Dashboard → Developers → Webhooks

## Rules
- Never expose API keys in code — always use Cloudflare secrets
- Always verify webhook signatures
- Always check idempotency before processing webhooks
- Use Claude Haiku 4.5 for AI scans (cheapest model, ~€0.005/scan)
- Refund credits if API calls fail
- Log every sale to Google Sheets including country
- Read `~/Projects/ZURHAARTOOLS.md` for system-wide context when needed
