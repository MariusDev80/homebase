-- V6__todo_details : description, répétition et drapeau « Important » d'une tâche (spec todo-details).
-- description : texte brut, 10 000 caractères et 40 000 octets au plus ('' = aucune) ; la borne en
-- octets résiste à un caractère NUL (length() d'un TEXT s'y arrête).
-- rrule : règle de répétition (ADR-003 3.5.1, sous-ensemble validé par core/time/date-rule.ts),
-- ancrée sur due_on, qu'elle exige ; cocher la tâche avance due_on (pas de completed_at).
-- important : booléen 0/1 (ADR-002).
-- Immuable dès son premier lancement sur une base, même de développement. Pas de BEGIN/COMMIT
-- ni de PRAGMA ici : sqlx exécute chaque migration dans une transaction.

ALTER TABLE todos ADD COLUMN description TEXT NOT NULL DEFAULT ''
  CHECK (length(description) <= 10000 AND length(CAST(description AS BLOB)) <= 40000);
ALTER TABLE todos ADD COLUMN rrule TEXT NULL
  CHECK (rrule IS NULL OR (length(rrule) BETWEEN 10 AND 256 AND rrule GLOB 'FREQ=*'
         AND due_on IS NOT NULL));
ALTER TABLE todos ADD COLUMN important INTEGER NOT NULL DEFAULT 0
  CHECK (important IN (0, 1));
