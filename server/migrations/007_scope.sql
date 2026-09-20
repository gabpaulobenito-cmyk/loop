-- Work / personal. Every loop belongs to exactly one world.
-- Existing loops were all work, which is what the default backfills.
ALTER TABLE loops ADD COLUMN scope text NOT NULL DEFAULT 'work'
  CHECK (scope IN ('work', 'personal'));

CREATE INDEX loops_scope_idx ON loops (scope)
  WHERE deleted_at IS NULL AND state <> 'closed';

ALTER TABLE action_history DROP CONSTRAINT action_history_kind_check;
ALTER TABLE action_history ADD CONSTRAINT action_history_kind_check
  CHECK (kind IN ('create', 'start', 'stop', 'close', 'reopen', 'priority', 'edit', 'delete', 'retime', 'handoff', 'deadline', 'scope'));
