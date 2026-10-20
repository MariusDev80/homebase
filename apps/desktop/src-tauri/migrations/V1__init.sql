-- V1__init : réglages, dashboards, instances de widgets (ADR-002).
-- Immuable dès sa fusion sur main. Pas de BEGIN/COMMIT ni de PRAGMA ici :
-- sqlx exécute chaque migration dans une transaction.

CREATE TABLE settings (
  key         TEXT    NOT NULL PRIMARY KEY
              CHECK (length(key) BETWEEN 1 AND 128
                     AND key GLOB '[a-z]*'
                     AND key NOT GLOB '*[^a-z0-9._-]*'),
  value       TEXT    NOT NULL
              CHECK (json_valid(value) AND length(value) <= 65536),
  created_at  TEXT    NOT NULL
              CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at  TEXT    NOT NULL
              CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
) STRICT;

CREATE TABLE dashboards (
  id          TEXT    NOT NULL PRIMARY KEY
              CHECK (length(id) = 36 AND id NOT GLOB '*[^0-9a-f-]*'),
  name        TEXT    NOT NULL
              CHECK (length(trim(name)) >= 1 AND length(name) <= 100),
  sort_order  INTEGER NOT NULL CHECK (sort_order >= 0),
  created_at  TEXT    NOT NULL
              CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at  TEXT    NOT NULL
              CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
) STRICT;

CREATE TABLE widget_instances (
  id              TEXT    NOT NULL PRIMARY KEY
                  CHECK (length(id) = 36 AND id NOT GLOB '*[^0-9a-f-]*'),
  dashboard_id    TEXT    NOT NULL
                  REFERENCES dashboards (id) ON DELETE CASCADE,
  widget_type     TEXT    NOT NULL CHECK (length(widget_type) BETWEEN 1 AND 64),
  grid_x          INTEGER NOT NULL CHECK (grid_x >= 0),
  grid_y          INTEGER NOT NULL CHECK (grid_y >= 0),
  grid_w          INTEGER NOT NULL CHECK (grid_w >= 1),
  grid_h          INTEGER NOT NULL CHECK (grid_h >= 1),
  config          TEXT    NOT NULL
                  CHECK (json_valid(config) AND json_type(config) = 'object' AND length(config) <= 65536),
  config_version  INTEGER NOT NULL CHECK (config_version >= 1),
  created_at      TEXT    NOT NULL
                  CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at      TEXT    NOT NULL
                  CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
) STRICT;

CREATE INDEX widget_instances_dashboard_id_idx ON widget_instances (dashboard_id);
