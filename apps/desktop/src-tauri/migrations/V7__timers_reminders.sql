-- V7__timers_reminders : rappels, livraisons de rappels, sessions de minuteur (spec timers-reminders).
-- Ces tables ne sont lues et écrites QUE par les commandes Rust du module schedule : aucun SQL côté front.
-- Fragments temporels de l'ADR-003 3.1.3. Un rappel a toujours une ancre horodatée (start_local +
-- time_zone) : une ancre datée ne sonne jamais (ADR-003 3.5.5).
-- next_fire_at / next_fire_key : cache de la prochaine occurrence, écrit par le planificateur Rust.
-- reminder_deliveries : une ligne par occurrence traitée ; la clé (reminder_id, occurrence_key)
-- déduplique les notifications (clé naturelle, pas d'UUID).
-- Immuable dès son premier lancement sur une base, même de développement. Pas de BEGIN/COMMIT
-- ni de PRAGMA ici : sqlx exécute chaque migration dans une transaction.

CREATE TABLE reminders (
  id            TEXT    NOT NULL PRIMARY KEY
                CHECK (length(id) = 36 AND id NOT GLOB '*[^0-9a-f-]*'),
  title         TEXT    NOT NULL
                CHECK (length(trim(title)) >= 1 AND length(title) <= 200
                       AND length(CAST(title AS BLOB)) <= 800),
  start_local   TEXT    NOT NULL CHECK (
                start_local GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
                AND strftime('%Y-%m-%dT%H:%M:%S', start_local, '+0 seconds') IS start_local
                AND start_local BETWEEN '1900-01-01' AND '2200-01-01'),
  time_zone     TEXT    NOT NULL CHECK (length(time_zone) BETWEEN 1 AND 64
                AND time_zone GLOB '[A-Za-z]*'
                AND time_zone NOT GLOB '*[^A-Za-z0-9_+/-]*'),
  rrule         TEXT    NULL CHECK (rrule IS NULL OR (length(rrule) BETWEEN 10 AND 256 AND rrule GLOB 'FREQ=*')),
  exdates       TEXT    NOT NULL CHECK (json_valid(exdates) AND json_type(exdates) = 'array'
                AND json_array_length(exdates) <= 366 AND length(exdates) <= 8192),
  enabled       INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  next_fire_at  TEXT    NULL CHECK (next_fire_at IS NULL OR (
                next_fire_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
                AND strftime('%Y-%m-%dT%H:%M:%fZ', next_fire_at, '+0 seconds') IS next_fire_at
                AND next_fire_at BETWEEN '1900-01-01' AND '2200-01-01')),
  next_fire_key TEXT    NULL CHECK (next_fire_key IS NULL OR (
                next_fire_key GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
                AND strftime('%Y-%m-%dT%H:%M:%S', next_fire_key, '+0 seconds') IS next_fire_key
                AND next_fire_key BETWEEN '1900-01-01' AND '2200-01-01')),
  created_at    TEXT    NOT NULL
                CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at    TEXT    NOT NULL
                CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((next_fire_at IS NULL) = (next_fire_key IS NULL)),
  CHECK (enabled = 1 OR next_fire_at IS NULL)
) STRICT;

CREATE INDEX reminders_next_fire_at_idx ON reminders (next_fire_at)
  WHERE next_fire_at IS NOT NULL;

CREATE TABLE reminder_deliveries (
  reminder_id    TEXT    NOT NULL
                 REFERENCES reminders (id) ON DELETE CASCADE,
  occurrence_key TEXT    NOT NULL CHECK (
                 occurrence_key GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
                 AND strftime('%Y-%m-%dT%H:%M:%S', occurrence_key, '+0 seconds') IS occurrence_key
                 AND occurrence_key BETWEEN '1900-01-01' AND '2200-01-01'),
  due_at         TEXT    NOT NULL CHECK (
                 due_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
                 AND strftime('%Y-%m-%dT%H:%M:%fZ', due_at, '+0 seconds') IS due_at
                 AND due_at BETWEEN '1900-01-01' AND '2200-01-01'),
  outcome        TEXT    NOT NULL CHECK (outcome IN ('on_time', 'late', 'missed')),
  skipped_count  INTEGER NOT NULL CHECK (skipped_count BETWEEN 0 AND 1000),
  seen_at        TEXT    NULL CHECK (seen_at IS NULL OR (
                 seen_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
                 AND strftime('%Y-%m-%dT%H:%M:%fZ', seen_at, '+0 seconds') IS seen_at
                 AND seen_at BETWEEN '1900-01-01' AND '2200-01-01')),
  created_at     TEXT    NOT NULL
                 CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at     TEXT    NOT NULL
                 CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  PRIMARY KEY (reminder_id, occurrence_key)
) STRICT;

CREATE INDEX reminder_deliveries_unseen_idx ON reminder_deliveries (created_at)
  WHERE seen_at IS NULL;

CREATE TABLE time_sessions (
  id          TEXT    NOT NULL PRIMARY KEY
              CHECK (length(id) = 36 AND id NOT GLOB '*[^0-9a-f-]*'),
  kind        TEXT    NOT NULL CHECK (kind IN ('stopwatch', 'countdown', 'pomodoro_work',
              'pomodoro_short_break', 'pomodoro_long_break')),
  label       TEXT    NOT NULL
              CHECK (length(label) <= 100 AND length(CAST(label AS BLOB)) <= 400),
  started_at  TEXT    NOT NULL CHECK (
              started_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
              AND strftime('%Y-%m-%dT%H:%M:%fZ', started_at, '+0 seconds') IS started_at
              AND started_at BETWEEN '1900-01-01' AND '2200-01-01'),
  ends_at     TEXT    NULL CHECK (ends_at IS NULL OR (
              ends_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
              AND strftime('%Y-%m-%dT%H:%M:%fZ', ends_at, '+0 seconds') IS ends_at
              AND ends_at BETWEEN '1900-01-01' AND '2200-01-01'
              AND ends_at > started_at)),
  ended_at    TEXT    NULL CHECK (ended_at IS NULL OR (
              ended_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
              AND strftime('%Y-%m-%dT%H:%M:%fZ', ended_at, '+0 seconds') IS ended_at
              AND ended_at BETWEEN '1900-01-01' AND '2200-01-01')),
  end_reason  TEXT    NULL CHECK (end_reason IS NULL OR end_reason IN ('completed', 'stopped')),
  created_at  TEXT    NOT NULL
              CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at  TEXT    NOT NULL
              CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((kind = 'stopwatch') = (ends_at IS NULL)),
  CHECK ((ended_at IS NULL) = (end_reason IS NULL)),
  CHECK (end_reason IS NOT 'completed' OR (ends_at IS NOT NULL AND ended_at IS ends_at))
) STRICT;

CREATE INDEX time_sessions_running_idx ON time_sessions (ends_at)
  WHERE ended_at IS NULL;
CREATE INDEX time_sessions_history_idx ON time_sessions (started_at, id)
  WHERE ended_at IS NOT NULL;

-- Safety net for M10 (a single pomodoro): the indexed expression is constant, so two running
-- pomodoro sessions cannot coexist even if a row is written outside insert_session.
CREATE UNIQUE INDEX time_sessions_one_pomodoro_idx ON time_sessions ((ended_at IS NULL))
  WHERE ended_at IS NULL AND kind IN ('pomodoro_work', 'pomodoro_short_break', 'pomodoro_long_break');
