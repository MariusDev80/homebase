# PLAN : Homebase (dashboard perso, application Windows)

## 1. Objectif et contraintes
Application de bureau **Windows** mono-utilisateur, personnalisable (grille drag & drop), avec widgets : TODO, habits, timers/alarmes, pomodoro/suivi de temps, rappels (dates + récurrence), calendrier agrégé, raccourcis (liens et applications), notes, météo, RSS, recherche, budget/comptes, objectifs (manuels), statut de services, puis page « Ressources » (mini-blog), GitHub et ressources système (basse priorité).

Choix structurants (décidés avec Marius, 16/10/2026) :
- **Tauri 2 dès le départ** (et non en fin de projet) : le front Angular tourne dans une fenêtre Windows native.
- **Vraie base de données** plutôt que des fichiers JSON : SQLite embarquée dans l'application (voir §3).
- **Application utilisée uniquement sur le PC de Marius** : pas de serveur, ni Spring Boot, ni PostgreSQL, ni Docker. Tout tourne dans l'application Tauri.
- **MVP fonctionnel d'abord**.

Ce que Tauri simplifie :
- Rappels : un planificateur dans l'application (Rust) + notifications natives + icône dans la zone de notification + démarrage automatique. Plus besoin de Web Push ni de backend pour qu'ils sonnent. Limite : le PC doit être allumé et l'application lancée (réduite dans la zone de notification).
- RSS et sondes de services : les requêtes partent du code Rust, donc pas de CORS, et le NAS du réseau local est joignable depuis le PC.
- Raccourcis vers des applications locales : possibles via un plugin d'ouverture/lancement restreint à une liste autorisée.

Ce que Tauri complique :
- Toolchain Windows : Rust (cible MSVC), outils de build C++ de Visual Studio et WebView2 (déjà présent sur Windows 11).
- Les agents Claude doivent écrire un peu de Rust (commandes Tauri, planificateur) : à confier à Sonnet avec spec, ou à Opus pour la conception.

## 2. Stack retenue
| Couche | Choix | Pourquoi / alternative |
|---|---|---|
| Shell desktop | Tauri 2 (Rust) | Léger, notifications natives, tray, autostart, lancement d'apps |
| Front | Angular 21 (zoneless, signals, Vitest) | Stack déjà maîtrisée |
| UI | Tailwind 4 + PrimeNG | Composants prêts, thèmes clair/sombre |
| Grille | angular-gridster2 **21.x épinglé** (repli : gridstack 14 + `gridstack/dist/angular`) | Vérifié le 20/10/2026 : 21.x a `@angular/core ^21` en peerDependency (22.x vise Angular 22, ne pas monter). Support zoneless revendiqué (PR #917, #950) mais issue #916 encore ouverte : à valider en phase 1 (la phase 0 utilise une grille CSS simple, voir ADR-001) |
| Calendrier | Schedule-X ou FullCalendar | Comparer en phase 2 (ADR) |
| Base locale (MVP) | SQLite via `tauri-plugin-sql` | Migrations versionnées intégrées, aucun serveur à installer |
| Images (MVP) | Fichiers dans le dossier de données de l'app, chemin en base | Évite les blobs géants en base |
| Récurrence | `rrule` | Standard RFC 5545 |
| Timers | Web Worker (UI) + horloge Rust (rappels) | Fiable même fenêtre réduite |
| Notifications | `tauri-plugin-notification`, tray, `autostart` | Natif Windows |
| Mise à jour | `tauri-plugin-updater` (binaires signés) | Phase finitions |
| CI | GitHub Actions, runner `windows-latest` | Build de l'installateur |

## 3. Données : SQLite embarquée
**Fait établi** : `tauri-plugin-sql` (basé sur sqlx) gère SQLite, MySQL et PostgreSQL, choisis par option de compilation, avec des migrations versionnées exécutées en transaction.

**Décision : SQLite, définitivement pour un usage solo sur un PC.** C'est une vraie base relationnelle (requêtes, relations, transactions, images référencées par chemin), sans service à installer, à démarrer ni à sauvegarder à part : un seul fichier. PostgreSQL ou MySQL demanderaient un serveur à faire tourner en permanence sur le PC, sans bénéfice pour un seul utilisateur.

**Flyway** : outil Java pensé pour un serveur applicatif. Il n'a pas de rôle ici : les migrations sont gérées par `tauri-plugin-sql` (versionnées, exécutées en transaction au démarrage). On garde la même discipline : fichiers `V1__init.sql`, `V2__…` immuables, une nouvelle migration par changement.

**Couche d'accès** : le front ne parle qu'à des interfaces `Repository` (dossier `data/`). Si un jour le stockage change (autre moteur, synchronisation), les widgets ne bougent pas.

**Sauvegardes** : copie automatique du fichier de base et du dossier d'images (par exemple vers le NAS), conservation des N dernières versions.

**Export/import** : sauvegarde de la base + dossier d'images (archive zip), JSON versionné pour la configuration seule ; jamais de secrets dedans.

## 4. Architecture
```
repo/
  apps/desktop/        Tauri (src-tauri : commandes Rust, migrations, planificateur, capacités)
  apps/web/            Angular (shell, widgets, data/, core/)
  docs/                PLAN, ROADMAP, DELEGATION, adr/
  .claude/             agents, settings
```
Front : `core/` (thème, grille, notifications), `data/` (repositories), `widgets/<nom>/` (un dossier par widget).

### Contrat Widget
Chaque widget déclare : `id`, `title`, `icon`, composant principal, tailles min/défaut, schéma de configuration (typé), éventuelle entrée calendrier (`CalendarSource`), ses permissions (réseau, notifications, lancement d'apps). Chargement en lazy-loading. Aucun widget n'en importe un autre ; ils communiquent via des services du `core/`.

### Temps
UTC + fuseau IANA ; récurrence en RRULE ; planificateur Rust qui recalcule la prochaine échéance au démarrage (rattrapage des rappels manqués pendant que le PC était éteint) ; tests obligatoires sur changements d'heure.

## 5. Widgets : notes de conception
- **Calendrier** : agrège les `CalendarSource` (rappels, TODO datées, habits, objectifs).
- **Timers/pomodoro** : session « en cours depuis X » cliquable (détail + historique) ; historique en base ; reprise correcte après fermeture.
- **Habits** : distinct de la TODO ; inclut des rappels de mise à jour périodique (ex. solde des comptes).
- **Objectifs** : entièrement manuels (progression éditable, durée définie), étiquette libre (ex. SkyBlock). Aucune dépendance à une API de jeu.
- **Budget/comptes** : saisie manuelle et import CSV ; automatisation bancaire reportée (GoCardless fermé aux nouveaux comptes depuis juillet 2025, Powens sur devis, autres non vérifiés).
- **Météo** : Open-Meteo (sans clé, usage non commercial) ; géocodage inclus.
- **RSS** : récupération côté Rust ; vérifier d'abord que ses sources ont des flux.
- **Statut de services** : sondes HTTP/TCP côté Rust, y compris le NAS local.
- **Raccourcis** : liens URL et applications locales, via liste autorisée.
- **Recherche** : barre unique multi-sources (raccourcis, ressources, plus tard TODO/notes), puis moteur web.
- **Ressources (phase 6)** : mini-blog perso. Article en Markdown (titres, paragraphes, liens, images), catégories hiérarchiques + tags, recherche plein texte (MiniSearch) dans la barre globale. Rendu assaini (DOMPurify, CSP) ; images redimensionnées avant stockage.
- **GitHub / ressources système** : plus tard ; jeton GitHub stocké dans le coffre du système (pas dans la base ni le front).

## 6. Sécurité
- **Tauri** : capacités au strict minimum (`sql:allow-execute` explicitement, plugins de lancement/ouverture limités à une liste d'applications et de schémas d'URL autorisés), CSP stricte, aucune page distante chargée dans la fenêtre principale.
- **Requêtes sortantes** (RSS, sondes) : liste d'hôtes autorisés ; refus des IP privées, sauf une liste explicite pour le NAS ; timeouts et taille maximale.
- **Secrets** : jamais dans le dépôt, le front ni les exports ; coffre du système (Windows Credential Manager).
- **Contenu** : tout Markdown et tout flux RSS sont assainis avant affichage.
- **Mises à jour** : binaires signés (clé privée hors dépôt).
- **Dépendances** : Dependabot + `cargo audit` et `npm audit` en CI.
- **Claude Code** : règles `deny` sur `.env*`/`secrets/`, pas de `git push` par défaut. Le sandbox n'existe pas sous Windows natif : voir KICKOFF pour l'alternative. Les règles `Read` seules n'arrêtent pas un sous-processus.

## 7. Skills et plugins Claude Code
Les agents du kit suffisent pour démarrer. Plugins officiels optionnels : `security-guidance` (dès qu'il y a du réseau et du Rust), `frontend-design`, `code-review`, `hookify` plus tard. Éviter d'en empiler (chaque plugin consomme du contexte).

## 8. Points à vérifier avant ou pendant la phase 0
1. ~~angular-gridster2 sur Angular 21 (sinon gridstack).~~ Fait : 21.x épinglé, voir §2.
2. Schedule-X vs FullCalendar (récurrence, vues, thèmes).
3. Toolchain Windows installée (Rust MSVC, Build Tools C++, WebView2) et version de Rust compatible avec `tauri-plugin-sql` (Rust 1.90 ou plus d'après la doc).
4. Environnement de travail de Claude Code : Windows natif (sans sandbox) ou WSL2 (voir KICKOFF).
5. Disponibilité de flux RSS pour les sources choisies.
6. Accès à Opus sur ton plan (sinon `architect`/`reviewer` passent en Sonnet).

## 9. Limites assumées (usage solo, PC uniquement)
- Pas de rappel quand le PC est éteint ou l'application fermée : au prochain lancement, les rappels manqués sont rattrapés et signalés.
- Pas d'accès depuis un téléphone ni un autre ordinateur. Si ce besoin apparaît un jour, il faudra rouvrir la question d'un serveur ou d'une synchronisation (ADR dédié) ; l'architecture `Repository` permet de le faire sans réécrire les widgets.
