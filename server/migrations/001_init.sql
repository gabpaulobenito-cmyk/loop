-- LOOP initial schema.

CREATE TABLE loops (
  id              uuid PRIMARY KEY,
  title           text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 140),
  note            text        NOT NULL DEFAULT '' CHECK (char_length(note) <= 280),
  priority        boolean     NOT NULL DEFAULT false,
  state           text        NOT NULL CHECK (state IN ('running', 'open', 'closed')),
  created_at      timestamptz NOT NULL,
  closed_at       timestamptz,
  running_since   timestamptz,
  accumulated_ms  bigint      NOT NULL DEFAULT 0 CHECK (accumulated_ms >= 0),
  version         integer     NOT NULL DEFAULT 1,
  updated_at      timestamptz NOT NULL,
  -- State and timestamps must always agree.
  CONSTRAINT loops_running_consistent CHECK ((state = 'running') = (running_since IS NOT NULL)),
  CONSTRAINT loops_closed_consistent  CHECK ((state = 'closed')  = (closed_at IS NOT NULL))
);

CREATE INDEX loops_state_idx ON loops (state);
CREATE INDEX loops_closed_at_idx ON loops (closed_at DESC) WHERE state = 'closed';

CREATE TABLE loop_sessions (
  id          uuid PRIMARY KEY,
  loop_id     uuid        NOT NULL REFERENCES loops (id) ON DELETE CASCADE,
  started_at  timestamptz NOT NULL,
  ended_at    timestamptz,
  CONSTRAINT loop_sessions_order CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX loop_sessions_loop_idx ON loop_sessions (loop_id, started_at DESC);
-- At most one running session per loop, even under concurrent requests.
CREATE UNIQUE INDEX loop_sessions_one_open ON loop_sessions (loop_id) WHERE ended_at IS NULL;

CREATE TABLE settings (
  key         text PRIMARY KEY,
  value       jsonb       NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Reversible action log. `before` is a snapshot of the loop row prior to the action;
-- session ids record which session the action created or finished.
CREATE TABLE action_history (
  id                  bigserial PRIMARY KEY,
  loop_id             uuid        NOT NULL REFERENCES loops (id) ON DELETE CASCADE,
  kind                text        NOT NULL CHECK (kind IN ('create', 'start', 'stop', 'close', 'reopen', 'priority', 'edit')),
  label               text        NOT NULL,
  before              jsonb,
  session_started_id  uuid,
  session_ended_id    uuid,
  loop_version_after  integer     NOT NULL,
  created_at          timestamptz NOT NULL,
  undone_at           timestamptz
);

CREATE INDEX action_history_pending_idx ON action_history (id DESC) WHERE undone_at IS NULL;

CREATE TABLE auth_sessions (
  token_hash  text PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  user_agent  text
);

CREATE INDEX auth_sessions_expires_idx ON auth_sessions (expires_at);
