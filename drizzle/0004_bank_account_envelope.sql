-- Employee bank account numbers are stored as an AES-256-GCM envelope
-- ("enc:v1:<iv>:<tag>:<ciphertext>", roughly 75-105 characters) when
-- BANK_DATA_ENCRYPTION_KEY is set. varchar(40) cannot hold that.
--
-- Widening a varchar is non-destructive and safe to run more than once. Apply
-- this BEFORE setting the key, otherwise inserts fail with "value too long".
ALTER TABLE employees ALTER COLUMN bank_account TYPE varchar(160);
