CREATE TABLE licenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_key TEXT NOT NULL UNIQUE,
  product TEXT NOT NULL,
  email TEXT NOT NULL,
  credits_remaining INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  last_recovery_at TEXT,
  waiver_acknowledged_at TEXT,
  waiver_text TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_licenses_key ON licenses(license_key);
CREATE INDEX idx_licenses_email_product ON licenses(email, product);

CREATE TABLE credit_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_key TEXT NOT NULL,
  change INTEGER NOT NULL,
  reason TEXT NOT NULL,
  order_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (license_key) REFERENCES licenses(license_key)
);

CREATE INDEX idx_transactions_key ON credit_transactions(license_key);
CREATE INDEX idx_transactions_order ON credit_transactions(order_id);

CREATE TABLE kit_waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  signed_up_at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT,
  confirmed INTEGER NOT NULL DEFAULT 1,
  unsubscribed INTEGER NOT NULL DEFAULT 0,
  product TEXT NOT NULL DEFAULT 'chrome-extension-kit'
);

CREATE INDEX idx_kit_waitlist_email ON kit_waitlist(email);

-- Chrome Extension Kit purchase tracking (Gumroad → GitHub flow).
-- See GUMROAD_GITHUB_FLOW.md §5.
CREATE TABLE kit_purchases (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id            TEXT NOT NULL UNIQUE,
  order_number       TEXT,
  license_key        TEXT UNIQUE,
  product_permalink  TEXT NOT NULL DEFAULT 'chrome-extension-kit',
  tier               TEXT,
  email              TEXT NOT NULL,
  github_username    TEXT,
  github_invite_id   INTEGER,
  repo_owner         TEXT NOT NULL DEFAULT 'andreaszurhaar',
  repo_name          TEXT NOT NULL DEFAULT 'chrome-extension-kit-template',
  invite_status      TEXT NOT NULL DEFAULT 'pending',
  refund_status      TEXT NOT NULL DEFAULT 'none',
  amount_cents       INTEGER NOT NULL DEFAULT 0,
  currency           TEXT NOT NULL DEFAULT 'eur',
  country            TEXT,
  test_mode          INTEGER NOT NULL DEFAULT 0,
  last_error         TEXT,
  purchased_at       TEXT NOT NULL DEFAULT (datetime('now')),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_kit_purchases_sale_id     ON kit_purchases(sale_id);
CREATE INDEX idx_kit_purchases_license_key ON kit_purchases(license_key);
CREATE INDEX idx_kit_purchases_email       ON kit_purchases(email);
CREATE INDEX idx_kit_purchases_github      ON kit_purchases(github_username);

CREATE TABLE kit_events (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  kit_purchase_id   INTEGER,
  sale_id           TEXT NOT NULL,
  event_type        TEXT NOT NULL,
  github_status     INTEGER,
  event_data        TEXT,
  occurred_at       TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (kit_purchase_id) REFERENCES kit_purchases(id)
);

CREATE INDEX idx_kit_events_sale_id      ON kit_events(sale_id);
CREATE INDEX idx_kit_events_purchase_id  ON kit_events(kit_purchase_id);
CREATE INDEX idx_kit_events_type         ON kit_events(event_type);
