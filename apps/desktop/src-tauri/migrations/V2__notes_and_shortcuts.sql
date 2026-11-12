-- V2__notes_and_shortcuts : notes (texte brut) et raccourcis web globaux (ADR-002).
-- Une note appartient à l'instance de widget qui l'a créée (supprimée avec elle) ;
-- widget_instance_id NULL est réservé à de futures notes autonomes.
-- Immuable dès sa fusion sur main. Pas de BEGIN/COMMIT ni de PRAGMA ici :
-- sqlx exécute chaque migration dans une transaction.

CREATE TABLE notes (
  id          TEXT    NOT NULL PRIMARY KEY
              CHECK (length(id) = 36 AND id NOT GLOB '*[^0-9a-f-]*'),
  widget_instance_id TEXT
              REFERENCES widget_instances (id) ON DELETE CASCADE,
  title       TEXT    NOT NULL
              CHECK (length(title) <= 200),
  body        TEXT    NOT NULL
              CHECK (length(body) <= 100000),
  created_at  TEXT    NOT NULL
              CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at  TEXT    NOT NULL
              CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
) STRICT;

CREATE UNIQUE INDEX notes_widget_instance_id_idx ON notes (widget_instance_id)
  WHERE widget_instance_id IS NOT NULL;

CREATE TABLE shortcuts (
  id          TEXT    NOT NULL PRIMARY KEY
              CHECK (length(id) = 36 AND id NOT GLOB '*[^0-9a-f-]*'),
  label       TEXT    NOT NULL
              CHECK (length(trim(label)) >= 1 AND length(label) <= 80),
  url         TEXT    NOT NULL
              CHECK (length(url) <= 2048 AND (url GLOB 'http://*' OR url GLOB 'https://*')),
  sort_order  INTEGER NOT NULL CHECK (sort_order >= 0),
  created_at  TEXT    NOT NULL
              CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at  TEXT    NOT NULL
              CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
) STRICT;

CREATE INDEX shortcuts_sort_order_idx ON shortcuts (sort_order, created_at);
