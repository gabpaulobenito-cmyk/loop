-- Allow "retime" actions: moving a loop's start (created time or current session start).
ALTER TABLE action_history DROP CONSTRAINT action_history_kind_check;
ALTER TABLE action_history ADD CONSTRAINT action_history_kind_check
  CHECK (kind IN ('create', 'start', 'stop', 'close', 'reopen', 'priority', 'edit', 'delete', 'retime'));
