-- V3__todos : listes de tâches et tâches (ADR-002, ADR-003 section 3.1 / Phase 1 TODO).
-- Une liste appartient à l'instance de widget qui l'a créée (supprimée avec elle) ;
-- widget_instance_id NULL est réservé à de futures listes autonomes.
-- due_on : date murale optionnelle ; completed_at : instant optionnel (fragments ADR-003 3.1.3).
-- Immuable dès sa fusion sur main. Pas de BEGIN/COMMIT ni de PRAGMA ici :
-- sqlx exécute chaque migration dans une transaction.

CREATE TABLE todo_lists (
  id          TEXT    NOT NULL PRIMARY KEY
              CHECK (length(id) = 36 AND id NOT GLOB '*[^0-9a-f-]*'),
  widget_instance_id TEXT
              REFERENCES widget_instances (id) ON DELETE CASCADE,
  name        TEXT    NOT NULL
              CHECK (length(trim(name)) >= 1 AND length(name) <= 80),
  created_at  TEXT    NOT NULL
              CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at  TEXT    NOT NULL
              CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
) STRICT;

CREATE UNIQUE INDEX todo_lists_widget_instance_id_idx ON todo_lists (widget_instance_id)
  WHERE widget_instance_id IS NOT NULL;

CREATE TABLE todos (
  id          TEXT    NOT NULL PRIMARY KEY
              CHECK (length(id) = 36 AND id NOT GLOB '*[^0-9a-f-]*'),
  list_id     TEXT    NOT NULL
              REFERENCES todo_lists (id) ON DELETE CASCADE,
  title       TEXT    NOT NULL
              CHECK (length(trim(title)) >= 1 AND length(title) <= 500),
  due_on      TEXT    NULL CHECK (due_on IS NULL OR (
              due_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
              AND date(due_on) IS due_on
              AND due_on BETWEEN '1900-01-01' AND '2199-12-31')),
  completed_at TEXT   NULL CHECK (completed_at IS NULL OR (
              completed_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
              AND strftime('%Y-%m-%dT%H:%M:%fZ', completed_at, '+0 seconds') IS completed_at
              AND completed_at BETWEEN '1900-01-01' AND '2200-01-01')),
  sort_order  INTEGER NOT NULL CHECK (sort_order >= 0),
  created_at  TEXT    NOT NULL
              CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at  TEXT    NOT NULL
              CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
) STRICT;

CREATE INDEX todos_list_id_sort_order_idx ON todos (list_id, sort_order);
