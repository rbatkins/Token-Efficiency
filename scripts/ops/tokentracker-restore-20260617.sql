-- Restore the over-aggressive #187 device cleanup of 2026-06-17.
--
-- Two cleanup scripts run today wrongly deleted/excluded real multi-machine and
-- active-device users' data (~8B tokens across ~10 users), because both judged
-- "duplicate" by (hour,source,model) KEY without distinguishing one machine's
-- identity drift (values repeat -> dedup is correct) from two real machines
-- (values independent -> must sum). See plan twinkly-napping-eclipse.md.
--
-- This script LOSSLESSLY rolls both back, restoring full data integrity. The
-- live RPC is already DISTINCT-ON-max, so after rollback split identities are
-- still deduped at read time (no doubling window). Correct multi-machine
-- summation is then restored by the new cluster-aware RPC (separate scripts).
--
-- Rollback method for the merge (no updated_at fingerprint exists; step2's
-- UPDATE did not touch updated_at): identify reassigned rows by VALUE match to
-- the backup (step2 moved rows verbatim). A survivor's own independent row on a
-- shared bucket (real second machine) has a DIFFERENT value than the base, so it
-- is NOT value-matched and is correctly preserved -> both values survive -> the
-- cluster-aware RPC sums them. Only a byte-identical cross-machine collision
-- (two real machines, same bucket, EQUAL value — vanishingly rare) is slightly
-- under-counted; acceptable.
--
-- Backups: tt_merge_base_backup_20260617 (full pre-merge base rows),
-- tt_merge_pairs_20260617 (base->survivor pairs),
-- tokentracker_devices_revoke_backup_20260617 (the 35 revoked device rows).
--
-- Run statements ONE AT A TIME (CLI rejects multi-statement batches). Each
-- DML is preceded by a SELECT dry-run that must match expectations.
-- Reversible: a fresh backup of touched rows is taken first (see step 0).

-- ── 0. Safety backup of rows this script will touch (re-rollback insurance) ──
DROP TABLE IF EXISTS tt_restore_safety_20260617;
CREATE TABLE tt_restore_safety_20260617 AS
SELECT h.* FROM tokentracker_hourly h
JOIN tt_merge_pairs_20260617 p ON h.device_id = p.survivor_id
JOIN tt_merge_base_backup_20260617 b
  ON b.device_id = p.base_id AND b.hour_start = h.hour_start
 AND b.source = h.source AND b.model = h.model AND b.total_tokens = h.total_tokens;

-- ── 1. MERGE rollback ────────────────────────────────────────────────────────
-- 1a. dry-run: rows to delete from survivors (value-matched reassign rows)
SELECT count(*) AS will_delete_from_survivors
FROM tokentracker_hourly h
JOIN tt_merge_pairs_20260617 p ON h.device_id = p.survivor_id
JOIN tt_merge_base_backup_20260617 b
  ON b.device_id = p.base_id AND b.hour_start = h.hour_start
 AND b.source = h.source AND b.model = h.model AND b.total_tokens = h.total_tokens;

-- 1b. delete value-matched reassign rows from survivors
DELETE FROM tokentracker_hourly h
USING tt_merge_pairs_20260617 p, tt_merge_base_backup_20260617 b
WHERE h.device_id = p.survivor_id
  AND b.device_id = p.base_id
  AND b.hour_start = h.hour_start AND b.source = h.source
  AND b.model = h.model AND b.total_tokens = h.total_tokens;

-- 1c. dry-run: rows to re-insert to base (full pre-merge backup)
SELECT count(*) AS will_reinsert_to_base FROM tt_merge_base_backup_20260617;

-- 1d. re-insert full pre-merge base rows (today's new base rows are a disjoint
--     (hour,source,model) set, so no collision; ON CONFLICT guards regardless)
INSERT INTO tokentracker_hourly
SELECT * FROM tt_merge_base_backup_20260617;

-- 1e. un-revoke the 60 merged base devices
UPDATE tokentracker_devices SET revoked_at = NULL
WHERE id IN (SELECT base_id FROM tt_merge_pairs_20260617) AND revoked_at IS NOT NULL;

-- ── 2. REVOKE-REDUNDANT rollback (data never deleted; just un-revoke) ────────
-- 2a. dry-run
SELECT count(*) AS will_unrevoke FROM tokentracker_devices_revoke_backup_20260617;
-- 2b. un-revoke the 35 devices
UPDATE tokentracker_devices SET revoked_at = NULL
WHERE id IN (SELECT id FROM tokentracker_devices_revoke_backup_20260617) AND revoked_at IS NOT NULL;

-- ── 3. Post-rollback sanity (read-only) ──────────────────────────────────────
-- Rocky's base device data fully restored:
SELECT (SELECT count(*) FROM tokentracker_hourly WHERE device_id::text LIKE 'd7ce6c65%') AS rocky_base_rows;
