# Spec : client HTTP sortant en Rust (`OutboundHttp`) : liste d'hôtes, anti-SSRF, exception NAS

- **Statut** : proposé, **en attente des décisions de Marius** (§17, N1 à N16). Aucun lot ne démarre avant.
- **Date** : 2026-11-25 (complément du même jour : premier usage réel, forum Hypixel, §1.4)
- **Auteur** : architect (Opus)
- **Destinataire** : `implementer` (Sonnet), en **quatre lots** (§15) : OH1 (cœur `net`), OH2 (liste autorisée et consentement), OH3 (flux RSS/Atom, filtre et historique), OH4 (sondes). Chaque lot lit aussi `CLAUDE.md` (Sécurité), `docs/specs/weather-widget.md` §6 (module `net` existant), `docs/adr/001-widget-contract.md` §3.8, `docs/adr/002-data-layer.md` (O3) et `docs/specs/typed-data-commands.md` (en cours de rédaction, voir §20).
- **ROADMAP** : phase 3, « (O) Spec du client HTTP sortant en Rust (liste d'hôtes, anti-SSRF, exception NAS) ». Prépare « (S) Widget RSS » et « (S) Statut de services ».
- **Hors périmètre** : l'interface des widgets RSS et Statut (disposition, états, i18n détaillé), qui fera l'objet de mini-specs (§15.6) ; l'état lu/non lu ; GitHub (phase 6, seuls les principes de §10 sont fixés ici).

> Règle : ne pas improviser. Si une supposition (§1.3) se révèle fausse, si une dépendance ne compile pas, ou si un critère ne peut pas être tenu sans s'écarter de cette spec, **s'arrêter et rapporter**.

---

## 0. En bref

1. Le front ne passe **jamais** d'URL ni d'hôte au moment d'une requête : il passe l'**identifiant** d'une cible (`net_targets`) que le Rust a validée et que Marius a **consentie dans une boîte de dialogue native** ouverte par le Rust (un script injecté ne peut pas cliquer dessus).
2. Toute connexion publique passe par un **résolveur DNS gardé** : chaque adresse résolue est classée (§6.1) ; une seule adresse non publique fait refuser toute la résolution. reqwest se connecte aux adresses mêmes qui ont été vérifiées (pas de fenêtre de rebinding). Les IP littérales, qui ne passent pas forcément par le résolveur (S1), sont vérifiées par la politique d'URL avant l'envoi, à **chaque saut** de redirection (redirections gérées à la main, 3 au plus, jamais de https vers http).
3. Le réseau local n'est joignable que par des **sondes** (TCP connect ; HTTP statut + latence, aucun corps lu) vers une **IP littérale privée + port + protocole** consentie une par une ; jamais par un flux ; boucle locale, link-local (dont 169.254.169.254) et multicast toujours refusés.
4. Les flux RSS/Atom/JSON Feed sont lus en flux borné (4 Mio), pré-analysés (profondeur, DTD interne, attributs), analysés par `feed-rs` 3.0.0 (quick-xml 0.42, corrigé des RUSTSEC-2026-0194/0195), et réduits à du **texte brut** borné, **auteur compris** : le front n'affiche que par interpolation, aucun `innerHTML`, aucune image distante, CSP inchangée. Un **filtre par source** (auteurs autorisés, mots du titre) est appliqué côté Rust, et les articles déjà vus sont **conservés en base** (200 par source), car les flux XenForo n'en donnent que 20 (§9.6, §9.7).
5. Débit prudent : intervalle par source (30 min, N16) **et** espacement par hôte (60 s entre deux requêtes vers le même hôte), `Retry-After` appliqué à tout l'hôte ; un défi Cloudflare est détecté et n'est jamais contourné (§8).
6. Aucun secret en phase 3. Les jetons futurs (GitHub) seront lus côté Rust dans le gestionnaire d'identifiants Windows, attachés seulement à un `Endpoint` fixe, jamais renvoyés au front ni stockés en base ou en export.

---

## 1. Contexte

La météo (phase 1) a posé un module Rust `net` minimal : client reqwest unique (`native-tls`, TLS ≥ 1.2, HTTPS seul, aucune redirection, aucun proxy, timeouts, taille max lue en flux, 4 requêtes simultanées), hôtes fixés par l'énumération fermée `Endpoint` (deux hôtes Open-Meteo), commandes dédiées, aucune permission `http:*`, CSP `connect-src` locale. Sa spec (§3.1) annonce la reprise en phase 3 : variante dynamique, résolveur qui refuse les IP privées sauf liste NAS, limites par usage.

La phase 3 apporte deux nouveautés de nature différente :
- **des hôtes choisis par l'utilisateur** (un flux RSS est une URL saisie) : la liste d'hôtes ne peut plus être fixée au code ;
- **une cible volontairement privée** (le NAS) : la règle « refuser les IP privées » doit admettre une exception sans rouvrir la SSRF.

Elle arrive juste après O3 de l'ADR-002 (commandes Rust typées à la place de `sql:allow-execute`/`sql:allow-select`), dont c'est la raison d'être : « avant tout contenu externe ».

### 1.1 Faits vérifiés (sources consultées le 2026-11-25)

| # | Fait | Source |
|---|---|---|
| F1 | `Cargo.toml` : `reqwest = { version = "0.13.5", default-features = false, features = ["native-tls"] }`, `tokio` avec la seule feature `sync`, `sha2`, `jiff`, `chrono` (`std`), `rfd` 0.16, `tauri-plugin-dialog` 2.8.3 | lecture du dépôt |
| F2 | `src/net/mod.rs` : `NetClient { client: Option<reqwest::Client>, permits: Semaphore(4) }`, `Endpoint` (2 variantes), `check_url`, `check_response`, `ChunkSource`, `read_limited`, `classify` (journalise le genre seulement, jamais l'URL) ; client construit avec `https_only(true)`, `Policy::none()`, `connect_timeout(5 s)`, `timeout(10 s)`, `user_agent("Homebase/<version>")`, `no_proxy()`, `referer(false)`, `tls_version_min(TLS_1_2)`, `tls_backend_native()` | lecture du dépôt |
| F3 | `capabilities/default.json` : 36 permissions d'app + `sql:allow-execute`, `sql:allow-select`, `opener:allow-open-url` (portée `https://*`, `http://*`) ; aucune `http:*` ; `capability_tests.rs` vérifie la liste exacte, l'absence de `http:`, `dialog:`, `fs:`, `shell:`, `process:` et que la CSP contient `connect-src 'self' ipc: http://ipc.localhost;` | lecture du dépôt |
| F4 | CSP (`tauri.conf.json`) : `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'none'` | lecture du dépôt |
| F5 | Dialogues natifs ouverts depuis le Rust uniquement (`backup/dialogs.rs`, `tauri_plugin_dialog` + `rfd`), stubs sous `cfg(test)` (un binaire de test qui lie `rfd` meurt, S11 de backup-restore), appels bloquants exécutés dans `spawn_blocking` | lecture du dépôt |
| F6 | Migrations V1 à V8 ; tables `reminders`, `time_sessions`, `habits`… accessibles par commandes Rust typées seulement (O3 partiel) ; `time::clock::Clock` (`SystemClock`, `FixedClock`), `time::formats::format_instant` (`YYYY-MM-DDTHH:MM:SS.sssZ`) ; front : `parseWebUrl` (`core/system/web-url.ts`), `hasInstantShape` (`data/time-formats.ts`) | lecture du dépôt |
| F7 | `feed-rs` **3.0.0** (2026-09-27, MIT, non retirée) : RSS 0.9x/1.0/2.0, Atom, JSON Feed ; dépendances `quick-xml 0.42.0` (feature `encoding`), `chrono`, `mediatype`, `regex`, `url`, `uuid`, `serde_json`, `siphasher` ; `ammonia` **optionnelle** derrière la feature `sanitize` | https://crates.io/api/v1/crates/feed-rs ; https://docs.rs/crate/feed-rs/3.0.0/source/Cargo.toml.orig |
| F8 | Couche XML de feed-rs : `NsReader` ; les événements DOCTYPE sont **ignorés** ; les entités non prédéfinies (`&foo;`, `&nbsp;`) **ne sont pas développées** (gardées littérales) ; **aucune limite de profondeur** ; encodage tiré de la déclaration XML | https://raw.githubusercontent.com/feed-rs/feed-rs/master/feed-rs/src/xml/mod.rs |
| F9 | `quick-xml` : RUSTSEC-2026-0194 (temps quadratique, attributs en double) et RUSTSEC-2026-0195 (allocation non bornée des déclarations d'espace de noms, `NsReader`) corrigés en **0.41.0** ; dernière version 0.42.0 (2026-08-22), déjà présente dans `Cargo.lock` | https://rustsec.org/packages/quick-xml.html ; …/advisories/RUSTSEC-2026-0194.html ; …/RUSTSEC-2026-0195.html ; crates.io ; `Cargo.lock` |
| F10 | `ammonia` 4.2.5 (2026-11-13) : **10 avis RUSTSEC**, dont 5 en 2026 (mXSS SVG/MathML : 2026-0533, 2026-0193, 2026-0213 ; CSS `url` : 2026-0373) ; 2026-0533 corrigé en 4.2.5 / 4.1.9 / 3.3.5 | https://rustsec.org/packages/ammonia.html ; …/RUSTSEC-2026-0533.html ; crates.io |
| F11 | Aucune page RUSTSEC pour `feed-rs` ni pour `html2text` (404) au 2026-11-25 | https://rustsec.org/packages/feed-rs.html ; …/html2text.html |
| F12 | `rss` 2.1.2 (2026-09-10) : RSS seul (Atom dans une autre crate) ; `html2text` 0.17.4 (2026-10-18) | crates.io |
| F13 | reqwest 0.13.5 : `ClientBuilder::dns_resolver<R: IntoResolve>`, trait `dns::Resolve { fn resolve(&self, name: Name) -> Resolving }` (« un port explicite dans l'URL remplace celui des `SocketAddr` résolues ») ; `redirect::Policy::{none, limited, custom}` ; `no_proxy()` désactive aussi le proxy système ; `tls_danger_accept_invalid_certs` (faux par défaut) ; `read_timeout`, `pool_idle_timeout` (90 s par défaut), `no_gzip()` | https://docs.rs/reqwest/0.13.5/reqwest/struct.ClientBuilder.html ; …/dns/trait.Resolve.html ; …/redirect/struct.Policy.html |
| F14 | `keyring` 4.2.0 (2026-08-29, MIT/Apache-2.0) | https://crates.io/api/v1/crates/keyring |
| F15 | Parseur RSS 2.0 de feed-rs : `<author>` et `dc:creator` sont **tous deux** ajoutés à `entry.authors` (`Person::parse(texte)`), avec les rôles `"author"` et `"creator"`, dans l'ordre du document, **sans priorité ni dédoublonnage** ; le découpage « email (nom) » dépend de `Person::parse` (non lu) | https://raw.githubusercontent.com/feed-rs/feed-rs/master/feed-rs/src/parser/rss2/mod.rs |

### 1.2 Conséquences directes des faits
- F8 : pas de bombe d'entités possible (pas de développement d'entités DTD), mais une **imbrication profonde** n'est pas bornée par feed-rs : un parseur récursif peut épuiser la pile, ce qui **termine le processus** (pas une panique rattrapable). D'où la pré-analyse bornée de §9.2, obligatoire avant d'appeler feed-rs.
- F10 : l'assainissement HTML côté Rust est un terrain d'avis fréquents. Rendre du HTML de flux imposerait de suivre ammonia de près **et** de faire `innerHTML` côté front. Le texte brut supprime les deux (§9.4, N6).
- F7 + F9 : feed-rs 3.0.0 tire quick-xml 0.42, déjà présent ; l'ajout au binaire se limite surtout à feed-rs, `mediatype`, `uuid` (à mesurer, CA-OH3-9).
- F15 : l'auteur se choisit par **rôle** (`creator` d'abord) et se **normalise** nous-mêmes (forme « email (nom) »), sans dépendre du découpage de `Person::parse` (§9.3).

### 1.3 Supposé (à vérifier pendant l'implémentation)

| # | Supposition | Vérifiée par |
|---|---|---|
| S1 | Le connecteur de reqwest (hyper-util `HttpConnector`) **ne passe pas** par le résolveur quand l'hôte de l'URL est une IP littérale. La spec ne dépend pas de la réponse : la politique d'URL refuse les littéraux non publics avant l'envoi ; le test CA-OH1-5 documente le comportement réel | CA-OH1-5 |
| S2 | `reqwest::dns::Name::as_str()` existe ; `Arc<T: Resolve>` (ou `T`) satisfait `IntoResolve` | compilation OH1 |
| S3 | L'erreur renvoyée par le résolveur est retrouvable dans la chaîne `source()` de `reqwest::Error` (pour la classer `forbidden_address` et non `network`) | CA-OH1-4 |
| S4 | `tokio::net::lookup_host` (feature `net`) fonctionne dans le runtime de Tauri sous Windows (getaddrinfo dans le pool bloquant) | CA-OH1-4, M-OH1-1 |
| S5 | `tauri_plugin_dialog` : `app.dialog().message(..).title(..).kind(..).buttons(MessageDialogButtons::OkCancelCustom(..)).parent(&window).blocking_show()` renvoie `bool` | compilation OH2, M-OH2-1 |
| S6 | feed-rs 3.0.0 expose `parser::parse(R: Read)` (ou `Builder::new().build().parse`) et un modèle `Feed { title, links, entries, .. }`, `Entry { id, title, links, summary, content, published, updated, authors, .. }`, `Person { name, email, .. }` avec un rôle consultable, `Text { content, .. }`, `Link { href, rel, .. }` | compilation OH3 (s'arrêter si l'API diffère sensiblement) |
| S7 | Aucun proxy n'est configuré sur le PC de Marius (hérité de weather-widget S7, toujours en attente) | Marius, N11 |
| S8 | Le lien `alternate` d'une entrée Atom ou le `<link>` RSS est présent dans `Entry::links` (premier lien de `rel` absent ou `alternate` = lien de l'article) | fixtures OH3 |
| S9 | `#[serde(tag = "kind", deny_unknown_fields)]` fonctionne sur l'énumération `NetTargetInput` ; sinon : désérialiser une structure plate `deny_unknown_fields` puis convertir | compilation et tests OH2 |
| S10 | Les trois flux Hypixel (§1.4) répondent au client Rust (`User-Agent: Homebase/<version>`, sans cookie, sans JavaScript) par un 200 `application/rss+xml` ou `text/xml`, **sans défi Cloudflare** | M-OH3-5 (Marius) ; si faux : §8.6, ne pas contourner |
| S11 | Les éléments `<item>` de XenForo 2 portent `dc:creator` (« Hypixel Team ») et `<author>` (« invalid@example.com (Hypixel Team) ») ; le flux contient 20 entrées | fixture tirée d'une réponse réelle, enregistrée par Marius ou le scout (CA-OH3-10) |

### 1.4 Premier usage réel : forum Hypixel (XenForo 2)
Transmis par le coordinateur le 2026-11-25 (observations du scout et de Marius, non revérifiées par l'architecte) :
- Flux retenus : `https://hypixel.net/forums/skyblock-patch-notes.158/index.rss`, `https://hypixel.net/forums/official-announcements.4/index.rss`, `https://hypixel.net/skyblock-alpha/index.rss`.
- Le troisième mélange fils de joueurs et notes Alpha officielles : Marius ne veut garder que les articles dont l'auteur vaut « Hypixel Team ». L'auteur figure dans `dc:creator` et dans `<author>` au format « invalid@example.com (pseudo) ».
- Les flux ne contiennent que **20** articles : les articles déjà vus doivent être conservés.
- Le forum a renvoyé un **429** sur `/whats-new/` : débit prudent par hôte, respect de `Retry-After`.
- Aucun défi Cloudflare observé à ce stade ; à confirmer depuis le client Rust (S10).

Conséquences intégrées : auteur extrait et normalisé (§9.3), filtre par source (§9.6, N15), historique persistant (§9.7, N8), espacement par hôte et `Retry-After` à l'échelle de l'hôte (§8.1, §8.5), détection d'un défi (§8.6), fixture XenForo (§15.3). Les trois URL ne figurent **que** dans la base de Marius (ajoutées par l'interface, avec consentement) et dans les fixtures de test : jamais dans le code de production.

---

## 2. Modèle de menace

Actifs : le PC de Marius et ses services locaux (NAS, routeur, serveurs de développement sur `localhost`), ses données Homebase, sa vie privée (adresses consultées), plus tard ses jetons.

| # | Menace | Vecteur | Parade (section) |
|---|---|---|---|
| T1 | **XSS dans la WebView qui pilote les commandes** | Contenu externe mal affiché, dépendance npm compromise | Les commandes n'acceptent que des identifiants de cibles consenties (§5) ; ajout d'une cible = dialogue natif (N1) ; aucune URL passée à la requête ; débits bornés (§8) ; aucune permission `http:*`, CSP `connect-src` locale (§13). Ce que garde un XSS : lister et supprimer des cibles, modifier un filtre, déclencher des requêtes vers des cibles déjà consenties, demander un dialogue (refusable, limité, §5.4) |
| T2 | **SSRF vers le réseau local** (routeur, NAS, imprimante) | URL de flux pointant sur `192.168.x.x`, nom DNS qui résout vers une IP privée, redirection vers une IP privée | Classement de chaque IP (§6.1) au résolveur et aux littéraux, à chaque saut (§6.4) ; LAN seulement par sondes sur IP littérale consentie (§7) |
| T3 | **SSRF vers la boucle locale** (`127.0.0.1`, `::1`, `localhost`, `[::ffff:127.0.0.1]`, `0.0.0.0`, `2130706433`, `0x7f.1`) | Idem T2 | Toujours interdite, même en exception (N4) ; normalisation WHATWG des formes IPv4 exotiques par la crate `url` (§6.2) |
| T4 | **Métadonnées / link-local** (`169.254.169.254`, `fe80::/10`) | Idem T2 | Toujours interdites |
| T5 | **DNS rebinding** (TTL 0, première réponse publique puis privée) | Nom contrôlé par l'attaquant | Vérification **dans** le résolveur utilisé pour la connexion ; refus de la résolution entière si une seule adresse est interdite (§6.3) |
| T6 | **IPv6 détournée** (IPv4 mappée `::ffff:a.b.c.d`, compatible `::a.b.c.d`, NAT64 `64:ff9b::/96`, 6to4, Teredo, ULA) | Littéral ou réponse AAAA | Table §6.1 : classe de l'IPv4 embarquée, ou refus |
| T7 | **Flux malveillant** : redirections en boucle ou vers http, réponse énorme ou lente, `Content-Length` menteur, compression, bombe XML, imbrication profonde, milliers d'attributs, encodage invalide, HTML/JS injecté, liens `javascript:`/`data:`/`file:`, caractères de contrôle ou bidi, dates absurdes, milliers d'entrées, remplissage de l'historique | Serveur du flux | §6.4, §8, §9 : redirections bornées et revalidées, taille lue en flux, timeouts, pré-analyse, texte brut seulement, liens http(s) filtrés, textes et listes bornés, historique plafonné par source |
| T8 | **Exfiltration par URL construite** | Un XSS ajoute `https://attaquant.example/?d=<données>` et laisse Homebase l'appeler en silence | URL figée au consentement et **affichée en entier** dans le dialogue natif (§5.5) ; aucun paramètre ajouté au moment de la requête ; pas de `Referer`, pas de cookie, `User-Agent` générique |
| T9 | **Requêtes GET à effet de bord** sur le LAN (`/cgi-bin/reboot`) | Cible LAN dont le chemin est modifié | Chemin compris dans la cible consentie, immuable (§5.2) ; aucun en-tête d'authentification ni cookie ; aucune réponse lue |
| T10 | **Fuite de jeton** (phase 6) | Jeton attaché à une redirection ou à une cible utilisateur, journalisé, renvoyé au front, exporté | §10 |
| T11 | **Déni de service** de l'app, ou **bannissement** par un site (429, blocage d'IP) | Requêtes en rafale par un XSS ou par plusieurs sources du même hôte | Sémaphores séparés, intervalle par source, espacement par hôte, `Retry-After` par hôte, recul exponentiel, une requête en vol par cible (§8.5) |
| T12 | **Données importées piégées** | Fichier JSON de configuration ou archive de sauvegarde contenant des cibles | Import JSON : cibles réimportées **sans consentement** ou pas du tout (N9) ; archive : risque accepté (§18, R6) |

Hors modèle : administrateur local malveillant (fichier `hosts`, certificat racine ajouté), compromission de Windows ou de WebView2.

---

## 3. Options étudiées

### 3.1 Où vit la liste autorisée
| Option | Verdict |
|---|---|
| A. Le front passe l'URL à chaque appel, le Rust la valide | **Rejeté** : un XSS choisit l'URL (T1, T8) ; c'est le modèle de `tauri-plugin-http` |
| B. Liste d'hôtes autorisés + URL passée par le front | **Rejeté** : un XSS choisit encore chemin et requête sur un hôte autorisé (exfiltration T8 ; effet de bord LAN T9) |
| **C. Cibles complètes (URL, ou hôte + port) stockées côté Rust, référencées par identifiant ; ajout par une commande qui valide puis demande un consentement** | **Retenu** |

### 3.2 Consentement (détail en N1)
| Option | Pour | Contre |
|---|---|---|
| Confirmation dans l'interface Angular | Intégré, joli | Un XSS appelle la commande directement : aucune protection |
| **Dialogue natif ouvert par le Rust** (comme les dialogues de sauvegarde) | Un script ne peut pas cliquer ; texte contrôlé par le Rust | Fenêtre système moins jolie ; stub en test |
| Natif pour le LAN seulement | Moins de dialogues | Un XSS ajoute en silence une cible publique qu'il contrôle (exfiltration T8) |

### 3.3 Anti-SSRF
| Option | Verdict |
|---|---|
| Résoudre soi-même, vérifier, puis mettre l'IP dans l'URL | **Rejeté** : casse SNI et vérification du certificat (nom d'hôte) |
| `resolve_to_addrs` | **Rejeté** : réglage du `ClientBuilder`, donc un client par requête (pool perdu) |
| Vérifier l'IP après connexion (`remote_addr`) | **Rejeté** : la requête est déjà partie |
| **Résolveur gardé (`dns_resolver`) + politique d'URL pure pour les IP littérales + redirections gérées à la main** | **Retenu** : la vérification porte sur les adresses mêmes de la connexion ; tout est testable sans réseau |

### 3.4 Crate de flux
| Option | Pour | Contre |
|---|---|---|
| **`feed-rs` 3.0.0** | RSS + Atom + JSON Feed, modèle unifié, `dc:creator` géré (F15), quick-xml 0.42 (corrigé), dates normalisées, aucun avis | Pas de limite de profondeur (F8 : pré-analyse à écrire) ; tire `regex`, `uuid`, `mediatype` |
| `rss` 2.1.2 + `atom_syndication` | Mainteneurs historiques | Deux modèles à unifier ; pas de JSON Feed |
| Parseur maison sur quick-xml | Contrôle total | Beaucoup de cas réels (espaces de noms, dates RFC 822 fantaisistes) : risque de bugs, coût Sonnet |

**Retenu : feed-rs 3.0.0, épinglé, sans la feature `sanitize`** (pas d'ammonia).

### 3.5 Contenu renvoyé au front (détail en N6)
| Option | Verdict |
|---|---|
| **Texte brut borné (titre, extrait, auteur, date, lien)** | **Recommandé** : aucune surface HTML ; interpolation Angular seule ; CSP inchangée |
| HTML assaini par ammonia (liste blanche) + `innerHTML` côté front après DOMPurify | Rendu riche, mais deux assainisseurs à suivre (F10) et une exception à la règle « jamais `innerHTML` » |
| Images : URL distantes (`img-src https:`) | **Rejeté** : pistage, fuite d'IP, CSP élargie |
| Images téléchargées par le Rust et servies en `data:` | Possible plus tard (CSP déjà compatible), mais chaque image est une requête vers un hôte non consenti : hors v1 |

### 3.6 Conversion HTML vers texte (choix technique)
| Option | Verdict |
|---|---|
| `html2text` 0.17.4 (html5ever) | Rendu soigné ; dépendance lourde pour un extrait de 500 caractères |
| ammonia avec liste vide, puis décodage | Tire ammonia (F10) pour rien |
| **Convertisseur maison borné (automate, ~150 lignes)** | **Retenu** : la sécurité n'en dépend pas (le front interpole), seul le confort de lecture ; testable par vecteurs |

### 3.7 Compression (choix technique)
**Retenu : aucune** (pas de feature `gzip`/`brotli`/`deflate`/`zstd`, pas d'`Accept-Encoding`, comme la météo). Quelques flux toutes les 30 min ne le justifient pas ; la limite de taille porte ainsi sur les octets reçus. Si un jour activée : `read_limited` bornerait les octets **décompressés** (reqwest décompresse avant `chunk()`), donc aussi une bombe de compression.

### 3.8 Où filtrer les articles (détail en N15)
| Option | Pour | Contre |
|---|---|---|
| **a. Côté Rust, avant l'historique** (filtre enregistré avec la source) | L'historique de 200 articles ne contient que ce que Marius veut : les notes « Hypixel Team », rares au milieu des fils de joueurs, y restent des mois | Élargir le filtre ne fait pas réapparaître les articles déjà écartés (seulement les 20 du flux courant) |
| b. Côté Rust, à la lecture (tout est stocké) | Filtre réversible | Les fils de joueurs remplissent le plafond et chassent les notes officielles (ou plafond bien plus haut) |
| c. Côté front (fonction pure dans `core/feeds`) | Le plus simple | Même défaut que b, et filtre dans la config du widget (deux widgets sur la même source peuvent diverger) |

### 3.9 Débit vers un hôte partagé
Plusieurs sources sur le même hôte (trois flux hypixel.net) : un intervalle **par source** ne suffit pas (3 requêtes simultanées au démarrage). Retenu : espacement minimal **par hôte** (§8.1) et `Retry-After` appliqué à **l'hôte** entier, en plus de l'intervalle par source.

---

## 4. Décision (résumé)

1. **Module `net` étendu** (OH1) : classement d'adresses pur (`net/address.rs`), politique d'URL pure (`net/url_policy.rs`), résolveur gardé (`net/resolver.rs`), boucle de redirections à la main sur une abstraction de transport testable (`net/fetch.rs`), **régulateur par hôte** (`net/host_gate.rs`). Un client public (météo, flux, sondes publiques) muni du résolveur gardé ; un client LAN distinct pour les sondes locales (§7, OH4).
2. **Liste autorisée** (OH2) : table `net_targets` accessible **uniquement** par commandes Rust typées ; ajout par `net_target_request`, qui valide, résout, puis ouvre un **dialogue natif** de consentement ; le front ne connaît que des identifiants.
3. **Flux** (OH3) : `feed_fetch(targetId, force)` : requête conditionnelle (ETag / Last-Modified), 4 Mio max, pré-analyse, feed-rs, sortie texte brut bornée avec auteur normalisé, **filtre par source** (`feed_filter_set`), **historique** en base (200 articles par source), recul côté Rust.
4. **Sondes** (OH4) : `probe_run(targetId)` : TCP connect ou HTTP GET sans lecture du corps ; résultat (joignable, statut, latence) ; LAN seulement sur IP littérale consentie.
5. **Front** : dépôt `NetTargetRepository` dans `data/` (couplage §20), `core/feeds` (`FeedService`), `core/probes` (`ProbeService`), revalidation Valibot, `assertWidgetPermission(ctx, 'network')`. Aucun `innerHTML` ni `bypassSecurityTrust*` dans `apps/web/src/app` (garde de lint).
6. **CSP inchangée**, aucune permission `http:*`, aucun plugin HTTP, aucune permission de plugin ajoutée (le dialogue est ouvert par le Rust).

---

## 5. Politique d'hôtes et consentement

### 5.1 Deux familles d'hôtes
| Famille | Exemples | Où elle est fixée | Consentement |
|---|---|---|---|
| **Hôtes fixés au code** | Open-Meteo (phase 1), `api.github.com` (phase 6) | Énumération fermée `Endpoint` dans `src/net/mod.rs` ; URL de base constante, paramètres ajoutés par `append_pair` | Aucun (relu en revue de code) |
| **Cibles de l'utilisateur** | Flux RSS (dont hypixel.net), sondes HTTP/TCP publiques, sondes LAN (NAS) | Table `net_targets` (§12), écrite seulement par `net_target_request` | Dialogue natif à l'ajout (N1) |

Un `Endpoint` fixe ne passe jamais par `net_targets`, et une cible utilisateur ne reçoit jamais d'en-tête d'authentification (§10).

### 5.2 Ce qu'est une cible
Une cible est **immuable** après consentement : `kind` (`feed` | `http_probe` | `tcp_probe`), `scope` (`public` | `lan`, déduit par le Rust, jamais choisi par le front), et soit une URL normalisée complète (chemin et requête compris, fragment retiré), soit `host` + `port`. Seuls le libellé (`label`) et, pour un flux, le filtre (§9.6) sont modifiables sans nouveau consentement (ils ne changent pas ce qui est contacté). Changer l'adresse = supprimer puis ajouter (nouveau dialogue).

| `kind` | `scope` possibles | Forme | Schémas |
|---|---|---|---|
| `feed` | `public` seulement (§7.1) | URL | `https` (N2) |
| `http_probe` | `public` ou `lan` | URL | public : `https` (N2) ; LAN : `http` ou `https` |
| `tcp_probe` | `public` (N12) ou `lan` | `host` + `port` | sans objet |

Déduction du `scope` (pure, `url_policy.rs`) : hôte IP littérale de classe `Lan` (§6.1) → `lan` ; hôte IP littérale `Public` ou nom de domaine → `public` (le nom doit résoudre vers des adresses toutes publiques, §6.3) ; tout le reste → refus. Un **nom** qui résout vers une IP privée (`nas.local`, `box.home.arpa`) est refusé avec `private_name` ; un nom sans point (`NAS`) avec `single_label` ; le message invite à saisir l'adresse IP (N3).

### 5.3 Ajout d'une cible (`net_target_request`)
Ordre strict, dans la commande Rust :
1. Valider l'entrée (types, longueurs, §11.2) et la politique d'URL ou d'hôte (§6.2) ; déduire le `scope`. Échec → erreur, aucun dialogue.
2. Refuser un doublon (§12) → `already_exists { id }` ; plus de 50 cibles → `limit_reached`. Aucun dialogue.
3. Cible publique désignée par un nom : le résoudre par le résolveur gardé (§6.3), sans se connecter. Échec DNS → `dns` ; adresse interdite → `private_name` si toutes les adresses sont de classe `Lan`, sinon `forbidden_address`. (Information au moment de l'ajout ; la vérification qui fait foi est celle de chaque connexion.)
4. Prendre le verrou de dialogue (§5.4) ; fenêtre principale non visible → `window_hidden` (un dialogue ne surgit jamais depuis la zone de notification).
5. Ouvrir le **dialogue natif** (dans `spawn_blocking`, parent = fenêtre principale) avec un texte construit par une fonction pure (§5.5). Refus → `declined`.
6. Insérer la ligne (`consented_at` = maintenant, UTC) et la renvoyer.

### 5.4 Verrou et anti-harcèlement
- Un seul dialogue de consentement à la fois (`tokio::sync::Mutex`, `try_lock`) : sinon `dialog_busy`.
- Après un refus, toute nouvelle demande est refusée pendant 10 s (`dialog_busy { retryAfterMs }`) : un script ne peut pas enchaîner les dialogues pour arracher un clic.
- Au plus 50 cibles au total, libellé de 100 caractères au plus.

### 5.5 Textes du dialogue (FR, fonctions pures testées)
Titre « Homebase : accès réseau ». Boutons « Autoriser » / « Annuler ». L'hôte est affiché **en ASCII** (forme punycode `xn--…` d'un nom internationalisé, contre les homographes), suivi entre parenthèses de la forme Unicode si elle diffère. L'URL est affichée **en entier** (≤ 2048 caractères, déjà bornée), sur sa propre ligne.

- `feed` : « Autoriser Homebase à lire régulièrement ce flux ?\n\nSite : {host}\nAdresse : {url}\n\nHomebase le consultera au plus toutes les {FEED_MIN_INTERVAL en minutes} minutes. Vous pourrez retirer cet accès dans Réglages. »
- `http_probe` public : « Autoriser Homebase à vérifier régulièrement que ce service répond ?\n\nSite : {host}\nAdresse : {url}\n\nSeuls le code et le temps de réponse sont relevés. »
- `tcp_probe` public : « Autoriser Homebase à vérifier régulièrement que ce service répond ?\n\nHôte : {host}\nPort : {port}\n\nHomebase ouvre seulement une connexion, sans rien envoyer. »
- LAN (`http_probe` ou `tcp_probe`) : « Autoriser Homebase à sonder un appareil de votre réseau local ?\n\nAdresse : {ip}\nPort : {port}\nProtocole : {TCP | HTTP | HTTPS}[\nChemin : {path}]\n\nHomebase vérifie seulement que l'appareil répond ; aucune donnée n'est lue ni envoyée. N'autorisez que vos propres appareils. »

### 5.6 Révocation
`net_target_delete(id)` (sans dialogue : réduire la surface ne demande pas de consentement) : supprime la ligne, son filtre et son historique (`ON DELETE CASCADE`), vide l'état mémoire de la cible ; une requête en vol se termine mais son résultat n'est ni enregistré ni mis en cache. Les préférences rattachées dans les tables des widgets suivent aussi par `ON DELETE CASCADE` (mini-specs). Une page Réglages « Accès réseau » liste les cibles et permet de les retirer (N13).

---

## 6. Anti-SSRF

### 6.1 Classement des adresses (`net/address.rs`, pur)
```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AddressClass { Public, Lan, Forbidden }
pub fn classify(ip: std::net::IpAddr) -> AddressClass;
```
Évaluation dans l'ordre des tableaux ; la première ligne qui correspond l'emporte.

**IPv4**
| Plage | Classe | Motif |
|---|---|---|
| `0.0.0.0/8` | Forbidden | « ce réseau » (`0.0.0.0` atteint la machine locale sous plusieurs OS) |
| `127.0.0.0/8` | Forbidden | boucle locale (N4) |
| `169.254.0.0/16` | Forbidden | link-local, métadonnées cloud |
| `224.0.0.0/4` | Forbidden | multicast |
| `240.0.0.0/4` (dont `255.255.255.255`) | Forbidden | réservé, diffusion |
| `192.0.0.0/24`, `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`, `192.88.99.0/24`, `198.18.0.0/15` | Forbidden | protocoles IETF, documentation, relais 6to4, bancs d'essai |
| `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` | Lan | RFC 1918 |
| `100.64.0.0/10` | Lan | CGNAT ; aussi les adresses Tailscale (un NAS joint par VPN reste une exception LAN) |
| tout le reste | Public | |

**IPv6**
| Plage | Classe |
|---|---|
| `::/128` (non spécifiée), `::1/128` (boucle) | Forbidden |
| `::ffff:0:0/96` (IPv4 mappée) | classe de l'IPv4 embarquée |
| `::/96` (IPv4 compatible, obsolète) | Forbidden |
| `64:ff9b::/96` (NAT64 bien connu) | Public si l'IPv4 embarquée est Public, sinon Forbidden (RFC 6052 : jamais vers une IPv4 privée) |
| `64:ff9b:1::/48` (NAT64 local) | Forbidden |
| `100::/64` (rejet) | Forbidden |
| `2001::/23` (protocoles IETF, dont Teredo `2001::/32`) | Forbidden |
| `2001:db8::/32`, `3fff::/20` (documentation) | Forbidden |
| `2002::/16` (6to4) | Forbidden (obsolète ; évite de décoder l'IPv4 embarquée) |
| `5f00::/16` (SRv6) | Forbidden |
| `fc00::/7` (ULA) | Lan |
| `fe80::/10` (link-local), `fec0::/10` (site-local obsolète), `ff00::/8` (multicast) | Forbidden |
| `2000::/3` restant | Public |
| tout le reste (non attribué) | Forbidden |

Ni `Ipv4Addr::is_global` (instable) ni crate : masques écrits à la main, une constante par plage, testés par vecteurs (CA-OH1-1).

### 6.2 Politique d'URL et d'hôte (`net/url_policy.rs`, pur)
```rust
pub const URL_MAX_LEN: usize = 2048;
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetScope { Public, Lan }
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UrlPolicyError {
    Invalid, Scheme, Credentials, TooLong, Port, LocalName, SingleLabel, ForbiddenAddress, LanNotAllowed,
}
/// URL normalisée par la crate `url` (WHATWG), après trim ; fragment retiré.
pub fn parse_target_url(raw: &str) -> Result<reqwest::Url, UrlPolicyError>;
/// Cible publique (flux, sonde HTTP publique, chaque saut de redirection).
pub fn check_public_url(url: &reqwest::Url) -> Result<(), UrlPolicyError>;
/// Sonde HTTP LAN : hôte IP littérale de classe Lan, http ou https.
pub fn check_lan_url(url: &reqwest::Url) -> Result<(), UrlPolicyError>;
/// Scope d'une URL de sonde : Lan si littéral Lan et check_lan_url passe ; sinon Public si check_public_url passe.
pub fn probe_url_scope(url: &reqwest::Url) -> Result<TargetScope, UrlPolicyError>;
/// Sonde TCP : hôte (nom ASCII ou IP littérale) + port 1..=65535.
pub fn check_tcp_target(host: &str, port: u16) -> Result<(TcpHost, TargetScope), UrlPolicyError>;
pub enum TcpHost { Ip(std::net::IpAddr), Name(String) }
/// Liste des « bad ports » de la norme Fetch (WHATWG).
pub fn is_bad_port(port: u16) -> bool;
/// Clé du régulateur par hôte (§8.5) : hôte ASCII en minuscules, sans point final.
pub fn host_key(url: &reqwest::Url) -> String;
```
Règles de `check_public_url`, dans l'ordre :
1. Longueur de `as_str()` ≤ 2048 (`TooLong`).
2. Schéma `https` (N2 ; `Scheme`).
3. Ni `username` ni `password` (`Credentials`).
4. Port explicite dans la liste des « bad ports » de Fetch → `Port` ; le port par défaut et les autres ports sont acceptés.
5. Hôte :
   - `Host::Ipv4` / `Host::Ipv6` : `classify` doit donner `Public` (`ForbiddenAddress`). La crate `url` ramène `2130706433`, `0x7f.1`, `127.1`, `0177.0.0.1` à `127.0.0.1` : un test le verrouille.
   - `Host::Domain` (ASCII, punycode) : refus de `localhost` et `*.localhost`, avec ou sans point final (`LocalName`) ; refus d'un nom sans point (`SingleLabel` : résolu par LLMNR/NetBIOS vers le réseau local) ; longueur ≤ 253.
6. Aucune autre règle sur le chemin ou la requête (bornés par la longueur).

`check_lan_url` : schéma `http` ou `https`, sans identifiants, hôte **IP littérale** de classe `Lan` (nom → `LanNotAllowed`, IP non `Lan` → `ForbiddenAddress`), bad ports refusés, longueur ≤ 2048. `check_tcp_target` : port 1..=65535 (pas de liste de ports refusés : connexion seule, rien n'est envoyé) ; hôte IP littérale (`Lan` → LAN, `Public` → public, sinon `ForbiddenAddress`) ou nom ASCII (règles du point 5, puis résolution publique au moment de la sonde).

### 6.3 Résolveur gardé (`net/resolver.rs`)
```rust
pub struct GuardedResolver;   // résolution publique seulement
impl reqwest::dns::Resolve for GuardedResolver { fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving; }
pub struct DenyAllResolver;   // client LAN : refuse tout nom (OH4)
/// Pur : vide → NotFound ; UNE adresse non Public → Forbidden (pas de filtrage partiel).
pub fn check_resolved(addrs: &[std::net::SocketAddr]) -> Result<(), ResolveError>;
/// Sondes TCP publiques et étape 3 de §5.3 : même règle, renvoie les adresses vérifiées.
pub async fn resolve_public(host: &str, port: u16) -> Result<Vec<std::net::SocketAddr>, ResolveError>;
#[derive(Debug)]
pub enum ResolveError { NotFound, Forbidden { all_lan: bool }, LocalName }   // impl std::error::Error + Display
```
- `resolve` : refuse d'abord `localhost`/`*.localhost` (`LocalName`), puis `tokio::net::lookup_host((name, 0))`, collecte, `check_resolved`, renvoie les adresses **inchangées**. reqwest se connecte alors à ces adresses (Happy Eyeballs sur la liste) : pas de seconde résolution, pas de fenêtre de rebinding.
- **Tout ou rien** : une réponse qui mêle public et privé est refusée (cas légitime rare ; il se règle par une sonde LAN).
- Le pool de connexions réutilise des connexions déjà vérifiées ; `pool_idle_timeout` reste à 90 s.
- Journalisation : genre d'erreur seulement, jamais le nom ni l'adresse.
- `ResolveError` traverse reqwest comme source de l'erreur ; `classify` (dans `net/mod.rs`) parcourt la chaîne `source()` et la classe en `ForbiddenAddress` / `LocalName` / `Dns` (S3). Si S3 est fausse : s'arrêter et rapporter (repli : appeler `resolve_public` avant l'envoi pour obtenir l'erreur typée, le résolveur gardé restant la barrière).

### 6.4 Redirections (`net/fetch.rs`)
Le client garde `Policy::none()` ; la boucle est écrite à la main pour revalider chaque saut avec la même politique :
```
url ← URL de la cible ; sauts ← 0
boucle :
  check_public_url(url)                          (littéraux, schéma, ports, noms locaux)
  réponse ← transport.send(GET url, en-têtes)    (le résolveur gardé s'applique aux noms)
  si statut ∈ {301, 302, 303, 307, 308} :
     si sauts = MAX_REDIRECTS (3) → TooManyRedirects
     Location absente, > 2048 octets, non UTF-8 ou non résoluble par url.join → InvalidRedirect
     suivante ← url.join(Location) ; fragment retiré
     url en https et suivante en http → InsecureRedirect
     url ← suivante ; sauts += 1 ; continuer (corps de la 3xx jamais lu)
  sinon sortir avec la réponse et l'URL finale
```
- Changement d'hôte permis s'il passe la politique (N7) ; l'URL stockée n'est **jamais** réécrite automatiquement (un 301 n'élargit pas le consentement). L'hôte final est renvoyé au front (`finalHost`) pour signaler un déménagement. Le régulateur par hôte (§8.5) porte sur l'hôte **de la cible** (un saut vers un autre hôte n'est pas régulé séparément : 3 sauts au plus).
- Méthode toujours `GET`, mêmes en-têtes à chaque saut ; aucun en-tête d'authentification ne transite par cette boucle (§10).
- Sondes : **aucune** redirection suivie (une 3xx est une réponse, donc « joignable »).

### 6.5 Proxy, cookies, TLS, en-têtes
- `no_proxy()` conservé (un proxy résoudrait le nom à notre place, hors du résolveur gardé) : N11 (S7).
- Pas de feature `cookies` : aucun magasin de cookies. Pas de `Referer`. Pas de HTTP/2 (feature absente), pas de compression (§3.7).
- TLS : `native-tls`, TLS ≥ 1.2, vérification du certificat **toujours active**, client public comme client LAN (N5).
- `User-Agent` : `Homebase/<version>` (inchangé ; aucune donnée personnelle, aucune URL de dépôt ni adresse de contact). Il n'est **jamais** remplacé par celui d'un navigateur pour passer un filtrage (§8.6).

---

## 7. Exception réseau local (NAS) et sondes

### 7.1 Principe
L'exception n'assouplit pas la politique publique : c'est un **second client**, utilisé seulement par `probe_run` pour une cible `scope = lan`, qui ne peut joindre **que l'IP littérale consentie** de cette cible.
- Cible LAN = IP littérale de classe `Lan` (RFC 1918, CGNAT/Tailscale, ULA) + port + protocole (`tcp`, `http`, `https`) [+ chemin pour HTTP]. Pas de nom d'hôte (N3) : rien à résoudre, donc ni rebinding ni dépendance au DNS local.
- Jamais pour un flux (un flux servi par le NAS n'est pas prévu ; à rouvrir par amendement si besoin).
- Boucle locale, link-local, multicast : refusés même en exception (N4).

### 7.2 Client LAN
Construit comme le client public, sauf :
```rust
reqwest::Client::builder()
    .https_only(false)                       // http permis pour une cible LAN
    .redirect(reqwest::redirect::Policy::none())
    .dns_resolver(DenyAllResolver)           // aucune résolution : la cible est une IP littérale
    .connect_timeout(PROBE_CONNECT_TIMEOUT)  // 3 s
    .timeout(PROBE_TOTAL_TIMEOUT)            // 5 s
    .user_agent(USER_AGENT)
    .no_proxy()
    .referer(false)
    .tls_version_min(reqwest::tls::Version::TLS_1_2)
    .tls_backend_native()
    .build()
```
`DenyAllResolver` refuse tout nom : même une erreur de programmation ne peut pas faire résoudre un nom par ce client. Avant chaque envoi : `check_lan_url(url)` **et** égalité stricte entre l'URL envoyée et l'URL stockée de la cible.

### 7.3 Sonde TCP (`probe/tcp.rs`)
- Adresse : LAN → `SocketAddr` de l'IP littérale ; public → `resolve_public(host, port)` (premier `SocketAddr`, puis le suivant en cas d'échec, 2 essais au plus).
- `tokio::time::timeout(3 s, TcpStream::connect(addr))` ; succès → fermeture immédiate (`drop`), rien n'est écrit ni lu.
- Résultat : joignable ou non, latence = durée du `connect` (ms, `std::time::Instant`), genre d'échec (`refused`, `timeout`, `unreachable`, `dns`, `forbidden_address`, `network`).

### 7.4 Sonde HTTP (`probe/http.rs`)
- `GET` (pas `HEAD`, mal géré par certains serveurs), `Accept: */*`, aucune redirection, aucun en-tête d'authentification.
- Dès les en-têtes reçus : relever le statut, mesurer la latence (jusqu'aux en-têtes), **abandonner la réponse sans lire le corps** (`drop`).
- Résultat : `reachable = true` dès qu'une réponse HTTP arrive, quel que soit le statut ; `httpStatus` renvoyé. Le classement « en ligne / dégradé / hors ligne » est une règle d'affichage du widget (proposition pour sa mini-spec : 2xx-3xx en ligne ; 401/403 en ligne « protégé » ; autres 4xx et 5xx dégradé ; pas de réponse hors ligne).
- HTTPS LAN : certificat vérifié (N5). Un NAS en certificat auto-signé se sonde en TCP sur son port HTTPS, ou en HTTP.
- Les sondes publiques passent aussi par le régulateur par hôte (§8.5).

---

## 8. Limites, débit et comportement réseau

### 8.1 Constantes
| Constante | Valeur | Portée |
|---|---|---|
| `CONNECT_TIMEOUT` / `TOTAL_TIMEOUT` | 5 s / 10 s (inchangés) | client public, météo |
| `FEED_TOTAL_TIMEOUT` | 15 s par requête (`RequestBuilder::timeout`) | flux |
| `FEED_DEADLINE` | 30 s pour toute la chaîne de redirections (`tokio::time::timeout`), attente du régulateur non comprise | flux |
| `PROBE_CONNECT_TIMEOUT` / `PROBE_TOTAL_TIMEOUT` | 3 s / 5 s | sondes |
| `MAX_REDIRECTS` | 3 | flux |
| `FEED_MAX_BYTES` | 4 Mio, lus en flux (`read_limited`) ; `Content-Length` annoncé au-delà refusé avant lecture | flux |
| `MAX_CONCURRENT_REQUESTS` | 4 (inchangé, partagé météo + flux) | client public |
| `MAX_CONCURRENT_PROBES` | 4 (sémaphore distinct : une sonde LAN qui pend ne bloque pas les flux) | sondes |
| `FEED_MIN_INTERVAL` | **30 min** entre deux requêtes réseau d'une même source (N16) ; `force` : 2 min | flux |
| `HOST_MIN_SPACING` | **60 s** entre deux requêtes réseau vers le même hôte, toutes cibles confondues (flux et sondes publiques ; pas la météo, à hôte fixe) | public |
| `HOST_MAX_WAIT` | 150 s : au-delà, `throttled` plutôt qu'attendre | public |
| `PROBE_MIN_INTERVAL` | 30 s par cible (le régulateur par hôte s'applique aussi aux sondes publiques) | sondes |
| `BACKOFF` | après n échecs consécutifs d'une source : min(2^(n-1) × 5 min, 2 h) ; `force` ne l'annule pas | flux |
| `RETRY_AFTER` | 429 ou 503 : `Retry-After` en secondes entières borné à [60 s, 6 h] ; absent, en date HTTP ou illisible → **15 min** ; appliqué à **l'hôte** | public |
| `CHALLENGE_BACKOFF` | 1 h pour l'hôte (§8.6) | public |
| `MAX_TARGETS` | 50 | liste autorisée |

### 8.2 Types de contenu acceptés (flux)
`Accept: application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/xml;q=0.9`. Acceptés (partie avant `;`, casse ignorée) : `application/rss+xml`, `application/atom+xml`, `application/rdf+xml`, `application/xml`, `text/xml`, `application/feed+json`, `application/json`. `text/html` → `not_a_feed` (cas typique : l'URL du site au lieu de celle du flux ; pas d'autodécouverte, N10), sauf défi détecté (§8.6). Absent ou autre → `invalid_response`.

### 8.3 Requêtes conditionnelles
- Validateurs `ETag` et `Last-Modified` de la dernière réponse 200 gardés **en mémoire**, renvoyés en `If-None-Match` / `If-Modified-Since` (valeur reprise telle quelle si ≤ 256 octets d'ASCII visible, sinon ignorée). Ils sont perdus au redémarrage (une requête complète par source au lancement, sans conséquence : l'historique est en base).
- 304 : l'historique n'est pas modifié ; la réponse est construite depuis l'historique avec `notModified: true`. Un validateur n'est envoyé que si un état mémoire existe ; un 304 reçu sans validateur envoyé est traité comme `invalid_response`.

### 8.4 Hors ligne, veille, changement d'heure
- Aucune détection « hors ligne » côté Rust : DNS ou connexion en échec → `dns`/`network`, délai → `timeout` ; le recul évite les rafales.
- `feed_fetch` en échec réseau ne renvoie pas l'historique : le front garde le dernier instantané reçu ; au démarrage hors ligne, il peut afficher l'historique par `feed_items` (§11.1), qui ne fait aucune requête.
- Intervalles mesurés sur l'horloge injectée (`time::clock::Clock`, UTC) : un recul de l'horloge (instant courant antérieur au dernier essai) rend l'intervalle **écoulé** (pas de blocage) ; une sortie de veille aussi. Changement d'heure sans effet (instants UTC, `Retry-After` en secondes).

### 8.5 Régulateur par hôte, concurrence et doublons (`net/host_gate.rs`)
```rust
pub struct HostGate { /* Mutex<HashMap<String, HostState { next_slot_at, blocked_until }>> */ }
impl HostGate {
    /// Réserve le prochain créneau de l'hôte : Ok(attente) si ≤ HOST_MAX_WAIT et hôte non bloqué,
    /// Err(retry_after_ms) sinon. La réservation avance next_slot_at de HOST_MIN_SPACING.
    pub fn reserve(&self, host: &str, now: Timestamp) -> Result<std::time::Duration, u64>;
    /// 429/503 (Retry-After) ou défi : bloque l'hôte jusqu'à now + durée (jamais en arrière).
    pub fn block(&self, host: &str, until: Timestamp);
}
```
- Ordre dans `feed_fetch` : verrou de la cible → intervalle et recul de la source → `HostGate::reserve` (attente par `tokio::time::sleep` si besoin, au plus 150 s) → requête. Au démarrage, les trois flux hypixel.net partent donc à 0, 60 et 120 s.
- Une requête en vol par cible : `tokio::sync::Mutex` par identifiant ; un second appel attend, puis trouve l'état frais et répond sans requête.
- État mémoire par cible : `{ etag, last_modified, last_attempt_at, next_allowed_at, failures }`, vidé à la suppression ; perdu à l'arrêt de l'app. L'historique, lui, est en base (§9.7).
- Pendant l'intervalle, le recul ou un blocage d'hôte : réponse construite depuis l'historique (`fromCache: true`) s'il contient au moins un article ou si un appel a déjà réussi depuis le démarrage ; sinon `throttled { retryAfterMs }`.

### 8.6 Défi anti-robot (Cloudflare) et blocages
- Détection (pure, testée) : en-tête `cf-mitigated: challenge`, **ou** statut 403/429/503 avec `Content-Type: text/html` et en-tête `server: cloudflare`. → erreur `blocked`, hôte bloqué `CHALLENGE_BACKOFF` (1 h).
- **Jamais de contournement** : pas de `User-Agent` de navigateur, pas d'exécution de JavaScript, pas de cookie de défi, pas de service tiers. Si S10 se révèle fausse pour Hypixel, la suite (renoncer, ou demander au site un accès) est une décision produit à remonter, pas une adaptation de l'implementer.
- Le corps d'une réponse de défi n'est pas lu.

---

## 9. Flux RSS/Atom : parsing, assainissement, filtre, historique (côté Rust)

### 9.1 Chaîne
`read_limited` (4 Mio) → détection du format (premier caractère non blanc après un BOM éventuel : `<` → XML, `{` → JSON, autre → `invalid_response`) → **pré-analyse XML** (§9.2) → `feed-rs` (dans `spawn_blocking` : travail CPU) → réduction aux articles (§9.3) → texte nettoyé (§9.4) → **filtre** de la source (§9.6) → **fusion dans l'historique** (§9.7) → lecture de l'historique filtré → DTO.

### 9.2 Pré-analyse XML (`feed/prescan.rs`, obligatoire, F8)
Passe en flux avec `quick_xml::Reader` (pas `NsReader`, pas de résolution d'espaces de noms), sans construire d'arbre :
| Contrôle | Limite | Erreur |
|---|---|---|
| Profondeur d'éléments | ≤ 64 | `invalid_response` |
| Nombre d'éléments | ≤ 100 000 | `invalid_response` |
| Attributs par élément | ≤ 64 (itération avec `with_checks(false)` : on compte, sans contrôle de doublon) | `invalid_response` |
| `DOCTYPE` avec sous-ensemble interne (`[` dans le contenu du DOCTYPE) | refusé (déclarations d'entités) | `invalid_response` |
| `DOCTYPE` externe simple (RSS 0.91 Netscape) | accepté (ignoré par feed-rs) | |
| Erreur de syntaxe XML | | `invalid_response` |

JSON Feed : pas de pré-analyse (limite de récursion de `serde_json` = 128, taille déjà bornée).

### 9.3 Articles produits
Champs (tous en texte nettoyé §9.4, bornés) :

| Champ | Source feed-rs | Règle |
|---|---|---|
| `title` (du flux) | `feed.title` | ≤ 200 caractères, `null` si vide |
| `siteUrl` | premier lien du flux de `rel` absent ou `alternate` | règle des liens ci-dessous, sinon `null` |
| `id` | `entry.id` | **SHA-256 hexadécimal tronqué à 32 caractères** de l'identifiant brut (jamais l'identifiant lui-même) ; doublons dans un même flux : le premier gagne |
| `title` | `entry.title` | ≤ 300 caractères ; `null` si vide (le front affiche « Sans titre ») |
| `url` | lien de `rel` absent ou `alternate`, sinon premier lien (S8) | règle des liens |
| `publishedAt` | `published`, sinon `updated` | `format_instant` UTC ; `null` si avant `1990-01-01` ou après maintenant + 2 jours |
| `excerpt` | `summary`, sinon `content` | converti (§9.4), ≤ 500 caractères (coupé sur une fin de mot, suivi de « … ») |
| `author` | `entry.authors` (F15) | **règle de l'auteur** ci-dessous, ≤ 100 caractères |

**Règle de l'auteur** (`feed/author.rs`, pure) :
1. Candidats dans l'ordre : le premier `Person` de rôle `creator` (`dc:creator`), puis le premier de rôle `author` (RSS `<author>`, Atom `<author>`), puis le premier `Person` quelconque.
2. Pour un candidat, texte brut = `name` (et `email` s'il est séparé et que `name` est vide).
3. Normalisation : si le texte a la forme `<adresse> (<nom>)` (adresse = suite sans espace contenant `@`, parenthèses finales), garder `<nom>` ; si le texte n'est qu'une adresse (contient `@`, sans espace), le candidat est **vide** (aucune adresse électronique renvoyée au front) ; puis `clean_text`.
4. Premier candidat non vide → `author` ; aucun → `null`.
Exemples : `dc:creator` « Hypixel Team » → « Hypixel Team » ; `<author>` seul « invalid@example.com (Hypixel Team) » → « Hypixel Team » ; « jdoe@example.com » seul → `null`.

- Au plus 100 entrées lues dans l'ordre du document.
- Ignorés volontairement : contenu complet, images, médias (enclosures, MediaRSS), catégories, commentaires.

**Règle des liens** (`feed/links.rs`, pure) : résolution relative contre l'URL **finale** du flux ; puis `parse_target_url` ; schéma `http` ou `https` seulement (`javascript:`, `data:`, `file:`, `mailto:`… → `null`) ; sans identifiants ; ≤ 2048 ; hôte IP littérale non `Public`, ou nom `localhost`/`*.localhost`/sans point → `null` (un clic ne doit pas viser le routeur). Le front ouvre ces liens par `UrlOpener` (permission `open-url`), qui revalide (`parseWebUrl`).

### 9.4 Nettoyage du texte (`feed/text.rs`, pur)
- `html_to_text(input: &str) -> String` : automate en une passe, sans récursion. Contenu de `script`, `style`, `template`, `noscript`, `iframe`, `object`, `svg`, `math` supprimé ; balises retirées ; `br`, `p`, `div`, `li`, `tr`, `h1` à `h6` → espace ; balise non fermée en fin de texte → retirée jusqu'à la fin ; entités décodées : 5 entités XML, références numériques décimales et hexadécimales (valeur 0, surrogate ou > U+10FFFF → U+FFFD), table fermée d'entités HTML courantes (`nbsp`, `eacute`, `egrave`, `ecirc`, `agrave`, `acirc`, `ccedil`, `ocirc`, `ucirc`, `ugrave`, `icirc`, `iuml`, `euml`, `rsquo`, `lsquo`, `ldquo`, `rdquo`, `laquo`, `raquo`, `hellip`, `mdash`, `ndash`, `euro`, `copy`, `reg`, `trade`, `deg`, `middot`, `bull`) ; entité inconnue → laissée telle quelle.
- `clean_text(input: &str, max_chars: usize) -> Option<String>` (appliqué à **tous** les champs texte, y compris après `html_to_text`) : suppression des caractères de contrôle (`char::is_control`), des formatages bidirectionnels (U+202A à U+202E, U+2066 à U+2069), de U+200B à U+200F, U+2028, U+2029, U+FEFF ; tout espace Unicode (`char::is_whitespace`, dont U+00A0) remplacé par une espace, suites réduites à une ; `trim` ; vide → `None` ; troncature en points de code, à la dernière espace si elle est dans les 20 derniers caractères, suivie de « … » (le total reste ≤ `max_chars`).
- Le choix texte brut / HTML est N6. **Invariant quel que soit N6** : le front n'utilise jamais `innerHTML`, `[innerHTML]`, `outerHTML`, `insertAdjacentHTML` ni `DomSanitizer.bypassSecurityTrust*` (garde CA-OH3-8).

### 9.5 Contrainte CSP
Aucune image ni ressource distante : `img-src 'self' data:` et `connect-src` inchangés. Les favicons des sites ne sont pas affichées (icône locale générique).

### 9.6 Filtre par source (`feed/filter.rs`, pur ; N15)
```rust
pub struct FeedFilter {
    /// Vide = tous les auteurs. Comparaison après normalisation (§9.3) : trim, insensible à la casse (Unicode simple : to_lowercase).
    pub authors: Vec<String>,          // 0 à 10 entrées, 1 à 100 caractères chacune, sans contrôle ni bidi
    /// Vide = aucun critère de titre. Article retenu si son titre CONTIENT l'un des fragments (insensible à la casse).
    pub title_contains: Vec<String>,   // 0 à 10 entrées, 1 à 100 caractères chacune
}
pub fn matches(filter: &FeedFilter, item: &FeedItem) -> bool;
```
- Règle : (`authors` vide **ou** `author` non nul et égal à l'un d'eux) **et** (`title_contains` vide **ou** `title` non nul contenant l'un d'eux). Un article sans auteur est écarté dès qu'un filtre d'auteur existe.
- Fragments de titre en **sous-chaîne**, pas en expression régulière (lisible pour Marius, aucun risque de motif pathologique, aucun échappement à expliquer).
- Le filtre est enregistré avec la source (§12, `feed_filters`), modifié par `feed_filter_set` (sans dialogue : il ne change pas ce qui est contacté). Il s'applique **avant** l'enregistrement dans l'historique et **à la lecture** : un article écarté n'entre pas dans l'historique (N15) ; un filtre resserré masque aussi les articles déjà enregistrés qui ne passent plus (ils restent en base jusqu'à l'élagage, et réapparaissent si le filtre est rétabli).
- Exemple Hypixel : `skyblock-alpha` → `{ authors: ["Hypixel Team"], titleContains: [] }` ; les deux autres flux sans filtre.

### 9.7 Historique (`feed/history.rs` + stockage, N8)
- Table Rust seulement `feed_items` (§12) : un article par `(target_id, item_id)`.
- Fusion après chaque 200 : pour chaque article retenu par le filtre, insertion s'il est nouveau (`first_seen_at` = maintenant), sinon mise à jour de `title`, `url`, `published_at`, `excerpt`, `author`, `last_seen_at` (le serveur a pu corriger un titre) ; `first_seen_at` conservé. Un article disparu du flux **reste** dans l'historique.
- Élagage : au plus **200** articles par source ; au-delà, suppression des plus anciens par `COALESCE(published_at, first_seen_at)` puis `first_seen_at`. Fusion et élagage dans **une** transaction.
- Lecture : articles de la source qui passent le filtre courant, triés par `COALESCE(published_at, first_seen_at)` décroissant, puis `first_seen_at` décroissant ; **50** renvoyés.
- Revalidation à la lecture : chaque ligne relue repasse les bornes de §9.3 et `clean_text` ; ligne invalide → ignorée.
- Pas d'état lu/non lu (mini-spec RSS) ; pas d'export JSON de l'historique (contenu public, reconstructible) ; inclus dans les sauvegardes de la base (comme toute table).

---

## 10. Secrets (principes fixés maintenant, implémentation en phase 6)

- Stockage : **gestionnaire d'identifiants Windows**, côté Rust seulement (crate `keyring` 4.x avec le magasin Windows, ou API Win32 `CredWriteW`/`CredReadW` directe : N14). Nom de cible `homebase/<usage>` (ex. `homebase/github`). Jamais en base, jamais dans `settings`, jamais dans les exports (le coffre est hors du dossier de données), jamais dans les journaux.
- Saisie : un champ de l'interface transmet le jeton **une fois** à `secret_set(kind, value)` ; aucune commande ne le relit (`secret_status(kind) → { present: bool }`, `secret_delete(kind)`). Risque accepté : le jeton transite par la WebView au moment de la saisie.
- Usage : attaché **uniquement** à un `Endpoint` fixe (ex. `GitHubApi`, hôte `api.github.com`), appelé sans redirection (`Policy::none()`, une 3xx = erreur) ; jamais à une cible de `net_targets` ; jamais dans une URL (en-tête `Authorization` seulement) ; valeur d'en-tête marquée sensible (`HeaderValue::set_sensitive(true)`).
- Erreurs : `401`/`403` → `unauthorized` sans détail ; le jeton n'apparaît dans aucune erreur ni charge renvoyée.
- Permission de widget `secrets` : à ajouter à l'ADR-001 §3.8 par amendement au moment de GitHub (point ouvert 3 de l'ADR-001).

---

## 11. Contrat IPC (figé avant tout lot ; ne change pas sans amender cette spec)

Erreurs : objet `{ "kind": <snake_case>, … }` (comme `WeatherError`). Toutes les commandes sont `async`.

### 11.1 Commandes
| Commande | Arguments (JS) | Succès | Lot |
|---|---|---|---|
| `net_target_list` | `{}` | `NetTarget[]` (ordre `created_at` croissant) | OH2 |
| `net_target_request` | `{ input: NetTargetInput }` | `NetTarget` créée (après dialogue) | OH2 |
| `net_target_rename` | `{ id: string, label: string }` | `NetTarget` | OH2 |
| `net_target_delete` | `{ id: string }` | `null` (idempotent : absente → `null`) | OH2 |
| `net_target_consent` | `{ id: string }` | `NetTarget` (dialogue natif pour une cible à `consentedAt: null`) | OH2, **seulement si N9 = a** |
| `feed_fetch` | `{ targetId: string, force: boolean }` | `FeedSnapshot` | OH3 |
| `feed_items` | `{ targetId: string }` | `FeedSnapshot` construit depuis l'historique, **sans requête réseau** (`fromCache: true`) | OH3 |
| `feed_filter_set` | `{ targetId: string, filter: FeedFilter \| null }` | `FeedFilter \| null` enregistré (`null` = aucun filtre) | OH3 |
| `probe_run` | `{ targetId: string }` | `ProbeResult` | OH4 |

### 11.2 Entrées
```ts
type NetTargetInput =
  | { kind: 'feed'; url: string; label?: string }
  | { kind: 'http_probe'; url: string; label?: string }
  | { kind: 'tcp_probe'; host: string; port: number; label?: string };
interface FeedFilter { authors: string[]; titleContains: string[] }
```
- `url` : ≤ 2048 caractères après `trim`, politique §6.2 ; `host` : 1 à 253 caractères ; `port` : entier 1..65535 ; `label` : `trim`, 1 à 100 caractères, sans caractère de contrôle ni bidi ; absent → hôte affiché (ASCII).
- `FeedFilter` : bornes §9.6 après `trim` ; doublons (insensibles à la casse) retirés ; deux listes vides équivalent à `null`.
- `id`, `targetId` : UUID v4 en minuscules (forme vérifiée avant toute requête SQL), sinon `invalid_input`.
- Clés inconnues refusées (S9) : un `scope` envoyé par le front donne `invalid_input`.

### 11.3 Sorties (clés camelCase exactes)
```jsonc
// NetTarget
{ "id": "…uuid…", "kind": "feed", "scope": "public", "label": "SkyBlock Alpha",
  "url": "https://hypixel.net/skyblock-alpha/index.rss", "host": "hypixel.net", "port": null,
  "consentedAt": "2026-11-25T10:00:00.000Z", "createdAt": "…", "updatedAt": "…" }

// FeedSnapshot
{ "targetId": "…", "fetchedAt": "2026-11-25T10:00:00.000Z", "fromCache": false, "notModified": false,
  "finalHost": "hypixel.net", "title": "SkyBlock Alpha", "siteUrl": "https://hypixel.net/skyblock-alpha/",
  "filter": { "authors": ["Hypixel Team"], "titleContains": [] },
  "items": [ { "id": "3f2a…(32 hex)", "title": "…", "url": "https://hypixel.net/threads/…", "publishedAt": "…Z",
               "firstSeenAt": "…Z", "excerpt": "…", "author": "Hypixel Team" } ] }

// ProbeResult
{ "targetId": "…", "checkedAt": "…Z", "fromCache": false, "reachable": true,
  "latencyMs": 12, "httpStatus": 200, "failure": null }
```
- `NetTarget.url` : présent pour `feed` et `http_probe`, `null` pour `tcp_probe` ; `port` : nombre pour `tcp_probe`, `null` sinon ; `consentedAt` : instant ou `null` (N9). L'URL d'une cible est une donnée saisie par Marius, pas un secret.
- `FeedSnapshot` : `fetchedAt` = instant du dernier succès réseau de la source (ou `null` si aucun depuis le démarrage, pour `feed_items`) ; `title`, `siteUrl`, `finalHost` : ceux du dernier succès depuis le démarrage, sinon `null` ; `items` : 0 à 50 articles de l'historique filtré (§9.7).
- `ProbeResult.failure` : `null` si joignable, sinon `"refused" | "timeout" | "unreachable" | "dns" | "tls" | "forbidden_address" | "blocked" | "network"`. **Une cible injoignable n'est pas une erreur** : `probe_run` résout normalement avec `reachable: false`. `httpStatus` : `null` pour une sonde TCP ou sans réponse. `latencyMs` : entier ≥ 0, `null` si injoignable.

### 11.4 Erreurs (rejet de `invoke`)
| `kind` | Champs | Commandes | Sens |
|---|---|---|---|
| `invalid_input` | `field` | toutes | Entrée refusée (forme, longueur, clé inconnue) |
| `forbidden_url` | `reason`: `invalid` \| `scheme` \| `credentials` \| `too_long` \| `port` \| `local_name` \| `single_label` \| `lan_not_allowed` | request | Politique d'URL (§6.2) |
| `forbidden_address` | — | request, fetch | IP littérale ou résolue interdite (§6.1) |
| `private_name` | — | request | Nom qui résout vers le réseau local : saisir l'IP (N3) |
| `dns` | — | request, fetch | Nom introuvable |
| `already_exists` | `id` | request | Doublon |
| `limit_reached` | — | request | 50 cibles |
| `declined` | — | request, consent | Refus dans le dialogue |
| `dialog_busy` | `retryAfterMs` | request, consent | Dialogue déjà ouvert, ou refus récent (§5.4) |
| `window_hidden` | — | request, consent | Fenêtre principale cachée |
| `not_found` | — | rename, consent, fetch, items, filter, run | Cible absente (ou ligne invalide à la relecture, §12) |
| `not_consented` | — | fetch, run | Cible à `consentedAt: null` (N9 = a seulement) |
| `wrong_kind` | — | fetch, items, filter, run | Commande de flux sur une sonde, ou l'inverse |
| `client_unavailable` | — | fetch, run | Client HTTP non construit |
| `network`, `timeout` | — | fetch | Connexion, TLS, lecture ; délai |
| `upstream_status` | `status`, `retryAfterMs?` | fetch | Statut hors 2xx et 304 (`retryAfterMs` pour 429/503) |
| `blocked` | `retryAfterMs` | fetch | Défi anti-robot détecté (§8.6) |
| `too_many_redirects`, `insecure_redirect` | — | fetch | §6.4 |
| `too_large` | — | fetch | > 4 Mio |
| `not_a_feed` | — | fetch | `text/html` |
| `invalid_response` | — | fetch | Content-Type, redirection illisible, pré-analyse, parsing, 304 inattendu |
| `throttled` | `retryAfterMs` | fetch, run | Intervalle, recul ou blocage d'hôte, sans historique à renvoyer |
| `storage` | — | toutes | Erreur SQLite (forme exacte : convention de typed-data-commands, §20) |

Le front ajoute `unavailable` (hors Tauri) et `unknown` (rejet non conforme), comme la météo.

---

## 12. Persistance (couplage avec `typed-data-commands`, §20)

Trois tables, **Rust seulement** (aucun dépôt `data/sqlite` ne les lit ; garde par test comme V7/V8), dans **une** migration :
```sql
-- V<n>__net_targets.sql  (numéro attribué par le coordinateur selon l'ordre de fusion ; texte figé en revue)
CREATE TABLE net_targets (
  id           TEXT PRIMARY KEY CHECK (length(id) = 36),
  kind         TEXT NOT NULL CHECK (kind IN ('feed', 'http_probe', 'tcp_probe')),
  scope        TEXT NOT NULL CHECK (scope IN ('public', 'lan')),
  url          TEXT CHECK (url IS NULL OR length(url) BETWEEN 1 AND 2048),
  host         TEXT NOT NULL CHECK (length(host) BETWEEN 1 AND 253),
  port         INTEGER CHECK (port IS NULL OR port BETWEEN 1 AND 65535),
  label        TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 100),
  consented_at TEXT,                       -- NULL : à confirmer (import JSON, N9 = a)
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  CHECK ((kind = 'tcp_probe') = (url IS NULL)),
  CHECK ((kind = 'tcp_probe') = (port IS NOT NULL)),
  CHECK (NOT (kind = 'feed' AND scope = 'lan'))
);
CREATE UNIQUE INDEX net_targets_identity ON net_targets (kind, COALESCE(url, ''), host, COALESCE(port, 0));

CREATE TABLE feed_filters (
  target_id      TEXT PRIMARY KEY REFERENCES net_targets(id) ON DELETE CASCADE,
  authors        TEXT NOT NULL CHECK (json_valid(authors) AND json_type(authors) = 'array'),
  title_contains TEXT NOT NULL CHECK (json_valid(title_contains) AND json_type(title_contains) = 'array'),
  updated_at     TEXT NOT NULL
);

CREATE TABLE feed_items (
  target_id     TEXT NOT NULL REFERENCES net_targets(id) ON DELETE CASCADE,
  item_id       TEXT NOT NULL CHECK (length(item_id) = 32),
  title         TEXT CHECK (title IS NULL OR length(title) <= 300),
  url           TEXT CHECK (url IS NULL OR length(url) <= 2048),
  published_at  TEXT,
  excerpt       TEXT CHECK (excerpt IS NULL OR length(excerpt) <= 500),
  author        TEXT CHECK (author IS NULL OR length(author) <= 100),
  first_seen_at TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  PRIMARY KEY (target_id, item_id)
);
CREATE INDEX feed_items_order ON feed_items (target_id, COALESCE(published_at, first_seen_at) DESC);
```
- Clés étrangères : vérifier que `PRAGMA foreign_keys = ON` est actif sur la connexion Rust utilisée (convention typed-data-commands, C1) ; sinon, supprimer explicitement `feed_filters` et `feed_items` dans la même transaction que la cible. Un test le vérifie.
- `host` : forme ASCII (punycode) ou IP littérale normalisée (IPv6 sans crochets).
- **Revalidation à la lecture** (défense en profondeur ; une base peut avoir été restaurée) : chaque cible relue repasse `parse_target_url` + `check_public_url`/`check_lan_url` (ou `check_tcp_target`) et la cohérence `scope`/`host`/`url` ; chaque filtre ses bornes ; chaque article ses bornes. Ligne invalide → ignorée (journal : genre seulement), `not_found` pour les commandes qui visent une cible invalide.
- Si N9 = a : `consented_at IS NULL` → `feed_fetch`/`probe_run` refusent avec `not_consented` ; `net_target_consent(id)` rouvre le dialogue (§5.3, étapes 3 à 5) puis renseigne `consented_at`.
- Validateurs HTTP en mémoire seulement (§8.3).

---

## 13. Capabilities, CSP, garde-fous, bundle

- `build.rs` (`AppManifest::commands`) et **les deux** `invoke_handler` : + `net_target_list`, `net_target_request`, `net_target_rename`, `net_target_delete` (+ `net_target_consent` si N9 = a) (OH2) ; `feed_fetch`, `feed_items`, `feed_filter_set` (OH3) ; `probe_run` (OH4). Fichiers `permissions/autogenerated/<commande>.toml` générés et commités.
- `default.json` : + `allow-net-target-list`, `allow-net-target-request`, `allow-net-target-rename`, `allow-net-target-delete` (+ `allow-net-target-consent`), `allow-feed-fetch`, `allow-feed-items`, `allow-feed-filter-set`, `allow-probe-run`, placées après `allow-weather-geocode`, dans cet ordre. Description complétée, **sans nom d'hôte** : « The net_target_* commands manage the outbound allowlist (net_targets, Rust only); adding a target requires a native consent dialog opened from Rust. feed_* and probe_run only take a target id, never a URL; public connections go through a resolver that refuses non-public addresses and a per-host rate limiter, LAN probes only reach the consented IP literal. Feed history and filters live in Rust-only tables. Still no http:* permission; the CSP connect-src stays local. »
- **Aucune** permission `dialog:*`, `http:*`, `core:*` ajoutée ; `debug.json` et `tauri.conf.json` (CSP) **inchangés**.
- `capability_tests.rs` (en plus des gardes existantes ou durcies par typed-data-commands) :
  - liste exacte mise à jour ;
  - `outbound_commands_take_no_url` : dans `src/feed/mod.rs` et `src/probe/mod.rs`, aucune fonction annotée `#[tauri::command]` n'a de paramètre nommé `url`, `host` ou `port` (lecture du source) ;
  - `lan_client_is_only_used_by_probes` : l'identifiant `lan_client` n'apparaît que dans `src/net/` et `src/probe/` (parcours des fichiers `src/**/*.rs`) ;
  - `no_dangerous_tls_or_proxy` : aucun `danger_accept_invalid` ni `.proxy(` dans `src/` ; reqwest sans feature `gzip`, `brotli`, `zstd`, `deflate`, `cookies`, `http2`, `system-proxy`, `rustls`, `default-tls` dans `Cargo.toml` ; pas de `tauri-plugin-http` ; `feed-rs` sans feature `sanitize` ;
  - `no_hardcoded_feed_hosts` : aucun `hypixel.net` dans `src/**/*.rs` hors `fixtures` et tests (les sources sont des données de Marius).
- Front : garde de lint `apps/web/scripts/check-no-raw-html.mjs`, branchée dans `npm run lint` : aucun `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `bypassSecurityTrust` dans `apps/web/src/app/**` hors `*.spec.ts` (les specs gardent `document.body.innerHTML = ''`).
- Bundle front : `core/feeds`, `core/probes` importés seulement par leurs widgets (chunks paresseux) ; dépôt `NetTargetRepository` chargé à la demande comme les dépôts todo/notes (arbitrage R5) ; la garde de CI sur le bundle initial reste verte.
- Binaire Rust : taille de l'installateur NSIS mesurée avant/après OH3 (feed-rs, `mediatype`, `uuid`), notée dans le rapport.
- `cargo audit` vert après chaque lot ; aucune exception ajoutée sans décision du coordinateur.

---

## 14. Cas limites

| # | Cas | Comportement |
|---|---|---|
| L1 | URL de flux `http://…` | `forbidden_url { reason: scheme }` (N2) |
| L2 | `https://192.168.1.10/feed` saisi comme flux | `forbidden_url { reason: lan_not_allowed }` |
| L3 | `http://NAS/`, `https://nas.local/` comme sonde | `single_label` ; `private_name` (nas.local résout en privé) ; message « saisissez l'adresse IP » |
| L4 | `https://localtest.me/` (DNS public → 127.0.0.1) | `forbidden_address` à l'ajout, et à chaque connexion si le DNS change |
| L5 | `https://[::ffff:127.0.0.1]/`, `https://2130706433/`, `https://0x7f.1/`, `https://[::1]/`, `https://0.0.0.0/` | `forbidden_address` |
| L6 | DNS qui renvoie une IP publique et une privée | `forbidden_address` (tout ou rien) |
| L7 | Rebinding : public à l'ajout, privé ensuite | `forbidden_address` à la requête suivante |
| L8 | Redirection vers `http://`, vers `https://127.0.0.1`, vers `https://10.0.0.1`, 4e saut, boucle A→B→A | `insecure_redirect` ; `forbidden_address` ; `forbidden_address` ; `too_many_redirects` |
| L9 | 301 permanent vers un autre hôte public | Suivi ; `finalHost` différent ; URL stockée inchangée |
| L10 | Réponse de 5 Mio, `Content-Length` menteur, corps sans fin | `too_large` ; `too_large` ; `timeout` (15 s par requête, 30 s au total) |
| L11 | XML à 10 000 niveaux, DTD interne (« billion laughs »), 10 000 attributs | `invalid_response` par la pré-analyse, sans appeler feed-rs |
| L12 | Flux déclaré en ISO-8859-1 / windows-1252 | Décodé (quick-xml `encoding`) ; octets invalides → `invalid_response` |
| L13 | `<script>`, `onerror=`, `javascript:` dans titre, description ou lien | Texte brut (balises retirées, contenu de `script` supprimé) ; lien → `null` |
| L14 | Titre de 1 Mo, 5 000 entrées, dates en 1970 ou 2099, identifiants en double, entrée sans identifiant | Tronqué à 300 ; 100 lues, 50 renvoyées ; `publishedAt: null` ; premier gardé ; identifiant fourni par feed-rs puis haché |
| L15 | Flux sans entrée | Historique inchangé ; succès |
| L16 | Deux widgets RSS sur la même source | Même cible, même filtre, même historique, une requête |
| L17 | Double clic « Ajouter » | Second appel : `dialog_busy` ; si le premier a abouti : `already_exists` |
| L18 | Un script appelle `net_target_request` en boucle | Un dialogue à la fois, 10 s d'attente après un refus, rien sans clic ; fenêtre cachée → `window_hidden` |
| L19 | Suppression d'une cible pendant un `feed_fetch` | La requête se termine ; rien n'est enregistré (la fusion vérifie l'existence de la cible dans sa transaction) ; appels suivants `not_found` |
| L20 | Démarrage automatique avant le réseau | `dns`/`network` ; le front affiche l'historique (`feed_items`) ; recul ; relance sur `online` |
| L21 | 429 avec `Retry-After: 120` sur un flux hypixel.net | `upstream_status { status: 429, retryAfterMs: 120000 }` ; **les trois** flux de l'hôte attendent 2 min (réponse depuis l'historique entre-temps) |
| L22 | 429 sans `Retry-After` | Hôte bloqué 15 min |
| L23 | Trois flux du même hôte au démarrage | Requêtes espacées de 60 s (0, 60, 120 s) |
| L24 | Défi Cloudflare (`cf-mitigated: challenge`) | `blocked`, hôte bloqué 1 h, aucun contournement (§8.6) |
| L25 | `skyblock-alpha` : 20 articles dont 2 de « Hypixel Team » | 2 enregistrés ; les fils de joueurs jamais stockés ; au fil des semaines, l'historique accumule les notes officielles (200 max) |
| L26 | `<author>` seul au format « invalid@example.com (Hypixel Team) » | `author: "Hypixel Team"` |
| L27 | Auteur « hypixel team » (casse différente), ou « Hypixel Team » suivi d'une espace insécable | Retenu (comparaison insensible à la casse après `clean_text`) |
| L28 | Filtre d'auteur et article sans auteur | Écarté |
| L29 | Filtre modifié (ajout d'un auteur) | Effet aux prochaines récupérations ; les articles déjà écartés ne reviennent que s'ils sont encore dans le flux (N15) |
| L30 | Article modifié par le forum (titre corrigé) | Mis à jour, `firstSeenAt` conservé |
| L31 | Article retiré du flux | Reste dans l'historique jusqu'à l'élagage (200) |
| L32 | NAS éteint | `probe_run` → `{ reachable: false, failure: "timeout" \| "unreachable" \| "refused" }` (pas un rejet) |
| L33 | NAS en HTTPS auto-signé | `failure: "tls"` (N5) ; l'interface conseille une sonde TCP |
| L34 | IP du NAS changée (DHCP) | Sonde injoignable ; corriger = supprimer puis ajouter ; recommander une réservation DHCP |
| L35 | Changement d'heure, fuseau | Sans effet (instants UTC, intervalles sur instants, `Retry-After` en secondes) ; le front formate dans le fuseau de l'utilisateur |
| L36 | Horloge reculée | Intervalles considérés écoulés (§8.4) ; `HostGate` ne recule jamais un blocage |
| L37 | Import d'une configuration JSON contenant des cibles | N9 |
| L38 | Restauration d'une archive | Cibles, filtres et historique restaurés, revalidés à la lecture (§12) ; R6 |
| L39 | Hors Tauri (`npm run web:start`) | `unavailable`, aucun appel |
| L40 | Conflits de synchronisation | Sans objet (mono-poste, pas de synchro) |
| L41 | Proxy obligatoire sur le réseau | Échec `network` (N11) |

---

## 15. Découpage en lots (pour `implementer`, Sonnet)

### 15.0 Ordre et prérequis
| Lot | Contenu | Dépend de | Budget |
|---|---|---|---|
| **OH1** | Cœur `net` : adresses, politique d'URL, résolveur gardé, boucle de redirections sur transport abstrait, régulateur par hôte, détection de défi ; client public muni du résolveur ; météo inchangée | N2, N4, N7, N11, N16 | ~45 étapes |
| **OH2** | `net_targets` (+ `feed_filters`, `feed_items` dans la même migration) : stockage des cibles, consentement natif, commandes `net_target_*`, capabilities, dépôt front, page Réglages | OH1 ; **typed-data-commands fusionné** (accès Rust à la base, conventions `data/tauri`, tests de capabilities durcis) ; N1, N3, N9, N13 | ~40 étapes |
| **OH3** | Flux : feed-rs, pré-analyse, texte, auteur, liens, filtre, historique, `feed_fetch` / `feed_items` / `feed_filter_set`, `core/feeds` | OH2 ; N6, N8, N10, N15 | ~50 étapes (dépassement probable : découper OH3a parsing pur, OH3b historique + commandes + front si besoin) |
| **OH4** | Sondes : client LAN, TCP/HTTP, `probe_run`, `core/probes` | OH2 (OH3 non requis) ; N3, N4, N5, N12 | ~35 étapes |

OH1 peut être mené en parallèle de typed-data-commands (fichiers disjoints : `src/net/**`, `src/weather/open_meteo.rs`, `Cargo.toml`, `Cargo.lock`). OH3 et OH4 sont indépendants mais modifient tous deux `default.json`, `build.rs`, `lib.rs` et `capability_tests.rs` : **l'un après l'autre**. Au-delà du budget sans avoir fini : s'arrêter et rapporter.

Tests Rust : **aucun appel réseau sortant**. Les tests de bout en bout utilisent un `TcpListener` local sur `127.0.0.1` ; la logique de requête est testée par un transport factice.

### 15.1 Lot OH1 : cœur `net`
Fichiers (sous `apps/desktop/src-tauri/`) :
```
créer    src/net/address.rs        classify (§6.1) + tests
créer    src/net/url_policy.rs     §6.2, BAD_PORTS (liste Fetch), host_key + tests
créer    src/net/resolver.rs       GuardedResolver, DenyAllResolver, check_resolved, resolve_public + tests
créer    src/net/fetch.rs          HttpTransport, RawResponse, fetch_public (§6.4), parse_retry_after, is_challenge (§8.6) + tests
créer    src/net/host_gate.rs      HostGate (§8.5) + tests (FixedClock)
modifier src/net/mod.rs            sous-modules ; NetError étendu ; NetClient : .dns_resolver(GuardedResolver), HostGate géré ;
                                   classify() parcourt source() (S3) ; transport reqwest de production ; get_json inchangé
modifier src/weather/open_meteo.rs From<NetError> étendu (nouvelles variantes), contrat météo inchangé
modifier Cargo.toml                tokio features = ["sync", "net", "time"] (rien d'autre)
```
Interfaces :
```rust
// src/net/mod.rs
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NetError {
    Unavailable, Forbidden, Timeout, Network, Status(u16), TooLarge, UnexpectedContentType,
    ForbiddenUrl(UrlPolicyError), ForbiddenAddress, LocalName, Dns,
    TooManyRedirects, InsecureRedirect, InvalidRedirect, Challenge,
}

// src/net/fetch.rs
pub struct OutboundRequest<'a> {
    pub accept: &'static str,
    pub if_none_match: Option<&'a str>,
    pub if_modified_since: Option<&'a str>,
    pub timeout: std::time::Duration,
}
pub struct RawResponse<B> {
    pub status: u16, pub location: Option<String>, pub content_type: Option<String>,
    pub content_length: Option<u64>, pub etag: Option<String>, pub last_modified: Option<String>,
    pub retry_after: Option<String>, pub server: Option<String>, pub cf_mitigated: Option<String>, pub body: B,
}
pub(crate) trait HttpTransport {
    type Body: ChunkSource + Send;
    fn send(&self, url: &reqwest::Url, request: &OutboundRequest<'_>)
        -> impl std::future::Future<Output = Result<RawResponse<Self::Body>, NetError>> + Send;
}
pub struct Fetched<B> { pub final_url: reqwest::Url, pub response: RawResponse<B> }
/// §6.4 : check_public_url à chaque saut ; MAX_REDIRECTS = 3.
pub(crate) async fn fetch_public<T: HttpTransport>(transport: &T, url: reqwest::Url, request: &OutboundRequest<'_>)
    -> Result<Fetched<T::Body>, NetError>;
/// Secondes entières → Some(ms) borné à [60 000, 21 600 000] ; autre valeur présente → Some(900 000) ; absent → None.
pub fn parse_retry_after(value: Option<&str>) -> Option<u64>;
/// §8.6, pur.
pub fn is_challenge(status: u16, content_type: Option<&str>, server: Option<&str>, cf_mitigated: Option<&str>) -> bool;
```
`WeatherError::from(NetError)` : `ForbiddenUrl`, `ForbiddenAddress`, `LocalName`, `TooManyRedirects`, `InsecureRedirect`, `InvalidRedirect` → `Forbidden` ; `Dns` → `Network` ; `Challenge` → `UpstreamStatus { status: 403 }`. Contrat météo (§4.3 de weather-widget) inchangé.

Tests (`#[cfg(test)]`) :
- `address.rs` : au moins une adresse dans et une juste hors de **chaque** plage de §6.1, dont : `9.255.255.255` Public, `10.0.0.0` Lan, `172.15.255.255` Public, `172.16.0.0` Lan, `172.31.255.255` Lan, `172.32.0.0` Public, `100.63.255.255` Public, `100.64.0.0` Lan, `100.127.255.255` Lan, `100.128.0.0` Public, `169.254.169.254` Forbidden, `198.17.255.255` Public, `198.18.0.0` Forbidden, `198.20.0.0` Public, `223.255.255.255` Public, `224.0.0.1` Forbidden, `255.255.255.255` Forbidden ; IPv6 : `::` F, `::1` F, `::ffff:127.0.0.1` F, `::ffff:192.168.1.1` Lan, `::ffff:8.8.8.8` Public, `::127.0.0.1` F, `64:ff9b::8.8.8.8` Public, `64:ff9b::10.0.0.1` F, `64:ff9b:1::1` F, `100::1` F, `2001::1` F, `2001:db8::1` F, `2002:c0a8:101::1` F, `3fff::1` F, `5f00::1` F, `fc00::1` Lan, `fd12::1` Lan, `fe80::1` F, `fec0::1` F, `ff02::1` F, `2606:4700::1111` Public, `4000::1` F.
- `url_policy.rs` : acceptées `https://example.com/feed.xml?x=1#frag` (fragment retiré), `https://example.com:8443/`, `https://exämple.com/` (punycode), `https://hypixel.net/forums/skyblock-patch-notes.158/index.rss` ; refusées avec la bonne raison : `http://example.com/` (Scheme), `ftp://example.com/` (Scheme), `https://u:p@example.com/` (Credentials), `https://example.com:25/` (Port), `https://localhost/`, `https://LOCALHOST./`, `https://a.localhost/` (LocalName), `https://nas/` (SingleLabel), `https://127.0.0.1/`, `https://2130706433/`, `https://0x7f.1/`, `https://127.1/`, `https://0177.0.0.1/`, `https://[::1]/`, `https://[::ffff:7f00:1]/`, `https://0.0.0.0/`, `https://169.254.169.254/`, `https://192.168.1.1/` (ForbiddenAddress), URL de 2049 caractères (TooLong), `pas une url` (Invalid) ; `check_lan_url` : `http://192.168.1.10:5000/` et `https://[fd00::10]:5001/` acceptées, `http://8.8.8.8/` (ForbiddenAddress), `http://127.0.0.1/` (ForbiddenAddress), `http://nas.local/` (LanNotAllowed), `http://169.254.1.1/` (ForbiddenAddress) refusées ; `probe_url_scope` : `http://192.168.1.10/` → Lan, `https://example.com/` → Public, `http://example.com/` → Scheme ; `check_tcp_target` : `("192.168.1.10", 22)` → Lan, `("example.com", 25565)` → Public, `("127.0.0.1", 80)`, `("localhost", 80)`, `("example.com", 0)` refusés ; `host_key` : `https://HyPixel.NET./x` → `hypixel.net`.
- `resolver.rs` : `check_resolved` (vide → NotFound ; tout public → Ok ; public + privé → Forbidden ; mappée privée → Forbidden ; toutes Lan → `Forbidden { all_lan: true }`) ; `GuardedResolver` sur `localhost` → `LocalName` ; `resolve_public("127.0.0.1", 80)` → Forbidden (IP littérale : aucune requête DNS) ; `DenyAllResolver` refuse tout nom.
- `fetch.rs` (transport factice qui enregistre les URL demandées et échoue si l'on lit le corps d'une 3xx) : 200 direct ; 3 sauts → ok (URL finale, 4 requêtes) ; 4 sauts → `TooManyRedirects` (4 requêtes, pas 5) ; `Location` relative (`/b`) résolue ; `Location` absente → `InvalidRedirect` ; `Location` de 2049 octets → `InvalidRedirect` ; https → `http://example.com/` → `InsecureRedirect` ; → `https://127.0.0.1/` et `https://[::1]/` → `ForbiddenUrl(ForbiddenAddress)` **sans** requête vers la cible ; 303 suivi en GET ; validateurs envoyés à chaque saut.
- `parse_retry_after` : `"120"` → 120 000 ; `"5"` → 60 000 ; `"99999999"` → 21 600 000 ; `"Wed, 21 Oct 2026 07:28:00 GMT"` → 900 000 ; `"-1"`, `"abc"` → 900 000 ; `None` → `None`.
- `is_challenge` : `cf-mitigated: challenge` (tout statut) → vrai ; 403 + `text/html` + `server: cloudflare` → vrai ; 503 + `text/html` + `server: cloudflare` → vrai ; 403 + `text/html` + `server: nginx` → faux ; 200 + `server: cloudflare` + `application/rss+xml` → faux.
- `host_gate.rs` (`FixedClock`) : trois réservations immédiates sur le même hôte → attentes 0, 60, 120 s ; quatrième → `Err` (au-delà de 150 s) ; deux hôtes différents → indépendants ; `block(host, now + 2 min)` → `reserve` renvoie `Err(120 000)` ; un `block` plus court qu'un blocage existant ne le raccourcit pas ; horloge reculée → pas d'attente négative.
- Bout en bout sans réseau (CA-OH1-5) : `std::net::TcpListener::bind("127.0.0.1:0")` en mode non bloquant ; (a) `fetch_public` avec le transport reqwest de production vers `https://127.0.0.1:<port>/` → `ForbiddenUrl(ForbiddenAddress)` ; (b) `reqwest::Client` construit par `NetClient`, appelé **directement** (sans politique d'URL) vers `https://localhost:<port>/` → erreur classée `LocalName` (S3) ; après (a) et (b), le listener n'a accepté **aucune** connexion (500 ms d'attente). (c) Informatif : client appelé directement vers `https://127.0.0.1:<port>/` ; le test consigne si une connexion arrive (S1 confirmée) ou non, sans échouer ; à rapporter.
- Tests météo existants verts, sans modification de leurs attentes.

Critères :
- **CA-OH1-1** Tous les vecteurs ci-dessus passent (`npm run rust:test`).
- **CA-OH1-2** `NetClient::new()` construit le client public avec `.dns_resolver(…GuardedResolver…)`, `Policy::none()`, `no_proxy()` (assertion sur le source, à la manière des tests de `lib.rs`).
- **CA-OH1-3** `rg -n "reqwest::Client" apps/desktop/src-tauri/src --glob '!**/net/**'` vide (aucun client construit hors de `net`).
- **CA-OH1-4** Une erreur du résolveur est classée `LocalName`/`ForbiddenAddress`/`Dns`, jamais `Network` (S3).
- **CA-OH1-5** Test du listener local : zéro connexion acceptée pour (a) et (b) ; résultat de (c) noté dans le rapport.
- **CA-OH1-6** `cargo tree -e features -i reqwest --manifest-path apps/desktop/src-tauri/Cargo.toml` : aucune feature `gzip`, `brotli`, `deflate`, `zstd`, `http2`, `system-proxy`, `cookies`, `rustls`, `default-tls` ; `cargo tree -i aws-lc-sys …` : « did not match any packages ».
- **CA-OH1-7** `git diff --stat -- apps/desktop/src-tauri/tauri.conf.json apps/desktop/src-tauri/capabilities apps/desktop/src-tauri/migrations apps/web` vide.
- **CA-OH1-M** M-OH1-1.

### 15.2 Lot OH2 : liste autorisée et consentement
Fichiers :
```
créer    migrations/V<n>__net_targets.sql                  §12, trois tables (texte figé en revue)
créer    src/net/targets/mod.rs                            NetTarget, NetTargetInput (serde, S9), validation, déduction du scope
créer    src/net/targets/store.rs                          accès sqlx selon la convention de typed-data-commands ; revalidation à la lecture
créer    src/net/targets/consent.rs                        trait ConsentPrompt ; consent_text (pur, §5.5) ; impl native (cfg(not(test))) ; stub (cfg(test))
créer    src/net/targets/commands.rs                       net_target_list / request / rename / delete (+ consent si N9 = a)
créer    permissions/autogenerated/net_target_*.toml       générés, commités
modifier src/lib.rs, build.rs, capabilities/default.json, src/capability_tests.rs   (§13)
modifier src/db.rs (ou équivalent)                         enregistrement de la migration
front (apps/web/src/app/) :
créer    data/net-targets.ts (types) ; NetTargetRepository dans data/repositories.ts ;
         data/tauri/net-target.repository.ts (seul fichier qui invoque net_target_*) ; schémas Valibot ; NetTargetError ;
         core/testing/fake-net-target.repository.ts ; specs
créer    (N13 = a) section Réglages « Accès réseau » : liste (libellé, hôte ou IP:port, genre, réseau local, date), « Retirer » avec confirmation dans l'interface
modifier core/i18n/fr.json                                 clés §15.5
```
```rust
pub trait ConsentPrompt: Send + Sync {
    /// Bloquant : appelé dans spawn_blocking. true = « Autoriser ».
    fn ask(&self, title: &str, body: &str) -> bool;
}
pub fn consent_text(target: &PendingTarget) -> (String, String);   // (titre, corps), pur, §5.5
```
Tests : textes exacts (un par genre et scope ; IDN affiché en punycode puis forme Unicode ; URL entière) ; `request` avec stub « oui » → ligne insérée, `consentedAt` = horloge fixe ; stub « non » → `declined`, rien inséré ; nouvelle demande dans les 10 s → `dialog_busy` ; après 10 s (horloge avancée) → dialogue rouvert ; deux demandes simultanées → la seconde `dialog_busy` ; doublon → `already_exists` sans dialogue ; 51e → `limit_reached` ; entrée avec clé `scope` → `invalid_input` ; chaque refus de politique (§6.2) → bonne erreur **sans** dialogue (le stub compte ses appels) ; fenêtre cachée (abstraction `WindowState` injectée) → `window_hidden` sans dialogue ; ligne incohérente écrite directement en SQL de test (`scope = 'lan'` avec un hôte public) → absente de `list`, `not_found` ailleurs ; `delete` idempotent et supprime aussi `feed_filters`/`feed_items` de la cible (clés étrangères actives ou suppression explicite, §12) ; `rename` borne et nettoie le libellé.

Critères :
- **CA-OH2-1** Tests verts ; le stub prouve qu'aucun dialogue ne s'ouvre avant la validation complète.
- **CA-OH2-2** `rg -n "net_targets|feed_items|feed_filters" apps/web/src` vide (aucun SQL front) ; garde de test équivalente à celles de V7/V8.
- **CA-OH2-3** `default.json` = liste §13 (part OH2) ; tests de capabilities à jour ; aucune permission `dialog:`.
- **CA-OH2-4** Les commandes figurent dans les deux `invoke_handler` et dans `build.rs` (tests de `lib.rs` étendus).
- **CA-OH2-5** Front : seul `data/tauri/net-target.repository.ts` invoque `net_target_*` ; schémas `v.object` stricts ; tests Vitest verts.
- **CA-OH2-M** M-OH2-1 à M-OH2-5.

### 15.3 Lot OH3 : flux
Fichiers :
```
modifier Cargo.toml          feed-rs = "=3.0.0" (vérifier que ses features par défaut n'incluent pas `sanitize` ; sinon default-features = false ;
                             si le parsing en dépend, s'arrêter et rapporter)
créer    src/feed/mod.rs       commandes feed_fetch, feed_items, feed_filter_set ; état mémoire ; une requête en vol par cible ; recul ; HostGate (§8)
créer    src/feed/prescan.rs   §9.2
créer    src/feed/parse.rs     feed-rs → articles (§9.3)
créer    src/feed/author.rs    règle de l'auteur (§9.3)
créer    src/feed/text.rs      html_to_text, clean_text (§9.4)
créer    src/feed/links.rs     règle des liens (§9.3)
créer    src/feed/filter.rs    FeedFilter, matches, validation (§9.6)
créer    src/feed/history.rs   fusion, élagage, lecture (§9.7) ; stockage selon la convention de typed-data-commands
créer    src/feed/fixtures/    rss2_basic.xml, atom_basic.xml, rss1_rdf.xml, jsonfeed_basic.json, latin1.xml (octets ISO-8859-1),
                              html_injection.xml, links_mixed.xml, dates_bogus.xml, duplicate_ids.xml, empty_channel.xml,
                              doctype_netscape.xml, doctype_internal_subset.xml, authors_mixed.xml,
                              xenforo_skyblock_alpha.xml (réponse réelle enregistrée, S11 ; à défaut, reconstruite à la main et signalée comme telle)
                              ; gros cas (300 entrées, profondeur, attributs) générés dans les tests
modifier src/lib.rs, build.rs, capabilities/default.json, src/capability_tests.rs   (§13)
front :  core/feeds/{index, feed.types, feed-error, feed.schemas, feed-api (seul invoke de feed_*), feed.service}.ts + specs ;
         core/testing/fake-feed-api.ts ; apps/web/scripts/check-no-raw-html.mjs branché dans le script lint
```
La fixture XenForo réelle ne doit contenir que des données publiques du forum ; aucune donnée de Marius (pas de cookie, pas d'en-tête de requête).

Tests Rust :
- Pré-analyse : profondeur 64 acceptée, 65 refusée ; 100 001 éléments refusés ; 65 attributs refusés ; DTD interne (« billion laughs ») refusée en moins de 100 ms ; DOCTYPE Netscape accepté.
- Chaque fixture → articles exacts attendus. `html_injection.xml` : aucune sortie ne contient `<`, `script` ni `onerror` ; liens `javascript:`/`data:` → `null`. Liens relatifs résolus contre l'URL finale ; lien vers `http://192.168.1.1/` → `null`. Titres > 300, extraits > 500, auteurs > 100 tronqués avec « … » en points de code. Bidi et contrôles retirés. Dates 1970 et 2099 → `null`. Identifiants hachés, stables d'un appel à l'autre, doublons écartés.
- Auteur (`authors_mixed.xml` et vecteurs purs) : `dc:creator` seul → nom ; `<author>` seul « invalid@example.com (Hypixel Team) » → « Hypixel Team » ; les deux présents et différents → celui de `dc:creator` ; `<author>` « jdoe@example.com » seul → `null` ; Atom `<author><name>` → nom ; aucun → `null`.
- XenForo : `xenforo_skyblock_alpha.xml` → 20 articles, auteurs extraits ; avec le filtre `{ authors: ["Hypixel Team"] }` → exactement les articles de cet auteur.
- Filtre : vide → tout ; auteurs insensibles à la casse et aux espaces insécables ; `titleContains` en sous-chaîne insensible à la casse ; combinaison ET ; sans auteur + filtre d'auteur → écarté ; validation (11 auteurs, 101 caractères, contrôle, bidi → `invalid_input`) ; deux listes vides → `null`.
- Historique (base SQLite de test, `FixedClock`) : première récupération → articles insérés, `firstSeenAt` = maintenant ; seconde avec un titre modifié → mis à jour, `firstSeenAt` inchangé ; article disparu du flux → conservé ; 250 articles cumulés → 200 gardés (les plus anciens supprimés) ; articles écartés par le filtre jamais insérés ; filtre resserré → masque à la lecture sans supprimer ; tri et 50 renvoyés ; ligne invalide en base → ignorée ; cible supprimée pendant la requête → rien n'est inséré.
- `html_to_text` puis `clean_text` : `<p>a</p><p>b</p>` → `a b` ; `a&nbsp;b&eacute;` → `a bé` ; `&#0;x` et `&#xD800;x` → `\u{FFFD}x` ; `&unknown;` gardé tel quel ; `<script>x</script>y` → `y` ; `a<b` → `a` ; `&lt;b&gt;` → `<b>` (texte, pas balise : c'est l'invariant d'interpolation qui protège) ; `\u{202E}abc` → `abc`.
- Débit (transport factice + `FixedClock`) : deuxième appel dans les 30 min → `fromCache: true`, aucune requête ; `force` après 2 min → requête ; 304 → `notModified: true`, validateurs envoyés, historique inchangé ; 3 échecs → prochaine requête permise après 20 min ; 429 + `Retry-After: 120` sur la source A → la source B du même hôte répond depuis l'historique sans requête pendant 2 min ; trois sources du même hôte → requêtes à 0, 60, 120 s (horloge et `sleep` simulés) ; défi → `blocked`, hôte bloqué 1 h ; deux appels concurrents → une seule requête ; `text/html` sans défi → `not_a_feed` ; `wrong_kind` sur une sonde ; `feed_items` ne fait jamais de requête.

Critères :
- **CA-OH3-1** Tests verts ; aucun test ne sort sur le réseau.
- **CA-OH3-2** `feed-rs` épinglé `=3.0.0`, sans `sanitize` ; `cargo tree -i ammonia --manifest-path apps/desktop/src-tauri/Cargo.toml` : « did not match any packages » ou « nothing to print ».
- **CA-OH3-3** `cargo tree -i quick-xml …` : une seule version, ≥ 0.41.
- **CA-OH3-4** `cargo audit` sans nouvel avis.
- **CA-OH3-5** `feed_fetch`, `feed_items`, `feed_filter_set` ne prennent ni `url`, ni `host`, ni `port` (garde §13).
- **CA-OH3-6** Front : `FeedService` appelle `assertWidgetPermission(ctx, 'network')` et revalide par Valibot (`v.object`, longueurs §9.3, `publishedAt`/`firstSeenAt` via `hasInstantShape`, `url` via `parseWebUrl`) ; `rg -n "core/feeds" apps/web/src/app --glob '!**/widgets/**' --glob '!**/core/feeds/**' --glob '!**/core/testing/**'` vide.
- **CA-OH3-7** `npm run web:build` : bundle initial inchangé à 1 kio près.
- **CA-OH3-8** `npm run lint` échoue si l'on ajoute `[innerHTML]` dans un template de `widgets/` (essai puis retrait, noté dans le rapport) et passe sur le code livré.
- **CA-OH3-9** Taille de l'installateur NSIS avant/après notée dans le rapport.
- **CA-OH3-10** Origine de la fixture XenForo indiquée dans le rapport (réponse réelle enregistrée ou reconstruction) ; S11 confirmée ou infirmée.
- **CA-OH3-M** M-OH3-1 à M-OH3-6.

### 15.4 Lot OH4 : sondes
Fichiers :
```
modifier src/net/mod.rs      lan_client (§7.2) avec DenyAllResolver, sémaphore des sondes
créer    src/probe/mod.rs     commande probe_run, cache 30 s, une sonde en vol par cible, HostGate pour les sondes publiques
créer    src/probe/tcp.rs     connect_with_timeout(addr: SocketAddr, timeout) + chemin public (resolve_public)
créer    src/probe/http.rs    GET sans lecture du corps, sur le transport abstrait
modifier src/lib.rs, build.rs, capabilities/default.json, src/capability_tests.rs   (§13)
front :  core/probes/{index, probe.types, probe-error, probe.schemas, probe-api, probe.service}.ts + specs ; core/testing/fake-probe-api.ts
```
Tests : `connect_with_timeout` (fonction basse, qui reçoit une `SocketAddr` déjà validée) vers un `TcpListener` local → joignable, latence ≥ 0 ; vers un port local fermé → `refused` ; délai simulé par un connecteur factice → `timeout` (aucune adresse distante réelle) ; `probe_run` sur une cible LAN dont l'URL envoyée différerait de l'URL stockée → refus ; HTTP : 200, 401, 503, 302 (non suivi) → `reachable: true` avec le statut ; corps jamais lu (le corps factice échoue si on le lit) ; échec TLS simulé → `failure: "tls"` ; défi → `failure: "blocked"` ; cible `feed` → `wrong_kind` ; deuxième appel dans les 30 s → `fromCache: true`.

Critères :
- **CA-OH4-1** Tests verts, sans réseau sortant.
- **CA-OH4-2** `lan_client` construit avec `DenyAllResolver`, `Policy::none()`, `no_proxy()`, sans `danger_accept_invalid*` (assertion sur le source) ; utilisé seulement dans `src/net/` et `src/probe/` (garde §13).
- **CA-OH4-3** `probe_run` ne prend que `targetId` (garde §13).
- **CA-OH4-4** Front : `ProbeService` avec `assertWidgetPermission(ctx, 'network')`, schémas stricts, fake.
- **CA-OH4-M** M-OH4-1 à M-OH4-3.

### 15.5 Clés i18n (FR, `core/i18n/fr.json`, sous `netAccess.`)
`title` « Accès réseau » ; `description` « Sites et appareils que Homebase est autorisé à contacter. » ; `empty` « Aucun accès autorisé. » ; `remove` « Retirer » ; `removeConfirm` « Retirer l'accès à {{ label }} ? Les widgets qui l'utilisent ne pourront plus l'actualiser, et les articles gardés seront effacés. » ; `kind.feed` « Flux » ; `kind.httpProbe` « Sonde HTTP » ; `kind.tcpProbe` « Sonde TCP » ; `scope.lan` « Réseau local » ; `consentedOn` « Autorisé le {{ date }} » ; `pendingConsent` « À confirmer » ; `confirm` « Autoriser… ».
Erreurs : `errors.forbiddenUrl.invalid` « Adresse invalide. » ; `errors.forbiddenUrl.scheme` « Seules les adresses https:// sont acceptées. » ; `errors.forbiddenUrl.credentials` « L'adresse ne doit contenir ni identifiant ni mot de passe. » ; `errors.forbiddenUrl.tooLong` « Adresse trop longue. » ; `errors.forbiddenUrl.port` « Ce port n'est pas autorisé. » ; `errors.forbiddenUrl.localName` et `errors.forbiddenUrl.singleLabel` « Nom local : saisissez l'adresse IP de l'appareil. » ; `errors.forbiddenUrl.lanNotAllowed` « Les adresses du réseau local ne sont acceptées que pour les sondes. » ; `errors.forbiddenAddress` « Cette adresse est interdite (machine locale, adresse réservée ou réseau privé). » ; `errors.privateName` « Ce nom désigne un appareil du réseau local : saisissez son adresse IP. » ; `errors.dns` « Nom introuvable. » ; `errors.alreadyExists` « Cet accès existe déjà. » ; `errors.limitReached` « Nombre maximal d'accès atteint (50). » ; `errors.declined` « Accès non autorisé. » ; `errors.dialogBusy` « Une demande d'autorisation est déjà en cours. » ; `errors.windowHidden` « Ouvrez la fenêtre de Homebase pour autoriser cet accès. » ; `errors.notConsented` « Cet accès doit être confirmé. » ; `errors.storage` « Enregistrement impossible. » ; `errors.unknown` « Erreur inattendue. ». Les clés des widgets RSS (dont `blocked` « Le site bloque les lecteurs automatiques pour le moment. », `throttled`, filtre) et Statut relèvent de leurs mini-specs.

### 15.6 Après ces lots
Les tâches « (S) Widget RSS » et « (S) Statut de services » consomment `FeedService`, `ProbeService` et `NetTargetRepository`. Recommandation : une **mini-spec par widget** (Opus, courte : disposition, états, config `{ targetIds }`, saisie du filtre « auteurs » et « le titre contient », éventuel état lu/non lu), car l'UI d'ajout d'une source (saisie, dialogue natif, erreurs) a des cas à figer.

### 15.7 Commandes de vérification (depuis `F:/`, lettre de lecteur en majuscule)
```
npm ci --ignore-scripts
npm run format:check
npm run lint
npm run test
npm run rust:fmt:check
npm run rust:lint
npm run rust:test
cargo tree -e features -i reqwest --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo tree -i aws-lc-sys --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo tree -i ammonia --manifest-path apps/desktop/src-tauri/Cargo.toml        (OH3)
cargo tree -i quick-xml --manifest-path apps/desktop/src-tauri/Cargo.toml      (OH3)
cargo audit                                                                     (depuis apps/desktop/src-tauri)
npm run web:build
npm run build
npm run dev                                                                     (vérifications manuelles)
```
Rapport attendu à la fin de chaque lot : fichiers créés et modifiés, résultats des commandes, suppositions S1 à S11 confirmées ou infirmées, écarts, étapes consommées.

---

## 16. Vérifications manuelles (Marius, `npm run dev`, console des outils de développement)

- **M-OH1-1** La météo s'affiche et s'actualise comme avant.
- **M-OH2-1** Ajouter un flux réel depuis l'interface : le dialogue Windows affiche le site et l'URL entière ; « Annuler » → rien n'est ajouté ; « Autoriser » → la cible apparaît dans Réglages « Accès réseau ».
- **M-OH2-2** Console : `await window.__TAURI_INTERNALS__.invoke('net_target_request', { input: { kind: 'feed', url: 'https://127.0.0.1/' } })` → rejet `forbidden_address`, **aucun dialogue** ; `http://example.com/` → `forbidden_url`/`scheme` ; `https://localtest.me/` → `forbidden_address` ; `{ kind: 'feed', url: 'https://example.com/', scope: 'lan' }` → `invalid_input`.
- **M-OH2-3** Lancer `setTimeout(() => window.__TAURI_INTERNALS__.invoke('net_target_request', { input: { kind: 'feed', url: 'https://example.com/rss' } }).catch(console.log), 5000)` puis réduire la fenêtre dans la zone de notification → `window_hidden`, aucun dialogue.
- **M-OH2-4** Deux appels rapprochés → un seul dialogue ; après un refus, nouvel appel immédiat → `dialog_busy`.
- **M-OH2-5** Retirer une cible dans Réglages → disparue ; `feed_fetch` sur son identifiant → `not_found`.
- **M-OH3-1** Ajouter les trois flux Hypixel (§1.4) : les articles s'affichent (titres, extraits, dates, auteurs) ; un clic ouvre l'article dans le navigateur.
- **M-OH3-2** Deux actualisations rapprochées : la seconde renvoie `fromCache: true`.
- **M-OH3-3** Wi-Fi coupé : `dns` ou `network`, l'historique reste affiché ; au retour du réseau : actualisation.
- **M-OH3-4** `fetch('https://example.com')` reste bloqué par la CSP ; `invoke('plugin:http|fetch', {})` échoue.
- **M-OH3-5** (S10) Les trois flux Hypixel répondent depuis Homebase sans `blocked` ni 429 au démarrage (requêtes espacées de 60 s : le troisième arrive au bout de 2 min environ) ; noter tout `blocked`.
- **M-OH3-6** Filtre `{ authors: ["Hypixel Team"] }` sur `skyblock-alpha` : seuls les articles de l'équipe restent ; après un redémarrage, ils sont toujours là (historique), même s'ils ont quitté le flux.
- **M-OH4-1** Ajouter le NAS par son **IP** (sonde TCP sur le port de DSM, puis sonde HTTP) : dialogue « réseau local » ; sonde joignable avec latence.
- **M-OH4-2** NAS éteint ou mauvais port : `reachable: false`, `failure` renseigné, pas de rejet.
- **M-OH4-3** `nas.local` ou le nom NetBIOS du NAS : refusé avec le message « saisissez l'adresse IP ».

---

## 17. Décisions à valider (Marius)

| # | Question | Options | Recommandation | Justification |
|---|---|---|---|---|
| **N1** | Comment Marius consent-il à un nouvel accès ? | a) dialogue Windows natif ouvert par le Rust pour **tout** ajout ; b) natif seulement pour le réseau local ; c) confirmation dans l'interface Homebase | **a** | Seul un dialogue natif résiste à un script injecté. b laisse un XSS ajouter en silence un flux vers un serveur qu'il contrôle et glisser des données dans l'URL (T8). Coût : un dialogue système par ajout, geste rare |
| **N2** | Schémas pour les cibles publiques | a) `https` seul ; b) `http` toléré, avec avertissement dans le dialogue | **a** | Un flux http peut être modifié en route (contenu, redirections). Les trois flux Hypixel sont en https. À rouvrir si une source n'existe qu'en http |
| **N3** | Forme d'une cible LAN | a) IP littérale seule ; b) nom d'hôte (`nas.local`) résolu à chaque sonde, accepté seulement s'il résout vers le réseau local | **a** | Rien à résoudre : pas de rebinding, pas de dépendance à mDNS/NetBIOS. Contrainte : une IP fixe pour le NAS (réservation DHCP, l'usage courant) |
| **N4** | Boucle locale (`127.0.0.1`, `localhost`) | a) toujours interdite ; b) permise pour des sondes TCP consenties (surveiller un service local) | **a** | La boucle locale est la cible SSRF la plus sensible (serveurs de développement sans authentification, dont celui de Homebase). Aucun besoin exprimé |
| **N5** | NAS en HTTPS avec certificat auto-signé | a) certificat toujours vérifié (sonder en TCP ou en HTTP) ; b) option « certificat non vérifié » par cible LAN, sondes seulement | **a** | b ajoute un client TLS affaibli pour un gain faible : une sonde TCP sur le port HTTPS dit déjà si le service répond |
| **N6** | Contenu des articles renvoyé au front | a) texte brut (titre, extrait de 500 caractères, auteur, date, lien), aucune image ; b) HTML assaini (ammonia côté Rust + DOMPurify, `innerHTML` côté front) ; c) a + vignettes téléchargées par le Rust en `data:` | **a** | Zéro surface HTML, CSP inchangée ; ammonia a eu 5 avis XSS en 2026 (F10). L'article complet s'ouvre dans le navigateur. c ferait contacter des hôtes d'images non consentis |
| **N7** | Redirections des flux | a) jusqu'à 3, changement d'hôte permis s'il est public et en https, URL stockée jamais réécrite, hôte final signalé ; b) même hôte seulement ; c) aucune | **a** | Les flux déménagent souvent (CDN, passage à https). Chaque saut repasse toute la politique : la SSRF reste fermée |
| **N8** | Conservation des articles | a) mémoire seulement (comme la météo) ; b) **historique en base**, 200 articles par source, sans état lu/non lu ; validateurs HTTP en mémoire | **b** | Exigence Hypixel : les flux XenForo n'ont que 20 articles, et les notes officielles de `skyblock-alpha` en disparaissent vite. Tables Rust seulement (§12) ; l'état lu/non lu reste à la mini-spec RSS |
| **N9** | Cibles dans l'export de configuration JSON | a) exportées (libellé, URL ou IP:port, filtre), **réimportées sans consentement** (`consented_at` NULL, bouton « Autoriser… » → dialogue natif) ; b) jamais exportées (les widgets réimportés perdent leurs sources) ; c) exportées et réimportées avec leur consentement | **b en v1, a ensuite** | c reviendrait à consentir par import d'un fichier non fiable (ADR-001 §3.5). a est le bon modèle mais coûte une commande (`net_target_consent`), une erreur (`not_consented`) et une nouvelle `formatVersion` de l'export (couplage C5) ; b est sûr et suffit pour trois flux et un NAS. Si Marius préfère a dès maintenant, tout est spécifié (§11, §12) |
| **N10** | Autodécouverte du flux depuis l'adresse d'un site | a) non en v1 (saisir l'URL du flux ; erreur `not_a_feed` explicite) ; b) oui (lecture d'une page HTML, recherche de `<link rel="alternate">`) | **a** | b ajoute l'analyse de HTML arbitraire et une requête vers une page avant consentement. Les URL Hypixel sont connues |
| **N11** | Proxy système | a) ignoré (`no_proxy`, comme la météo) ; b) pris en compte | **a**, sous réserve que **Marius confirme qu'aucun proxy n'est configuré** (S7, en attente depuis la phase 1) | Un proxy résout les noms à notre place : le résolveur gardé ne verrait plus les adresses |
| **N12** | Sondes TCP vers des hôtes **publics** (ex. un serveur de jeu sur le port 25565) | a) permises (consentement, connexion seule) ; b) réseau local seulement | **a** | Une connexion TCP sans données vers une cible publique consentie ne présente pas de risque propre ; utile au widget Statut |
| **N13** | Page Réglages « Accès réseau » (liste + retrait) | a) oui dès OH2 ; b) plus tard, retrait depuis les widgets seulement | **a** | Transparence (ce que Homebase contacte) et révocation en un seul endroit ; petit coût (une liste) |
| **N14** | Stockage des jetons (phase 6) | a) crate `keyring` 4.x (magasin Windows) ; b) API Win32 directe (`CredWriteW`/`CredReadW`) | **Choix de crate reporté à la spec GitHub** ; valider dès maintenant les principes de §10 | Sans effet sur la phase 3 |
| **N15** | Où et quand filtrer les articles d'une source (auteurs, mots du titre) | a) côté Rust, filtre enregistré avec la source, appliqué **avant** l'historique et à la lecture ; b) côté Rust, à la lecture seulement (tout est stocké) ; c) côté front, dans la config du widget | **a** | Seul a garde des mois de notes « Hypixel Team » dans un historique de 200 que les fils de joueurs rempliraient sinon. Contrepartie : élargir le filtre ne fait pas revenir les articles déjà écartés (seulement les 20 du flux courant). Correspondance d'auteur exacte (casse ignorée), titre en « contient », pas d'expression régulière |
| **N16** | Débit vers les sites | a) 30 min par source (2 min avec « Actualiser »), 60 s entre deux requêtes vers le même hôte, `Retry-After` appliqué à l'hôte (15 min s'il manque) ; b) 15 min par source, mêmes règles d'hôte | **a** | Le forum a déjà renvoyé un 429 ; trois flux sur le même hôte = 6 requêtes par heure en a, 12 en b. Les patch notes ne justifient pas plus |

Note : si N9 = b, retirer de OH2 `net_target_consent`, `not_consented` et `pendingConsent` (la colonne `consented_at` reste, toujours renseignée).

---

## 18. Risques

- **R1** S1/S3 fausses (comportement interne de reqwest) : la défense n'en dépend pas (politique d'URL avant envoi, test du listener) ; seul le libellé d'erreur peut changer.
- **R2** feed-rs contient une récursion non couverte par la pré-analyse (ex. JSON Feed) : limite de `serde_json` à 128 ; pré-analyse XML à 64 niveaux. Parsing dans `spawn_blocking` : une boucle CPU ne bloque pas le runtime, mais n'est pas interrompue (corps borné à 4 Mio).
- **R3** Un flux légitime dépasse 4 Mio ou utilise un DOCTYPE interne : `too_large` / `invalid_response` visibles ; constante ajustable par amendement.
- **R4** Dialogue natif : API différente (S5) ou fenêtre parent absente ; repli sur `rfd::MessageDialog` (déjà utilisé par `show_error`).
- **R5** DNS d'un fournisseur ou d'un réseau qui renvoie des adresses privées pour des noms publics : flux refusé (`forbidden_address`). Accepté (PC personnel).
- **R6** Une archive de sauvegarde **fabriquée** et restaurée volontairement apporte des cibles consenties (dont LAN). Accepté : la restauration est un geste explicite sur un fichier choisi par Marius ; les lignes sont revalidées à la lecture ; la page « Accès réseau » les montre.
- **R7** Surface résiduelle d'un XSS : lister les cibles (adresses saisies par Marius), en supprimer, modifier un filtre, déclencher des requêtes bornées vers des cibles consenties, ouvrir un dialogue refusable. Accepté.
- **R8** Avis `cargo audit` sur feed-rs, quick-xml ou leurs dépendances : mise à jour ciblée ; exception seulement par décision du coordinateur.
- **R9** Taille du binaire : feed-rs et ses dépendances (mesurée en CA-OH3-9).
- **R10** Le lien d'un article reste un lien choisi par l'auteur du flux : ouvert dans le navigateur par un clic de Marius, comme tout lien web ; seuls les schémas non http(s) et les cibles locales sont écartés.
- **R11** Hypixel active un défi Cloudflare ou bloque le `User-Agent` de Homebase (S10) : `blocked` visible, aucun contournement ; décision produit à prendre alors (renoncer à la source, ou autre canal officiel).
- **R12** Le forum change l'auteur des notes officielles (autre compte que « Hypixel Team ») : les nouvelles notes sont écartées sans bruit. Mitigation : le filtre est visible et modifiable dans le widget (mini-spec), et un filtre « le titre contient » peut le compléter.
- **R13** L'historique conserve du contenu externe en base (texte brut borné) : il passe dans les sauvegardes (poids négligeable : 200 × ~1 kio par source) ; il est revalidé à la lecture.

---

## 19. Amendements proposés (texte à appliquer par le coordinateur après validation ; non appliqués ici)

### 19.1 `docs/PLAN.md`
- §2, ligne « HTTP sortant », ajouter à la fin de la colonne de droite : « *Amendement (spec http-client, 2026-11-25)* : phase 3 : résolveur DNS gardé (refus de toute adresse non publique), redirections revalidées à chaque saut (3 au plus, jamais vers http), espacement par hôte et `Retry-After` par hôte ; cibles utilisateur dans `net_targets` (Rust seulement) consenties par un dialogue natif ; flux par `feed-rs` 3.0.0 sans `sanitize`, texte brut seulement, filtre par source et historique en base ; sondes LAN sur IP littérale par un client distinct. Voir `docs/specs/http-client.md`. »
- §5 « RSS » : « RSS : récupération côté Rust (`feed_fetch`, cible consentie) ; texte brut (titre, extrait, auteur, date, lien), ni image ni HTML ; filtre par source (auteurs, mots du titre) et historique de 200 articles par source ; URL du flux saisie (pas d'autodécouverte en v1). Premier usage : forum Hypixel (XenForo, 20 articles par flux). »
- §5 « Statut de services » : « Statut de services : sondes TCP (connexion seule) et HTTP (statut et latence, corps jamais lu) côté Rust (`probe_run`) ; NAS par son adresse IP, consenti explicitement ; boucle locale interdite. »
- §6, « Requêtes sortantes » : remplacer la dernière phrase par : « Phase 1 (météo) : deux hôtes Open-Meteo fixés en dur. Phase 3 (`docs/specs/http-client.md`) : toute connexion publique passe par un résolveur qui refuse les adresses non publiques ; IP littérales et redirections revérifiées à chaque saut ; le front ne passe qu'un identifiant de cible consentie (dialogue natif), jamais une URL ; le réseau local n'est joignable que par des sondes vers une IP consentie ; aucun contournement de défi anti-robot. »
- §8, point 5 (« Disponibilité de flux RSS ») : « Fait pour Hypixel (3 flux XenForo, spec http-client §1.4). »

### 19.2 `docs/SECURITY-NOTES.md` (nouvelle section)
```
## Réseau sortant (spec http-client)

- Le front ne passe jamais d'URL ni d'hôte à une requête : seulement l'identifiant d'une cible
  de `net_targets` (table accessible par commandes Rust seulement, comme `feed_filters` et
  `feed_items`).
- Ajout d'une cible : validation Rust, puis dialogue Windows natif ouvert par le Rust (un script
  injecté ne peut pas y répondre) ; un dialogue à la fois, 10 s d'attente après un refus, jamais
  fenêtre cachée.
- Connexions publiques : résolveur DNS gardé, tout ou rien (une seule adresse non publique fait
  refuser la résolution) ; IP littérales et redirections revérifiées à chaque saut ; https seul ;
  ni proxy, ni cookie, ni Referer, ni compression ; 60 s entre deux requêtes vers un même hôte,
  Retry-After appliqué à l'hôte ; défi anti-robot détecté, jamais contourné.
- Réseau local : seulement des sondes (connexion TCP, statut HTTP sans corps) vers une IP
  littérale consentie, par un client distinct qui ne résout aucun nom. Boucle locale, link-local
  (dont 169.254.169.254) et multicast toujours interdits.
- Flux : 4 Mio max lus en flux, pré-analyse XML (profondeur 64, DTD interne refusée), texte brut
  seulement (y compris dans l'historique en base, revalidé à la lecture) ; le front n'utilise
  jamais innerHTML (garde de lint `check-no-raw-html`).
- Risques acceptés : surface résiduelle d'un XSS (lister ou supprimer des cibles, modifier un
  filtre, déclencher des requêtes bornées vers des cibles consenties) ; cibles restaurées depuis
  une archive choisie par Marius (revalidées à la lecture).
- Jetons (phase 6) : gestionnaire d'identifiants Windows, côté Rust, attachés seulement à un
  Endpoint fixe sans redirection, jamais relisibles par le front.
```

### 19.3 `docs/ROADMAP.md`, phase 3
Remplacer « (O) Spec du client HTTP sortant… » par :
```
- [x] (O) Spec du client HTTP sortant en Rust (`docs/specs/http-client.md`, décisions N1 à N16 validées par Marius le <date>)
- [ ] (S) Lot OH1 (spec http-client) : cœur `net` (adresses, politique d'URL, résolveur gardé, redirections, régulateur par hôte) ; parallélisable avec O3
- [ ] (S) Lot OH2 : `net_targets` (+ tables des flux), consentement natif, commandes `net_target_*`, Réglages « Accès réseau » (après O3)
- [ ] (S) Lot OH3 : flux (`feed_fetch`, `feed_items`, `feed_filter_set`, feed-rs, texte brut, auteur, filtre, historique), `core/feeds` ; fixture XenForo Hypixel
- [ ] (S) Lot OH4 : sondes (`probe_run`, client LAN), `core/probes`
- [ ] (O) Mini-specs des widgets RSS et Statut de services (UI d'ajout, filtre, états, config)
```
Et cocher « (H, scout) Lister les flux RSS des sources de Marius » si la liste de §1.4 est complète pour lui.

### 19.4 `docs/adr/001-widget-contract.md` §3.8, ligne `network`
Ajouter à la fin de la cellule de droite : « *Amendement (spec http-client, 2026-11-25)* : `FeedService` (`feed_fetch`, `feed_items`, `feed_filter_set`) et `ProbeService` (`probe_run`) ne prennent qu'un identifiant de cible de `net_targets` ; ajout d'une cible par `net_target_request` avec dialogue natif de consentement ; aucune permission de plugin ajoutée. »

---

## 20. Couplages avec `docs/specs/typed-data-commands.md` (non tranchés ici)

| # | Point | Ce que cette spec suppose | À aligner |
|---|---|---|---|
| C1 | Accès Rust à la base pour `net_targets`, `feed_filters`, `feed_items` (connexion sqlx par opération et verrou, comme `schedule`, ou mécanisme commun introduit par typed-data-commands) ; `PRAGMA foreign_keys` sur cette connexion | Le mécanisme commun, quel qu'il soit ; transaction pour la fusion de l'historique | OH2/OH3 suivent la convention fixée par typed-data-commands |
| C2 | Numéro de la migration (trois tables) | `V<n>` libre au moment d'OH2 | Coordinateur, selon l'ordre de fusion |
| C3 | `capability_tests.rs` et `default.json` : typed-data-commands retire `sql:allow-*`, compare la CSP en chaîne exacte et `debug.json` en liste exacte | OH2 à OH4 ajoutent des permissions **après** sa fusion | Ne pas mener OH2 en parallèle de ce chantier |
| C4 | Forme de l'erreur de stockage (`storage` ici) et de `not_found` | `{ kind: "storage" }` | Reprendre le nom et la forme choisis par typed-data-commands s'ils diffèrent |
| C5 | Export/import de configuration (`config_export_save`, `config_import_apply`) si N9 = a | Tableau `netTargets` (avec filtres) dans le JSON (nouvelle `formatVersion`), insertion avec `consented_at = NULL` ; l'historique n'est jamais exporté | À spécifier avec le format d'export ; coordonner si typed-data-commands touche l'import |
| C6 | Emplacement du dépôt front (`data/tauri/net-target.repository.ts`, interface dans `data/repositories.ts`, chargement à la demande) | Même modèle que reminders/habits | Suivre la convention `data/tauri` confirmée par typed-data-commands |
| C7 | Garde « aucun SQL front sur `net_targets`, `feed_filters`, `feed_items` » | Test équivalent à V7/V8 | Si typed-data-commands supprime tout SQL front, la garde devient générale et celle-ci inutile |
| C8 | Suppression d'instances de widget et de tableaux (`dashboard_delete`) | Filtre et historique rattachés à la **source**, pas à l'instance : supprimer un widget ne les efface pas | Sans objet ici ; à revoir dans les mini-specs des widgets |
| C9 | Restauration d'une sauvegarde | Les trois tables sont restaurées comme les autres et revalidées à la lecture | Aucun traitement particulier attendu de typed-data-commands |
