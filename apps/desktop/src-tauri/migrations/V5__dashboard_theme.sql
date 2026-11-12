-- V5__dashboard_theme : thème d'un tableau de bord (spec dashboard-theme).
-- Objet JSON versionné, comme la configuration d'un widget : la couche données ne l'interprète
-- pas ; le front le valide, le migre et tient la liste des teintes (options futures sans migration).
-- Immuable dès son premier lancement sur une base, même de développement. Pas de BEGIN/COMMIT
-- ni de PRAGMA ici : sqlx exécute chaque migration dans une transaction.

ALTER TABLE dashboards ADD COLUMN theme TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(theme) AND json_type(theme) = 'object' AND length(theme) <= 4096);
ALTER TABLE dashboards ADD COLUMN theme_version INTEGER NOT NULL DEFAULT 1
  CHECK (theme_version >= 1);
