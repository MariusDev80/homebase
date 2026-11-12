# Spec : détail d'une tâche (fiche dans le widget TODO, description, « Important », répétition)

- **Statut** : implémentée (TD1a à TD4) ; vérifications manuelles MD1 à MD9 en attente. Historique : révision 2 (2026-11-10), revue indépendante intégrée (B1, C1 à C7, suggestions S1 à S10) ; décisions de Marius au §12
- **Auteur** : architect (Opus)
- **Destinataire** : `implementer` (Sonnet), un lot à la fois (§7), **sur la branche `dashboards-sidebar`**
- **Liens** : `CLAUDE.md` ; `docs/DESIGN.md` ; ADR-002 (données) ; ADR-003 (temps : §3.1.3, §3.4, §3.5, §3.6, §3.9, D2) ; `docs/specs/dashboards-sidebar.md` (D0, §7, §9) ; `docs/specs/dashboard-theme.md` (§4.3, §6.2, §6.3, D10) ; `docs/specs/backup-restore.md` §4.7

Cette spec vaut compte rendu de décision (contexte, options, décision, conséquences, risques). Elle ne modifie aucun autre document : les amendements à appliquer par le coordinateur sont rédigés au §10. Chemins TS relatifs à `apps/web/src/app/`, chemins Rust relatifs à `apps/desktop/src-tauri/`, sauf mention.

---

## 1. Contexte et périmètre

Demande de Marius et décisions **prises** :
1. La saisie de date sur la ligne (`<input type="date">` sous le titre) est laide et prend de la place : **la retirer de la ligne** et **remplacer le bouton « Modifier » par un petit bouton [i]** qui ouvre le détail de la tâche.
2. Le détail permet de **voir plus clairement et de modifier directement** : titre (en entier, la liste tronque), **description**, **échéance**, **répétition**, et un drapeau **« Important »** (décision de Marius, §12).
3. **Affichage : panneau dans le widget.** Le corps du widget est remplacé par la fiche, avec « Retour » (comme le panneau de la météo) ; le focus revient au [i].
4. **Répétition : cocher une tâche répétée la laisse active et avance son échéance** à la prochaine occurrence, après max(échéance, aujourd'hui). Ni historique ni copie.
5. **Migration V6 sur la branche `dashboards-sidebar`** (rien sur `main`).
6. **Widget étroit** : flèches et poubelle masquées sur la ligne.

**Hors périmètre** (à ne pas improviser) : rappels ou heure d'échéance (phase 2, rappel lié) ; jours ouvrés et autres `BYDAY` ; `COUNT`/`UNTIL` ; tri par échéance ou par importance ; filtre « importantes » ; ouverture de la fiche depuis un résultat de recherche ; Markdown ou liens cliquables dans la description ; Playwright (tâche séparée de la ROADMAP) ; export de configuration (les tâches n'y figurent pas, V8).

---

## 2. Faits vérifiés et suppositions

### 2.1 Vérifiés

| # | Fait | Source |
|---|---|---|
| V1 | Ligne actuelle : case, titre tronqué (double-clic = édition en ligne), ↑ ↓, crayon « Modifier », poubelle avec confirmation en ligne ; **seconde ligne** : `<input type="date">` + étiquette relative + bouton d'effacement. Un `busy` global refuse toute écriture concurrente | `widgets/todo/todo.component.{ts,html}` |
| V2 | La saisie partielle de l'année est déjà gérée : `change` ignoré si `badInput` ou date invalide/hors bornes, valeur remise au `blur` | `todo.component.ts` l. 254-280 |
| V3 | `todos` (V3) : `id`, `list_id`, `title` (1..500), `due_on` (date murale optionnelle), `completed_at`, `sort_order`, `created_at`, `updated_at` ; table `STRICT` | `migrations/V3__todos.sql` |
| V4 | `TodoRepository` : `getListForInstance`, `createList`, `listTodos`, `create`, `update(id, { title?, dueOn? })`, `setCompleted`, `remove`, `reorder`, `clearCompleted`, `search` (titres seulement). Aucune méthode publique `get` (seulement `mustGet`, privée) | `data/repositories.ts` l. 141-177 ; `sqlite-todo.repository.ts` |
| V5 | **`data/` ne peut pas importer `core/`** : le dépôt ne peut pas appeler `core/time` | ADR-003 §3.6 ; `eslint.config.js` |
| V6 | `core/time` expose `parseLocalDate`, `formatLocalDate`, `isValidLocalDate`, `addDays`, `daysBetween`, `compareLocalDates`, `Today`, `TimeDisplay` (`short`, `long`, `weekday-long`, `weekday-short`) ; **le lot B (codec RRULE, moteur Rust) n'existe pas** | `core/time/index.ts` ; glob |
| V7 | `core/time/temporal.ts` : espace de noms de types limité à `Instant`, `PlainDate`, `PlainDateTime`, `ZonedDateTime` | `temporal.ts` l. 14-19 |
| V8 | Les tâches ne sont pas dans l'export de configuration (`config_transfer` ne les lit ni ne les écrit ; seules les cascades les touchent) | `src/backup/config_transfer*.rs` |
| V9 | Notes : écriture au fil de l'eau (800 ms), `flush` au `blur` et à la destruction, inscription à `PendingWrites`, boucle unique (`running ??= drain()`) | `widgets/notes/notes.component.ts` |
| V10 | Météo : panneau qui remplace le corps, `keydown.escape` sur le groupe, focus rendu au déclencheur par `afterNextRender` | `widgets/weather/weather.component.{ts,html}` |
| V11 | `ALTER TABLE ADD COLUMN` : `CHECK` autorisé et testé contre les lignes existantes depuis SQLite 3.37.0 ; `NOT NULL` exige un défaut non nul ; texte `CREATE TABLE` réécrit | https://www.sqlite.org/lang_altertable.html |
| V12 | Pièges Rust : `sqlite.rs` l. 70 (`== 5`) ; `validate_tests.rs` l. 618-643 (`supported: 5`, version 6 « future ») ; `v4_database_migrated_to_v5_…` (l. 1009-1033) applique toutes les migrations puis compare à `expected_schema(5)` ; `config_transfer_tests.rs` l. 84 : `INSERT INTO todos VALUES (…)` positionnel à 8 valeurs | grep |
| V13 | `migrations.spec.ts` a `createTestDatabase(n)` et le modèle des blocs V4/V5 | `data/migrations.spec.ts` l. 90-191 |
| V14 | Recherche des notes : `title LIKE $1 OR body LIKE $1`, titres d'abord, extrait `excerptAround` ; la barre de recherche n'affiche pas de `subtitle` pour les tâches | `sqlite-note.repository.ts` l. 12-15 ; `widgets/search/search.component.html` l. 96 |
| V15 | PrimeIcons : `pi-info-circle`, `pi-sync`, `pi-align-left`, `pi-arrow-left`, `pi-star-fill`, `pi-exclamation-circle` | `node_modules/primeicons/primeicons.css` |
| V16 | Widget TODO et `fr.json` chargés à la demande ; `data/` dans le bundle initial | `todo.definition.ts` ; dashboard-theme V16 |
| V17 | `.field` : `min-height` 32 px, padding horizontal seul (un `textarea` ajoute `py-2`) | `core/theme/components.css` l. 102 |
| V18 | Le widget n'emploie que des tokens sémantiques ; `.card-theme` redéfinit `--hb-fg-muted`, `--hb-danger`, `--hb-attention`… dans la carte (contrastes vérifiés par `check-contrast`) | dashboard-theme D4, §4.5 |
| V19 | Vraie base en V3 ; base de dev en V5 | dashboards-sidebar D0 ; dashboard-theme D10 |
| V20 | **Revue indépendante** : la V6 de la révision 1 exécutée sur better-sqlite3 : un `CHECK` de colonne ajouté par `ADD COLUMN` peut référencer `due_on` ; `CHECK` évalués sur les lignes existantes ; texte `CREATE TABLE todos` stocké identique au §4.1 de la révision 1, déterministe pour une base neuve et pour V3/V4/V5 → V6. Les 23 cas de D3 recalculés : corrects | revue du 2026-11-10 |
| V21 | `addDays` (`core/time/local-date.ts`) **lève `out_of_range`** au-delà du 2199-12-31 (résultat revalidé par `parseLocalDate`) | `local-date.ts` l. 10-18 |
| V22 | Tailwind `^4.3.3` : requêtes de conteneur intégrées (`@container`, variantes `@max-[…]:`) | `apps/web/package.json` l. 54 ; revue |
| V23 | `length()` d'une valeur `TEXT` s'arrête au premier caractère NUL ; `length(CAST(x AS BLOB))` compte les octets | revue (S7) ; documentation SQLite `length()` |

### 2.2 Supposés (à vérifier ; si faux : s'arrêter et rapporter)

| # | Supposition | Vérifiée par |
|---|---|---|
| S1 | Le `CHECK` de `rrule` qui référence `due_on` s'applique aussi quand un `UPDATE` met `due_on` à `NULL` (confirmé sur better-sqlite3, V20) | `migrations.spec.ts` (TD1a) |
| S2 | Le texte `CREATE TABLE todos` après V6 est celui du §4.1. La révision 2 ajoute `important` et la borne en octets : texte déduit de la même règle que V20 | `migrations.spec.ts` et test Rust (TD1a, SQLite de sqlx). Si **seul le littéral du test** diffère, l'aligner sur la sortie réelle et le rapporter ; **jamais** modifier V6 pour le faire correspondre |
| S3 | Tailwind 4 fournit `field-sizing-content` (hauteur du `textarea` qui suit le contenu ; WebView2 155 supporte `field-sizing`) | TD2a (`web:build`, MD2). Sinon : `rows` fixes, rapporter |
| S4 | `core/time/date-rule.ts`, importé **directement** par le widget (pas par `core/time/index.ts`), reste hors du bundle initial | TD3 : aucun des fichiers listés « Initial chunk files » par `npm run web:build` ne contient `BYMONTHDAY` |
| S5 | jsdom déclenche `change` sur `input[type=number]`, `select` et case `role="switch"` comme le navigateur | specs TD2a, TD3 |
| S6 | Les variantes de conteneur arbitraires (`@max-[20rem]:hidden`, `@max-[11rem]:basis-full`…) sont générées par Tailwind 4.3.3 à partir des gabarits du widget | TD2b : `web:build`, classes présentes dans la feuille, MD1 |
| S10 | Le codec complet du lot B (`parseRecurrenceRule`) accepte tels quels les textes du sous-ensemble. **Au lot B, `parseDateRule` sera réécrit au-dessus de ce codec** (codec complet + restriction au sous-ensemble), sans changer sa signature ni les vecteurs `dateNext` | lot B (ADR-003, amendement §10.1) |

---

## 3. Décisions

### D1. Calcul de la prochaine échéance en TypeScript (`core/time`), sans attendre le lot B (accepté par le coordinateur)
| Option | Pour | Contre |
|---|---|---|
| A. Attendre le lot B (moteur Rust `time_expand`) | Un seul moteur | Chantier de phase 2 hors de proportion pour une prochaine date ; IPC à chaque coche |
| B. Arithmétique SQL (`date(due_on, '+1 month')`) | Une instruction | SQLite normalise le 31/01 + 1 mois en 03/03 : faux (D2 de l'ADR-003) ; calcul à la main |
| **C. Fonction pure `core/time/date-rule.ts` sur Temporal**, sous-ensemble strict, vecteurs partagés | Simple, testable hors Tauri, pas d'IPC | Deuxième implémentation d'une sémantique RRULE restreinte |

**Retenu : C**, exception écrite à l'ADR-003 (§10.1) : la règle du moteur unique vise les occurrences qui **déclenchent des notifications** ; une tâche est une ancre datée qui n'en déclenche jamais ; il s'agit d'**une** prochaine occurrence d'un sous-ensemble minuscule, sans heure ni fuseau ; les vecteurs `dateNext` du fichier partagé font foi pour les deux côtés ; `parseDateRule` sera rebasé sur le codec du lot B (S10). `data/` ne pouvant pas importer `core/` (V5), le dépôt reçoit la date calculée (D5).

### D2. Répétition : colonne `rrule` (RRULE du sous-ensemble), ancrée sur `due_on`
| Option | Verdict |
|---|---|
| Deux colonnes `repeat_unit` + `repeat_interval` | Rejetée : CLAUDE.md et l'ADR-003 imposent RRULE ; toute extension demanderait une migration |
| **`rrule TEXT NULL`, fragment de l'ADR-003 §3.1.3 + `due_on IS NOT NULL`** | **Retenue** : forme canonique du §3.5.1 ; ajouter `BYDAY` plus tard = code seulement |

Sous-ensemble accepté par `date-rule.ts` (forme **canonique** uniquement) : `^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;INTERVAL=[1-9][0-9]{0,2})?(;BYMONTHDAY=-1)?$`, `INTERVAL` omis s'il vaut 1 et borné par fréquence (DAILY 1..366, WEEKLY 1..52, MONTHLY 1..11, YEARLY 1..10), `BYMONTHDAY=-1` seulement avec `MONTHLY`. Ancre = `due_on`, qui avance à chaque coche. Une règle stockée hors du sous-ensemble est **conservée** et affichée « règle non reconnue ».

### D3. Prochaine échéance : première occurrence strictement après max(échéance, aujourd'hui) (validé par Marius)
| Option | Effet | Verdict |
|---|---|---|
| a. Après l'ancienne échéance | Quotidienne en retard de 5 jours : encore en retard après la coche | Rejetée |
| b. Aujourd'hui + 1 période | Perd l'alignement (le lundi devient un mercredi) | Rejetée |
| **c. Première occurrence de la série (ancrée sur l'échéance) strictement après max(échéance, aujourd'hui)** | Jamais en retard après la coche ; jamais la même date ; alignement conservé ; périodes manquées sautées ; coche en avance → période suivante | **Retenue** |

« Aujourd'hui » = `Today.date()` au clic. Jours inexistants **ignorés** (ADR-003 D2, validé par Marius) ; l'interface propose « le dernier jour du mois » quand l'échéance est le dernier jour de son mois. Pas d'occurrence au plus tard le 2199-12-31 : la tâche est **terminée normalement** (`setCompleted`), règle conservée.

Table de cas (aujourd'hui = 2026-11-10, mardi, sauf mention ; tous repris dans les vecteurs du §4.4) :

| # | Échéance | Règle | Aujourd'hui | Prochaine | Raison |
|---|---|---|---|---|---|
| N1 | 2026-11-10 | `FREQ=DAILY` | | 2026-11-11 | cochée le jour même |
| N2 | 2026-11-05 | `FREQ=DAILY` | | 2026-11-11 | 5 jours de retard, sautés |
| N3 | 2026-11-01 | `FREQ=DAILY;INTERVAL=3` | | 2026-11-13 | série 01, 04, 07, 10, 13 |
| N4 | 2026-11-09 (lundi) | `FREQ=WEEKLY` | | 2026-11-16 (lundi) | alignement conservé |
| N5 | 2026-11-16 | `FREQ=WEEKLY` | | 2026-11-23 | cochée en avance |
| N6 | 2026-10-26 | `FREQ=WEEKLY;INTERVAL=2` | | 2026-11-23 | série 10-26, 11-09, 11-23 |
| N7 | 2026-01-31 | `FREQ=MONTHLY` | 2026-01-31 | 2026-03-31 | février sauté (D2) |
| N8 | 2026-03-31 | `FREQ=MONTHLY` | 2026-03-31 | 2026-05-31 | avril sauté |
| N9 | 2026-01-31 | `FREQ=MONTHLY;BYMONTHDAY=-1` | 2026-01-31 | 2026-02-28 | dernier jour |
| N10 | 2028-01-31 | `FREQ=MONTHLY;BYMONTHDAY=-1` | 2028-01-31 | 2028-02-29 | bissextile |
| N11 | 2028-02-29 | `FREQ=MONTHLY;BYMONTHDAY=-1` | 2028-02-29 | 2028-03-31 | |
| N12 | 2026-01-30 | `FREQ=MONTHLY` | 2026-01-30 | 2026-03-30 | pas de 30 février |
| N13 | 2028-01-29 | `FREQ=MONTHLY` | 2028-01-29 | 2028-02-29 | 2028 bissextile |
| N14 | 2026-01-15 | `FREQ=MONTHLY` | 2026-04-20 | 2026-05-15 | 3 mois de retard |
| N15 | 2026-01-31 | `FREQ=MONTHLY;INTERVAL=3` | 2026-01-31 | 2026-07-31 | le 30 avril n'a pas de 31 |
| N16 | 2026-12-15 | `FREQ=MONTHLY` | | 2027-01-15 | cochée un mois en avance |
| N17 | 2028-02-29 | `FREQ=YEARLY` | 2028-02-29 | 2032-02-29 | D2 |
| N18 | 2096-02-29 | `FREQ=YEARLY` | 2096-02-29 | 2104-02-29 | 2100 non bissextile |
| N19 | 2026-11-10 | `FREQ=YEARLY` | | 2027-11-10 | |
| N20 | 2190-06-01 | `FREQ=YEARLY;INTERVAL=10` | 2190-06-01 | `null` | 2200 hors bornes → terminée |
| N21 | 2199-12-31 | `FREQ=DAILY` | 2199-12-31 | `null` | idem (sans exception, C1) |
| N22 | 2026-12-28 (lundi) | `FREQ=WEEKLY` | 2026-12-28 | 2027-01-04 | changement d'année |
| N23 | 2026-01-01 | `FREQ=DAILY` | | 2026-11-11 | grand retard : calcul direct |
| N24 | 2024-03-15 | `FREQ=YEARLY` | | 2027-03-15 | annuelle en retard (B1) |
| N25 | 2020-12-25 | `FREQ=YEARLY;INTERVAL=2` | | 2026-12-25 | série 2020, 22, 24, 26 (B1) |
| N26 | 2024-02-29 | `FREQ=YEARLY` | | 2028-02-29 | 2026 et 2027 sautées (B1) |
| N27 | 2026-01-31 | `FREQ=MONTHLY;INTERVAL=2` | 2026-06-15 | 2026-07-31 | mensuelle en retard |
| N28 | 2026-01-15 | `FREQ=MONTHLY` | 2026-11-20 | 2026-12-15 | mensuelle en retard |
| N29 | 2199-01-01 | `FREQ=DAILY;INTERVAL=366` | 2199-01-01 | `null` | dépasserait la borne (C1) |

### D4. Champs : description et « Important » (décision de Marius) ; une colonne typée par champ
- `description TEXT NOT NULL DEFAULT ''`, **texte brut**, ≤ 10 000 caractères et ≤ 40 000 octets (borne qui résiste à un caractère NUL, V23).
- `important INTEGER NOT NULL DEFAULT 0 CHECK (important IN (0, 1))` (booléen ADR-002 : jamais de booléen JS en paramètre). Marqueur sur la ligne (étoile + texte accessible, jamais la couleur seule) et interrupteur dans la fiche. **Tri et recherche inchangés** : l'ordre est manuel (une tâche importante se monte avec ↑) ; un tri automatique par importance contredirait l'ordre choisi par Marius ; un drapeau n'est pas du texte à chercher.
- La fiche affiche aussi, sans coût de schéma, « Créée le … » et « Terminée le … ».
- Extensibilité : un futur champ = une migration `ADD COLUMN … DEFAULT … CHECK` sur ce modèle, une entrée de `TodoChanges`, un bloc dans la fiche. Pas de sac JSON (données utilisateur à contrôler en SQL). Une extension de la **répétition** ne demande aucune migration (D2).

### D5. Le dépôt ne calcule pas : `shiftRepeatDue` (comparer-et-écrire), `setCompleted` inchangé
Le widget décide (`checkAction`, §4.6) : règle reconnue et prochaine date → `shiftRepeatDue(id, ancienne, nouvelle)` ; sinon `setCompleted(id, true)`. `shiftRepeatDue` n'écrit que si la ligne a encore l'échéance attendue, une règle et pas de `completed_at` (une instruction) ; sinon `conflict` (ou `not_found`). Il sert aussi à « Annuler » (D9). `setCompleted` garde son contrat : chemin de repli des règles non reconnues et hors bornes. Décocher une tâche répétée terminée la rend active, échéance et règle intactes.

### D6. Fiche : enregistrement au fil de l'eau, comme les notes
| Option | Verdict |
|---|---|
| « Enregistrer » / « Annuler » (comme le thème) | Rejetée : le thème a un aperçu à annuler ; ici on édite du contenu et Marius veut « modifier directement » |
| **Au fil de l'eau** : titre et description débouncés (800 ms, `flush` au `blur`, à « Retour », à la destruction, `PendingWrites`) ; échéance, répétition et « Important » écrits à chaque choix validé | **Retenue** |

Une seule boucle d'écriture (pas de `busy`). Règles d'échec (C2) : les **changements discrets** en attente (échéance, répétition, « Important ») sont **abandonnés**, les contrôles réalignés sur la valeur enregistrée, message d'erreur ; les **textes** restent en attente et sont réessayés (frappe suivante, `blur`, « Retour »), comme les notes. « Retour » attend l'écriture ; en cas d'échec, la fiche reste ouverte avec un message ; un second « Retour » ferme en abandonnant les textes non écrits. Un titre invalide (vide après `trim`) n'est pas écrit ; à la fermeture, ce brouillon est abandonné et le titre enregistré reste.

### D7. Ligne : une seule ligne, [i] à la place du crayon ; largeur décidée par le conteneur
`[case] [★] [titre tronqué, flex-1] [≡] [⟳] [échéance] [↑] [↓] [i] [poubelle]`. Saisie de date et édition en ligne disparaissent ; le double-clic sur le titre ouvre la fiche.
La largeur est celle **du conteneur** (requêtes de conteneur Tailwind, V22), pas `ctx.size().w` : à 800 px de fenêtre, un widget de 3 colonnes est plus étroit qu'un widget de 2 colonnes à 1 280 px. La liste porte `@container` ; seuils sur la largeur de la liste :
| Largeur de la liste | Ligne |
|---|---|
| ≥ 28rem (448 px) | complète, étiquette longue |
| < 28rem | étiquette courte |
| < 20rem (320 px) | en plus : ↑ ↓, poubelle et ≡ masqués (validé par Marius ; un widget de 2 colonnes est toujours sous ce seuil) |
| < 11rem (176 px) | en plus : étiquette sur une seconde ligne, sous le titre |
Corps utile estimé : 2 colonnes 72 à 152 px, 3 colonnes 180 à 300 px, 4 colonnes 256 à 416 px (fenêtre 800 à 1 280 px, dashboards-sidebar D4). La suppression reste dans la fiche ; réordonner demande d'élargir le widget.

### D8. Recherche : la description est cherchée, avec un extrait
Comme les notes : `title LIKE $1 OR description LIKE $1`, actives d'abord, titres ensuite, extrait affiché en sous-titre. Lot séparé (TD4).

### D9. Coche d'une tâche répétée : message d'état avec « Annuler »
Sans historique, une coche accidentelle ferait perdre l'ancienne échéance. Après l'avance : message dans une zone `role="status"` **permanente** (seul son contenu change) « Prochaine échéance de « … » : lundi 16 novembre 2026 » + bouton « Annuler » (`shiftRepeatDue` inverse). Le message reste jusqu'à la prochaine action dans le widget (pas de délai : WCAG 2.2.1).

### D10. Livraison sur `dashboards-sidebar`, gel de V6
- Lots TD1a à TD4 après T5, avant la revue de fin de phase 1 bis ; une seule fusion vers `main`, après revue de Marius.
- **Texte de V6 figé à la revue du lot TD1a.** **Aucun `npm run dev` du début de TD1a jusqu'à cette revue.** Ensuite, la base de dev passe de V5 à V6 au premier lancement.
- La vraie base passe de V3 à V6 en un seul démarrage de l'exe release : **une** sauvegarde « Avant mise à jour » (schéma 3), puis V4, V5 et V6 ensemble (M10 amendé, §10.6).

---

## 4. Conception détaillée

### 4.1 Migration V6

`migrations/V6__todo_details.sql` (texte exact, LF, sans BOM ; **figé à la revue du lot TD1a**) :
```sql
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
```
- `src/db.rs` : `version: 6, description: "todo_details"`. `checksums.json` : SHA-256 du fichier.
- `DEFAULT` constants : exception déjà admise pour V4/V5. `rrule` sans `DEFAULT` (NULL implicite), conforme au fragment de l'ADR-003 §3.1.3 complété de `due_on IS NOT NULL` (S1). Lignes existantes : `''`, `NULL`, `0`, `updated_at` inchangé.

Texte `CREATE TABLE todos` attendu après V6 (S2) : le texte de V3 dont la fin
```
  updated_at  TEXT    NOT NULL
              CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
) STRICT
```
devient
```
  updated_at  TEXT    NOT NULL
              CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
, description TEXT NOT NULL DEFAULT ''
  CHECK (length(description) <= 10000 AND length(CAST(description AS BLOB)) <= 40000), rrule TEXT NULL
  CHECK (rrule IS NULL OR (length(rrule) BETWEEN 10 AND 256 AND rrule GLOB 'FREQ=*'
         AND due_on IS NOT NULL)), important INTEGER NOT NULL DEFAULT 0
  CHECK (important IN (0, 1))) STRICT
```

### 4.2 Couche `data/`

`data/models.ts` :
```ts
/** Same bound as the CHECK of V6 (the repository counts UTF-16 units, which is stricter). */
export const TODO_DESCRIPTION_MAX = 10_000;

export interface Todo {
  id: string;
  listId: string;
  title: string;
  /** Plain text, '' when none (V6). Rendered by interpolation only. */
  description: string;
  /** Wall-clock due date `YYYY-MM-DD` (ADR-003), or null. */
  dueOn: LocalDateIso | null;
  /** Repetition rule (canonical subset of core/time/date-rule.ts, no DTSTART), anchored on dueOn;
   *  null = no repetition. Never set without dueOn (CHECK of V6). Not interpreted here. */
  rrule: string | null;
  /** Flag shown on the row (V6, stored 0/1). */
  important: boolean;
  completedAt: InstantIso | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface TodoChanges {
  title?: string;
  /** undefined keeps the current value; null clears it, and the rule with it (same statement). */
  dueOn?: string | null;
  /** undefined keeps the current value; '' clears it. */
  description?: string;
  /** undefined keeps the current value; null removes the repetition. A rule needs a due date. */
  rrule?: string | null;
  /** undefined keeps the current value. Bound as 1/0, never as a JS boolean (ADR-002 F13). */
  important?: boolean;
}

/** (lot TD4) */
export interface TodoSearchHit {
  id: string;
  title: string;
  listId: string;
  widgetInstanceId: string | null;
  completedAt: InstantIso | null;
  /** Short plain-text extract of the description (may be empty). */
  excerpt: string;
}
```
`NewTodo` est inchangé (création depuis la liste : titre seul ; défauts SQL pour les nouveaux champs).

`data/repositories.ts`, dans `TodoRepository` :
```ts
/**
 * Omitted fields are kept. Title trimmed, 1 to 500 characters; dueOn a YYYY-MM-DD shape or null;
 * description at most TODO_DESCRIPTION_MAX UTF-16 units (kept as typed, not trimmed); rrule null or
 * 10 to 256 characters starting with 'FREQ=' (invalid_input otherwise). rrule non-null together
 * with dueOn null: invalid_input before any query. dueOn null without rrule also clears the rule.
 * A rule written on a todo without due date (dueOn omitted): DataError('constraint').
 * not_found when absent. One statement.
 */
update(id: string, changes: TodoChanges): Promise<Todo>;
/**
 * Compare-and-set of the due date of a repeating, active todo: writes `toDueOn` only if the row
 * still has due_on = `fromDueOn`, a rule, and no completed_at (one statement). Otherwise conflict,
 * or not_found when absent. Both dates must have the YYYY-MM-DD shape (invalid_input). Used to
 * advance a repeating todo when it is checked, and to undo that. Keeps sort_order.
 */
shiftRepeatDue(id: string, fromDueOn: string, toDueOn: string): Promise<Todo>;
/** (unchanged contract) Ignores the rule: a repeating todo becomes completed, rule kept. */
setCompleted(id: string, completed: boolean): Promise<Todo>;
/** (lot TD4) Todos whose title or description contains `query` (same matching and limits as
 *  NoteRepository.search). Active first, then title matches, then most recently updated. */
search(query: string, limit: number): Promise<TodoSearchHit[]>;
```

`data/sqlite/sqlite-todo.repository.ts` :
- `validDescription(d)` : `d.length <= TODO_DESCRIPTION_MAX` sinon `invalid_input`. `validRrule(r)` : `null`, ou chaîne de 10 à 256 caractères commençant par `FREQ=` (miroir du `CHECK`).
- `update` :
```sql
UPDATE todos
SET title = COALESCE($2, title),
    due_on = CASE WHEN $3 = 1 THEN $4 ELSE due_on END,
    description = COALESCE($5, description),
    rrule = CASE WHEN $6 = 1 THEN $7
                 WHEN $3 = 1 AND $4 IS NULL THEN NULL
                 ELSE rrule END,
    important = COALESCE($8, important),
    updated_at = $9
WHERE id = $1
```
  Paramètres : `[id, title|null, setDue ? 1 : 0, dueOn|null, description|null, setRrule ? 1 : 0, rrule|null, important === undefined ? null : (important ? 1 : 0), now]`. Chaque expression lit l'**ancienne** ligne : `rrule` explicite l'emporte ; sinon, effacer l'échéance efface la règle. Contrôle préalable : `changes.rrule` non nul avec `changes.dueOn === null` → `invalid_input`.
- `shiftRepeatDue` :
```sql
UPDATE todos SET due_on = $3, updated_at = $4
WHERE id = $1 AND due_on = $2 AND rrule IS NOT NULL AND completed_at IS NULL
```
  0 ligne → `SELECT 1 FROM todos WHERE id = $1` : absente → `not_found`, sinon `conflict`. Puis `mustGet`.
- `setCompleted`, `create`, `listTodos` (tri), `remove`, `reorder`, `clearCompleted` : SQL inchangé. Avancer une tâche ne change pas `sort_order`.
- (TD4) `search` :
```sql
SELECT t.id, t.title, t.description, t.list_id, l.widget_instance_id, t.completed_at
FROM todos AS t JOIN todo_lists AS l ON l.id = t.list_id
WHERE t.title LIKE $1 ESCAPE '\' OR t.description LIKE $1 ESCAPE '\'
ORDER BY (t.completed_at IS NOT NULL), (t.title LIKE $1 ESCAPE '\') DESC, t.updated_at DESC, t.id
LIMIT $2
```
  (dans le littéral TS, `'\\'` comme aujourd'hui) ; `excerpt: excerptAround(row.description, term)`.

`data/sqlite/row-mappers.ts` : `TodoRow` gagne `description: string; rrule: string | null; important: number` ; `TODO_COLUMNS = 'id, list_id, title, description, due_on, rrule, important, completed_at, sort_order, created_at, updated_at'` ; `toTodo` : `description: str(…)`, `rrule: null | str(…)`, `important` : `int(row.important, 'important')` qui doit valoir 0 ou 1, sinon `corrupt_data`.

`core/testing/fake-todo.repository.ts` : mêmes champs, défauts et validation (règle sans échéance → `invalid_input`, effacement de la règle avec l'échéance), `shiftRepeatDue` (mêmes erreurs), (TD4) `search` sur titre et description avec `excerpt`.

### 4.3 `core/time/date-rule.ts` (nouveau, **non réexporté** par `core/time/index.ts`, S4)

```ts
import type { LocalDateIso } from '../../data';

export type DateRuleFreq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
export interface DateRule {
  readonly freq: DateRuleFreq;
  /** 1..DATE_RULE_INTERVAL_MAX[freq] (ADR-003 3.5.1). */
  readonly interval: number;
  /** BYMONTHDAY=-1; MONTHLY only. */
  readonly lastDayOfMonth: boolean;
}
export const DATE_RULE_INTERVAL_MAX: Readonly<Record<DateRuleFreq, number>> =
  { DAILY: 366, WEEKLY: 52, MONTHLY: 11, YEARLY: 10 };

/** Canonical text of the subset only (D2); null for anything else. Rebased on the lot B codec
 *  later (S10), same signature. */
export function parseDateRule(text: string): DateRule | null;
/** Canonical text (INTERVAL omitted when 1). Throws TimeError('invalid_rule') on a rule that
 *  parseDateRule would refuse. */
export function formatDateRule(rule: DateRule): string;
/** First occurrence of the series anchored at `anchor` strictly after `after`; null when it would
 *  be after MAX_LOCAL_DATE (never throws for that). Invalid days are skipped (ADR-003 D2).
 *  Throws TimeError on an invalid `anchor` or `after`. */
export function nextOccurrenceAfter(anchor: LocalDateIso, rule: DateRule, after: LocalDateIso): LocalDateIso | null;
/** D3: nextOccurrenceAfter(dueOn, rule, max(dueOn, today)). */
export function nextRepeatDue(dueOn: LocalDateIso, rule: DateRule, today: LocalDateIso): LocalDateIso | null;
/** True when `date` is the last day of its month. */
export function isLastDayOfMonth(date: LocalDateIso): boolean;
```
Algorithme (Temporal via `core/time` ; aucune arithmétique en millisecondes ; les seules opérations entières portent sur des **nombres de jours, de mois ou d'années fournis par Temporal**). Notations : `A` = ancre (`PlainDate`), `F` = `after`, `MAX` = `PlainDate` du 2199-12-31. Résultat : premier candidat `C` avec `C > F` et `C >= A` ; tout candidat `> MAX` → `null`. **Comparer en `PlainDate` (`Temporal.PlainDate.compare`) avant tout formatage** : ne jamais appeler `addDays` ni `formatLocalDate` sur une date hors bornes (V21).
- **DAILY / WEEKLY** : `step = interval × (1 | 7)` ; si `F < A` → `C = A` ; sinon `k = floor(daysBetween(A, F) / step) + 1`, `offset = k × step`. Si `offset > daysBetween(A, MAX)` → `null` (N21, N29) ; sinon `C = addDays(A, offset)`. Pas de boucle (N23).
- **MONTHLY** : `ym0` = `PlainYearMonth` de `A`, `d` = jour de `A`. `k0 = max(0, floor(ym0.until(ymF, { largestUnit: 'months' }).months / interval))` (`ymF` = `PlainYearMonth` de `F`, `0` si `F < A`). Pour `k = k0, k0 + 1, …` : `ym = ym0.add({ months: k × interval })` ; si `ym` est après décembre 2199 → `null` ; candidat = dernier jour de `ym` si `lastDayOfMonth`, sinon `ym.toPlainDate({ day: d })` **seulement si** `d <= ym.daysInMonth` (sinon mois ignoré) ; retenir le premier candidat `> F` et `>= A`.
- **YEARLY** (B1, écrit explicitement) : `k0 = max(0, floor(ym0.until(ymF, { largestUnit: 'years' }).years / interval))` (`0` si `F < A`). Pour `k = k0, k0 + 1, …` : `ym = ym0.add({ years: k × interval })` (même mois que `A`) ; si `ym` est après décembre 2199 → `null` ; candidat = `ym.toPlainDate({ day: d })` seulement si `d <= ym.daysInMonth` (seul le 29 février peut manquer) ; premier candidat `> F` et `>= A`. Ex. N24 : `ym0` = 2024-03, `ymF` = 2026-11, 2 ans → `k0 = 2` → 2026-03-15 (≤ F) → `k = 3` → 2027-03-15.
- Garde-fou : au plus **1 000** itérations → `null` (inatteignable dans les bornes).
- `temporal.ts` : ajouter `type PlainYearMonth = Poly.Temporal.PlainYearMonth;` à l'espace de noms de types.

### 4.4 Vecteurs partagés
`core/time/testing/time-vectors.json`, nouvelle section (sans changer `formatVersion`) :
```json
"dateNext": [
  { "id": "N1-DAILY-TODAY", "anchor": "2026-11-10", "rrule": "FREQ=DAILY", "after": "2026-11-10", "expected": "2026-11-11" }
]
```
Une entrée par ligne N1 à N29 de D3, avec `after` = max(échéance, aujourd'hui) et `expected` (`null` pour N20, N21, N29) ; plus deux cas `after < anchor` : `FREQ=MONTHLY;BYMONTHDAY=-1`, ancre 2026-01-15, après 2026-01-10 → 2026-01-31 ; `FREQ=WEEKLY`, ancre 2026-11-16, après 2026-11-10 → 2026-11-16. `vectors.spec.ts` exécute la section par `nextOccurrenceAfter(anchor, parseDateRule(rrule), after)` ; chaque échec cite l'`id`. Le lot B l'exécutera côté Rust (§10.1).

### 4.5 Ligne de la liste (lot TD2b ; ⟳ au lot TD3)

- La liste (`ul`) porte la classe `@container`. Une ligne : `div.flex.items-center.gap-2.@max-[11rem]:flex-wrap` :
  - case (inchangée, `aria-label` = titre) ;
  - marqueur « Important » si `important` : `<i class="pi pi-star-fill text-xs text-attention" aria-hidden="true">` + `span.sr-only` « Important » (`todo-important-marker`) ; la forme de l'étoile porte l'information, pas seulement la couleur ;
  - titre `min-w-0 flex-1 truncate`, `title` = titre complet, `(dblclick)` → ouvrir la fiche ;
  - indicateurs `flex-none text-xs text-fg-muted` : description (`pi pi-align-left`, si `description.trim() !== ''`, classe `@max-[20rem]:hidden`), répétition (`pi pi-sync`, TD3, si `rrule !== null`), chacun `aria-hidden` doublé d'un `span.sr-only` (« Avec description », « Répétée : <résumé> ») ;
  - étiquette d'échéance `flex-none text-xs` (`text-danger font-semibold` en retard, `text-attention` aujourd'hui/demain, `text-fg-muted` sinon), avec `@max-[11rem]:order-last @max-[11rem]:basis-full @max-[11rem]:pl-6` (seconde ligne quand très étroit) ; elle contient la forme longue (`@max-[28rem]:hidden`) et la forme courte (`hidden @max-[28rem]:inline`) ;
  - ↑ ↓ (actives seulement) et poubelle : `@max-[20rem]:hidden` ;
  - **[i]** : `button.btn.btn-invisible.btn-icon.btn-compact`, `data-testid="todo-info"`, `pi pi-info-circle` `aria-hidden`, `aria-label` « Détails de <titre> », sur **toutes** les lignes (terminées comprises).
- Étiquette : fonction pure `dueLabel(todo, today, formatDate)` dans `widgets/todo/todo-due.ts`, où `formatDate: (date: LocalDateIso, style: 'day-month' | 'short') => string` est fourni par l'appelant (`TimeDisplay.formatLocalDate`) ; elle renvoie le genre, le texte long et le texte court :
  | Genre | Forme longue | Forme courte |
  |---|---|---|
  | `overdue` | icône `pi-exclamation-circle` + « En retard d'1 jour » / « En retard de N jours » | icône `pi-exclamation-circle` + « N j » visible, texte long en `sr-only` (C6 : l'icône est présente dans **toutes** les formes) |
  | `today` | « Aujourd'hui » | identique |
  | `tomorrow` | « Demain » | identique |
  | `date` | `day-month` (« 3 nov. ») si même année qu'aujourd'hui (`parseLocalDate(x).year`), sinon `short` (« 3 nov. 2027 ») | identique |
  Tâche terminée : jamais en retard (genre `date`).
- `core/time/time-display.ts` : style `'day-month'` = `{ day: 'numeric', month: 'short' }`.
- [i] et double-clic ignorés pendant `busy()` (une écriture de la liste en cours).
- Supprimés du composant : `editing`, `editError`, `startEdit`, `onEditInput`, `cancelEdit`, `commitEdit`, `onDueChange`, `onDueBlur`, `inDueRange`, `clearDue`, `setDue` et leurs gabarits.
- Focus après fermeture de la fiche : [i] de la ligne ; ligne absente → [i] de la ligne qui a pris sa place, sinon de la précédente, sinon le champ « Nouvelle tâche ». Un [i] masqué n'existe pas (il est toujours visible).

### 4.6 Coche d'une tâche répétée (lot TD3)

`widgets/todo/todo-repeat.ts` (pur) :
```ts
export type CheckAction =
  | { readonly kind: 'complete' }
  | { readonly kind: 'advance'; readonly from: LocalDateIso; readonly to: LocalDateIso };
/** advance when the todo is active, has a due date and a rule parsed by parseDateRule, and
 *  nextRepeatDue gives a date; complete otherwise. */
export function checkAction(todo: Todo, today: LocalDateIso): CheckAction;
```
`toggle` : si la case passe à coché et `checkAction(todo, today.date())` vaut `advance` → `shiftRepeatDue(id, from, to)`, puis **`box.checked = false`** (la liaison `[checked]` reste à `false` et ne repeint pas le DOM), `refresh`, focus sur la même case, message D9 (`advanced = { id, title, from, to }`). Sinon : comportement actuel. Échec : case remise, `actionError` ; si l'erreur est `conflict`, `refresh` en plus (la liste affichée était périmée).
« Annuler » : `shiftRepeatDue(id, to, from)`, message retiré, `refresh`, focus sur la case ; `conflict` → `actionError` et `refresh` ; `not_found` → `actionError` et `refresh`.
Le message est retiré au début de **toute** autre action du widget : ajout, coche, ↑ ↓, suppression, « Effacer les terminées », « Afficher les terminées », ouverture de la fiche, rechargement.
Gabarit : `p[role="status"][data-testid="todo-advanced-status"].min-w-0.truncate.text-xs.text-fg-muted` **toujours rendu** dans la vue liste (vide hors message) ; son texte « Prochaine échéance de « {{ title }} » : {{ date }} » (`weekday-long`) ; à côté, `button.btn.btn-invisible.btn-compact[data-testid="todo-advanced-undo"]` « Annuler », rendu seulement avec un message.

### 4.7 Fiche (`widgets/todo/todo-detail.component.{ts,html}`, lot TD2a ; répétition au lot TD3)

Composant enfant du widget (même dossier), standalone, `OnPush`, signals. Entrées : `todo = input.required<Todo>()` (instantané à l'ouverture), `instanceId = input.required<string>()`. Sorties : `closed`, `removed`, `vanished`. Il injecte `TODO_REPOSITORY`, `Today`, `TimeDisplay`, `PendingWrites`, `TranslocoService`. Il ne connaît pas la largeur : il défile dans la carte.

Branchement (lot TD2b) dans `TodoComponent` : `detail = signal<Todo | null>(null)` ; `@if (detail(); as t) { <app-todo-detail …/> } @else { …liste… }` (champ d'ajout, liste et pied remplacés). `openDetail(todo)` (ignoré si `busy()`) : retire le message D9 et les confirmations, ouvre. `closed` → `detail.set(null)`, `refresh`, focus §4.5. `removed` → idem, focus comme `confirmRemove`. `vanished` → idem + flash `role="alert"` « Cette tâche n'existe plus. » (`todo-gone`), focus sur le champ « Nouvelle tâche ».

Structure (conteneur `div[role="group"].flex.min-h-0.flex-1.flex-col.gap-3.overflow-y-auto`, `aria-label` « Détails de « <titre enregistré> » », `(keydown.escape)`) :
1. En-tête `flex items-center gap-2` : « Retour » (`btn btn-invisible btn-compact`, `pi pi-arrow-left` + texte, `todo-detail-back`) ; état d'écriture `text-xs text-fg-muted min-w-0 flex-1 truncate` (« Enregistrement… », « Enregistré » ; erreur en `role="alert"` `text-danger`) ; poubelle `btn btn-invisible btn-icon btn-compact btn-danger` (`todo-detail-remove`, « Supprimer la tâche »).
2. Confirmation de suppression (si demandée), à la place de l'en-tête : « Supprimer cette tâche ? » + « Supprimer » (`btn btn-compact btn-danger`) + « Annuler » (`btn btn-compact`, focus initial).
3. **Titre** : `label` visible (`text-xs font-semibold`) + `textarea.field.w-full.resize-none.py-2.field-sizing-content` `rows="2"` `maxlength="500"` (`todo-detail-title`). Entrée et Maj+Entrée n'insèrent pas de retour (le titre est une ligne) et déclenchent l'écriture immédiate ; tout retour à la ligne collé devient une espace ; touches ignorées si `isComposing`. Erreur `field-error` « Le titre doit contenir de 1 à 500 caractères. » + `aria-invalid`.
4. **Important** : `label.flex.items-center.gap-2` + `input[type=checkbox][role=switch].switch` (`todo-detail-important`) « Important ».
5. **Description** : `label` + `textarea.field.w-full.resize-none.py-2.field-sizing-content` `rows="3"` `maxlength="10000"` (`todo-detail-description`), texte brut lié par `[value]` (jamais `innerHTML`) ; Entrée insère un retour à la ligne (comportement natif).
6. **Échéance** : `label` + `<input type="date" class="field" min="1900-01-01" max="2199-12-31">` (`todo-detail-due`) + bouton « Effacer l'échéance » (`btn btn-invisible btn-icon btn-compact`, `pi pi-times`, si une échéance est voulue) + étiquette relative `text-xs` (`dueLabel`, forme longue). Saisie partielle **reprise telle quelle** de V2 ; au `blur`, le champ reprend la valeur **voulue** : `'dueOn' in pending ? pending.dueOn : stored.dueOn` (jamais `stored` seul, C2).
7. **Répétition** (TD3) : §4.8.
8. Métadonnées `text-xs text-fg-muted` : « Créée le … » (`formatInstant(createdAt, 'date')`), « Terminée le … » si `completedAt`.

Écritures (D6) :
- État : `stored` (dernière `Todo` renvoyée par le dépôt), brouillons `title`, `description`, `pending: TodoChanges` (seulement `dueOn`, `rrule`, `important`), `textDirty`, `timer`, `running`, `closeFailed`.
- **Fusion unique** (C3), fonction pure `mergeChanges(stored, older, newer): TodoChanges` dans `widgets/todo/todo-changes.ts` : `merged = { ...older, ...newer }` (le plus récent l'emporte), puis normalisation : (1) `merged.dueOn === null` → `merged.rrule = null` ; (2) (TD3) échéance effective (`'dueOn' in merged ? merged.dueOn : stored.dueOn`) non nulle et règle effective (`'rrule' in merged ? merged.rrule : stored.rrule`) reconnue avec `lastDayOfMonth` alors que l'échéance n'est pas un dernier jour → `merged.rrule = formatDateRule(normalizeRule(règle, échéance))`. Tout choix discret fait `pending = mergeChanges({ ...stored, ...inflight }, pending, choix)` puis écriture immédiate : la base de fusion est l'état **voulu** (dernière `Todo` stockée + écriture en cours), jamais `stored` seul, sinon un choix fait pendant une écriture peut laisser une règle « dernier jour » sur une échéance qui n'en est pas un (C10) ou perdre ce choix (revue TD3, I1).
- Saisie de texte → `textDirty = true`, minuterie 800 ms (`TODO_DETAIL_SAVE_DEBOUNCE_MS`, exportée) ; `blur` d'un champ texte → écriture immédiate.
- Boucle `drain` : tant que `textDirty` ou `pending` non vide : `batch = pending`, `pending = {}` ; `changes = { ...batch }` ; si `textDirty` : `textDirty = false`, ajouter `description` **si elle diffère** de `stored.description`, et `title` (trim) **s'il est valide et diffère** de `stored.title` (S5) ; `changes` vide → itération suivante ; `update(id, changes)` → `stored` = résultat.
  - `not_found` → abandon (C4, ci-dessous), puis `vanished`.
  - Autre erreur (C2) : `batch` **et** tout `pending` accumulé pendant l'écriture sont **abandonnés** (`pending = {}`), contrôles discrets réalignés sur `stored` ; `textDirty = true` si des textes faisaient partie de l'essai (ils sont relus dans les brouillons au prochain essai : le plus récent l'emporte par construction) ; état « erreur » ; arrêt. Aucun autre ordre de fusion n'existe : après un échec, seuls les textes survivent.
- « Retour » / Échap (Échap ignoré si `isComposing`) : si `closeFailed` → **abandon** puis `closed`. Sinon `flush` ; succès → `closed` ; échec → `closeFailed = true`, message « Les modifications n'ont pas pu être enregistrées. Réessayez, ou appuyez de nouveau sur Retour pour les abandonner. ». Toute nouvelle saisie remet `closeFailed` à faux. Échap pendant la confirmation de suppression annule la confirmation (focus sur la poubelle) sans fermer.
- **Abandon** (C4 ; second « Retour », `vanished`, suppression) : annuler la minuterie, `pending = {}`, `textDirty = false`, **avant** d'émettre ; ainsi le `flush` de la destruction n'écrit rien.
- Destruction (changement de tableau, suppression du widget, navigation) : `flush` silencieux, puis désinscription de `PendingWrites` (modèle des notes) ; aucune sortie émise.
- Suppression confirmée : attendre `running`, abandon, `remove(id)` → `removed` ; échec → message, fiche ouverte.
- Ouverture : focus sur le titre (curseur en fin).

### 4.8 Répétition dans la fiche (lot TD3)

`widgets/todo/todo-repeat.ts` ajoute :
```ts
export type RuleForm =
  | { readonly kind: 'none' }
  | { readonly kind: 'other' }                       // stored rule not parsed by parseDateRule
  | { readonly kind: 'rule'; readonly rule: DateRule };
export function ruleFormOf(rrule: string | null): RuleForm;
/** Rule to store for this due date: lastDayOfMonth dropped when dueOn is not a last day. */
export function normalizeRule(rule: DateRule, dueOn: LocalDateIso): DateRule;
/** Transloco key and params of the human summary ("Toutes les 2 semaines"). */
export function ruleSummary(form: RuleForm): { readonly key: string; readonly params: Record<string, number> };
```
Le formulaire affiche la règle **voulue** (`'rrule' in pending ? pending.rrule : stored.rrule`), comme le champ de date.
- `select.field` « Répétition » (`todo-detail-repeat`) : « Ne se répète pas », « Tous les jours », « Toutes les semaines », « Tous les mois », « Tous les ans », plus « Règle non reconnue (conservée) » **désactivée**, sélectionnée seulement si `kind === 'other'`. **Désactivé sans échéance voulue**, avec l'aide « Choisissez d'abord une échéance. ».
- Si une règle : « Intervalle » `input[type=number].field.w-16` (`todo-detail-interval`, `min=1`, `max` = borne de la fréquence, `step=1`) + unité ; écrit au `change` si entier dans les bornes, sinon `aria-invalid` + « Entrez un nombre entier de 1 à {{ max }}. », rien d'écrit, valeur voulue remise au `blur`.
- Si `MONTHLY` et l'échéance voulue est le dernier jour de son mois : `fieldset` « Jour du mois », radios « Le {{ day }} de chaque mois » (défaut, D2) et « Le dernier jour du mois ».
- Note `text-xs text-fg-muted` (`todo-detail-repeat-note`) : `MONTHLY` sans « dernier jour » et jour ≥ 29 → « Les mois qui n'ont pas de {{ day }} sont sautés. » ; `YEARLY` au 29 février → « Les années non bissextiles sont sautées. ».
- Résumé + aide (`todo-detail-repeat-summary`) : « Toutes les 2 semaines. Cocher la tâche avance son échéance à la prochaine date ; elle reste dans la liste. ».
- Changer de fréquence : intervalle remis à 1, « dernier jour » décoché ; choix `{ rrule: formatDateRule(…) }` ou `{ rrule: null }` via `mergeChanges`.
- Changer l'échéance avec une règle « dernier jour » vers un jour qui ne l'est pas : la normalisation de `mergeChanges` réécrit la règle dans la **même** écriture.
- Effacer l'échéance avec une règle : choix `{ dueOn: null }` (la fusion pose `rrule: null`) ; formulaire « Ne se répète pas » ; état « Échéance effacée : la répétition est retirée. ».
- Échec d'écriture : formulaire réaligné sur `stored` (C2).

### 4.9 Recherche (lot TD4)
Dépôt : §4.2. `SearchService` : `TodoResult` gagne `readonly subtitle?: string` (`excerpt` non vide). `widgets/search/search.component.html` l. 96 : la condition devient `@if (result.subtitle)` (sous-titre des tâches comme celui des notes, segments surlignés, interpolation seule). « Important » n'est ni cherché ni affiché dans la recherche (D4).

### 4.10 i18n FR (`core/i18n/fr.json`, sous `widgets.todo`)
Retirer : `edit`, `editLabel`, `save`, `cancel`, `dueLabel`, `clearDue`. Ajouter :
```
details                  Détails de {{ title }}
important                Important
dueShortOverdue          {{ count }} j
hasDescription           Avec description
repeating                Répétée : {{ summary }}
advanced                 Prochaine échéance de « {{ title }} » : {{ date }}
undoAdvance              Annuler
gone                     Cette tâche n'existe plus.
detail.group             Détails de « {{ title }} »
detail.back              Retour
detail.titleLabel        Titre
detail.importantLabel    Important
detail.descriptionLabel  Description
detail.descriptionPlaceholder  Ajouter une description…
detail.dueLabel          Échéance
detail.clearDue          Effacer l'échéance
detail.dueAndRepeatCleared  Échéance effacée : la répétition est retirée.
detail.created           Créée le {{ date }}
detail.completed         Terminée le {{ date }}
detail.saving            Enregistrement…
detail.saved             Enregistré
detail.saveError         Les modifications n'ont pas pu être enregistrées. Réessayez, ou appuyez de nouveau sur Retour pour les abandonner.
detail.remove            Supprimer la tâche
detail.confirmRemove     Supprimer cette tâche ?
repeat.label             Répétition
repeat.none              Ne se répète pas
repeat.daily             Tous les jours
repeat.weekly            Toutes les semaines
repeat.monthly           Tous les mois
repeat.yearly            Tous les ans
repeat.other             Règle non reconnue (conservée)
repeat.needsDue          Choisissez d'abord une échéance.
repeat.intervalLabel     Intervalle
repeat.intervalError     Entrez un nombre entier de 1 à {{ max }}.
repeat.unit.DAILY        jour(s)
repeat.unit.WEEKLY       semaine(s)
repeat.unit.MONTHLY      mois
repeat.unit.YEARLY       an(s)
repeat.monthDayGroup     Jour du mois
repeat.monthDay          Le {{ day }} de chaque mois
repeat.lastDay           Le dernier jour du mois
repeat.skipMonths        Les mois qui n'ont pas de {{ day }} sont sautés.
repeat.skipYears         Les années non bissextiles sont sautées.
repeat.hint              Cocher la tâche avance son échéance à la prochaine date ; elle reste dans la liste.
repeat.summary.DAILY_one         Chaque jour
repeat.summary.DAILY_many        Tous les {{ n }} jours
repeat.summary.WEEKLY_one        Chaque semaine
repeat.summary.WEEKLY_many       Toutes les {{ n }} semaines
repeat.summary.MONTHLY_one       Chaque mois
repeat.summary.MONTHLY_many      Tous les {{ n }} mois
repeat.summary.MONTHLY_LAST_one  Le dernier jour de chaque mois
repeat.summary.MONTHLY_LAST_many Le dernier jour du mois, tous les {{ n }} mois
repeat.summary.YEARLY_one        Chaque année
repeat.summary.YEARLY_many       Tous les {{ n }} ans
repeat.summary.other             Règle non reconnue
```
Clés `detail.*` au lot TD2a ; `details`, `important`, `dueShortOverdue`, `hasDescription`, `gone` et retraits au lot TD2b ; `repeat.*`, `repeating`, `advanced`, `undoAdvance` au lot TD3. `fr.spec.ts` mis à jour.

### 4.11 Accessibilité et clavier
- [i] : nom « Détails de <titre> » ; Entrée/Espace ouvrent la fiche ; focus sur le titre ; Échap ou « Retour » referment ; focus rendu au [i].
- Champs de la fiche : `label` visible lié par `for`/`id` (`todo-detail-<champ>-<instanceId>`) ; erreurs par `aria-describedby` ; état d'écriture en texte (`role="alert"` en cas d'erreur).
- Aucune information portée par la couleur seule : étoile + « Important » en `sr-only` ; retard = icône + texte dans toutes les formes ; indicateurs doublés d'un texte `sr-only` (WCAG 1.4.1).
- Éléments masqués par les variantes de conteneur : `display: none`, donc hors de l'ordre de tabulation et de l'arbre d'accessibilité.
- Cibles ≥ 24 px (`btn-compact` = 28 px).

### 4.12 Thème de tableau et contraste
Aucune nouvelle couleur ni nouvelle paire : `text-fg`, `text-fg-muted`, `text-danger`, `text-attention`, `field`, `field-error`, `switch`, `btn*`, `flash*`, déjà employés par les widgets et vérifiés sur les teintes par `check-contrast` (V18). `tokens.css` et `check-contrast` inchangés. Contrôle visuel MD1.

### 4.13 Sécurité
- Description et titre : texte brut, **interpolation uniquement** (`{{ }}`, `[value]`, `[attr.title]`), jamais `innerHTML` ; pas de détection de liens. Extrait de recherche : segments interpolés (existant).
- SQL : paramètres liés ; booléen lié en 0/1 ; règle validée par `parseDateRule`/`formatDateRule` avant écriture, forme revérifiée par le dépôt, `CHECK` en dernier.
- Déni de service : description ≤ 10 000 caractères et ≤ 40 000 octets (NUL compris), règle ≤ 256, calcul sans boucle pour jour/semaine, ≤ 1 000 itérations sinon, aucune exception hors bornes.
- Aucune commande Tauri, capability, CSP, `build.rs` ni `tauri.conf.json` modifiés ; aucun secret ; rien de nouveau dans `settings` ni dans l'export.

### 4.14 Bundle initial (avertissement à 500 kB ; base ≈ 490 kB)
| Élément | Bundle | Estimation |
|---|---|---|
| `data/` : SQL et validation d'`update`, `shiftRepeatDue`, colonnes, mapper (`important` compris) | initial | +1,2 à +1,7 kB |
| `TimeDisplay` : style `day-month` | initial | < 0,1 kB |
| `data/` recherche (TD4) | initial | +0,2 kB |
| `core/time/date-rule.ts` (import direct par le widget, S4) | paresseux | 0 |
| Widget, fiche, `fr.json`, variantes de conteneur (CSS du composant ou feuille globale : mesurer) | paresseux / styles | ≈ 0 à +0,5 kB |
| **Total** | | **≈ +1,5 à +2,5 kB** (≈ 492 kB) |

Contrôle à chaque lot sur **tous** les fichiers listés « Initial chunk files » par `npm run web:build` (S4) ; ≥ 500 kB ou avertissement → arrêt (budget jamais relevé).

---

## 5. Cas limites

| # | Cas | Comportement |
|---|---|---|
| C1 | Tâches existantes à la migration | `description = ''`, `rrule = NULL`, `important = 0`, `updated_at` inchangé |
| C2 | Tâche répétée cochée | Reste active, à sa place ; échéance = prochaine occurrence (D3) ; case décochée ; message avec « Annuler » |
| C3 | Retard de plusieurs périodes | Périodes manquées sautées (N2, N14, N23 à N28) |
| C4 | Cochée en avance | Période suivante (N5, N16) |
| C5 | Le 31, le 30, le 29 février | Mois/années sans ce jour sautés (D2 ; N7, N8, N12, N15, N17, N18, N26) ; note dans la fiche ; « dernier jour du mois » proposé si l'échéance est un dernier jour |
| C6 | Pas d'occurrence au plus tard le 2199-12-31 | `null` sans exception (N20, N21, N29) ; terminée normalement, règle conservée ; décocher la rend active |
| C7 | Règle non reconnue (version future) | Conservée ; « Règle non reconnue » ; cocher = terminer normalement ; choisir une autre option la remplace |
| C8 | Effacer l'échéance d'une tâche répétée | Échéance et règle effacées dans la même écriture ; message |
| C9 | Règle sans échéance (appel direct) | `invalid_input` (même modification) ou `constraint` (échéance absente en base) ; l'interface l'empêche |
| C10 | Échéance « dernier jour » remplacée par un autre jour | Règle réécrite sans `BYMONTHDAY=-1` dans la même écriture (`mergeChanges`) |
| C11 | Double clic sur la case ; clic sur [i] pendant une écriture | Seconde coche ignorée, case remise ; [i] et double-clic ignorés pendant `busy()` |
| C12 | « Annuler » ou coche sur une liste périmée | `conflict` → message d'erreur et liste rechargée |
| C13 | Minuit pendant l'affichage | Étiquettes recalculées (`Today`) ; la coche utilise `today.date()` au clic |
| C14 | Changement de fuseau | Dates murales inchangées ; « aujourd'hui » recalculé (ADR-003 C18) |
| C15 | Changement d'heure | Sans objet : dates sans heure |
| C16 | Saisie partielle de l'année | Rien d'écrit avant une date complète et valide ; au `blur`, valeur **voulue** remise |
| C17 | Modification pendant une écriture (fiche) | Fusionnée (`mergeChanges`, la plus récente l'emporte) et écrite par la boucle unique |
| C18 | Écriture en échec | Changements discrets abandonnés, contrôles réalignés sur l'enregistré, message ; textes conservés et réessayés |
| C19 | Échec puis « Retour » | Fiche ouverte, message ; second « Retour » : abandon puis fermeture ; la destruction n'écrit rien |
| C20 | Titre vidé puis « Retour » | Titre non écrit ; à la fermeture le brouillon est abandonné, l'ancien titre reste |
| C21 | Tâche disparue pendant que la fiche est ouverte | Première écriture → `not_found` → abandon, fiche fermée, « Cette tâche n'existe plus. », focus sur le champ d'ajout |
| C22 | Suppression depuis la fiche | Confirmation ; aucune écriture après ; focus sur le [i] de la ligne suivante / précédente / le champ |
| C23 | Changement de tableau, `Alt+←`, Réglages, suppression du widget, fiche ouverte | Destruction : écriture en attente envoyée ; au retour, la liste s'affiche |
| C24 | Import de configuration, restauration, suppression de tableau (`AppLock`) | `PendingWrites.flushAll` écrit le brouillon avant ; page `inert` pendant l'opération |
| C25 | Liste étroite (widget de 2 colonnes, ou de 3 colonnes à 800 px) | Seuils du D7 : étiquette courte, puis ↑ ↓ poubelle ≡ masqués, puis étiquette sous le titre ; fiche défilante |
| C26 | Titre de 500 caractères, description de 10 000 | Fiche défile ; `textarea` à hauteur du contenu (S3) |
| C27 | Description avec HTML, script ou caractère NUL | Affichée comme texte ; NUL : borne en octets du `CHECK` |
| C28 | Composition IME (Entrée, Échap) | Ignorées tant que `isComposing` |
| C29 | Tâche terminée | [i] disponible ; tout éditable ; reste terminée |
| C30 | « Afficher les terminées » désactivé et tâche répétée cochée | Reste affichée (active) ; focus sur sa case |
| C31 | « Effacer les terminées » | Inchangé ; une tâche répétée active n'est jamais concernée |
| C32 | Tâche importante | Étoile + « Important » en `sr-only` ; ordre manuel inchangé |
| C33 | Recherche d'un mot de la description (TD4) | Trouvée, extrait en sous-titre ; titres d'abord |
| C34 | Archive V3, V4 ou V5 restaurée avec le binaire V6 | Acceptée ; migrée au démarrage suivant après `pre-migration` |
| C35 | Archive V6 restaurée avec un binaire V5 | `schema_too_new` |
| C36 | Export / import de configuration | Inchangés (`formatVersion` 3) |
| C37 | Hors Tauri (`ng serve`) | `unavailable` comme aujourd'hui |
| C38 | Hors-ligne, synchronisation, doublons | Sans objet : local, un seul processus ; la répétition ne copie pas la tâche |

---

## 6. Tests

### 6.1 `test:data`
- `migrations.spec.ts`, bloc « V6 (todos.description, rrule, important) » : `createTestDatabase(5)`, un tableau, une instance `todo`, une liste, deux tâches (une avec échéance et `completed_at`) ; V6 appliquée (comme V5) → `description = ''`, `rrule = NULL`, `important = 0`, autres colonnes et `updated_at` inchangés, `integrity_check` et `foreign_key_check` propres. `CHECK` (erreur `constraint`) : description de 10 001 caractères (10 000 acceptés) ; description `'a' || char(0) || <40 000 octets>` (borne en octets) ; `rrule` `'FREQ=DAILY'` sans échéance (S1) ; `'DAILY'`, `'FREQ='`, 257 caractères ; `UPDATE todos SET due_on = NULL` sur une tâche avec règle (S1) ; `important` 2 et -1. Acceptés : `'FREQ=DAILY'` avec échéance ; `important` 1. Texte `CREATE TABLE todos` de `sqlite_schema` égal au §4.1 (S2).
- `sqlite-todo.repository.spec.ts` : `create` → `''`, `null`, `false` ; `listTodos` et les valeurs renvoyées par `update` restituent les nouveaux champs ; description (titre seul la garde ; `''` ; 10 001 → `invalid_input`) ; `important` (vrai puis faux ; omis → gardé ; paramètre lié 1/0) ; règle (forme invalide → `invalid_input` ; avec `dueOn: null` → `invalid_input` sans requête ; échéance absente en base → `constraint`) ; `dueOn: null` efface la règle ; changer l'échéance garde la règle ; `rrule: null` la retire ; `shiftRepeatDue` (écrit ; `sort_order`, `completed_at` inchangés ; `updated_at` mis à jour ; échéance attendue différente, sans règle, terminée → `conflict` ; absente → `not_found` ; forme invalide → `invalid_input`) ; `setCompleted` sur une tâche répétée → terminée, règle gardée ; décocher → active, intacte. Ligne avec `important = 2` écrite en contournant le `CHECK` impossible : pas de test (STRICT + CHECK). (TD4) `search` (écart : ces tests sont dans `apps/web/src/app/data/sqlite/sqlite-search.spec.ts`, avec ceux des notes et raccourcis, et non dans `sqlite-todo.repository.spec.ts`) : description seule → trouvée avec extrait ; titres d'abord ; actives d'abord ; `%` et `_` littéraux.

### 6.2 Vitest, runner Angular
| Fichier | Lot | Contenu |
|---|---|---|
| `core/time/date-rule.spec.ts` (nouveau) | TD1b | `parseDateRule` : acceptés `FREQ=DAILY`, `FREQ=WEEKLY;INTERVAL=52`, `FREQ=MONTHLY;INTERVAL=11;BYMONTHDAY=-1`, `FREQ=YEARLY;INTERVAL=10` ; refusés `''`, `freq=daily`, `RRULE:FREQ=DAILY`, `FREQ=HOURLY`, `FREQ=DAILY;INTERVAL=1`, `FREQ=DAILY;INTERVAL=02`, `FREQ=DAILY;INTERVAL=367`, `FREQ=MONTHLY;INTERVAL=12`, `FREQ=WEEKLY;BYMONTHDAY=-1`, `FREQ=MONTHLY;BYMONTHDAY=-1;INTERVAL=2`, `FREQ=MONTHLY;BYMONTHDAY=31`, `FREQ=WEEKLY;BYDAY=MO`, `FREQ=DAILY;COUNT=3` ; aller-retour ; `formatDateRule` refuse intervalle hors bornes et `lastDayOfMonth` hors `MONTHLY` ; table D3 (N1 à N29) par `nextRepeatDue`, **sans exception** pour N20, N21, N29 ; `isLastDayOfMonth` (2026-02-28 oui, 2028-02-28 non, 2028-02-29 oui, 2026-04-30 oui, 2026-04-29 non) |
| `core/time/vectors.spec.ts` | TD1b | Section `dateNext` |
| `core/time/time-display.spec.ts` | TD2a | `day-month` : « 3 nov. » (comparé à `Intl` construit dans le test) |
| `widgets/todo/todo-due.spec.ts` (nouveau) | TD2a | `dueLabel` avec un formateur factice : en retard 1 et N (icône dans les deux formes), aujourd'hui, demain, même année → `day-month`, autre année → `short`, terminée jamais en retard |
| `widgets/todo/todo-changes.spec.ts` (nouveau) | TD2a, TD3 | [TD2a] plus récent l'emporte ; `dueOn: null` force `rrule: null` ; ordre des arguments. [TD3] règle « dernier jour » en attente ou enregistrée + échéance qui n'est pas un dernier jour → règle sans `BYMONTHDAY=-1` ; échéance dernier jour → règle gardée |
| `widgets/todo/todo-detail.component.spec.ts` (nouveau) | TD2a, TD3 | [TD2a] valeurs initiales ; focus sur le titre ; titre et description écrits **une fois** 800 ms après la dernière frappe (`vi.useFakeTimers`), immédiatement au `blur` ; titre ou description identiques à l'enregistré non envoyés ; Entrée et Maj+Entrée dans le titre : écriture, pas de retour à la ligne ; ignorées pendant `isComposing` ; collage multi-ligne → espaces ; titre vide → message, non écrit, description écrite ; « Important » → `{ important: true }` ; date : `{ dueOn }`, saisie partielle et `badInput` ignorées, `blur` remet la valeur **voulue** pendant une écriture en cours et l'enregistrée sinon, effacement ; une saisie pendant une écriture est reprise par la boucle ; échec d'une écriture discrète → contrôles réalignés, aucune nouvelle tentative de ce changement, texte réessayé à la frappe suivante ; « Retour » attend l'écriture puis `closed` ; échec puis « Retour » → reste, message ; **second « Retour » puis destruction → 0 appel `update`** (C4) ; Échap = « Retour » ; suppression : confirmation, focus « Annuler », Échap annule la confirmation, « Supprimer » → `remove` puis `removed`, aucune écriture ensuite ; `not_found` → `vanished` puis destruction → 0 appel ; destruction normale → écriture en attente envoyée ; `PendingWrites` ; métadonnées. [TD3] sélecteur désactivé sans échéance voulue + aide ; « Toutes les semaines » → `{ rrule: 'FREQ=WEEKLY' }` ; intervalle 2 → `'FREQ=WEEKLY;INTERVAL=2'` ; 0 et 53 → erreur, rien d'écrit ; radios du jour du mois seulement si dernier jour ; « Le dernier jour » → `'FREQ=MONTHLY;BYMONTHDAY=-1'` ; échéance 31/01 → 15/01 avec cette règle → **une** écriture `{ dueOn, rrule: 'FREQ=MONTHLY' }` ; notes « mois sautés » (30) et « années » (29/02) ; effacer l'échéance avec règle → `{ dueOn: null, rrule: null }`, message ; règle inconnue → option désactivée sélectionnée ; échec → formulaire réaligné |
| `widgets/todo/todo.component.spec.ts` | TD2b, TD3 | [TD2b] plus de `input[type=date]` dans la liste ; une ligne = un bloc flex (titre, étiquette, [i]) ; `ul` avec `@container` ; ↑ ↓ poubelle et ≡ portent `@max-[20rem]:hidden`, l'étiquette ses deux formes et les classes du §4.5 (jsdom n'évalue pas les requêtes de conteneur : présence des classes ; rendu réel en MD1) ; [i] « Détails de X » sur les lignes actives et terminées ; marqueur « Important » (icône + `sr-only`) ; indicateur de description ; [i] et double-clic ouvrent la fiche, ignorés pendant `busy()` ; `closed` → liste rechargée, focus sur [i] ; `removed` → focus suivante / précédente / champ ; `vanished` → `todo-gone`, focus sur le champ ; tests existants d'ajout, coche, ordre, suppression en ligne, « Effacer les terminées », étiquettes et minuit conservés (édition en ligne et saisie de date sur la ligne retirées ou déplacées dans la spec de la fiche). [TD3] coche d'une tâche répétée → `shiftRepeatDue(id, from, to)` (`ManualClock`), case décochée dans le DOM, focus sur la case, texte dans la zone `todo-advanced-status` (toujours présente) ; « Annuler » → appel inverse, zone vidée ; zone vidée par une autre action, dont « Afficher les terminées » ; `conflict` → `actionError` et `listTodos` rappelé ; règle inconnue, prochaine date nulle → `setCompleted` ; échec → case remise ; indicateur ⟳ et `sr-only` |
| `widgets/todo/todo-repeat.spec.ts` (nouveau) | TD3 | `checkAction` (active + règle + date → `advance` ; terminée, sans règle, règle inconnue, `null` → `complete`) ; `ruleFormOf` ; `normalizeRule` ; `ruleSummary` |
| `core/search/search.service.spec.ts`, `widgets/search/search.component.spec.ts` | TD4 | `subtitle` d'une tâche = extrait non vide ; absent sinon ; rendu surligné |
| `core/i18n/fr.spec.ts` | TD2a, TD2b, TD3 | Clés §4.10 présentes, clés retirées absentes |
| Specs qui construisent un `Todo` ou un `TodoSearchHit` | TD1a, TD4 | Champs ajoutés |

### 6.3 Rust (lot TD1a)
- `src/backup/sqlite.rs` l. 70 : `6`.
- `validate_tests.rs` : `contiguous_history_beyond_the_supported_version_is_schema_too_new` → `supported: 6` ; second cas `db_archive(&dir, 6, "INSERT … VALUES (7, 'x', 1, X'00', 0); CREATE TABLE future (a)")` → `archive: 7`.
- `v4_database_migrated_to_v5_keeps_the_icon_and_gets_the_default_theme` (V12) → renommé `v4_database_migrated_to_the_supported_version_keeps_the_icon_and_gets_the_default_theme`, comparaison à `expected_schema(supported_schema_version())`.
- `v3_database_migrated_to_the_supported_version_has_its_schema_and_defaults` : inchangé (chemin de la vraie base, V3 → V6, D10) ; doit rester vert.
- Nouveaux : `expected_schema_of_version_6_matches_a_real_database` (texte figé du §4.1 pour `todos`, `assert_ne!` avec la V5 ; S2) ; `v5_database_migrated_to_v6_keeps_todos_and_gets_defaults` (base V5 avec tableau, instance `todo`, liste, tâche datée et terminée ; vrai migrateur ; `description = ''`, `rrule` NULL, `important = 0`, `due_on`, `completed_at`, `updated_at` inchangés ; schéma égal à `expected_schema(6)` ; chemin de la base de dev) ; `archive_of_version_5_is_still_accepted` ; dans `archive_at_the_supported_version_made_by_the_real_migrator_is_accepted`, une tâche avec description, `rrule = 'FREQ=WEEKLY'` et `important = 1` restituée. Helper `todo_value(path, column) -> Option<String>` (et un entier pour `important`).
- `config_transfer_tests.rs` l. 84 : `INSERT INTO todos (id, list_id, title, due_on, completed_at, sort_order, created_at, updated_at) VALUES (…)`.
- Tout autre test qui suppose « 5 = à jour » : `supported_schema_version()` ; liste au rapport.

---

## 7. Lots

**Règles communes** (reprises de dashboards-sidebar §7 et dashboard-theme §7)
- Lire `CLAUDE.md`, puis cette spec. **Branche `dashboards-sidebar`**, après T5 ; jamais `main`, jamais de `git push` sans demande. Un lot à la fois, dans l'ordre TD1a, TD1b, TD2a, TD2b, TD3, TD4 ; chacun laisse l'application utilisable et le dépôt vert.
- Interdits : `any`, `Date` hors exemptions, calcul de date hors `core/time`, couleur brute, texte en dur, `CommonModule`, `innerHTML`, modification de V1 à V5, de V6 après la revue de TD1a, des capabilities, de `build.rs`, de `tauri.conf.json` ou de la CSP, relèvement d'un budget.
- Composants standalone, `OnPush`, état en signals.
- **Base réelle intouchable** : jamais l'exe release, ni `npm run tauri dev`, ni `cargo tauri dev` ; seulement `npm run dev` (app « Homebase Dev », dossier `fr.mariusdev.homebase.dev`) ; **aucun `npm run dev` du début de TD1a jusqu'à sa revue** ; aucun export ni archive de l'app de dev dans `%APPDATA%\fr.mariusdev.homebase\backups\`.
- **Commandes de fin de lot** (racine, toutes vertes) :
  ```
  npm run format:check
  npm run lint
  npm run test
  npm run rust:fmt:check
  npm run rust:lint
  npm run rust:test
  cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --release --all-targets -- -D warnings
  npm run web:build
  ```
- **Conditions d'arrêt** : supposition infirmée (S1 à S6) ; test existant cassé sans lien avec le lot ; bundle initial ≥ 500 kB ou avertissement ; besoin de modifier V1 à V5, ou V6 après la revue de TD1a (→ V7, avec accord) ; un vecteur `dateNext` qui ne passe pas (ne pas modifier le vecteur : rapporter) ; toute écriture dans `%APPDATA%\fr.mariusdev.homebase\`.
- **Rapport de lot** : fichiers touchés, résultats des commandes, taille du bundle initial avant et après (somme des « Initial chunk files »), suppositions vérifiées, écarts.
- Cocher la ligne de la ROADMAP après application du §10.4.

### Lot TD1a : V6 et couche de données (texte de V6 figé à la revue)
Fichiers à créer : `migrations/V6__todo_details.sql`. À modifier : `migrations/checksums.json` ; `src/db.rs` ; `data/models.ts`, `repositories.ts`, `sqlite/row-mappers.ts`, `sqlite/sqlite-todo.repository.ts`, `sqlite/sqlite-todo.repository.spec.ts`, `migrations.spec.ts` ; `core/testing/fake-todo.repository.ts` ; specs qui construisent un `Todo` ; `src/backup/sqlite.rs`, `validate_tests.rs`, `config_transfer_tests.rs`.

Étapes :
1. **Ne pas lancer `npm run dev` avant la fin de la revue de ce lot.** Mesurer le bundle initial de départ.
2. V6 (texte exact du §4.1), `checksums.json`, `db.rs`.
3. `data/` (§4.2) : constante, `Todo`, `TodoChanges`, colonnes, mapper, `validDescription`, `validRrule`, `update`, `shiftRepeatDue`. (Recherche : TD4.)
4. Faux dépôt ; littéraux `Todo` des specs.
5. Tests `test:data` (§6.1, sauf recherche), dont S1 et S2.
6. Tests Rust (§6.3) ; liste des tests adaptés au rapport.
7. **Revue : texte de V6 figé ensuite** ; `npm run dev` permis à nouveau (base de dev V5 → V6).

Acceptation :
- TD1a-1 V1 à V5 inchangées ; `registered_migrations_match_files_exactly` et le manifeste verts.
- TD1a-2 Tests `data` et Rust verts, dont le vrai migrateur V3 → V6 et V5 → V6, et le texte figé (S1, S2).
- TD1a-3 Aucun changement visible dans l'application ; bundle initial < 500 kB.

### Lot TD1b : prochaine échéance (`core/time/date-rule.ts`) et vecteurs
Fichiers à créer : `core/time/date-rule.ts` et sa spec. À modifier : `core/time/temporal.ts` (type), `core/time/testing/time-vectors.json`, `core/time/vectors.spec.ts`.

Étapes : `date-rule.ts` (§4.3, YEARLY explicite, bornes sans exception) ; spec (§6.2) ; vecteurs N1 à N29 + 2 cas `after < anchor` ; `vectors.spec.ts`.

Acceptation :
- TD1b-1 Les 29 cas de D3 et les 2 cas supplémentaires passent (spec et vecteurs) ; N20, N21, N29 renvoient `null` sans exception.
- TD1b-2 `rg -n "date-rule" apps/web/src/app/core/time/index.ts` → aucun résultat.

### Lot TD2a : fiche (titre, « Important », description, échéance, suppression)
Fichiers à créer : `widgets/todo/todo-due.ts`, `todo-changes.ts`, `todo-detail.component.{ts,html}` et leurs specs. À modifier : `core/time/time-display.ts` et sa spec ; `core/i18n/fr.json` (`detail.*`), `fr.spec.ts`.

Étapes : style `day-month` ; `dueLabel` (formateur en paramètre) ; `mergeChanges` (règle `dueOn: null`) ; fiche (§4.7, sans répétition) : structure, boucle, fusion, échec (C2), abandon (C4), « Retour », Échap, suppression, `PendingWrites` ; i18n ; specs (§6.2, TD2a). La fiche n'est pas encore branchée : l'application est inchangée.

Acceptation :
- TD2a-1 Specs vertes, dont « second Retour puis destruction → 0 appel `update` » et « `vanished` puis destruction → 0 appel ».
- TD2a-2 Un seul `type="date"` dans `todo-detail.component.html` ; aucun `innerHTML`.

### Lot TD2b : branchement et nouvelle ligne
Fichiers : `widgets/todo/todo.component.{ts,html,spec.ts}` ; `core/i18n/fr.json` (`details`, `important`, `dueShortOverdue`, `hasDescription`, `gone`, retraits), `fr.spec.ts`.

Étapes : ligne (§4.5) avec requêtes de conteneur ; retrait de la saisie de date et de l'édition en ligne ; marqueur « Important » ; [i] ; ouverture/fermeture, focus, `vanished` (§4.7) ; i18n ; specs (§6.2, TD2b) ; vérifications MD1 à MD4 et MD6 sur l'app de dev, captures clair, sombre et tableau à teinte au rapport.

Acceptation :
- TD2b-1 Aucun `type="date"` dans `todo.component.html`.
- TD2b-2 Parcours complet en spec : [i] → fiche → titre, « Important », description, échéance → « Retour » → focus sur [i], liste à jour.
- TD2b-3 Variantes de conteneur présentes dans la feuille générée (S6) ; classes de couleur ⊂ §4.12 (`npm run lint`) ; bundle < 500 kB.

### Lot TD3 : répétition
Fichiers à créer : `widgets/todo/todo-repeat.ts` et sa spec. À modifier : `todo-changes.ts` et sa spec (normalisation « dernier jour »), `todo-detail.component.{ts,html,spec.ts}`, `todo.component.{ts,html,spec.ts}`, `core/i18n/fr.json`, `fr.spec.ts`.

Étapes : `checkAction`, `ruleFormOf`, `normalizeRule`, `ruleSummary` ; normalisation dans `mergeChanges` ; section « Répétition » (§4.8) ; coche, zone `role="status"` permanente, « Annuler », `refresh` sur `conflict` (§4.6) ; indicateur ⟳ ; i18n ; specs ; S4 (aucun « Initial chunk file » ne contient `BYMONTHDAY`) ; MD5.

Acceptation :
- TD3-1 Une tâche hebdomadaire en retard, cochée, reste à sa place avec l'échéance du prochain même jour de semaine (spec avec `ManualClock`) ; « Annuler » rétablit.
- TD3-2 Toutes les écritures de règle passent par `formatDateRule` (spec).
- TD3-3 S4 vérifiée ; bundle < 500 kB.

### Lot TD4 : recherche dans les descriptions
Fichiers : `data/models.ts`, `sqlite/sqlite-todo.repository.ts` et sa spec ; `core/testing/fake-todo.repository.ts` ; `core/search/search.service.ts` et sa spec ; `widgets/search/search.component.html` et sa spec.

Écart : les tests `search` des tâches sont dans `apps/web/src/app/data/sqlite/sqlite-search.spec.ts` (avec ceux des notes et raccourcis), pas dans `sqlite-todo.repository.spec.ts`.

Étapes : SQL et extrait (§4.2) ; `TodoResult.subtitle` ; condition du gabarit ; specs ; MD7.

Acceptation :
- TD4-1 Un mot présent seulement dans une description trouve la tâche, avec l'extrait surligné.
- TD4-2 Ordre : actives, puis titres, puis plus récentes (spec `test:data`).

---

## 8. Critères d'acceptation d'ensemble
1. Commandes de fin de lot vertes après TD4.
2. V1 à V5 inchangées ; V6 présente, enregistrée, au manifeste, inchangée depuis la revue de TD1a.
3. Aucun calcul de date hors `core/time` ; aucun `any`, `OnPush` partout, textes via Transloco ; aucune couleur brute ; aucun `innerHTML`.
4. Bundle initial < 500 kB ; budgets inchangés ; `date-rule.ts` hors des fichiers initiaux.
5. Capabilities, `build.rs`, `tauri.conf.json`, CSP, `tokens.css` et `check-contrast` inchangés.
6. MD1 à MD9 passées par Marius ; celles marquées « vraie base » sur l'exe release, avec M1 à M17 de dashboards-sidebar et MT1 à MT9 de dashboard-theme, juste avant la fusion.

---

## 9. Vérifications manuelles (Marius)

**Ordre.** Après la revue de TD1a : app de dev (`npm run dev`, base `.dev` en V5, passée en V6 au premier lancement). Juste avant la fusion : exe release sur la vraie base, **M10 de dashboards-sidebar en premier** (V4, V5 et V6), puis le reste. Retour arrière : procédure de dashboards-sidebar §9 ; la sauvegarde « Avant mise à jour » (schéma 3) couvre les trois migrations.

- **MD1 Ligne** (dev). Fenêtre à **800 px puis 1 280 px** de large ; widget de **2, 3 et 4 colonnes** ; clair, sombre et tableau à teinte : une seule ligne par tâche ; titre tronqué lisible ; étiquettes « Aujourd'hui », « Demain », « En retard de 3 jours » (icône), forme courte « 3 j » avec icône quand la liste est étroite, « 3 nov. », date d'une autre année ; étiquette sous le titre quand la liste est très étroite ; flèches, poubelle et ≡ absents dès que la liste est étroite (toujours en 2 colonnes) ; étoile « Important » visible.
- **MD2 Fiche, clavier et Narrateur.** Tab jusqu'au [i] (Narrateur : « Détails de … »), Entrée : la fiche remplace le corps, curseur dans le titre ; titre long en entier ; « Important » annoncé comme interrupteur ; Échap : retour, focus sur le même [i]. Même parcours à la souris (« Retour », double-clic sur le titre).
- **MD3 Enregistrement.** Modifier titre, description, « Important », « Retour », rouvrir : conservés ; modifier puis changer aussitôt de tableau, revenir : conservés ; F5 et redémarrage : conservés. Vider le titre puis « Retour » : l'ancien titre reste.
- **MD4 Échéance.** Sélecteur ; année tapée au clavier (aucune date intermédiaire enregistrée) ; effacement ; étiquette de la ligne à jour au retour.
- **MD5 Répétition.** Tâche « toutes les semaines », échéance d'il y a 10 jours : cocher → elle reste, échéance au prochain même jour de semaine, message avec date, « Annuler » rétablit. Mensuelle au 31/01 : « Le dernier jour du mois » proposé ; avec « Le 31 », note « mois sautés ». Effacer l'échéance d'une tâche répétée : répétition retirée et message.
- **MD6 Suppression depuis la fiche** : confirmation, focus sur « Annuler » ; « Supprimer » : retour à la liste, tâche disparue, focus sur la ligne suivante.
- **MD7 Recherche** (après TD4) : un mot de la description trouve la tâche, extrait surligné.
- **MD8 Migration** (vraie base) : couverte par M10 amendé ; en plus, toutes les tâches présentes, sans description, répétition ni « Important », échéances et états inchangés.
- **MD9 Restauration** (vraie base) : couverte par M11 et M12 amendés ; en plus, description, répétition et « Important » modifiés reviennent après la restauration de la sauvegarde manuelle (schéma 6).

---

## 10. Amendements à appliquer par le coordinateur

### 10.1 ADR-003 (`docs/adr/003-time-model.md`)

§3.4, puce « **Aucune** bibliothèque RRULE : codec strict maison (§3.5), qui ne calcule aucune date ; il appelle `parseLocalDate` de `core/time` pour valider la date d'un `UNTIL`. », ajouter à la fin :
> *Amendement (spec todo-details, 2026-11-10)* : exception unique, `core/time/date-rule.ts` calcule la prochaine échéance d'une tâche répétée (§3.9).

§3.9, à la fin :
> *Amendement (spec todo-details, 2026-11-10)* : une tâche peut se répéter. `todos.rrule` (V6 ; fragment §3.1.3 complété de `due_on IS NOT NULL`) porte une règle canonique du sous-ensemble `FREQ` ∈ {`DAILY`, `WEEKLY`, `MONTHLY`, `YEARLY`}, `INTERVAL` (bornes §3.5.1, omis s'il vaut 1), `BYMONTHDAY=-1` (`MONTHLY` seulement) ; ancre datée = `due_on`. Cocher une tâche répétée avance `due_on` à la première occurrence de la série strictement postérieure à max(échéance, aujourd'hui) (périodes manquées sautées, coche en avance → période suivante ; validé par Marius) ; ni `completed_at` ni historique ; sans occurrence au plus tard le 2199-12-31, la tâche est terminée normalement. Ce calcul est fait **en TypeScript** par `core/time/date-rule.ts` (Temporal), par exception au moteur unique Rust (§2.4) : une tâche est une ancre datée qui ne déclenche jamais de notification (§3.5.5), le sous-ensemble n'a ni `BYDAY`, ni `COUNT`, ni `UNTIL`, et il s'agit d'une seule prochaine occurrence, pas d'une expansion de plage. Les jours inexistants sont ignorés (D2) ; l'interface propose « le dernier jour du mois » quand l'échéance est le dernier jour de son mois. Les vecteurs `dateNext` de `time-vectors.json` font foi pour les deux côtés. Au lot B, `parseDateRule` est réécrit au-dessus du codec complet (codec + restriction au sous-ensemble), sans changer sa signature ni les vecteurs. Toute extension (`BYDAY`, `COUNT`, `UNTIL`) passe par le codec et le moteur du lot B.

§8.6, « Contenu minimal », ajouter :
> - `dateNext` (spec todo-details) : `{ id, anchor, rrule, after, expected }` (`expected` : date ou `null`) ; exécutée côté TS par `nextOccurrenceAfter` dès la spec todo-details, côté Rust au lot B.

§8.10, ajouter :
> - `core/time/date-rule.ts` (spec todo-details) : `parseDateRule` est réécrit au-dessus de `parseRecurrenceRule` (ancre `date`, puis restriction au sous-ensemble), même signature ; `date-rule.spec.ts` et les vecteurs `dateNext` restent verts.

§8.11, ajouter :
> - Rust `expand` : section `dateNext` (première occurrence strictement après `after` d'une ancre datée, par `floating_occurrences` ou des expansions successives) ; un écart avec le TS s'arrête et se rapporte.

### 10.2 ADR-002 (`docs/adr/002-data-layer.md`)

Fin de §3.4, après l'amendement V5 :
> *Amendement (spec todo-details, V6)* : `todos.description TEXT NOT NULL DEFAULT ''` (texte brut, ≤ 10 000 caractères et ≤ 40 000 octets, borne qui résiste à un NUL), `todos.rrule TEXT NULL` (règle RRULE de l'ADR-003, ancrée sur `due_on`, qu'elle exige par `CHECK`) et `todos.important INTEGER NOT NULL DEFAULT 0 CHECK (important IN (0, 1))`. Même exception justifiée à « pas de `DEFAULT` » que V4. Un futur champ de tâche suit le même modèle (une colonne typée par `ADD COLUMN`, défaut constant, `CHECK`).

Fin de §3.5 :
> *Amendement (spec todo-details)* : `Todo.description`, `Todo.rrule`, `Todo.important` ; `TodoChanges.description?`, `rrule?`, `important?` (lié en 1/0 ; une règle exige une échéance : `invalid_input` dans la même modification, `constraint` sinon ; effacer l'échéance efface la règle dans la même instruction) ; `TodoRepository.shiftRepeatDue(id, fromDueOn, toDueOn)` (comparer-et-écrire en une instruction : `conflict` si l'échéance, la règle ou l'état ont changé ; `not_found`). Le dépôt ne calcule aucune date : la prochaine échéance vient de `core/time` (que `data/` ne peut pas importer). `setCompleted` ignore la règle. `search` porte aussi sur la description et renvoie un `excerpt`.

### 10.3 `docs/DESIGN.md`

§3, après « **Erreurs** », ajouter :
> - **Panneau dans une carte** (réglages de la météo, fiche d'une tâche) : le corps du widget est remplacé par le panneau, qui défile dans la carte. Premier élément : bouton invisible compact « Retour » (`pi pi-arrow-left` + texte). Échap ferme ; le focus revient au bouton qui l'a ouvert. Champs empilés, libellé visible au-dessus (12 px, 600). Une édition locale à un widget n'ouvre pas de dialogue modal ; elle s'enregistre au fil de l'eau, avec un état « Enregistrement… / Enregistré » en 12 px `--hb-fg-muted`.
> - **Ligne de tâche** : une seule ligne : case, marqueur « Important » (`pi pi-star-fill` en `--hb-attention`, doublé du texte `sr-only` « Important »), titre tronqué, indicateurs, étiquette d'échéance (12 px, en texte ; le retard porte toujours l'icône `pi-exclamation-circle`), actions. Indicateurs de métadonnées en 12 px `--hb-fg-muted` (`pi pi-align-left` description, `pi pi-sync` répétition), `aria-hidden`, doublés d'un texte `sr-only` (exception écrite à la taille de 16 px des icônes). Bouton de détail : `pi pi-info-circle`, invisible, compact, nom accessible « Détails de <titre> ». La densité suit la largeur de la liste (requêtes de conteneur) : étiquette courte sous 28rem ; flèches, poubelle et indicateur de description masqués sous 20rem ; étiquette sous le titre sous 11rem.

§5, « Mise en œuvre technique », ajouter :
> - **Requêtes de conteneur** (Tailwind 4 : `@container`, variantes `@max-[…]:`) pour adapter un widget à la largeur de sa carte, plutôt qu'à sa taille en colonnes ou à la fenêtre.

### 10.4 `docs/ROADMAP.md`

Phase 1 bis, l. 33 : remplacer « Vérifications manuelles M1 à M17 (et MT1 à MT9 de `docs/specs/dashboard-theme.md`) à faire par Marius » par « Vérifications manuelles M1 à M17 (et MT1 à MT9 de `docs/specs/dashboard-theme.md`, MD1 à MD9 de `docs/specs/todo-details.md`) à faire par Marius ».

Phase 1 bis, après la ligne du lot T5 (l. 49), insérer :
```markdown
- [ ] (S) Lot TD1a (spec `todo-details.md`) : migration V6 `todos.description` / `rrule` / `important`, couche de données (texte de V6 figé à la revue ; pas de `npm run dev` avant)
- [ ] (S) Lot TD1b : prochaine échéance d'une tâche répétée (`core/time/date-rule.ts`, vecteurs `dateNext`)
- [ ] (S) Lot TD2a : fiche de tâche (titre, « Important », description, échéance, suppression), non branchée
- [ ] (S) Lot TD2b : ligne de tâche sur une ligne (bouton [i], échéance sur la ligne, requêtes de conteneur) et branchement de la fiche
- [ ] (S) Lot TD3 : répétition des tâches (cocher avance l'échéance, « Annuler »)
- [ ] (S) Lot TD4 : recherche dans les descriptions de tâches
```

Phase 1 bis, l. 50 : remplacer la ligne par
```markdown
- [ ] (O) Revue de fin de phase (thème et détail des tâches compris) ; vérifications manuelles M1 à M17, MT1 à MT9 et MD1 à MD9 à faire par Marius, juste avant la fusion (M10 en premier : V4, V5 et V6 appliquées ensemble)
```

Phase 2, l. 54 : à la fin de la ligne du lot B, ajouter « ; vecteurs `dateNext` (spec todo-details) exécutés aussi côté Rust ; `parseDateRule` rebasé sur le codec ».

### 10.5 `docs/PLAN.md`

§2, ligne « Dates et récurrence », fin de la deuxième cellule : ajouter « Exception : la prochaine échéance d'une TODO répétée (date sans heure, sans notification) est calculée par `core/time/date-rule.ts` (ADR-003 §3.9, spec todo-details). »

§5, avant « **Calendrier** », ajouter :
> - **TODO** : ligne compacte (case, marqueur « Important », titre, échéance relative, indicateurs, bouton de détail) qui s'adapte à la largeur de la carte ; fiche dans le widget (titre, « Important », description, échéance, répétition) enregistrée au fil de l'eau ; cocher une tâche répétée avance son échéance, sans historique (`docs/specs/todo-details.md`).

### 10.6 `docs/specs/dashboards-sidebar.md`

- D0, à la fin : « *Amendement (spec todo-details)* : V6 s'ajoute sur cette branche, figée à la revue du lot TD1a ; aucun `npm run dev` du début de TD1a jusqu'à cette revue. La vraie base passe de V3 à V6 au premier lancement de l'exe release. »
- §8, point 6 : « M1 à M17 (et MT1 à MT9 de la spec dashboard-theme, MD1 à MD9 de la spec todo-details) passées par Marius sur l'exe release et la vraie base, juste avant la fusion. »
- §9, remplacer M10 par :
  > - **M10 Migrations V4, V5 et V6** (première action sur la vraie base, une seule fois ; vaut aussi MT6 de la spec dashboard-theme et MD8 de la spec todo-details) : une seule sauvegarde « Avant mise à jour », base seule, schéma 3, prise avant que V4, V5 et V6 soient appliquées ensemble ; tous les widgets présents ; tableau existant à l'icône grille et au thème par défaut ; tâches présentes, sans description, répétition ni « Important ».
- §9, remplacer M11 par :
  > - **M11 Restauration V3.** Restaurer cette sauvegarde : acceptée, redémarrage, V4, V5 et V6 appliquées ensemble, nouvelle sauvegarde « Avant mise à jour » (schéma 3). Données retrouvées.
- §9, remplacer M12 par :
  > - **M12 Restauration au schéma courant.** Créer une sauvegarde manuelle (schéma 6), modifier quelque chose (icône, thème, description, répétition et « Important » d'une tâche compris), la restaurer : acceptée, redémarrage, état d'avant la modification.
- §11, R3, colonne « Mitigation », ajouter : « ; V6 (spec todo-details) figée à la revue de son lot TD1a, même procédure ».

### 10.7 `docs/specs/dashboard-theme.md`

- D10, à la fin : « *Amendement (spec todo-details)* : V6 s'ajoute ; la vraie base passe de V3 à V6 au même démarrage, avec une seule sauvegarde « Avant mise à jour » (schéma 3) ; M10 amendé en conséquence. »
- §9, MT7 : remplacer « (schéma 5) » par « (schéma 6 après la spec todo-details) ».

### 10.8 Autres documents
ADR-001, `docs/specs/backup-restore.md` (§4.7 est générique sur `supported_schema_version()`), `CLAUDE.md` : aucun amendement.

---

## 11. Risques

| # | Risque | Impact | Mitigation |
|---|---|---|---|
| R1 | V6 lancée (même sur la base de dev) puis modifiée | `VersionMismatch`, démarrage impossible | Texte figé à la revue de TD1a ; aucun `npm run dev` avant ; tests en mémoire et vrai migrateur |
| R2 | Sémantique TS divergente du futur moteur Rust | Calendrier (phase 2) qui ne montre pas la même date | Sous-ensemble minimal ; vecteurs `dateNext` partagés ; `parseDateRule` rebasé sur le codec au lot B (S10) |
| R3 | Coche accidentelle d'une tâche répétée | Ancienne échéance perdue | « Annuler » (D9) ; échéance modifiable dans la fiche |
| R4 | Le 31 saute des mois (D2) | Tâche mensuelle « absente » un mois | Note dans la fiche ; « dernier jour du mois » proposé |
| R5 | Liste étroite sans ↑ ↓ ni poubelle | Réordonner impossible en petit | Fiche pour supprimer ; élargir pour réordonner (validé par Marius) |
| R6 | Écriture au fil de l'eau qui échoue | Changement discret perdu | Contrôles réalignés sur l'enregistré (l'utilisateur voit ce qui est en base) ; message ; textes conservés et réessayés |
| R7 | Requêtes de conteneur non testables sous jsdom | Régression de mise en page silencieuse | Classes vérifiées en spec ; MD1 à deux largeurs de fenêtre et trois largeurs de widget ; Playwright planifié |
| R8 | Bundle initial | Avertissement | +1,5 à +2,5 kB estimés ; `date-rule.ts` paresseux (S4) ; arrêt à 500 kB |
| R9 | V4, V5 et V6 au même démarrage de la vraie base | Un seul point de retour | Vrai migrateur V3 → V6 testé ; M10 en premier ; installateur V3 conservé |

---

## 12. Décisions de Marius et points restants

**Décidé**
1. [i] à la place de « Modifier », plus de saisie de date sur la ligne ; fiche dans le widget avec « Retour » ; V6 sur `dashboards-sidebar`.
2. **Prochaine échéance = première occurrence après max(échéance, aujourd'hui)** : périodes manquées sautées, coche en avance → période suivante (D3).
3. **Jours inexistants sautés** (le 31, le 29 février) : conforme à l'ADR-003 D2, déjà validé ; « dernier jour du mois » proposé quand l'échéance est le dernier jour de son mois.
4. **Champs : description + drapeau « Important »** (D4), dans V6 ; tri et recherche inchangés pour « Important ».
5. **Liste étroite : flèches et poubelle masquées** (D7), décidé par la largeur du conteneur.
6. **Calcul en TypeScript**, exception écrite à l'ADR-003 (D1) : accepté par le coordinateur (pas de notification, sous-ensemble minimal, une seule occurrence, vecteurs partagés de référence, `parseDateRule` rebasé au lot B).

**Restant à valider (non bloquant)**
7. Enregistrement au fil de l'eau dans la fiche, comme les notes (D6).
8. « Annuler » après la coche d'une tâche répétée, message visible jusqu'à l'action suivante (D9).
9. Recherche dans les descriptions, avec extrait (D8).
10. Pas de jours ouvrés dans cette version : ajout possible plus tard sans migration.
11. Seuils de largeur (28rem, 20rem, 11rem) : à juger en MD1, ajustables sans migration.
