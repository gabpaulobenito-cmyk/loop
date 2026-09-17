-- Ball in court: who is moving a loop.
--   mine       you act on it (default)
--   delegated  handed to someone on your team; you monitor
--   waiting    stuck on someone outside your control
ALTER TABLE loops ADD COLUMN owner text NOT NULL DEFAULT 'mine'
  CHECK (owner IN ('mine', 'delegated', 'waiting'));
ALTER TABLE loops ADD COLUMN owner_with text NOT NULL DEFAULT ''
  CHECK (char_length(owner_with) <= 60);
ALTER TABLE loops ADD COLUMN handed_off_at timestamptz;
ALTER TABLE loops ADD COLUMN follow_up_at timestamptz;
ALTER TABLE loops ADD CONSTRAINT loops_handoff_consistent
  CHECK ((owner = 'mine') = (handed_off_at IS NULL));
ALTER TABLE loops ADD CONSTRAINT loops_mine_has_no_followup
  CHECK (owner <> 'mine' OR (follow_up_at IS NULL AND owner_with = ''));

ALTER TABLE action_history DROP CONSTRAINT action_history_kind_check;
ALTER TABLE action_history ADD CONSTRAINT action_history_kind_check
  CHECK (kind IN ('create', 'start', 'stop', 'close', 'reopen', 'priority', 'edit', 'delete', 'retime', 'handoff'));
