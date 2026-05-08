-- Add status column to licenses table
-- Values: 'active', 'suspended' (refunded), 'revoked' (chargeback)
ALTER TABLE licenses ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
