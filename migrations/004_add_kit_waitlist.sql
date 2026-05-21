-- Waitlist table for product pre-launch signups.
-- First use case: Chrome Extension Kit (landing page collects emails before launch).
-- product is futureproofed so other kits/products can share the same table.
-- confirmed defaults to TRUE because the soft waitlist has no double opt-in yet.
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
