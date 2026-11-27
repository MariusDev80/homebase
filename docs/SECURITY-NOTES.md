# Notes de sécurité

## CSP

CSP définie dans `apps/desktop/src-tauri/tauri.conf.json` (`app.security.csp`) :
`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; … form-action 'none'`.

- **Scripts** : `script-src 'self'` sans `unsafe-inline`. Tauri y ajoute en release un nonce/hash (protection conservée).
- **Styles** : `style-src 'self' 'unsafe-inline'` est nécessaire car PrimeNG et Angular injectent des balises `<style>` à l'exécution. En release, Tauri ajoute un nonce/hash à `style-src` ; or, dès qu'un nonce/hash est présent, les navigateurs ignorent `'unsafe-inline'` et bloquent ces `<style>`. D'où `app.security.dangerousDisableAssetCspModification: ["style-src"]` : Tauri ne modifie plus que les autres directives (dont `script-src`). Le risque accepté est limité à l'injection de styles (pas de script).
- **CSS critique Angular** : l'optimisation `inlineCritical` (beasties) génère `<link media="print" onload="this.media='all'">`, un gestionnaire inline bloqué par `script-src 'self'`. Elle est désactivée dans la configuration `production` de `apps/web/angular.json` (`optimization.styles.inlineCritical: false`).
- **Polices** : PrimeIcons est servi depuis l'origine de l'app (`font-src 'self' data:`).
- `form-action 'none'` : aucun formulaire ne doit pouvoir soumettre vers l'extérieur.
- *Amendement (spec calendar, 2026-11-21)* : feuille de style non injectée `calendar-lib.css` (`angular.json`, `inject: false`), servie par l'application et insérée par un `<link>` créé par `createElement` ; aucune ressource distante ; CSP inchangée.
- *Amendement (spec typed-data-commands, 2026-11-25)* : la CSP est comparée en chaîne exacte par `capability_tests.rs` (`csp_is_exact`), ainsi que `dangerousDisableAssetCspModification == ["style-src"]`.

## Accès aux données du front (ADR-002 O3, spec typed-data-commands)

*Amendement (2026-11-25, spec `docs/specs/typed-data-commands.md`, branche `phase-3-typed-sql`)* : cette section remplace « Accès SQL direct du front (ADR-002) ». Jusqu'au lot TC4, le front avait `sql:allow-execute` et `sql:allow-select` : un script injecté pouvait lire et écrire toute la base, y compris les tables du planificateur, et créer des fichiers SQLite par `ATTACH` ou `VACUUM INTO`. Vérifications manuelles MC1 à MC8 à faire par Marius avant la fusion.

Le front n'a **aucune** permission `sql:*` : il lit et écrit les données par des commandes Rust typées, aux entrées bornées et validées, aux paramètres SQL liés. Aucune commande ne reçoit de SQL, de nom de table ni de chemin : `ATTACH`, `VACUUM INTO` et les `PRAGMA` sont hors d'atteinte. `tauri-plugin-sql` ne sert qu'aux migrations, côté Rust (`preload`).

- **Barrière** : l'ACL de Tauri (aucune permission `sql:*` dans `default.json` ni dans `debug.json`) et l'absence du paquet `@tauri-apps/plugin-sql`. Le refus des commandes `plugin:sql|*` sans permission est vérifié dans les sources (tauri 2.12.6, tauri-utils 2.10.4, tauri-plugin-sql 2.6.0 ; détail dans la spec, §9 R1). MC1 le confirme à l'exécution.
- **Tests de la configuration** : `capability_tests.rs` (aucune permission `sql:`, listes exactes de `default.json` et `debug.json`, CSP exacte, paquet absent de `package.json`, `apps/web/package.json` et `package-lock.json`).
- **Alarmes statiques** : `front-sql-guard.spec.ts`, `check-initial-bundle.mjs` (`plugin:sql` absent de tout le bundle), règle ESLint sur `@tauri-apps/plugin-sql`. Elles signalent une régression involontaire. Elles sont contournables par conception (chaîne construite, import dynamique, fichier exclu) : ce ne sont pas des barrières.
- **Résiduel accepté** : un script injecté peut appeler toutes les commandes typées. Il peut lire les données affichables. Il peut aussi détruire ou écraser des données. Rien de ce qui suit n'est une régression : l'accès SQL d'avant le permettait déjà, et plus encore.
  - Suppressions sans sauvegarde : `widget_delete` (et ses notes ou tâches en cascade), `todo_delete`, `todo_clear_completed`, `note_delete`, `shortcut_delete`, `setting_delete`.
  - (a) Écrasements sans sauvegarde : `note_update`, `todo_update`, `widget_update_config`, `shortcut_update`, `setting_set`. L'ancien contenu est perdu.
  - (b) Suppressions côté planificateur : `reminder_delete`, `session_delete`, `habit_delete`, `habit_set_check` (une coche retirée).
  - (c) `config_import_apply` avec un plan forgé, sans dialogue : les tableaux absents du plan sont supprimés en cascade. Une sauvegarde `pre-import` est prise avant.
  - (d) `backup_restore { kind: 'internal', id }` sans dialogue : une archive interne remplace la base au redémarrage. Une sauvegarde `pre-restore` est prise avant.
  - (e) Purge des réserves de sauvegarde par rotation. 11 `backup_create` évincent toutes les sauvegardes manuelles (réserve de 10). Plus de 5 `dashboard_delete` ou `config_import_apply` évincent la réserve de sécurité (5 archives : `pre-delete`, `pre-import`, `pre-restore`). `daily_due` saute la sauvegarde quotidienne si une archive complète de moins de 24 h existe (`src/backup/daily.rs` l. 22-24) : des `backup_create` répétés empêchent toute nouvelle quotidienne (les anciennes restent).
  - (f) Remplissage du disque : aucune borne de nombre sur les notes, raccourcis, tâches et listes. Seuls les tableaux, widgets et réglages sont bornés.
  - Protégés : la suppression de tableau (`dashboard_delete`, sauvegarde `pre-delete`, jamais le dernier) et l'import (sauvegarde `pre-import`).
- **Atténuations** : CSP stricte, assainissement de tout contenu externe, aucune page distante, sauvegardes quotidiennes et de sécurité.
- **À réévaluer à l'audit de phase 6** (pistes, non décidées) : dialogue natif de confirmation, ouvert par Rust, pour l'import et la restauration ; sauvegarde avant écrasement ou suppression ; bornes de nombre sur les notes, raccourcis, tâches et listes ; protéger les réserves de sauvegarde contre une rotation forcée.
