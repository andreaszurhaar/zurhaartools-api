CREATE TABLE licenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_key TEXT NOT NULL UNIQUE,
  product TEXT NOT NULL,
  email TEXT NOT NULL,
  credits_remaining INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  last_recovery_at TEXT,
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
