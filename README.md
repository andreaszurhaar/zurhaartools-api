# zurhaartools-api

The serverless backend behind [Zurhaar Tools](https://zurhaartools.com) — licensing, credit metering,
payment webhooks and AI scan orchestration for two Chrome extensions live on the Chrome Web Store.

Built and operated solo. Cloudflare Workers + D1 (SQLite), no framework.

## What it does

A customer buys a credit pack through Stripe or Gumroad. A webhook creates or tops up a licence, the
extension calls `/api/scan` with that licence key, the Worker deducts one credit atomically and calls
Claude Haiku to analyse the document. If the model errors — or returns a 200 with unusable content —
the credit is refunded rather than silently consumed.

## The parts worth reading

**Atomic credit deduction.** The deduct is a single conditional `UPDATE ... WHERE credits_remaining > 0`
rather than a read-then-write, so two concurrent scans on the same licence cannot both succeed against
the last credit. Every movement is written to a `credit_transactions` ledger, so a balance is always
reconstructible rather than merely stored.

**Idempotency.** Payment processors retry. Every webhook path is idempotent by event id: a replayed
`checkout.session.completed` does not double-credit, a replayed refund does not double-deduct, and a
replayed dispute does not double-revoke. There are tests for each of those three specifically.

**Webhook authentication.** Stripe signatures are verified with HMAC-SHA256 and compared in constant
time. Gumroad's ping is authenticated by a shared token *and* pinned to a seller id, because a token
alone would accept a ping from any Gumroad seller.

**Access revocation that actually revokes.** The kit-delivery path grants repository access on purchase
and removes it on refund. The first implementation called GitHub's delete-collaborator endpoint, which
answers `204` whether or not it did anything — it only affects a buyer who has *accepted* their
invitation, so a still-pending invite survived a refund and stayed acceptable. Buy, don't accept, refund,
accept afterwards: permanent access, recorded in the database as revoked. The fix cancels the pending
invitation *and* removes the accepted collaborator, on both the refund and dispute paths, because there
is no way to know which state a buyer is in. The regression test was proven to fail without the fix
before it was trusted.

**Cost control.** Scan cost sat around €0.024 worst case against a €9.99/500-scan pack — the published
price was underwater. Capping the work per scan brought it to roughly €0.004.

## Testing

`npm test` runs the money-path suite under `@cloudflare/vitest-pool-workers` against a real Worker
runtime, with Anthropic mocked via MSW. It covers signature rejection, credit grant, top-up and
reactivation, refund and suspension, chargeback and reinstatement, per-scan deduction and refund-on-error,
cross-product key rejection, and Gumroad token and seller-id rejection.

## Layout

```
src/index.js       the Worker — routing, webhooks, licensing, scan orchestration
schema.sql         licenses, credit_transactions, kit_purchases, kit_events, kit_waitlist
migrations/        incremental schema changes
test/              money-path suite
wrangler.toml      Workers + D1 bindings
```

## Running it

```
npm install
npx wrangler dev        # local
npm test                # money-path suite
npx wrangler deploy
```

Secrets (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `GUMROAD_PING_TOKEN`, `ANTHROPIC_API_KEY`,
`ADMIN_API_KEY`, `GITHUB_KIT_PAT`) are set with `wrangler secret put` and are never in this repository.
