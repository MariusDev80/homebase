-- V8__habits : habitudes, jours cochés, rappel possédé par une habitude (spec habits).
-- Ces tables ne sont lues et écrites QUE par les commandes Rust du module schedule : aucun SQL côté front.
-- habits.kind : 'days' (days_mask : bit 0 = lundi ... bit 6 = dimanche, 127 = tous les jours) ou
-- 'weekly' (weekly_target fois par semaine ISO, du lundi au dimanche). start_on : date murale de début.
-- habit_checks : une ligne par jour coché (date murale) ; la clé (habit_id, day_on) est l'identité
-- de la coche (clé naturelle, pas d'UUID).
-- reminders.habit_id : rappel possédé par une habitude (un au plus), supprimé avec elle ; défaut NULL
-- obligatoire pour ADD COLUMN ... REFERENCES.
-- Immuable dès son premier lancement sur une base, même de développement. Pas de BEGIN/COMMIT
-- ni de PRAGMA ici : sqlx exécute chaque migration dans une transaction.

CREATE TABLE habits (
  id            TEXT    NOT NULL PRIMARY KEY
                CHECK (length(id) = 36 AND id NOT GLOB '*[^0-9a-f-]*'),
  title         TEXT    NOT NULL
                CHECK (length(trim(title)) >= 1 AND length(title) <= 200
                       AND length(CAST(title AS BLOB)) <= 800),
  kind          TEXT    NOT NULL CHECK (kind IN ('days', 'weekly')),
  days_mask     INTEGER NULL CHECK (days_mask IS NULL OR days_mask BETWEEN 1 AND 127),
  weekly_target INTEGER NULL CHECK (weekly_target IS NULL OR weekly_target BETWEEN 1 AND 7),
  start_on      TEXT    NOT NULL CHECK (
                start_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
                AND date(start_on) IS start_on
                AND start_on BETWEEN '1900-01-01' AND '2199-12-31'),
  archived_at   TEXT    NULL CHECK (archived_at IS NULL OR (
                archived_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
                AND strftime('%Y-%m-%dT%H:%M:%fZ', archived_at, '+0 seconds') IS archived_at
                AND archived_at BETWEEN '1900-01-01' AND '2200-01-01')),
  created_at    TEXT    NOT NULL
                CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at    TEXT    NOT NULL
                CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((kind = 'days') = (days_mask IS NOT NULL)),
  CHECK ((kind = 'weekly') = (weekly_target IS NOT NULL))
) STRICT;

CREATE TABLE habit_checks (
  habit_id   TEXT NOT NULL
             REFERENCES habits (id) ON DELETE CASCADE,
  day_on     TEXT NOT NULL CHECK (
             day_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
             AND date(day_on) IS day_on
             AND day_on BETWEEN '1900-01-01' AND '2199-12-31'),
  created_at TEXT NOT NULL
             CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at TEXT NOT NULL
             CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  PRIMARY KEY (habit_id, day_on)
) STRICT;

CREATE INDEX habit_checks_day_on_idx ON habit_checks (day_on);

ALTER TABLE reminders ADD COLUMN habit_id TEXT NULL
  REFERENCES habits (id) ON DELETE CASCADE;

CREATE UNIQUE INDEX reminders_habit_id_idx ON reminders (habit_id)
  WHERE habit_id IS NOT NULL;
