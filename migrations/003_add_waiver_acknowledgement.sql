-- Add withdrawal-right waiver tracking to licenses table
-- Required under art. 6:230p sub g + art. 6:230v lid 7 BW for digital content sales:
-- consumer's express prior consent to immediate delivery and waiver of 14-day
-- right of withdrawal must be persisted and echoed back in the confirmation email.
-- Nullable to preserve existing rows; populated by checkout.session.completed
-- when the Stripe Payment Link is configured with the waiver checkbox custom field.
ALTER TABLE licenses ADD COLUMN waiver_acknowledged_at TEXT;
ALTER TABLE licenses ADD COLUMN waiver_text TEXT;
