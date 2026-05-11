-- Add last_recovery_at column for rate limiting license key recovery emails
ALTER TABLE licenses ADD COLUMN last_recovery_at TEXT;
