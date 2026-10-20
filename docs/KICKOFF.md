# KICKOFF : démarrer avec Claude Code (Windows)

## 0. Prérequis
- Plan payant Claude (Pro/Max/Team/Enterprise) ou clé API Console, requis par Claude Code.
- Windows 11 avec : Git, Node LTS, Rust (rustup), Visual Studio Build Tools (charge « Développement Desktop en C++ »). WebView2 est déjà inclus dans Windows 11.
- Java, Docker et tout serveur ne sont pas nécessaires : l'application est autonome.
- Le sandbox de Claude Code n'existe pas sous Windows natif : le kit s'appuie sur des règles `deny`, l'interdiction de `git push` et la revue. Voir `docs/settings.sandbox.example.json` si tu bascules en WSL2.

## 1. Installer le kit
```bash
mkdir homebase && cd homebase && git init
# copier le contenu du kit : CLAUDE.md, docs/, .claude/
echo ".claude/settings.local.json" >> .gitignore
echo ".env*" >> .gitignore
git add . && git commit -m "chore: add Claude Code kit"
```

## 2. Plugins (facultatif, un à la fois)
Dans Claude Code : `/plugin`, puis installer depuis la marketplace officielle : `security-guidance`, `frontend-design`.

## 3. Vérifier la config
- `/agents` : on doit voir Explore, scout, implementer, architect, reviewer.
- `/permissions` : règles `deny` présentes.
- Si un accès Opus n'est pas disponible sur ton plan, remplace `model: opus` par `sonnet` dans `architect.md` et `reviewer.md`.

## 4. Premier prompt (Phase 0)
```
Lis CLAUDE.md, docs/PLAN.md et docs/ROADMAP.md.
Exécute la Phase 0 de la roadmap en respectant docs/DELEGATION.md :
- délègue la vérification de angular-gridster2 vs Angular 21 à scout ;
- demande à architect les ADR-001 (contrat Widget) et ADR-002 (couche de données SQLite) ;
- fais implémenter le reste par implementer, une tâche à la fois, y compris le spike tray/notification ;
- coche la roadmap au fur et à mesure et fais relire la phase par reviewer.
Arrête-toi à la fin de la Phase 0 et fais-moi un résumé de 5 lignes.
```

## 5. Rythme conseillé
Une phase par session, `/compact` ou nouvelle session entre les phases, commit après chaque tâche validée, revue `reviewer` avant de passer à la suite.
