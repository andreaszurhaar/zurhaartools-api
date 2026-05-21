-- Chrome Extension Kit purchase tracking (Gumroad → GitHub flow).
-- See GUMROAD_GITHUB_FLOW.md §5 for the full design rationale.
--
-- Separate from `licenses` (the credits-based scanner table) because the kit
-- has no credits, no Stripe session, and a different lifecycle (invite → accept
-- → maybe revoke). Mixing them would muddy idempotency keys and refund logic.

CREATE TABLE kit_purchases (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id            TEXT NOT NULL UNIQUE,          -- Gumroad sale_id (idempotency key)
  order_number       TEXT,                          -- Gumroad order_number (display only)
  license_key        TEXT UNIQUE,                   -- Gumroad-issued license key (used for /redeem auth)
  product_permalink  TEXT NOT NULL DEFAULT 'chrome-extension-kit',
  tier               TEXT,                          -- 'starter' | 'pro' | 'studio' (derived from product_permalink / price)
  email              TEXT NOT NULL,
  github_username    TEXT,                          -- normalized lowercase, no @ prefix
  github_invite_id   INTEGER,                       -- from PUT /collaborators response
  repo_owner         TEXT NOT NULL DEFAULT 'andreaszurhaar',
  repo_name          TEXT NOT NULL DEFAULT 'chrome-extension-kit-template',
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
  amount_cents       INTEGER NOT NULL DEFAULT 0,
  currency           TEXT NOT NULL DEFAULT 'eur',
  country            TEXT,
  test_mode          INTEGER NOT NULL DEFAULT 0,
  last_error         TEXT,                          -- last GitHub error body, for debugging
  purchased_at       TEXT NOT NULL DEFAULT (datetime('now')),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_kit_purchases_sale_id     ON kit_purchases(sale_id);
CREATE INDEX idx_kit_purchases_license_key ON kit_purchases(license_key);
CREATE INDEX idx_kit_purchases_email       ON kit_purchases(email);
CREATE INDEX idx_kit_purchases_github      ON kit_purchases(github_username);

-- Append-only audit trail of GitHub API calls and refund/dispute lifecycle.
-- Parallel to credit_transactions for the scanner products.
CREATE TABLE kit_events (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  kit_purchase_id   INTEGER,                       -- FK to kit_purchases.id (nullable for orphan events)
  sale_id           TEXT NOT NULL,                 -- denormalized for query convenience
  event_type        TEXT NOT NULL,
  -- event_type values:
  --   'sale'                  initial sale ping received
  --   'invite_sent'           GitHub PUT /collaborators 201
  --   'invite_already_active' GitHub PUT /collaborators 204 (already collab)
  --   'invite_failed'         GitHub returned 4xx/5xx
  --   'invite_accepted'       (optional — set if we later poll invite acceptance)
  --   'redeem'                /api/kit/redeem call (username change / late invite)
  --   'collaborator_removed'  refund/dispute revoked access
  --   'refund'                Gumroad refund ping processed
  --   'dispute'               Gumroad dispute ping processed
  --   'dispute_won'           Gumroad dispute_won ping — collaborator re-invited
  --   'revoke'                manual admin revoke
  github_status     INTEGER,                       -- HTTP status from GitHub API (if applicable)
  event_data        TEXT,                          -- JSON-stringified context (old/new username, error message, etc.)
  occurred_at       TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (kit_purchase_id) REFERENCES kit_purchases(id)
);

CREATE INDEX idx_kit_events_sale_id      ON kit_events(sale_id);
CREATE INDEX idx_kit_events_purchase_id  ON kit_events(kit_purchase_id);
CREATE INDEX idx_kit_events_type         ON kit_events(event_type);
