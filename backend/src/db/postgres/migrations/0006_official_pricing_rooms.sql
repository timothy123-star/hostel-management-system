-- Official NGN room inventory pricing. Additive/idempotent.
-- Replaces clearly-demo USD placeholders with per-resident NGN naira values.
-- Preserves historical payments, currencies, verification, reconciliation, and allocations.
INSERT INTO official_session_prices (capacity, amount_kobo, currency) VALUES (1, 240000000, 'NGN') ON CONFLICT (capacity) DO NOTHING;
INSERT INTO official_session_prices (capacity, amount_kobo, currency) VALUES (2, 120000000, 'NGN') ON CONFLICT (capacity) DO NOTHING;
INSERT INTO official_session_prices (capacity, amount_kobo, currency) VALUES (3, 80000000, 'NGN') ON CONFLICT (capacity) DO NOTHING;
UPDATE rooms SET price_per_student = 2400000 WHERE capacity = 1 AND price_per_student = 1200;
UPDATE rooms SET price_per_student = 1200000 WHERE capacity = 2 AND price_per_student = 800;
UPDATE rooms SET price_per_student = 800000 WHERE capacity = 3 AND price_per_student = 600;
