-- Deleting a loop hides it immediately but keeps the row briefly so the
-- action can be undone. Rows deleted more than 7 days ago are purged.
ALTER TABLE loops ADD COLUMN deleted_at timestamptz;
CREATE INDEX loops_deleted_at_idx ON loops (deleted_at) WHERE deleted_at IS NOT NULL;

ALTER TABLE action_history DROP CONSTRAINT action_history_kind_check;
ALTER TABLE action_history ADD CONSTRAINT action_history_kind_check
  CHECK (kind IN ('create', 'start', 'stop', 'close', 'reopen', 'priority', 'edit', 'delete'));
