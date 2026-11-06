-- V4__dashboard_icon : icône d'un tableau de bord (spec dashboards-sidebar).
-- Le CHECK ne fige que la forme : la liste fermée vit dans le front et peut évoluer sans migration.
-- Immuable dès sa fusion sur main. Pas de BEGIN/COMMIT ni de PRAGMA ici :
-- sqlx exécute chaque migration dans une transaction.

ALTER TABLE dashboards ADD COLUMN icon TEXT NOT NULL DEFAULT 'th-large'
  CHECK (length(icon) BETWEEN 1 AND 32
         AND icon GLOB '[a-z]*'
         AND icon NOT GLOB '*[^a-z0-9-]*');
