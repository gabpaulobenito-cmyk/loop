-- Dual timers. Every loop reads exactly one clock:
--   elapsed    counts up from when it was opened (the default — visibility)
--   countdown  counts down to a hard external deadline (urgency)
-- A countdown loop always has a deadline, and an elapsed loop never does.
ALTER TABLE loops ADD COLUMN timer_type text NOT NULL DEFAULT 'elapsed'
  CHECK (timer_type IN ('elapsed', 'countdown'));
ALTER TABLE loops ADD COLUMN deadline_at timestamptz;
ALTER TABLE loops ADD CONSTRAINT loops_deadline_consistent
  CHECK ((timer_type = 'countdown') = (deadline_at IS NOT NULL));

CREATE INDEX loops_deadline_idx ON loops (deadline_at)
  WHERE deadline_at IS NOT NULL AND state <> 'closed' AND deleted_at IS NULL;

-- Append-only record of conversions, kept for pattern analysis: how often a
-- soft loop quietly turns into one with a real date, and how often that reverses.
CREATE TABLE loop_timer_changes (
  id          bigserial PRIMARY KEY,
  loop_id     uuid        NOT NULL REFERENCES loops (id) ON DELETE CASCADE,
  from_type   text        NOT NULL CHECK (from_type IN ('elapsed', 'countdown')),
  to_type     text        NOT NULL CHECK (to_type IN ('elapsed', 'countdown')),
  deadline_at timestamptz,
  changed_at  timestamptz NOT NULL,
  CONSTRAINT loop_timer_changes_direction CHECK (from_type <> to_type)
);

CREATE INDEX loop_timer_changes_loop_idx ON loop_timer_changes (loop_id, id DESC);

ALTER TABLE action_history DROP CONSTRAINT action_history_kind_check;
ALTER TABLE action_history ADD CONSTRAINT action_history_kind_check
  CHECK (kind IN ('create', 'start', 'stop', 'close', 'reopen', 'priority', 'edit', 'delete', 'retime', 'handoff', 'deadline'));
