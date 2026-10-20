# Spike 001 : notification planifiée, tray, démarrage automatique

Statut : implémenté, vérification manuelle à faire par Marius (notification, tray, autostart ne sont pas testables automatiquement).

## Ce qui a été fait

- `apps/desktop/src-tauri/src/spike.rs` : commandes `schedule_test_notification(delay_secs)` (borne 1..=3600, sinon `SpikeError::DelayOutOfRange` sérialisable `{kind, min, max, got}`), `get_autostart`, `set_autostart`. Validation dans la fonction pure `validate_delay` (testée : 0, 1, 3600, 3601). Titre et corps de la notification fixés en Rust (français), jamais issus d'une saisie.
- Minuteur côté Rust : un thread `std::thread` qui dort puis appelle `app.notification().builder()...show()`. Aucune dépendance `tokio` ajoutée (le runtime async de Tauri n'expose pas de timer sans activer la feature `time` de tokio). Suffisant pour un spike ; le planificateur de la phase 2 devra être différent (voir recommandations).
- `src/tray.rs` : icône de zone de notification (icône de l'app, info-bulle « Homebase », menu « Ouvrir Homebase » / « Quitter », clic gauche = afficher et donner le focus). `src/lib.rs` : `CloseRequested` sur `main` = `prevent_close` + `hide` ; « Quitter » appelle `app.exit(0)`.
- Moindre privilège : `build.rs` déclare les 3 commandes via `AppManifest::commands`; `capabilities/default.json` = `core:default` + `allow-schedule-test-notification`, `allow-get-autostart`, `allow-set-autostart`. Aucune permission `notification:*` ni `autostart:*` : les plugins ne sont utilisables que depuis Rust.
- Front : `core/system/system.service.ts` (seul fichier important `@tauri-apps/api`), section « Système (expérimental) » dans `features/settings/settings.page.ts` (textes dans `fr.json`). Hors Tauri (`isTauri()` faux) : les méthodes rejettent avec `SystemUnavailableError`, les contrôles sont désactivés.
- CSP inchangée : `connect-src ipc: http://ipc.localhost` suffit pour `invoke`.

Dépendances ajoutées : `tauri-plugin-notification` 2.7, `tauri-plugin-autostart` 2.7, feature `tray-icon` de `tauri`, `@tauri-apps/api` ^2 (npm), plus `serde` (derive) et `serde_json` (dev, test de sérialisation) côté Rust.

## Sources

- Plugin notification (Schedule = mobile uniquement ; sur desktop `show()` affiche immédiatement) : https://v2.tauri.app/plugin/notification/
- Plugin autostart : https://v2.tauri.app/plugin/autostart/
- Tray : https://v2.tauri.app/learn/system-tray/
- Capabilities et permissions de commandes d'app (`AppManifest`, `allow-<commande>`) : https://v2.tauri.app/security/capabilities/ et https://v2.tauri.app/learn/security/using-plugin-permissions/ ; `tauri_build::AppManifest` : https://docs.rs/tauri-build/latest/tauri_build/struct.AppManifest.html
- Code du plugin notification (identité AUMID, lu dans les sources de la crate 2.7) : https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/notification

## Procédure de vérification manuelle

Préparation : `npm run build`, puis installer `apps/desktop/src-tauri/target/release/bundle/nsis/Homebase_0.0.0_x64-setup.exe` (la vérification de l'identité de toast ne vaut que pour l'app installée). Alternative rapide : `npm run dev`.

1. Lancer Homebase, ouvrir Réglages, section « Système (expérimental) ». Attendu : bouton et interrupteur actifs.
2. Cliquer « Envoyer une notification de test dans 10 s ». Attendu : après ~10 s, toast Windows « Homebase » / « Notification de test planifiée par Homebase. ». Refaire en ayant masqué la fenêtre dans le tray : le toast doit apparaître quand même.
3. Vérifier l'identité du toast : en app installée, il doit être attribué à « Homebase » ; en `npm run dev`, il est attribué à PowerShell (limite connue, voir plus bas). Vérifier aussi que le mode « Ne pas déranger » / Assistant de concentration le retient (comportement normal).
4. Tray : l'icône Homebase apparaît dans la zone de notification (éventuellement dans le menu « ^ »), info-bulle « Homebase ». Fermer la fenêtre (croix) : la fenêtre disparaît, le processus et l'icône restent. Clic gauche sur l'icône : la fenêtre revient avec le focus. Clic droit : menu « Ouvrir Homebase » (même effet) et « Quitter » (le processus se termine, vérifier dans le Gestionnaire des tâches).
5. Autostart : activer « Lancer au démarrage de Windows ». Attendu : une valeur `Homebase` dans `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` (regedit) et dans Gestionnaire des tâches > Applications de démarrage. Se déconnecter/reconnecter (ou redémarrer) : Homebase démarre. Désactiver : la valeur disparaît. Rouvrir Réglages : l'interrupteur reflète l'état.
6. Navigateur seul (`npm run web:start`) : contrôles désactivés avec le message « Disponible uniquement dans l'application Windows. », aucune erreur en console.

Test de fumée automatisé (déjà réalisé) : exe release lancé 5 s, processus vivant, titre de fenêtre « Homebase », arrêt par `Stop-Process`.

## Limites constatées ou documentées

- Identité des toasts : le plugin ne définit l'AppUserModelID (= `identifier` Tauri, `fr.mariusdev.homebase`) que si l'exe n'est pas dans `...\target\debug` ou `...\target\release`. Un exe lancé depuis `target/` (dev ou release non installée) affiche donc les toasts sous l'identité de PowerShell. Seule l'app installée (NSIS/MSI, qui crée le raccourci du menu Démarrer portant l'AUMID) est représentative.
- Plusieurs instances : sans garde, un second lancement (ex. autostart + lancement manuel) crée un second processus, un second tray et des rappels en double. Recommandation : ajouter `tauri-plugin-single-instance` dès que le planificateur existe (le second lancement focalise la fenêtre existante). Il n'est pas ajouté ici (hors périmètre).
- Rappels manqués : le minuteur du spike est en mémoire ; si l'app est quittée (« Quitter »), en veille prolongée ou tuée, la notification est perdue. Aucun rattrapage.
- Veille : un `sleep` côté thread peut dériver ou être retardé après une mise en veille du PC ; ne pas s'y fier pour des échéances absolues.
- Un thread par notification en attente : acceptable pour un spike seulement.
- Libellés natifs (tray, notification) en français en dur ; i18n natif hors périmètre du spike.
- Le clic sur un toast n'est pas géré (pas de retour vers la fenêtre) ; sur desktop, le plugin notification n'expose pas d'événement d'action fiable.
- `MacosLauncher` est ignoré sous Windows ; l'autostart écrit dans le registre `Run` de l'utilisateur, avec le chemin de l'exe courant (si l'exe est déplacé ou lancé depuis `target/`, l'entrée pointe au mauvais endroit : activer l'option depuis l'app installée).
- Autostart au login : la fenêtre s'ouvre visible ; pour la suite, prévoir un argument de lancement (ex. `--minimized`, via le paramètre `args` de `tauri_plugin_autostart::init`) pour démarrer masqué dans le tray.

## Recommandations pour le planificateur de la phase 2

- Source de vérité en base (SQLite) : les rappels (échéance UTC, fuseau IANA, RRULE) vivent dans la couche `data/`, pas en mémoire. Le planificateur Rust ne garde que la prochaine échéance.
- Un seul worker : boucle async unique qui dort jusqu'à la prochaine échéance (`tokio::time::sleep_until` avec la feature `time`, ou `tokio::select!` avec un canal de réveil quand un rappel est créé/modifié), plutôt qu'un thread par rappel. Re-synchroniser sur l'horloge murale après une veille (re-calculer à chaque réveil, ne jamais compter sur la durée écoulée).
- Rattrapage au démarrage : lister les rappels dont l'échéance est passée et non acquittée, les notifier (groupés si nombreux) selon une politique à définir (fenêtre max de rattrapage).
- Combiner autostart + tray + `single-instance` + démarrage masqué pour que les rappels fonctionnent sans fenêtre ouverte.
- Garder le moindre privilège : le front ne reçoit que des commandes d'app dédiées (créer/annuler un rappel), jamais `notification:*`. Titre et corps lus depuis la base (contenu utilisateur, affiché en texte brut par Windows).
- Prévoir i18n natif (libellés tray/notification fournis par le front à l'enregistrement, ou fichiers de langue côté Rust).
