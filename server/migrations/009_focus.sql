-- FOCUS: the handful of loops being worked on right now.
-- Taking focus starts the loop's timer; releasing it stops it. The column holds
-- when focus was taken, because focus is for one day only — a pick from an
-- earlier day is ignored, and cleared the next time focus is taken.

ALTER TABLE loops ADD COLUMN focused_at timestamptz;

CREATE INDEX loops_focused_idx ON loops (focused_at)
  WHERE focused_at IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE action_history DROP CONSTRAINT action_history_kind_check;
ALTER TABLE action_history ADD CONSTRAINT action_history_kind_check
  CHECK (kind IN ('create', 'start', 'stop', 'close', 'reopen', 'priority', 'edit', 'delete', 'retime',
                  'handoff', 'deadline', 'scope', 'focus', 'release'));
