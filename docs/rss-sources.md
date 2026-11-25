# Sources RSS de Marius

Liste validée par Marius le 2026-11-25 (tâche ROADMAP phase 3 « Lister les flux RSS des sources de Marius »). Elle sert de jeu de départ au widget RSS et de cas réels pour la spec `docs/specs/http-client.md`. Flux vérifiés le 2026-11-25 par le scout (RSS 2.0, 20 items chacun, `dc:creator` présent, aucun challenge Cloudflare observé ; à confirmer depuis le client HTTP Rust).

| Source | URL du flux | Filtre | Remarques |
|---|---|---|---|
| Hypixel SkyBlock : patch notes | https://hypixel.net/forums/skyblock-patch-notes.158/index.rss | aucun | Tous les items sont publiés par « Hypixel Team » ; aucune note Alpha |
| Hypixel SkyBlock Alpha : patch notes | https://hypixel.net/skyblock-alpha/index.rss | auteur (`dc:creator`) = `Hypixel Team` | Le flux mêle fils de joueurs et notes officielles : le filtre est obligatoire. Seulement 20 items : conserver les items déjà vus |
| Hypixel : annonces officielles | https://hypixel.net/forums/official-announcements.4/index.rss | aucun | Annonces générales, dont les grosses mises à jour SkyBlock |

## Contraintes observées
- Un seul hôte : `hypixel.net` (XenForo 2). `robots.txt` autorise ces chemins.
- `https://hypixel.net/whats-new/` a renvoyé un 429 : rafraîchissement prudent par hôte, respect de `Retry-After`.
- Écartés : le flux global du forum (`/forums/-/index.rss`, trop bruyant) et l'API `https://api.hypixel.net/v2/skyblock/news` (JSON, en retard sur le forum).
