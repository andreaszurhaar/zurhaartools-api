# Gumroad → GitHub Repo Access Flow — Design Doc

> **Status:** Design only. No implementation yet.
> **Author:** Backend Agent (May 20, 2026)
> **Product:** Chrome Extension Kit (€99–€299, lifetime access to private GitHub template repo)
> **Promise:** "If you pay for something, you have it forever."

## 1. Summary

Buyer pays on Gumroad → Gumroad fires a `sale` ping to our Cloudflare Worker →
worker reads the buyer's GitHub username from a Gumroad custom checkout field →
worker calls GitHub REST API to invite the buyer as a collaborator on a private
template repo (`pull` permission) → worker logs the purchase in D1 and sends a
Resend email with the GitHub invite link and instructions. Refunds within
14 days trigger collaborator removal via the GitHub API. Forgotten/typo'd
usernames are recovered via a self-service `/api/kit/redeem` endpoint.

---

## 2. End-to-End Purchase Flow

### Sequence diagram

```
┌────────┐    ┌──────────┐    ┌──────────────┐    ┌────────┐    ┌────────┐    ┌──────────┐
│ Buyer  │    │ Gumroad  │    │  CF Worker   │    │   D1   │    │ GitHub │    │  Resend  │
└───┬────┘    └────┬─────┘    └──────┬───────┘    └───┬────┘    └───┬────┘    └────┬─────┘
    │              │                 │                │             │              │
    │ click Buy    │                 │                │             │              │
    ├─────────────▶│                 │                │             │              │
    │              │ checkout +      │                │             │              │
    │              │ custom field    │                │             │              │
    │              │ "GitHub username"                │             │              │
    │              │                 │                │             │              │
    │ pay (€99)    │                 │                │             │              │
    ├─────────────▶│                 │                │             │              │
    │              │                 │                │             │              │
    │              │ POST /webhooks/gumroad           │             │              │
    │              │ (form-encoded sale ping)         │             │              │
    │              ├────────────────▶│                │             │              │
    │              │                 │                │             │              │
    │              │                 │ verify secret  │             │              │
    │              │                 │ (URL token +   │             │              │
    │              │                 │ x-gumroad-sig) │             │              │
    │              │                 │                │             │              │
    │              │                 │ idempotency    │             │              │
    │              │                 │ check by       │             │              │
    │              │                 │ sale_id        │             │              │
    │              │                 ├───────────────▶│             │              │
    │              │                 │◀───────────────┤             │              │
    │              │                 │                │             │              │
    │              │                 │ insert         │             │              │
    │              │                 │ kit_purchase   │             │              │
    │              │                 │ (status=pending)             │              │
    │              │                 ├───────────────▶│             │              │
    │              │                 │                │             │              │
    │              │                 │ PUT /repos/{owner}/{repo}/   │              │
    │              │                 │ collaborators/{username}     │              │
    │              │                 │ {permission: "pull"}         │              │
    │              │                 ├──────────────────────────────▶              │
    │              │                 │                              │              │
    │              │                 │  201 (invite sent) /         │              │
    │              │                 │  204 (already collab) /      │              │
    │              │                 │  404 (user not found) /      │              │
    │              │                 │  422 (validation)            │              │
    │              │                 │◀──────────────────────────────              │
    │              │                 │                              │              │
    │              │                 │ update kit_purchase          │              │
    │              │                 │ (invite_status, invite_id)   │              │
    │              │                 ├───────────────▶│             │              │
    │              │                 │                │             │              │
    │              │                 │ send confirmation email      │              │
    │              │                 ├──────────────────────────────────────────────▶
    │              │                 │                │             │              │
    │              │                 │ 200 OK                       │              │
    │              │◀────────────────┤                │             │              │
    │              │                 │                │             │              │
    │ ← email with GitHub invite link + repo URL                    │              │
    │◀──────────────────────────────────────────────────────────────────────────────┤
    │              │                 │                │             │              │
    │ accept invite on github.com    │                │             │              │
    ├──────────────────────────────────────────────────────────────▶│              │
    │                                                               │              │
```

### Step-by-step

1. **Gumroad checkout** — Buyer clicks Buy on a Gumroad product page that has a
   required custom text field labelled **"GitHub username"** (see §3).
2. **Sale ping** — Gumroad POSTs a form-encoded payload to our worker at
   `POST /webhooks/gumroad?token=<secret>`. Event identified by
   `resource_name=sale`.
3. **Verify** — Worker checks: (a) the URL token matches the
   `GUMROAD_PING_SECRET` env var, (b) if Gumroad sends `x-gumroad-signature`
   for this product type, also HMAC-SHA256 verify. **Reject otherwise.**
   (See §4 for why we double up.)
4. **Idempotency** — Worker queries `kit_purchases` by `sale_id`. If row
   exists with `invite_status` not in `('pending','failed')`, return 200
   already-processed.
5. **Persist purchase** — Insert/update row in `kit_purchases` with
   `status='pending'`.
6. **Invite to repo** — Worker calls
   `PUT https://api.github.com/repos/{owner}/{repo}/collaborators/{username}`
   with `Authorization: Bearer <GITHUB_KIT_PAT>` and body
   `{"permission": "pull"}`. Outcomes:
   - **201** invitation created → store `invite_id` from response, set
     `invite_status='invited'`.
   - **204** user already a collaborator → set `invite_status='active'`.
   - **404** username does not exist → set `invite_status='bad_username'`,
     send a recovery email asking buyer to submit correct username via
     `/redeem` page (see §3 fallback).
   - **422** spam-flagged / validation → set `invite_status='blocked'`,
     alert via `console.error` (Andreas reviews manually).
7. **Email** — Resend email with: GitHub invite link
   (`https://github.com/{owner}/{repo}/invitations`), repo URL,
   redemption link to change username later, support contact.
8. **Done** — Worker returns `200 {ok:true}`. Gumroad does not retry on 200.

### Worker endpoints (new routes in `src/index.js`)

| Method | Path | Purpose | Auth |
|---|---|---|---|
| POST | `/webhooks/gumroad` | Receive sale/refund/dispute pings | URL token + (optional) HMAC |
| POST | `/api/kit/redeem` | Buyer submits/corrects GitHub username post-purchase | Gumroad `license_key` |
| POST | `/api/kit/change-username` | Buyer changes GitHub username later | Gumroad `license_key` + email match |
| POST | `/api/admin/kit-revoke` | Manual collaborator revoke (Andreas) | `ADMIN_API_KEY` |

---

## 3. Collecting the GitHub Username

### Recommendation: **(a) required custom checkout field on Gumroad**, with `(b)` redemption page as fallback.

### Comparison

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **(a) Gumroad custom field "GitHub username"** | Single flow, captured at sale, no extra UI needed. Gumroad natively supports custom text fields per product. | Buyer can typo; can't validate live on Gumroad's checkout. | **Primary** |
| **(b) Post-purchase form on success page** | Live validation against GitHub API (does username exist?). | Adds a step; buyer may close tab; needs hosted page. | **Fallback only** (for bad/missing usernames from (a)) |
| **(c) Email exchange** | Zero setup. | Manual work per sale; doesn't scale; breaks the "lifetime access" promise on day one. | **Reject** |

### Implementation

- Gumroad product → Settings → Customize → add custom field:
  - **Label:** `GitHub username`
  - **Type:** Text
  - **Required:** Yes
  - **Placeholder:** `octocat (no @, no URL)`
- Worker reads `custom_fields[GitHub username]` from the form-encoded body
  (Gumroad serialises custom fields with the bracket-key convention).
- Strip leading `@`, strip `https://github.com/` prefix, lowercase, validate
  against regex `^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$` (GitHub username
  rules). If invalid format → store as `bad_username`, redirect buyer to
  `/redeem` via email link.

### Redemption page (website agent territory)

- `zurhaartools.com/kit/redeem?sale_id=<id>` — buyer pastes Gumroad
  `license_key`, enters/corrects GitHub username. Posts to `/api/kit/redeem`,
  which re-runs the GitHub invite. License key is the only secret needed
  (Gumroad license keys are random UUID-format strings).

---

## 4. Auth + Secrets

### GitHub PAT

- **Type:** Fine-grained personal access token (NOT classic — narrower blast
  radius).
- **Owner:** Andreas's personal GitHub account (`andreaszurhaar`).
- **Repo scope:** Only the kit template repos (e.g. `chrome-extension-kit`),
  not all repos.
- **Permissions:**
  - `Administration: Read and write` (required to manage collaborators)
  - `Metadata: Read-only` (mandatory baseline)
- **Storage:** Cloudflare Worker secret `GITHUB_KIT_PAT` via
  `wrangler secret put GITHUB_KIT_PAT`. **Never in code, never in
  `wrangler.toml`.**
- **Rotation:** Set 1-year expiry on the PAT. Calendar reminder for renewal.
  When rotating: generate new PAT → `wrangler secret put` → revoke old PAT.
  Zero-downtime.
- **Blast radius if leaked:** Attacker can add/remove collaborators on the
  kit repo only (scope is per-repo). They cannot push code (no `Contents:
  write` permission). Worst case: someone adds themselves as a pull-access
  collaborator and clones the kit. Mitigation: rotate immediately, audit
  collaborator list, remove unauthorized accounts.

### Gumroad ping secret

- **URL token approach (primary):** Gumroad lets you set the Ping URL freely.
  We use `https://api.zurhaartools.com/webhooks/gumroad?token=<random-256-bit>`.
  Stored as worker secret `GUMROAD_PING_SECRET`. Worker rejects requests with
  missing/wrong token.
- **HMAC signature (if available):** Some Gumroad accounts/products receive
  an `x-gumroad-signature` header (HMAC-SHA256 over the raw body, signed with
  the seller's Gumroad app secret). **Unknown** whether this applies to plain
  Ping or only to Resource Subscriptions created via the Gumroad API. If
  present, also verify HMAC and reject mismatches. If absent, the URL token
  is the only auth — accept that as Gumroad's documented model for Ping.
- **Decision:** Implement URL-token verification on day 1. Add HMAC
  verification once we confirm what Gumroad actually sends (subscribe to a
  test resource and inspect headers in worker logs).

### Cloudflare Worker secret summary (new)

```
GUMROAD_PING_SECRET     — URL token Gumroad must send with every ping
GUMROAD_APP_SECRET      — (optional) HMAC verification secret if available
GITHUB_KIT_PAT          — fine-grained PAT, repo-scoped, Administration RW
GITHUB_KIT_OWNER        — "andreaszurhaar" (var, not secret)
GITHUB_KIT_REPO         — "chrome-extension-kit" (var, not secret)
```

---

## 5. D1 Schema

**Decision:** New table `kit_purchases`. Do **not** extend `licenses` — the
existing table is built around `credits_remaining` and credit-based scan
products. The kit has no credits, no Stripe session, no scans. A separate
table keeps both models simple.

```sql
-- migrations/004_add_kit_purchases.sql

CREATE TABLE kit_purchases (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id            TEXT NOT NULL UNIQUE,          -- Gumroad sale_id
  order_number       TEXT,                          -- Gumroad order_number (display only)
  license_key        TEXT UNIQUE,                   -- Gumroad-issued license key
  product_permalink  TEXT NOT NULL,                 -- e.g. "chrome-extension-kit"
  email              TEXT NOT NULL,
  github_username    TEXT,                          -- normalized lowercase, no @
  github_invite_id   INTEGER,                       -- from PUT collaborators response
  repo_owner         TEXT NOT NULL,                 -- e.g. "andreaszurhaar"
  repo_name          TEXT NOT NULL,                 -- e.g. "chrome-extension-kit"
  invite_status      TEXT NOT NULL DEFAULT 'pending',
  -- invite_status values:
  --   'pending'        initial, before GitHub call
  --   'invited'        GitHub returned 201 — invite sent, awaiting accept
  --   'active'         GitHub returned 204 — buyer was already collaborator
  --   'bad_username'   404 from GitHub — user does not exist
  --   'blocked'        422 from GitHub — spam/validation flag
  --   'revoked'        refund/chargeback — collaborator removed
  --   'failed'         transient error — retry candidate
  refund_status      TEXT NOT NULL DEFAULT 'none',
  -- refund_status values:  'none' | 'refunded' | 'disputed' | 'dispute_won'
  amount_cents       INTEGER NOT NULL,              -- price paid, for reporting
  currency           TEXT NOT NULL DEFAULT 'eur',
  country            TEXT,
  test_mode          INTEGER NOT NULL DEFAULT 0,
  last_error         TEXT,                          -- last GitHub error body, for debugging
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_kit_sale_id      ON kit_purchases(sale_id);
CREATE INDEX idx_kit_license_key  ON kit_purchases(license_key);
CREATE INDEX idx_kit_email        ON kit_purchases(email);
CREATE INDEX idx_kit_github       ON kit_purchases(github_username);

-- Append-only audit trail of GitHub API calls (parallel to credit_transactions)
CREATE TABLE kit_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id         TEXT NOT NULL,
  event_type      TEXT NOT NULL,    -- 'invite_sent' | 'invite_failed' | 'collaborator_removed' | 'username_changed' | 'refund' | 'dispute'
  github_status   INTEGER,          -- HTTP status from GitHub API
  detail          TEXT,             -- JSON-stringified context (old/new username, error message)
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_kit_events_sale ON kit_events(sale_id);
```

### Why not extend `licenses`?

- `licenses` has `credits_remaining` (non-nullable), product-keyed by
  internal `PRODUCT_FOR_TYPE` map — neither applies to kit.
- Stripe and Gumroad use different sale ID formats; mixing in
  `credit_transactions.order_id` muddies idempotency.
- The kit's lifecycle (invite → accept → maybe revoke) does not map onto
  the credit deduction model.
- Separation keeps existing scanner refund/GDPR/chargeback code untouched.

---

## 6. Edge Cases

| Case | Detection | Handling |
|---|---|---|
| **Buyer has no GitHub account yet** | GitHub returns 404 on `PUT /collaborators/{username}`. | Set `invite_status='bad_username'`. Email buyer: "We couldn't find GitHub user `<x>`. Create an account at github.com/join, then redeem at zurhaartools.com/kit/redeem with your license key." |
| **Typo'd GitHub username** | Same 404. | Same flow as "no account" — redemption page lets them re-enter. |
| **Buyer uses `@username` or full URL** | Caught by normalisation before GitHub call. | Strip prefixes, lowercase, regex-validate. |
| **Refund within 14 days** | Gumroad `refund` ping (`resource_name=refund`, includes original `sale_id`). | Look up `kit_purchases.sale_id` → call `DELETE /repos/{owner}/{repo}/collaborators/{username}` → set `invite_status='revoked'`, `refund_status='refunded'`. Log to Google Sheets as negative sale. |
| **Chargeback (dispute)** | Gumroad `dispute` ping. | Same as refund: revoke collaborator, set `refund_status='disputed'`. If `dispute_won` ping later arrives, re-invite the collaborator and set `refund_status='dispute_won'`, `invite_status='invited'`. |
| **Buyer changes GitHub username later** | Self-service: `POST /api/kit/change-username` with `{license_key, new_username}`. | Verify license_key matches a row. Remove old collaborator (`DELETE`), invite new (`PUT`). Log to `kit_events`. Rate-limit to 3 changes per 30 days per `sale_id`. |
| **Buyer forgets license key** | Email-based recovery (parallel to existing `/api/recover`). | New endpoint `/api/kit/recover` — find all kit_purchases by email, email back the list of `(product, license_key, github_username, repo URL)`. Same 5-min rate limit pattern. |
| **Buyer accepts invite, then leaves repo** | We learn this only when they try to access and fail. | Out of band — handle via support email. Re-invite manually via `/api/admin/kit-revoke` (which also has a re-invite variant) or extend `/api/kit/redeem` to detect 404-on-list-collaborators and re-invite. |
| **Multiple buyers per org (team access)** | Out of scope at MVP. | One purchase = one collaborator. Document in product description: "Solo developer license. For team access, contact us." Future: add quantity-based pricing tier that creates N pending slots redeemable with different usernames. |
| **Duplicate sale (same buyer, second purchase)** | Different `sale_id`, possibly same `github_username`. | Row inserted as new. GitHub returns 204 (already collaborator) — set `invite_status='active'`. Both purchases recorded for accounting; buyer is just confirmed-active on the repo. |
| **Gumroad retries on transient failure** | Same `sale_id` arrives twice. | Idempotency check at the top of the handler returns 200 without re-inviting. |
| **GitHub API down** | Network/5xx error. | Set `invite_status='failed'`, store `last_error`, **return 500 to Gumroad** so they retry the ping (Gumroad retries on non-2xx, similar to Stripe). |
| **GDPR deletion request** | Buyer emails Andreas. | Extend existing `/api/admin/delete-customer` to also anonymize `kit_purchases` (email → `deleted@anonymized.invalid`, `github_username` → null) and revoke GitHub collaborator. Kit purchase history retained for accounting (anonymized). |

---

## 7. Implementation Cost — Phased Estimate

**Total: ~12–16 hours over 3–4 sessions.**

### Phase 1 — Schema + sale webhook (4–5h)
- Write migration `004_add_kit_purchases.sql`, run on D1 local + remote.
- Add `/webhooks/gumroad` route in `src/index.js`.
- URL-token verification.
- Parse form-encoded body (Gumroad uses `application/x-www-form-urlencoded`,
  with bracket-keys for custom fields — needs careful URL-decoding).
- Idempotency check by `sale_id`.
- Insert `kit_purchases` row, `status='pending'`.
- GitHub `PUT /collaborators` call with all 4 outcomes mapped.
- Resend confirmation email (clone existing license-key email template,
  adjust copy).
- Manual test: create test Gumroad product, fire test ping, observe D1 row
  and email.

### Phase 2 — Redemption + recovery endpoints (3–4h)
- `/api/kit/redeem` — POST `{license_key, github_username}`.
- `/api/kit/change-username` — POST `{license_key, email, new_username}`.
- `/api/kit/recover` — POST `{email}`, sends recovery email with kit
  license keys + repo links.
- Reuse rate-limit pattern from `/api/recover` (5-min cooldown via
  `last_recovery_at` field — add column to `kit_purchases`).
- Website agent builds the redemption page UI (separate ticket).

### Phase 3 — Refund / dispute handling (2–3h)
- Extend `/webhooks/gumroad` to handle `resource_name=refund`,
  `resource_name=dispute`, `resource_name=dispute_won`.
- `DELETE /collaborators/{username}` on refund/dispute.
- Re-invite on `dispute_won`.
- Google Sheets logging for kit refunds (matches existing pattern).
- Update `MONTHLY_CLOSE.md` runbook with kit-revenue reporting steps.

### Phase 4 — Admin + monitoring (2–3h)
- `/api/admin/kit-revoke` — manual collaborator removal (Andreas).
- `/api/admin/kit-reinvite` — manual re-invite.
- Extend `/api/admin/delete-customer` for GDPR on kit rows.
- Add structured `[KIT_*]` log prefixes for filtering.
- Manual smoke test of full flow with test purchase.

### Phase 5 — Polish (1–2h)
- HMAC verification if Gumroad sends `x-gumroad-signature` for our products
  (decide after observing real traffic).
- Update website success page copy.
- Update CLAUDE.md backend agent docs with the kit flow.

### Out of scope (post-MVP)
- Team licenses (N-seat purchases).
- Per-product PAT rotation if we sell multiple kits from different repos.
- Self-service "leave the repo" flow.
- Detection of buyers who accepted invite but later got removed externally.

---

## 8. References (Prior Art)

| Source | Relevance | Key takeaway |
|---|---|---|
| **Makerkit — "Sell code with Gumroad and Github"** (makerkit.dev/blog/tutorials/sell-code-gumroad-github) | Direct prior art. Same architecture: Gumroad custom field → webhook → octokit → `PUT /collaborators` with `permission: 'pull'`. | Confirms the design. Uses `custom_fields[Github Username]` key convention. Returns 200 on missing username to prevent Gumroad retries — we'll do the same but mark `invite_status='bad_username'` so we can email a recovery link. Refunds **not** covered in their tutorial. |
| **Makerkit — Lemon Squeezy variant** (makerkit.dev/blog/tutorials/selling-code-with-lemon-squeezy) | Same problem, different payment provider. | Same GitHub side; same fallback redemption pattern. |
| **ShipFast (shipfa.st)** | Production deployment of this exact pattern (private NextJS boilerplate sold via Stripe/Gumroad). | Validates that the model works at scale. Their docs aren't public-source, but the architecture is well-known to be: webhook → GitHub collaborator invite → custom redemption page for misses. |
| **Gumroad Ping docs** (gumroad.com/ping, app.gumroad.com/api) | Official payload spec. Resource events: `sale`, `refund`, `dispute`, `dispute_won`, `cancellation`, `subscription_*`. Form-encoded body. Fields include `sale_id`, `order_number`, `seller_id`, `product_id`, `product_permalink`, `email`, `price`, `currency`, `license_key`, `refunded`, `disputed`, `ip_country`, `custom_fields[...]`. | We rely on `sale_id` for idempotency, `custom_fields[GitHub username]` for the username, `license_key` for self-service redemption auth. |
| **GitHub REST — Collaborators** (docs.github.com/en/rest/collaborators/collaborators) | Authoritative endpoint spec. `PUT /repos/{owner}/{repo}/collaborators/{username}` — 201 invite, 204 already-collab, 403, 422. `DELETE` for removal. | Fine-grained PAT with `Administration: write` works. Scope to the kit repo only. |
| **GitHub fine-grained PAT permissions** (docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens) | Auth model. | "Administration" permission covers collaborator management on personal repos. |

---

## 9. Open Questions / Unknowns

1. **HMAC on Gumroad Ping?** Some third-party docs claim `x-gumroad-signature`
   is sent; others say it only applies to Resource Subscriptions created via
   the Gumroad API. **Action:** Subscribe a test product, fire a test ping,
   inspect headers in worker logs before deciding. Implement URL-token first;
   layer HMAC if available.
2. **Gumroad retry policy on non-2xx?** Documented behavior is unclear vs.
   Stripe's well-defined retry schedule. **Action:** Confirm by simulating a
   500 response from the worker and watching whether Gumroad retries.
3. **Cancellation event semantics for one-time purchases?** `cancellation` is
   relevant only for subscriptions; the kit is one-time. Safe to ignore the
   event type, but document it.
4. **Will Andreas sell the kit on Stripe too (parallel to Gumroad)?** If yes,
   the `kit_purchases.sale_id` schema needs a `source` column (`gumroad` |
   `stripe`) and the success-page integration on zurhaartools.com needs to
   collect GitHub username at Stripe checkout (Stripe `custom_fields` supports
   text). **Out of scope for this design** — Gumroad-only.
5. **Buyer with org-owned repo permissions?** We invite the personal account
   only. If they want a team to access, we recommend they fork — pull-access
   doesn't allow them to add others. Document in product description.

---

## 10. Decision Log

| Decision | Choice | Reason |
|---|---|---|
| Username collection | Gumroad required custom field + `/redeem` fallback | Lowest friction at checkout, recovery path for typos |
| GitHub permission level | `pull` | Buyers need to clone, not push. Matches "you have it forever" — they own the clone. |
| PAT type | Fine-grained, repo-scoped | Smaller blast radius than classic `repo` scope |
| D1 schema | New `kit_purchases` table | Kit lifecycle doesn't fit the existing credits model |
| Refund window | 14 days (matches EU consumer law + existing Stripe flow) | Consistent with scanner products |
| Team licenses | Out of scope at MVP | Adds significant complexity (N-seat redemption); ship single-seat first |
| Webhook auth | URL secret token (day 1) + HMAC (when confirmed) | Defense in depth without blocking launch on unconfirmed docs |
