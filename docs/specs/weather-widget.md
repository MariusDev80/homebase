# Spec : widget Météo (Open-Meteo + géocodage)

- **Statut** : prêt à implémenter (révisé le 2026-10-21 après revue indépendante ; décisions de Marius en §13)
- **Date** : 2026-10-21
- **Auteur** : architect (Opus)
- **Destinataire** : `implementer` (Sonnet), en **trois lots** (§5) : W1 (Rust), W2a (`core/weather`), W2b (widget). Chaque lot est autonome : lire aussi `CLAUDE.md`, `docs/DESIGN.md` (dont l'exception « icônes météo » de §5), `docs/adr/001-widget-contract.md` (§3.1, §3.6, §3.8), `docs/adr/002-data-layer.md` (§3.3), `docs/adr/003-time-model.md` (§3.1, §3.6, §8.2).
- **ROADMAP** : phase 1, « Widget météo Open-Meteo (+ géocodage) ».

> Règle : ne pas improviser. Si une supposition (§1.3) se révèle fausse, si une dépendance ne compile pas, ou si un critère ne peut pas être tenu sans s'écarter de cette spec, **s'arrêter et rapporter**.

---

## 1. Contexte

La météo est le premier widget qui sort sur le réseau. Elle arrive en phase 1, alors que la spec générale du client HTTP sortant (`OutboundHttp`, anti-SSRF, exception NAS) est prévue en phase 3. ADR-001 §3.8 fixe déjà la frontière : **aucune** permission `http:*` exposée au JS, des commandes Rust dédiées, une liste d'hôtes, des timeouts et une taille maximale. La CSP (`connect-src 'self' ipc: http://ipc.localhost`) interdit au front tout appel réseau direct, et doit le rester.

On livre donc le strict nécessaire, sans dette : un petit module Rust `net` réutilisable en phase 3, deux commandes météo à hôtes fixes, un service `core/weather` côté front, et le widget.

### 1.1 Faits vérifiés sur les sources (2026-10-21)

| # | Fait | Source |
|---|---|---|
| W1 | Prévisions : `GET https://api.open-meteo.com/v1/forecast`. Paramètres `latitude`, `longitude`, `current`, `daily` (exige `timezone`), `timezone` (nom IANA ou `auto`, « auto resolves the time zone from the coordinates »), `forecast_days` 0 à 16 (défaut 7), `temperature_unit` (`celsius`), `wind_speed_unit` (`kmh`), `precipitation_unit` (`mm`), `timeformat` (`iso8601`). Erreur : HTTP 400 `{"error": true, "reason": "…"}` | https://open-meteo.com/en/docs |
| W2 | `timezone` : le décalage UTC **au moment de la requête** sert pour les horodatages et les bornes de jours de toute la réponse ; « Daylight saving time (DST) changes within the requested range are ignored » | https://open-meteo.com/en/docs |
| W3 | `current` : « time specifies the moment at which the data is valid », `interval` = 900 s | https://open-meteo.com/en/docs |
| W4 | Codes WMO documentés : 0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 97, 99 (96 et 99 seulement pour les modèles avec grêle ; les autres renvoient 95 et 97) | https://open-meteo.com/en/docs |
| W5 | Réponse réelle (Paris, 3 jours) : `current.time` = `"2026-10-21T11:15"` (heure locale sans secondes), `daily.time` = `"YYYY-MM-DD"`, `current_units.temperature_2m` = `"°C"`, `current_units.wind_speed_10m` = `"km/h"`, `weather_code` entier, `is_day` 0/1. Contenu exact en §11.1 | requête directe |
| W6 | `timezone=auto` et virgules encodées `%2C` dans `current` / `daily` acceptés | requête directe |
| W7 | Géocodage : `GET https://geocoding-api.open-meteo.com/v1/search`, paramètres `name`, `count` 1 à 100 (défaut 10), `language` (défaut `en`), `format` (`json`). Moins de 2 caractères : aucun résultat. « Empty fields are not returned » | https://open-meteo.com/en/docs/geocoding-api |
| W8 | Géocodage, réponse réelle : `results` (tableau) avec `id`, `name`, `latitude`, `longitude`, `admin1..4`, `country`, `timezone`, `postcodes`…, `country` traduit selon `language`. **Sans résultat, la clé `results` est absente**. `postcodes` peut dépasser 80 entrées | requêtes directes |
| W9 | API gratuite : usage **non commercial** ; 600 appels/min, 5 000/h, 10 000/jour, 300 000/mois ; blocage possible des IP abusives ; pas de clé | https://open-meteo.com/en/terms |
| W10 | Données sous **CC BY 4.0** : « You must include a link next to any location Open-Meteo data are displayed », exemple `<a href="https://open-meteo.com/">Weather data by Open-Meteo.com</a>` | https://open-meteo.com/en/licence |
| W11 | Géocodage : « Location data based on GeoNames » | https://open-meteo.com/en/docs/geocoding-api |
| W12 | `reqwest` **0.13.5** (2026-09-08). Depuis 0.13.0 : TLS par défaut = rustls + **aws-lc** ; `query`/`form` optionnelles ; `native-tls` inclut ALPN ; 0.13.4 : TLS 1.3 avec `native-tls`. `default` = `charset`, `default-tls`, `http2`, `system-proxy` | https://crates.io/api/v1/crates/reqwest ; https://github.com/seanmonstar/reqwest/blob/master/CHANGELOG.md ; https://docs.rs/crate/reqwest/0.13.5/features |
| W13 | `aws-lc-sys` sous Windows x86_64 MSVC : NASM requis, sauf objets précompilés (`prebuilt-nasm`) | https://aws.github.io/aws-lc-rs/requirements/windows.html |
| W14 | `ClientBuilder` 0.13.5 : `https_only`, `redirect`, `timeout`, `connect_timeout`, `user_agent`, `no_proxy`, `referer`, `tls_version_min` (remplace `min_tls_version`, dépréciée), `tls_backend_native`, `dns_resolver`. `Response::chunk(&mut self)` async, `content_length()`, `json()` seulement avec la feature `json`. `tls::Version::TLS_1_2` existe | https://docs.rs/reqwest/0.13.5/reqwest/struct.ClientBuilder.html ; …/struct.Response.html ; …/tls/struct.Version.html |
| W15 | `tauri-plugin-http` 2.8.3 ; `ureq` 3.4.2 (bloquant, rustls/ring par défaut) | https://crates.io/api/v1/crates/tauri-plugin-http ; https://crates.io/api/v1/crates/ureq |
| W16 | Lucide : licence **ISC** (« Copyright (c) 2026 Lucide Icons and Contributors »), icônes dérivées de Feather sous MIT (« Copyright (c) 2013-present Cole Bemis »). Icônes vérifiées présentes : `cloud-hail`, `cloud-sun`, `cloud-sun-rain`, `cloud-moon`, `cloud-fog`, `cloud-drizzle`, `cloud-lightning`, `circle-question-mark` (`circle-help` n'existe plus) | https://raw.githubusercontent.com/lucide-icons/lucide/main/LICENSE ; `…/main/icons/<nom>.svg` |
| W17 | Dépôt : `build.rs` restreint les commandes par `AppManifest::commands`, qui génère `permissions/autogenerated/<commande>.toml` (déjà commités pour les 3 commandes existantes) ; `default.json` liste exactement 5 permissions, vérifiées par `src/capability_tests.rs` ; deux `invoke_handler` (debug / release) ; `.prettierignore` n'exclut de `src-tauri` que `gen` et `icons` ; `core/system/url-opener.ts` est le modèle de service sensible ; `isTauriRuntime()` dans `tauri-runtime.ts` ; PrimeIcons 8.0.2 n'a ni pluie, ni neige, ni brouillard | lecture du dépôt |

### 1.2 Faits vérifiés expérimentalement par la revue (Windows MSVC, 2026-10-21)
- reqwest 0.13.5 + `native-tls` compile **sans NASM ni `aws-lc-sys`**.
- Aucune redirection suivie avec `Policy::none()` ; `http://` refusé par `https_only` ; TLS 1.1, certificat expiré et nom d'hôte faux refusés ; le timeout fonctionne.
- Aucun en-tête `Accept-Encoding` envoyé (pas de feature de compression).
- `chunk()` renvoie des morceaux d'au plus 16 kio ; l'endpoint de prévisions répond **en chunked, sans `Content-Length`**.
- `timezone=auto` peut renvoyer `GMT`, `Etc/GMT`, `Etc/GMT+11`, `Antarctica/McMurdo` (océans, pôles).
- Open-Meteo **accepte une langue inconnue** (d'où la liste fermée côté Rust, §6.2).
- Les 29 codes WMO, leurs libellés FR (§8.3), les conditions d'utilisation et la licence sont corrects.
- Tauri 2.12.4 verrouille déjà reqwest 0.13.5 dans `Cargo.lock` (dépendance réservée au mobile, sans effet sur les features Windows).

### 1.3 Supposé (à vérifier pendant l'implémentation)

| # | Supposition | Vérifiée par |
|---|---|---|
| S2 | Les commandes Tauri `async fn` s'exécutent dans le runtime tokio de Tauri, compatible avec reqwest (pas de panique « no reactor running ») | CA-W1-M (lot W1) |
| S3 | `normalizeTimeZone` (Temporal) accepte `GMT`, `Etc/GMT`, `Etc/GMT+11`, `Antarctica/McMurdo`. Sinon : repli sur le fuseau utilisateur, déjà prévu | test W2b (§8.9) |
| S4 | Valibot expose `v.finite()` (sinon `v.check(Number.isFinite)`) | compilation |
| S5 | `Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })` donne « jeu. 23 » (comparer à `Intl` construit dans le test) | test W2a |
| S6 | Les deux endpoints renvoient `Content-Type: application/json` (éventuellement suivi de `; charset=…`) | CA-W1-M |
| S7 | **Aucun proxy** n'est configuré sur le PC de Marius (`no_proxy()` les ignore tous) : en attente de sa confirmation | Marius (§13) |
| S8 | Les icônes Lucide `sun`, `moon`, `cloud`, `cloud-rain`, `cloud-snow`, `snowflake` existent (héritées de Feather, non revérifiées une à une) | lot W2b |

---

## 2. Options étudiées

### 2.1 Où partent les requêtes
| Option | Verdict |
|---|---|
| A. `fetch` depuis le front + `connect-src` élargi | **Rejeté** : tout script injecté pourrait exfiltrer ; contraire à ADR-001 §3.8 |
| B. `tauri-plugin-http` avec permission JS limitée aux deux hôtes | **Rejeté** : `http:*` interdit côté JS ; le front recevrait du JSON brut |
| C. `tauri-plugin-http` côté Rust seulement | **Rejeté** : enregistre des commandes `plugin:http|*` inutiles pour n'apporter qu'une réexportation de reqwest |
| **D. Commandes Rust dédiées, hôtes en dur, client HTTP Rust** | **Retenu** : le front ne reçoit que des structures validées ; CSP inchangée ; base de `OutboundHttp` |

### 2.2 Crate HTTP
| Option | Pour | Contre |
|---|---|---|
| reqwest 0.13 par défaut (rustls + aws-lc) | Standard de fait | NASM sous Windows (W13) |
| reqwest `rustls-no-provider` + ring | Pas de NASM | Configuration TLS manuelle |
| ureq 3.4 | Peu de dépendances | Bloquant (`spawn_blocking`) ; anti-SSRF de phase 3 à écrire dans un autre modèle que l'asynchrone de Tauri |
| **reqwest 0.13.5, `default-features = false`, `features = ["native-tls"]`** | Asynchrone sur le tokio de Tauri ; TLS de Windows (SChannel), correctifs par Windows Update, TLS 1.3 ; aucun outil C en plus (vérifié, §1.2) ; `dns_resolver` pour la phase 3 | Arbre de dépendances plus lourd ; `Cargo.lock` contient des paquets TLS d'autres plateformes (§6.7, `cargo audit`) |

**Retenu : reqwest 0.13.5 + native-tls**, sans `json`, `http2`, `system-proxy` ni compression.

### 2.3 Cache
Décidé par Marius : **mémoire seulement** (aucune table). Justification : l'app tourne en continu dans la zone de notification ; au démarrage automatique, le réseau revient en quelques secondes et les nouveaux essais suffisent. Configuration du widget et `settings` écartés (données ≠ préférences, ADR-001 §3.4).

### 2.4 Fuseau des prévisions
`timezone=auto` et fuseau lu dans la réponse (plutôt qu'un fuseau stocké en config, qui pourrait être refusé par Open-Meteo et bloquer le widget en permanence). Le fuseau renvoyé est validé par le Rust (forme), puis par `normalizeTimeZone` côté front, avec repli sur le fuseau utilisateur.

---

## 3. Décision (résumé)
1. **Rust** : module `net` (client HTTPS unique, sans redirection ni proxy, timeouts, taille max, concurrence plafonnée, hôtes fixés par l'énumération fermée `Endpoint`, fonctions de contrôle pures et testées) et module `weather` (deux commandes asynchrones, entrées bornées, désérialisation typée, sorties validées, erreurs typées). Aucun plugin HTTP.
2. **Capabilities** : `allow-weather-forecast`, `allow-weather-geocode`. CSP **inchangée**.
3. **Front** : `core/weather` (`WeatherService` + `WEATHER_API`), seul point d'appel des commandes, `assertWidgetPermission(ctx, 'network')` sur toutes les méthodes, revalidation Valibot, cache mémoire de 30 min, dédoublonnage, délai minimal entre essais limité aux actualisations déclenchées par le focus.
4. **Widget** `weather` : permissions `network` et `open-url` (attribution obligatoire), config `{ location, days }`, dispositions compacte / complète, états vide / chargement / erreur / données périmées, recherche de ville avec délai de 300 ms, icônes SVG locales (exception DESIGN).
5. Aucune géolocalisation système, aucune table, aucun secret.

### 3.1 Reprise par `OutboundHttp` (phase 3)
- `net::NetClient` devient le cœur d'`OutboundHttp` : la phase 3 ajoutera à `Endpoint` une variante dynamique (URL validée, hôtes en réglage), un `dns_resolver` qui refuse les IP privées, de bouclage et link-local (sauf liste NAS), des limites par endpoint. `check_response` et `read_limited` sont réutilisés tels quels. Les endpoints Open-Meteo restent des constantes et passent par les mêmes contrôles.
- Côté front : pas de client HTTP générique, un service typé par source (`WeatherService`, puis `FeedService`, `ProbeService`).
- Pas de filtrage d'IP en phase 1 : hôtes publics constants, connexion authentifiée par TLS (une réponse DNS détournée vers une IP privée échoue à la vérification du certificat, vérifié en §1.2 pour un nom d'hôte faux).

---

## 4. Contrat IPC (figé avant tout lot)

Les lots W1 et W2a l'implémentent chacun de leur côté ; il ne change pas sans amender cette spec.

### 4.1 Commandes
| Commande | Arguments JSON (côté JS) | Succès |
|---|---|---|
| `weather_forecast` | `{ "latitude": number, "longitude": number }` | `Forecast` (§4.2) |
| `weather_geocode` | `{ "query": string, "language": "fr" \| "en" }` | `Place[]` (0 à 10, §4.2) |

### 4.2 Charges de succès (clés camelCase exactes)
```json
{
  "timeZone": "Europe/Paris",
  "current": {
    "temperatureC": 12.8,
    "apparentTemperatureC": 9.7,
    "relativeHumidityPct": 74,
    "windSpeedKmh": 18.1,
    "weatherCode": 3,
    "isDay": true
  },
  "daily": [
    { "date": "2026-10-21", "weatherCode": 80, "temperatureMaxC": 14.9, "temperatureMinC": 8.4, "precipitationProbabilityPct": 35 }
  ]
}
```
- `apparentTemperatureC`, `relativeHumidityPct`, `windSpeedKmh` : nombre ou `null`. `temperatureC` : nombre fini dans [-100, 100]. `weatherCode` courant : entier 0..99. `isDay` : booléen.
- `daily` : 1 à 16 éléments, dates `YYYY-MM-DD` strictement croissantes ; `weatherCode` entier 0..99 ou `null` ; les trois autres valeurs nombre ou `null`.
- `timeZone` : 1 à 64 caractères, motif `^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$`.

```json
[ { "id": 3037854, "name": "Amiens", "region": "Hauts-de-France", "country": "France", "latitude": 49.9, "longitude": 2.3 } ]
```
- `id` entier ≥ 0 unique dans la liste ; `name` 1 à 200 caractères ; `region`, `country` : chaîne de 1 à 200 caractères ou `null` ; coordonnées finies dans les bornes.

### 4.3 Charge d'erreur (rejet de `invoke`)
Objet `{ "kind": <snake_case>, … }`, cohérent avec `DataError` et les codes de l'ADR-003 :

| `kind` | Champs | Sens |
|---|---|---|
| `invalid_input` | `field`: `"latitude"` \| `"longitude"` \| `"query"` \| `"language"` | Entrée refusée par le Rust |
| `client_unavailable` | — | Le client HTTP n'a pas pu être construit au démarrage |
| `forbidden` | — | URL refusée par `check_url` (erreur de programmation) |
| `network` | — | DNS, connexion, TLS ou lecture du corps |
| `timeout` | — | Délai dépassé |
| `upstream_status` | `status`: entier | Statut HTTP hors 2xx (3xx compris) |
| `too_large` | — | Corps au-delà de la limite |
| `invalid_response` | — | Content-Type, JSON, unités ou valeurs invalides |

Le front ajoute trois genres qui ne viennent jamais du Rust : `unavailable` (hors Tauri), `throttled` (refus du limiteur local, avec `retryAfterMs`) et `unknown` (tout rejet non conforme, par exemple l'erreur texte de Tauri si un argument a un mauvais type).

---

## 5. Prérequis et découpage

### 5.1 Prérequis communs
- ADR-003 lot A : commité (fait).
- **Le widget TODO (en cours) doit être commité avant le début de n'importe quel lot météo** : il prend la migration V3 et modifie `widgets/widgets.providers.ts`, `core/i18n/fr.json` et `data/**`. Si ce n'est pas le cas au démarrage : s'arrêter et demander.
- La météo n'ajoute **aucune migration** et ne touche ni `data/**`, ni `migrations/`, ni `tauri.conf.json`, ni `docs/adr/003-time-model.md`.

### 5.2 Lots
| Lot | Contenu | Dépend de | Budget |
|---|---|---|---|
| **W1** | Rust : `net`, `open_meteo`, commandes, capabilities, tests ; vérification manuelle par `invoke` depuis les outils de développement | §4 | ~40 étapes max |
| **W2a** | Front `core/weather` : types, erreurs, schémas, API, service (limiteur §7.4), `FakeWeatherApi`, style d'affichage `weekday-short` | §4 seulement (indépendant de W1) | ~40 étapes max |
| **W2b** | Widget : config, définition, codes, formatage, composant, sélecteur de lieu, icônes SVG, i18n | W2a (et W1 pour les vérifications manuelles) | ~40 étapes max |

Au-delà du budget sans avoir fini : s'arrêter et rapporter l'état (fichiers faits, tests verts ou non, reste à faire). W1 et W2a peuvent être menés en parallèle.

---

## 6. Lot W1 : Rust (`apps/desktop/src-tauri/`)

### 6.1 Fichiers
Créer :
```
src/net/mod.rs
src/weather/mod.rs
src/weather/open_meteo.rs
src/weather/fixtures/forecast_paris.json              (§11.1, verbatim)
src/weather/fixtures/forecast_nulls.json
src/weather/fixtures/forecast_bad_units.json
src/weather/fixtures/forecast_mismatched_lengths.json
src/weather/fixtures/geocode_amiens.json              (§11.2)
src/weather/fixtures/geocode_empty.json               ({"generationtime_ms":0.09286404})
src/weather/fixtures/geocode_partial.json
permissions/autogenerated/weather_forecast.toml       (généré par build.rs, à commiter)
permissions/autogenerated/weather_geocode.toml        (généré par build.rs, à commiter)
```
Modifier :
```
Cargo.toml                    reqwest = { version = "0.13.5", default-features = false, features = ["native-tls"] }
                              tokio = { version = "1", default-features = false, features = ["sync"] }
build.rs                      + "weather_forecast", "weather_geocode" dans AppManifest::commands
src/lib.rs                    mod net; mod weather; .manage(net::NetClient::new()) ; commandes dans les DEUX invoke_handler
capabilities/default.json     + "allow-weather-forecast", "allow-weather-geocode" ; description (§6.5)
src/capability_tests.rs       liste attendue + 2 tests (§6.6)
.prettierignore (racine)      + apps/desktop/src-tauri/src/**/fixtures   (les fixtures restent verbatim)
Cargo.lock                    mis à jour par cargo
```
`tokio` est déjà une dépendance de Tauri : l'ajout direct ne sert qu'au `Semaphore` (feature `sync`).

### 6.2 `src/weather/open_meteo.rs` (pur, sans I/O)
```rust
use serde::Serialize;

pub const FORECAST_DAYS: u8 = 7;
pub const GEOCODE_COUNT: u8 = 10;
pub const QUERY_MIN_CHARS: usize = 2;
pub const QUERY_MAX_CHARS: usize = 100;
pub const TEXT_MAX_CHARS: usize = 200;
pub const LANGUAGES: [&str; 2] = ["fr", "en"];
pub const CURRENT_VARIABLES: &str =
    "temperature_2m,apparent_temperature,relative_humidity_2m,is_day,weather_code,wind_speed_10m";
pub const DAILY_VARIABLES: &str =
    "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WeatherError {
    InvalidInput { field: &'static str },
    ClientUnavailable,
    Forbidden,
    Network,
    Timeout,
    UpstreamStatus { status: u16 },
    TooLarge,
    InvalidResponse,
}
// impl From<NetError> : Unavailable → ClientUnavailable ; Forbidden → Forbidden ; Timeout → Timeout ;
// Network → Network ; Status(s) → UpstreamStatus { status: s } ; TooLarge → TooLarge ;
// UnexpectedContentType → InvalidResponse.

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Place { pub id: u64, pub name: String, pub region: Option<String>, pub country: Option<String>,
                   pub latitude: f64, pub longitude: f64 }

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Forecast { pub time_zone: String, pub current: Current, pub daily: Vec<Day> }

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Current { pub temperature_c: f64, pub apparent_temperature_c: Option<f64>,
                     pub relative_humidity_pct: Option<f64>, pub wind_speed_kmh: Option<f64>,
                     pub weather_code: u8, pub is_day: bool }

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Day { pub date: String, pub weather_code: Option<u8>, pub temperature_max_c: Option<f64>,
                 pub temperature_min_c: Option<f64>, pub precipitation_probability_pct: Option<f64> }

pub fn validate_coordinates(latitude: f64, longitude: f64) -> Result<(f64, f64), WeatherError>;
/// "{:.4}", -0 normalisé en "0.0000".
pub fn format_coordinate(value: f64) -> String;
/// latitude, longitude, current, daily, timezone=auto, forecast_days=7, temperature_unit=celsius,
/// wind_speed_unit=kmh, precipitation_unit=mm, timeformat=iso8601 (dans cet ordre).
pub fn forecast_query(latitude: f64, longitude: f64) -> Vec<(&'static str, String)>;
/// trim ; 2..=100 caractères (chars().count()) ; aucun caractère de contrôle ni de formatage bidi.
pub fn validate_query(query: &str) -> Result<String, WeatherError>;
/// Liste fermée LANGUAGES (Open-Meteo accepte n'importe quelle valeur, §1.2).
pub fn validate_language(language: &str) -> Result<&'static str, WeatherError>;
/// name, count=10, language, format=json.
pub fn geocode_query(query: &str, language: &str) -> Vec<(&'static str, String)>;
pub fn parse_forecast(body: &[u8]) -> Result<Forecast, WeatherError>;
pub fn parse_places(body: &[u8]) -> Result<Vec<Place>, WeatherError>;
```
Sérialisation des erreurs : `{"kind":"invalid_input","field":"latitude"}`, `{"kind":"upstream_status","status":429}`, `{"kind":"client_unavailable"}`…

**Texte « dangereux »** (fonction privée `is_forbidden_char`) : `char::is_control` **ou** formatage bidirectionnel U+202A à U+202E et U+2066 à U+2069.

**Structures brutes** (`Deserialize`, privées, **sans** `deny_unknown_fields`) : `RawForecast { timezone, current_units, current, daily_units, daily }`, `RawCurrentUnits { temperature_2m, wind_speed_10m }`, `RawCurrent { temperature_2m, apparent_temperature, relative_humidity_2m, is_day, weather_code, wind_speed_10m }` (tous `Option<f64>`), `RawDailyUnits { temperature_2m_max }`, `RawDaily { time: Vec<String>, weather_code, temperature_2m_max, temperature_2m_min, precipitation_probability_max }` (tableaux de `Option<f64>`), `RawGeocode { results: Option<Vec<RawPlace>> }`, `RawPlace { id: Option<u64>, name, latitude, longitude, admin1, country }` (tous `Option`).

Limite assumée (S-i de la revue) : un champ de `RawPlace` présent mais d'un **autre type** (ex. `latitude: "abc"`) fait échouer la désérialisation de **toute** la réponse (`InvalidResponse`), pas seulement de l'entrée. Accepté : l'API est typée de façon stable ; le message « réponse illisible » le signalerait.

**`parse_forecast`** (violation → `InvalidResponse`, sauf « → None ») :
- JSON invalide ou champ obligatoire absent.
- `timezone` : 1 à 64 caractères, motif §4.2 (vérifié à la main, sans crate `regex`). `GMT`, `Etc/GMT`, `Etc/GMT+11`, `Antarctica/McMurdo` acceptés (§1.2).
- Unités : `current_units.temperature_2m == "°C"`, `current_units.wind_speed_10m == "km/h"`, `daily_units.temperature_2m_max == "°C"`.
- Codes : entier (`fract() == 0`) dans 0..=99 ; sinon courant → `InvalidResponse`, journalier → `None`.
- `current.temperature_2m` : obligatoire, fini, [-100, 100].
- Optionnels → `None` si absents, non finis ou hors bornes : températures [-100, 100], humidité et probabilité [0, 100], vent [0, 500].
- `is_day` : `0` → `false`, sinon → `true`.
- `daily` : 5 tableaux de même longueur, 1 à 16 ; `time` de forme `NNNN-NN-NN` ; dates strictement croissantes (comparaison de chaînes).

**`parse_places`** :
- JSON invalide → `InvalidResponse` ; `results` absent → `Ok(vec![])`.
- Entrée **ignorée** si : `id`, `name`, `latitude` ou `longitude` absent ; coordonnées non finies ou hors bornes ; `name` vide après `trim`, de plus de 200 caractères ou contenant un caractère dangereux ; `id` déjà vu (le premier gagne).
- `admin1` → `region`, `country` → `country` : `trim`, puis `None` si vide, de plus de 200 caractères ou contenant un caractère dangereux.
- Au plus 10 entrées, ordre de l'API conservé.

### 6.3 `src/net/mod.rs`
```rust
//! Outbound HTTPS (ADR-001 §3.8). Phase 1: fixed Open-Meteo endpoints only.
//! Phase 3 (OutboundHttp) extends `Endpoint` and adds a DNS resolver refusing private addresses.
//! reqwest is built without compression features: no Accept-Encoding is sent (bodies are small),
//! so the size limit applies to the bytes actually received.

use std::time::Duration;

pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
pub const TOTAL_TIMEOUT: Duration = Duration::from_secs(10);
pub const MAX_CONCURRENT_REQUESTS: usize = 4;
pub const USER_AGENT: &str = concat!("Homebase/", env!("CARGO_PKG_VERSION"));

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Endpoint { OpenMeteoForecast, OpenMeteoGeocoding }

impl Endpoint {
    pub const fn base_url(self) -> &'static str;   // https://api.open-meteo.com/v1/forecast | https://geocoding-api.open-meteo.com/v1/search
    pub const fn host(self) -> &'static str;       // api.open-meteo.com | geocoding-api.open-meteo.com
    pub const fn max_body_bytes(self) -> usize;    // 64 * 1024 | 256 * 1024
    /// Base constante + paires déjà validées (append_pair, encodage formulaire).
    pub fn url(self, query: &[(&str, String)]) -> reqwest::Url;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NetError { Unavailable, Forbidden, Timeout, Network, Status(u16), TooLarge, UnexpectedContentType }

/// Pur : schéma https, host == endpoint.host(), sans identifiants, sans port explicite, chemin == celui de base_url().
pub fn check_url(endpoint: Endpoint, url: &reqwest::Url) -> Result<(), NetError>;

/// Pur, dans cet ordre :
/// 1. status hors 200..=299 → Status(status) ;
/// 2. content_type : partie avant le premier ';', trim, égale à "application/json" sans tenir compte de la casse,
///    sinon (y compris absent ou non UTF-8) → UnexpectedContentType ;
/// 3. content_length Some(n) avec n > max → TooLarge.
pub fn check_response(status: u16, content_type: Option<&str>, content_length: Option<u64>, max: usize)
    -> Result<(), NetError>;

/// Source de morceaux de corps (Response en production, file de morceaux en test).
pub(crate) trait ChunkSource {
    fn next_chunk(&mut self)
        -> impl std::future::Future<Output = Result<Option<Vec<u8>>, NetError>> + Send;
}

/// Lit au plus `max` octets : Vec::new() (AUCUNE pré-allocation tirée de Content-Length) ;
/// pour chaque morceau, si body.len() + chunk.len() > max → TooLarge AVANT d'étendre ; sinon extend.
pub(crate) async fn read_limited<S: ChunkSource>(source: &mut S, max: usize) -> Result<Vec<u8>, NetError>;

pub struct NetClient { client: Option<reqwest::Client>, permits: tokio::sync::Semaphore }

impl NetClient {
    /// Construit le client unique ; en cas d'échec, eprintln! sans URL ni requête, client = None.
    pub fn new() -> Self;
    #[cfg(test)]
    pub fn is_available(&self) -> bool;
    pub async fn get_json(&self, endpoint: Endpoint, url: reqwest::Url) -> Result<Vec<u8>, NetError>;
}
impl Default for NetClient { fn default() -> Self { Self::new() } }   // clippy::new_without_default
```
Construction du client (exactement) :
```rust
reqwest::Client::builder()
    .https_only(true)
    .redirect(reqwest::redirect::Policy::none())
    .connect_timeout(CONNECT_TIMEOUT)
    .timeout(TOTAL_TIMEOUT)
    .user_agent(USER_AGENT)
    .no_proxy()
    .referer(false)
    .tls_version_min(reqwest::tls::Version::TLS_1_2)
    .tls_backend_native()
    .build()
```
`get_json`, dans l'ordre :
1. `client` absent → `Unavailable` ; `check_url` en échec → `Forbidden`.
2. Acquérir un jeton du `Semaphore` (`MAX_CONCURRENT_REQUESTS`), gardé jusqu'à la fin de la lecture du corps. Échec d'acquisition (impossible : jamais fermé) → `Unavailable`.
3. `send()` avec `Accept: application/json` ; erreur : `is_timeout()` → `Timeout`, sinon `Network`.
4. `check_response(status, Content-Type, content_length(), endpoint.max_body_bytes())`.
5. `read_limited` sur un adaptateur `ChunkSource` de la `Response` (`chunk().await` → `Vec<u8>`, erreur classée comme en 3).

Journalisation : aucune URL, aucun texte recherché. Si une erreur reqwest devait un jour être journalisée : `error.without_url()`.

### 6.4 `src/weather/mod.rs`
```rust
pub mod open_meteo;

#[tauri::command]
pub async fn weather_forecast(net: tauri::State<'_, crate::net::NetClient>, latitude: f64, longitude: f64)
    -> Result<open_meteo::Forecast, open_meteo::WeatherError>;
// validate_coordinates → forecast_query → Endpoint::OpenMeteoForecast.url(&pairs) → get_json → parse_forecast

#[tauri::command]
pub async fn weather_geocode(net: tauri::State<'_, crate::net::NetClient>, query: String, language: String)
    -> Result<Vec<open_meteo::Place>, open_meteo::WeatherError>;
// validate_query, validate_language → geocode_query → Endpoint::OpenMeteoGeocoding.url(&pairs) → get_json → parse_places
```
Commandes minces : aucune logique hors de l'enchaînement.

### 6.5 `lib.rs`, `build.rs`, capabilities
- `lib.rs` : `mod net; mod weather;` ; `.manage(net::NetClient::new())` ; `weather::weather_forecast, weather::weather_geocode` dans **les deux** `generate_handler!`.
- `build.rs` : `["schedule_test_notification", "get_autostart", "set_autostart", "weather_forecast", "weather_geocode"]`.
- `default.json`, `permissions` dans cet ordre exact : `"allow-get-autostart"`, `"allow-set-autostart"`, `"allow-weather-forecast"`, `"allow-weather-geocode"`, `"sql:allow-execute"`, `"sql:allow-select"`, puis l'objet `opener:allow-open-url` inchangé. Ajouter à la description, **sans nom d'hôte** : « The weather commands only reach the two Open-Meteo hosts fixed in src/net (Endpoint enum); there is no http:* permission and the CSP connect-src stays local. »
- `capabilities/debug.json`, `tauri.conf.json` : inchangés.

### 6.6 Tests Rust (aucun appel réseau : `get_json` n'est jamais appelé dans un test)
Les tests asynchrones utilisent `tauri::async_runtime::block_on`.

`src/net/mod.rs` :
- `base_url()` de chaque endpoint : `https`, `host_str() == host()`, pas de port.
- `url(&[("name", "Saint-Étienne, France".to_string())])` : `check_url` accepte, `query_pairs()` redonne la valeur.
- `check_url` → `Forbidden` : `http://api.open-meteo.com/v1/forecast`, `https://evil.example/v1/forecast`, `https://user@api.open-meteo.com/v1/forecast`, `https://api.open-meteo.com:8443/v1/forecast`, `https://api.open-meteo.com/v1/other`, URL du géocodage présentée comme `OpenMeteoForecast`.
- `check_response` : `(200, "application/json", None)` ok ; `"Application/JSON; charset=utf-8"` ok ; `"application/jsonx"` → `UnexpectedContentType` ; `"text/html"` et `None` → `UnexpectedContentType` ; `302` → `Status(302)` (même avec un bon Content-Type) ; `429` → `Status(429)` ; `Content-Length` = max → ok ; max + 1 → `TooLarge`.
- `read_limited` (source de test : `VecDeque<Result<Vec<u8>, NetError>>`, futurs `std::future::ready`) : corps chunked de exactement `max` octets → ok ; `max + 1` sur plusieurs morceaux → `TooLarge` ; un seul morceau > max → `TooLarge` ; erreur `Network` au 2e morceau → `Network` ; source vide → `Vec` vide.
- Content-Length menteur (enchaînement `check_response` puis `read_limited`) : annonce 10 octets, corps de max + 1 → `TooLarge` ; annonce max + 1, corps de 10 → `TooLarge` sans lecture ; annonce 1 000, corps de 10 → ok (10 octets).
- `NetClient::new().is_available()` vrai (construction hors réseau).

`src/weather/open_meteo.rs` :
- `validate_coordinates` : `(0,0)`, `(90,180)`, `(-90,-180)` ok ; `90.0001`, `-90.0001`, `NaN`, `INFINITY` → `field: "latitude"` ; `180.1`, `NaN` → `field: "longitude"`.
- `format_coordinate` : `49.9` → `"49.9000"`, `2.35208` → `"2.3521"`, `-0.0` → `"0.0000"`, `-107.25119` → `"-107.2512"`.
- `forecast_query(49.9, 2.3)` : liste exacte.
- `validate_query` : `"  Amiens "` → `"Amiens"` ; `"Pa"` ok ; `""`, `" "`, `"A"` refusés ; 100 caractères (accentués) ok, 101 refusés ; `"Pa\u{7}ris"`, `"Pa\u{202E}ris"`, `"Pa\u{2066}ris"` refusés.
- `validate_language` : `"fr"`, `"en"` ok ; `"de"`, `"FR"`, `"fra"`, `""` → `field: "language"`.
- `geocode_query("Amiens", "fr")` : liste exacte.
- `parse_forecast(forecast_paris.json)` = valeur complète : `Europe/Paris` ; courant 12.8, 9.7, 74, 18.1, code 3, jour ; jours `2026-10-21` (80, 14.9, 8.4, 35), `2026-10-22` (80, 15.5, 9.0, 25), `2026-10-23` (61, 13.7, 9.9, 91).
- `forecast_nulls.json` : `apparent_temperature` `null`, un `temperature_2m_max` `null`, un code journalier `null`, humidité 120, `is_day` absent → `None` ×4 et `true`.
- Variantes construites à partir du fixture Paris (`serde_json::Value` modifié) → `InvalidResponse` : `current.temperature_2m` `null` ; code courant 3.5, 100, -1 ; `timezone` `""`, `"../etc"`, `"+02:00"` ; date `"2026-1-01"` ; dates non croissantes ; 17 jours ; JSON tronqué ; `{"error":true,"reason":"x"}`. Et acceptées : `timezone` `GMT`, `Etc/GMT`, `Etc/GMT+11`, `Antarctica/McMurdo`.
- `forecast_bad_units.json` (`°F`), `forecast_mismatched_lengths.json` → `InvalidResponse`.
- `parse_places(geocode_amiens.json)` = 3 lieux (§11.2) ; `geocode_empty.json` → `[]`.
- `geocode_partial.json` : entrée sans `latitude` ; sans `id` ; `name` de 201 caractères ; `name` avec `\u0007` ; `name` avec `‮` ; `latitude` 95 ; doublon d'`id` ; `admin1` vide et `country` absent (gardée, `None`/`None`) ; une valide. Résultat : exactement les deux dernières, dans l'ordre.
- 12 entrées valides → 10.
- Sérialisation exacte de chaque variante de `WeatherError` (§4.3) ; clés camelCase d'un `Forecast` et d'un `Place` (§4.2) ; `From<NetError>` une assertion par variante.

`src/capability_tests.rs` :
- `main_window_permissions_are_exactly_the_expected_ones` : nouvelle liste (§6.5).
- `no_http_plugin_permission` : aucune permission ne commence par `http:` ; la sérialisation ne contient pas `"http:` suivi d'autre chose que `/` (la portée opener `"http://*"` est légitime) ; les fichiers `capabilities/*.json` sont exactement `default.json` et `debug.json` ; `Cargo.toml` ne contient pas `tauri-plugin-http`.
- `csp_keeps_network_local` : `app.security.csp` de `tauri.conf.json` contient exactement `connect-src 'self' ipc: http://ipc.localhost;` et ne contient pas `open-meteo`.

### 6.7 Dépendances et `cargo audit`
- `Cargo.lock` contient, pour d'autres plateformes, des paquets TLS tirés par `native-tls` (`openssl`, `openssl-sys`, `security-framework`, `tempfile`…). Ils ne sont pas compilés sous Windows, mais `cargo audit` (qui lit tout le lockfile, y compris sur un runner Linux) les analyse.
- Politique : si un avis les concerne, d'abord `cargo update -p <paquet>` ; si aucune version corrigée n'existe, le **coordinateur** décide d'une exception justifiée dans `.cargo/audit.toml` (identifiant de l'avis + motif « non compilé pour la cible Windows »). L'implementer ne crée pas cette exception seul.

### 6.8 Critères d'acceptation W1
- **CA-W1-1** `npm run rust:test` vert avec tous les tests de §6.6.
- **CA-W1-2** `npm run rust:fmt:check`, `npm run rust:lint` (clippy `-D warnings`) et `npm run format:check` propres (fixtures exclues par `.prettierignore`, contenu verbatim).
- **CA-W1-3** `default.json` = liste §6.5 ; `rg -n '"http:[^/]' apps/desktop/src-tauri/capabilities` vide (la portée opener `"http://*"` est attendue) ; `rg -n "tauri-plugin-http|plugin-http" apps package.json` vide.
- **CA-W1-4** `git diff --stat -- apps/desktop/src-tauri/tauri.conf.json apps/desktop/src-tauri/capabilities/debug.json apps/desktop/src-tauri/migrations apps/web` vide.
- **CA-W1-5** `rg -n "api\.open-meteo\.com|geocoding-api\.open-meteo\.com" apps --glob '!**/fixtures/**'` : uniquement `apps/desktop/src-tauri/src/net/mod.rs`.
- **CA-W1-6** `Cargo.toml` contient exactement la ligne `reqwest` de §6.1. Sorties attendues (depuis la racine) :
  - `cargo tree -i aws-lc-sys --manifest-path apps/desktop/src-tauri/Cargo.toml` échoue avec un message contenant `did not match any packages` (attendu : le paquet n'est même pas dans le lockfile) ;
  - `cargo tree -i openssl-sys --manifest-path …` affiche `nothing to print` sous Windows (présent dans le lockfile pour d'autres cibles, non compilé) ;
  - `cargo tree -e features -i reqwest --manifest-path …` ne montre aucune feature `gzip`, `brotli`, `deflate`, `zstd`, `http2`, `system-proxy`, `rustls` ni `default-tls`.
- **CA-W1-7** `permissions/autogenerated/weather_forecast.toml` et `weather_geocode.toml` présents et commités.
- **CA-W1-8** `npm run build` produit les installateurs.
- **CA-W1-M** (manuel, `npm run dev`, console des outils de développement de la WebView) :
  - `await window.__TAURI_INTERNALS__.invoke('weather_forecast', { latitude: 49.9, longitude: 2.3 })` renvoie un objet conforme à §4.2 (S2, S6) ;
  - `… invoke('weather_geocode', { query: 'Amiens', language: 'fr' })` renvoie environ 3 lieux ;
  - `… invoke('weather_forecast', { latitude: 91, longitude: 0 })` rejette `{ kind: 'invalid_input', field: 'latitude' }` ;
  - `… invoke('weather_geocode', { query: 'Amiens', language: 'de' })` rejette `{ kind: 'invalid_input', field: 'language' }` ;
  - Wi-Fi coupé : `weather_forecast` rejette `{ kind: 'network' }` (ou `timeout`) ;
  - `fetch('https://api.open-meteo.com/v1/forecast?latitude=0&longitude=0')` est bloqué par la CSP ; `invoke('plugin:http|fetch', {})` échoue.

### 6.9 Commandes W1
```
npm run rust:fmt:check
npm run rust:lint
npm run rust:test
npm run format:check
cargo tree -i aws-lc-sys --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo tree -i openssl-sys --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo tree -e features -i reqwest --manifest-path apps/desktop/src-tauri/Cargo.toml
npm run build
npm run dev        # CA-W1-M
```

---

## 7. Lot W2a : front `core/weather` (`apps/web/src/app/`)

### 7.1 Fichiers
Créer :
```
core/weather/index.ts
core/weather/weather.types.ts
core/weather/weather-error.ts
core/weather/weather.schemas.ts
core/weather/weather-api.ts                (seul fichier qui invoque weather_forecast / weather_geocode)
core/weather/weather.service.ts
core/weather/weather.schemas.spec.ts
core/weather/weather-api.spec.ts
core/weather/weather.service.spec.ts
core/testing/fake-weather-api.ts
```
Modifier :
```
core/time/time-display.ts        DateStyle + 'weekday-short'
core/time/time-display.spec.ts   cas 'weekday-short'
```
`core/weather` ne doit être importé à l'exécution que par `widgets/weather/**` (jamais par `app.config.ts` ni par un fichier `*.definition.ts`) pour rester dans le chunk paresseux du widget.

### 7.2 Types (`weather.types.ts`)
```ts
import type { InstantIso, LocalDateIso } from '../../data';

export interface WeatherCoordinates { readonly latitude: number; readonly longitude: number; }
export interface WeatherPlace extends WeatherCoordinates {
  readonly id: number; readonly name: string; readonly region: string | null; readonly country: string | null;
}
export interface WeatherCurrent {
  readonly temperatureC: number; readonly apparentTemperatureC: number | null;
  readonly relativeHumidityPct: number | null; readonly windSpeedKmh: number | null;
  readonly weatherCode: number; readonly isDay: boolean;
}
export interface WeatherDay {
  readonly date: LocalDateIso; readonly weatherCode: number | null;
  readonly temperatureMaxC: number | null; readonly temperatureMinC: number | null;
  readonly precipitationProbabilityPct: number | null;
}
export interface WeatherForecast { readonly timeZone: string; readonly current: WeatherCurrent; readonly daily: readonly WeatherDay[]; }
/** fetchedAt : instant de réception lu sur CLOCK (jamais l'heure du modèle). */
export interface WeatherSnapshot { readonly forecast: WeatherForecast; readonly fetchedAt: InstantIso; }
export type WeatherLanguage = 'fr' | 'en';
```

### 7.3 Erreurs et schémas
```ts
// weather-error.ts
export type WeatherErrorKind =
  | 'invalid_input' | 'client_unavailable' | 'forbidden' | 'network' | 'timeout'
  | 'upstream_status' | 'too_large' | 'invalid_response'      // venus du Rust (§4.3)
  | 'unavailable' | 'throttled' | 'unknown';                  // front seulement
export class WeatherError extends Error {
  readonly kind: WeatherErrorKind;
  readonly status: number | null;        // upstream_status
  readonly field: string | null;         // invalid_input
  readonly retryAfterMs: number | null;  // throttled
  constructor(kind: WeatherErrorKind, details?: { status?: number; field?: string; retryAfterMs?: number });
}
/** WeatherError → telle quelle ; objet conforme au schéma de la charge d'erreur (§4.3, kinds Rust seulement)
 *  → WeatherError ; tout le reste (chaîne d'erreur Tauri, Error, objet inconnu) → 'unknown'. */
export function toWeatherError(error: unknown): WeatherError;
```
`weather.schemas.ts` : schémas Valibot `v.object` (jamais `looseObject`) miroirs de §4.2 et §4.3 : nombres finis, `weatherCode` entier 0..99, `date` via `v.check(isValidLocalDate)` (`core/time`), `timeZone` chaîne 1..64, `daily` 1..16, places ≤ 10, `name` 1..200. Exporte `parseForecastPayload(raw: unknown): WeatherForecast` et `parsePlacesPayload(raw: unknown): readonly WeatherPlace[]`, qui lèvent `WeatherError('invalid_response')`. Défense en profondeur : le Rust a déjà validé.

### 7.4 API et service
```ts
// weather-api.ts
export interface WeatherApi {
  forecast(latitude: number, longitude: number): Promise<unknown>;
  geocode(query: string, language: WeatherLanguage): Promise<unknown>;
}
/** invoke('weather_forecast', { latitude, longitude }) / invoke('weather_geocode', { query, language }) ;
 *  hors Tauri (isTauriRuntime() faux) : rejet WeatherError('unavailable') sans appel. */
export const WEATHER_API: InjectionToken<WeatherApi>; // providedIn 'root'

// weather.service.ts
export const WEATHER_MAX_AGE_MS = 30 * 60 * 1000;
export const WEATHER_MIN_RETRY_MS = 60 * 1000;
export const WEATHER_CACHE_MAX_ENTRIES = 20;
export const PLACE_QUERY_MIN_CHARS = 2;
export const PLACE_QUERY_MAX_CHARS = 100;

export interface ForecastOptions {
  /** Ignore la fraîcheur du cache ET le délai minimal (boutons Réessayer / Actualiser). */
  readonly force?: boolean;
  /** Ignore seulement le délai minimal (minuteur du composant, événement `online`, changement de lieu). */
  readonly ignoreRetryDelay?: boolean;
}

@Injectable({ providedIn: 'root' })
export class WeatherService {
  // injecte WEATHER_API, CLOCK, TranslocoService
  /** Dernier instantané pour ces coordonnées, sans réseau. Vérifie la permission 'network'. */
  cached(ctx: Pick<WidgetContext, 'type' | 'permissions'>, at: WeatherCoordinates): WeatherSnapshot | null;
  forecast(ctx: Pick<WidgetContext, 'type' | 'permissions'>, at: WeatherCoordinates, options?: ForecastOptions): Promise<WeatherSnapshot>;
  searchPlaces(ctx: Pick<WidgetContext, 'type' | 'permissions'>, query: string): Promise<readonly WeatherPlace[]>;
}
```
`forecast`, dans l'ordre :
1. `assertWidgetPermission(ctx, 'network')` avant toute autre action.
2. Coordonnées finies dans les bornes, sinon rejet `invalid_input` sans appel.
3. Clé de cache locale : `` `${latitude.toFixed(4)},${longitude.toFixed(4)}` `` (sert seulement à identifier un lieu côté front ; elle peut différer de l'arrondi du Rust dans de rares cas de demi-valeur, sans conséquence).
4. Sans `force` : instantané d'âge `0 ≤ durationBetween(fetchedAt, now) < WEATHER_MAX_AGE_MS` → le renvoyer. Âge négatif (horloge reculée) = périmé.
5. Requête en cours pour la clé → même promesse (y compris avec `force` : dédoublonnage toujours actif).
6. Sans `force` ni `ignoreRetryDelay` : si le dernier essai pour la clé a échoué il y a moins de `WEATHER_MIN_RETRY_MS`, rejet `WeatherError('throttled', { retryAfterMs })` **sans appel** (ce n'est pas un échec réseau).
7. Appel → `parseForecastPayload` → `{ forecast, fetchedAt: clock.nowIso() }` → cache (réinsertion en fin de `Map`, suppression de la plus ancienne au-delà de 20) → effacer l'échec mémorisé. Échec : `toWeatherError`, mémoriser `{ error, at }`, rejeter. Le cache n'est jamais vidé par un échec.

`cached` : permission vérifiée (lève `WidgetPermissionError`), puis lecture du cache par la même clé.

`searchPlaces` : permission ; `trim` ; moins de 2 caractères (`[...q].length`) → `[]` sans appel ; plus de 100 → `invalid_input` ; langue = `getActiveLang()` si elle vaut `'fr'` ou `'en'`, sinon `'fr'` ; pas de cache ni de limiteur ; `parsePlacesPayload`.

`index.ts` exporte : types, `WeatherError`, `toWeatherError`, `WEATHER_API`, `WeatherApi`, `ForecastOptions`, `WeatherService`, constantes. Pas les schémas.

`core/testing/fake-weather-api.ts` : `FakeWeatherApi implements WeatherApi`, réponses programmables (promesses contrôlables : `resolveNext`, `rejectNext`, ou file de réponses), compteur et arguments des appels.

### 7.5 `core/time/time-display.ts`
Ajouter `'weekday-short'` à `DateStyle`, options `{ weekday: 'short', day: 'numeric' }` (date murale formatée en UTC, sans conversion). Test : comparaison avec `new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })` construit dans le test, sur `2026-10-23` (S5).

### 7.6 Tests W2a
`ManualClock` fourni comme `CLOCK`, `FakeWeatherApi` comme `WEATHER_API`, `provideAppI18n()`. `@tauri-apps/api/core` mocké dans `weather-api.spec.ts` uniquement.
- `weather.schemas.spec.ts` : charges §4.2 acceptées ; `weatherCode` 3.5 / 100, `date` `2026-02-30`, `daily` vide ou de 17 jours, `temperatureC` `null` → `invalid_response` ; clé inconnue retirée ; places > 10 ou `name` vide → `invalid_response`. `toWeatherError` : `{ kind: 'upstream_status', status: 429 }` → kind + status ; `{ kind: 'invalid_input', field: 'query' }` → field ; `{ kind: 'throttled' }` (genre front, pas Rust), `{ kind: 'nope' }`, chaîne, `Error` → `unknown`.
- `weather-api.spec.ts` : hors Tauri → `unavailable`, `invoke` non appelé ; dans Tauri → `invoke('weather_forecast', { latitude: 49.9, longitude: 2.3 })` et `invoke('weather_geocode', { query: 'Amiens', language: 'fr' })`.
- `weather.service.spec.ts` :
  - widget sans `network` → `WidgetPermissionError` pour `forecast`, `cached` et `searchPlaces`, aucun appel, même cache rempli ;
  - coordonnées invalides → `invalid_input` sans appel ;
  - succès → `fetchedAt` = horloge ; à +29 min → cache sans appel ; à +30 min → appel ; horloge reculée de 1 h → appel ;
  - deux appels simultanés (même avec `force` pour le second) → 1 appel ;
  - échec puis appel simple à +30 s → `throttled` avec `retryAfterMs` = 30 000, sans appel ; à +30 s avec `ignoreRetryDelay` → appel ; à +61 s sans option → appel ; `force` après échec → appel ;
  - échec après succès → `cached()` conserve l'instantané ;
  - charge invalide → `invalid_response` ;
  - 21 lieux distincts → `cached()` du premier vaut `null` ;
  - `searchPlaces('  A ')` → `[]` sans appel ; `' Amiens '` → appel avec `'Amiens'`, `'fr'` ; langue active `'de'` → `'fr'` ; 101 caractères → `invalid_input`.
- `time-display.spec.ts` : `'weekday-short'`.

### 7.7 Critères d'acceptation W2a
- **CA-W2a-1** `npm run test` vert avec §7.6 ; `test:data` inchangé.
- **CA-W2a-2** `npm run lint` (frontières de widgets comprises) et `npm run format:check` propres ; aucun `any`.
- **CA-W2a-3** `rg -n "weather_forecast|weather_geocode" apps/web/src` : uniquement `core/weather/weather-api.ts` et son spec.
- **CA-W2a-4** `git diff --stat -- apps/web/src/app/data apps/desktop` vide.

Commandes : `npm run format:check`, `npm run lint`, `npm run test`.

---

## 8. Lot W2b : widget `weather` (`apps/web/src/app/widgets/weather/`)

### 8.1 Fichiers
Créer :
```
widgets/weather/weather.config.ts (+ .spec.ts)
widgets/weather/weather.definition.ts
widgets/weather/weather-codes.ts (+ .spec.ts)
widgets/weather/weather-format.ts (+ .spec.ts)
widgets/weather/weather-icon.component.ts (+ .html, + .spec.ts)
widgets/weather/icons/LICENSE-lucide.txt
widgets/weather/weather.component.ts (+ .html, + .spec.ts)
widgets/weather/weather-location-picker.component.ts (+ .html, + .spec.ts)
```
Modifier : `widgets/widgets.providers.ts` (+ `provideWidget(weatherWidget)`), `core/i18n/fr.json` (§9).

### 8.2 Configuration et définition
```ts
// weather.config.ts — importé par la définition (chargée au démarrage) : uniquement `import type` depuis core/weather.
import * as v from 'valibot';
import type { WeatherPlace } from '../../core/weather';

const text = (max: number) => v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(max));
export const weatherLocationSchema = v.object({
  name: text(200),
  region: v.nullable(text(200)),
  country: v.nullable(text(200)),
  latitude: v.pipe(v.number(), v.finite(), v.minValue(-90), v.maxValue(90)),
  longitude: v.pipe(v.number(), v.finite(), v.minValue(-180), v.maxValue(180)),
});
export const weatherConfigSchema = v.object({
  location: v.nullable(weatherLocationSchema),
  days: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(7)),
});
export type WeatherConfig = v.InferOutput<typeof weatherConfigSchema>;
export type WeatherLocation = NonNullable<WeatherConfig['location']>;
export const WEATHER_CONFIG_VERSION = 1;
export const weatherDefaults = (): WeatherConfig => ({ location: null, days: 5 });
export function toWeatherLocation(place: WeatherPlace): WeatherLocation;   // sans id

// weather.definition.ts
export const weatherWidget = defineWidget<WeatherConfig>({
  type: 'weather',
  titleKey: 'widgets.weather.title',
  descriptionKey: 'widgets.weather.description',
  icon: 'pi pi-sun',
  loadComponent: () => import('./weather.component').then((m) => m.WeatherComponent),
  size: { min: { w: 2, h: 2 }, default: { w: 3, h: 4 }, max: { w: 6, h: 8 } },
  config: { version: WEATHER_CONFIG_VERSION, schema: weatherConfigSchema, defaults: weatherDefaults, migrations: {} },
  permissions: ['network', 'open-url'],
});
```
Pas de fuseau ni d'`id` GeoNames dans la config ; pas de lieu par défaut.

### 8.3 Codes météo et icônes
```ts
export type WeatherIconName =
  | 'sun' | 'moon' | 'cloud-sun' | 'cloud-moon' | 'cloud' | 'fog' | 'drizzle' | 'rain'
  | 'freezing' | 'showers' | 'snow' | 'snowflake' | 'thunderstorm' | 'unknown';
export type WeatherTone = 'muted' | 'attention' | 'accent';
/** Clé `widgets.weather.conditions.c<code>` ; inconnu ou null → `conditions.unknown`, 'unknown', 'muted'. */
export function describeWeather(code: number | null, isDay: boolean):
  { readonly labelKey: string; readonly icon: WeatherIconName; readonly tone: WeatherTone };
```
| Code | Libellé FR | Icône jour / nuit | Ton |
|---|---|---|---|
| 0 | Ciel dégagé | `sun` / `moon` | attention / muted |
| 1 | Plutôt dégagé | `sun` / `moon` | attention / muted |
| 2 | Partiellement nuageux | `cloud-sun` / `cloud-moon` | muted |
| 3 | Couvert | `cloud` | muted |
| 45 | Brouillard | `fog` | muted |
| 48 | Brouillard givrant | `fog` | muted |
| 51 | Bruine légère | `drizzle` | accent |
| 53 | Bruine modérée | `drizzle` | accent |
| 55 | Bruine dense | `drizzle` | accent |
| 56 | Bruine verglaçante légère | `freezing` | accent |
| 57 | Bruine verglaçante dense | `freezing` | accent |
| 61 | Pluie faible | `rain` | accent |
| 63 | Pluie modérée | `rain` | accent |
| 65 | Pluie forte | `rain` | accent |
| 66 | Pluie verglaçante faible | `freezing` | accent |
| 67 | Pluie verglaçante forte | `freezing` | accent |
| 71 | Neige faible | `snow` | muted |
| 73 | Neige modérée | `snow` | muted |
| 75 | Neige forte | `snow` | muted |
| 77 | Grains de neige | `snowflake` | muted |
| 80 | Averses faibles | `showers` / `rain` | accent |
| 81 | Averses modérées | `showers` / `rain` | accent |
| 82 | Averses violentes | `showers` / `rain` | accent |
| 85 | Averses de neige faibles | `snow` | muted |
| 86 | Averses de neige fortes | `snow` | muted |
| 95 | Orage | `thunderstorm` | attention |
| 96 | Orage avec grêle faible | `thunderstorm` | attention |
| 97 | Orage violent | `thunderstorm` | attention |
| 99 | Orage avec forte grêle | `thunderstorm` | attention |
| autre | Conditions inconnues | `unknown` | muted |

Ton → classe : `muted` → `text-fg-muted`, `attention` → `text-attention`, `accent` → `text-accent`.

**Icônes** (exception `docs/DESIGN.md` §5, décision de Marius) : `WeatherIconComponent` (sélecteur `app-weather-icon`, standalone, OnPush), inputs `name = input.required<WeatherIconName>()`, `size = input<16 | 32>(16)`. Template : un `@switch (name())` dont chaque branche est un `<svg>` en ligne avec `[attr.width]`/`[attr.height]` = `size()`, `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `stroke-width="2"`, `stroke-linecap="round"`, `stroke-linejoin="round"`, `aria-hidden="true"`, `focusable="false"`. Les `<path>`/`<circle>`/`<line>` sont **recopiés tels quels** depuis Lucide (pas de dépendance npm) :

| `WeatherIconName` | Icône Lucide |
|---|---|
| `sun` | `sun` |
| `moon` | `moon` |
| `cloud-sun` | `cloud-sun` |
| `cloud-moon` | `cloud-moon` |
| `cloud` | `cloud` |
| `fog` | `cloud-fog` |
| `drizzle` | `cloud-drizzle` |
| `rain` | `cloud-rain` |
| `freezing` | `cloud-hail` |
| `showers` | `cloud-sun-rain` |
| `snow` | `cloud-snow` |
| `snowflake` | `snowflake` |
| `thunderstorm` | `cloud-lightning` |
| `unknown` | `circle-question-mark` |

Source : dépôt `lucide-icons/lucide`, dossier `icons/`, à **un tag de release** noté dans `icons/LICENSE-lucide.txt` avec le texte des deux licences (ISC du projet et MIT de Feather, W16). Aucune couleur, aucun `style`, aucun `xlink:href` dans les SVG. La couleur vient de la classe de ton posée sur `app-weather-icon` (`currentColor`).

### 8.4 Formatage pur (`weather-format.ts`)
```ts
export type AgeMessage =
  | { readonly kind: 'just-now' } | { readonly kind: 'minutes'; readonly minutes: number }
  | { readonly kind: 'hours'; readonly hours: number } | { readonly kind: 'date' };
/** ms = durationBetween(fetchedAt, now) : < 60 s (négatif compris) → just-now ; < 60 min → minutes (plancher) ;
 *  < 24 h → hours (plancher) ; sinon date (formatée par le composant : TimeDisplay 'date-time'). */
export function ageMessage(fetchedAt: InstantIso, now: InstantIso): AgeMessage;
/** Math.round ; -0 → 0. */
export function roundValue(value: number): number;
/** « Nom, Région (Pays) » ; partie absente omise. Libellés identiques dans la liste :
 *  suffixe « · 49,90 ; 2,30 » (toFixed(2), point remplacé par une virgule). */
export function placeLabels(places: readonly WeatherPlace[]): readonly string[];
export function locationLabel(location: WeatherLocation): string;
/** date ≥ today (compareLocalDates), au plus `days`. */
export function visibleDays(daily: readonly WeatherDay[], today: LocalDateIso, days: number): readonly WeatherDay[];
/** 0 → 'today', 1 → 'tomorrow', sinon 'weekday' (daysBetween(today, date)). */
export function dayKind(date: LocalDateIso, today: LocalDateIso): 'today' | 'tomorrow' | 'weekday';
```

### 8.5 Composant principal (`WeatherComponent`, `app-weather-widget`)
Standalone, OnPush, signals ; `imports: [TranslocoPipe, WeatherIconComponent, WeatherLocationPickerComponent]` ; `host: { class: 'flex h-full min-h-0 flex-col gap-2' }`. Injecte : contexte (`injectWidgetContext<WeatherConfig>()`), `WeatherService`, `UrlOpener`, `CLOCK`, `TimeDisplay`, `UserTimeZone`, `DOCUMENT`, `DestroyRef`.

```ts
type WeatherView =
  | { readonly kind: 'no-location' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: WeatherError }
  | { readonly kind: 'data'; readonly snapshot: WeatherSnapshot; readonly refreshError: WeatherError | null };
```
Signaux : `view`, `refreshing`, `now` (rafraîchi toutes les 60 s et sur visibilité / focus), `panelOpen`, `saving`, `saveError`, `linkError`. Disposition : `compact = size().w <= 2 || size().h <= 2` ; `showDetails = !compact && size().w >= 4`. Fuseau du lieu : `normalizeTimeZone(forecast.timeZone) ?? userTimeZone.id()` ; `today = todayIn(clock, zone)`, recalculé avec `now`.

**Rafraîchissement** (correction C3 de la revue : le limiteur ne doit jamais gonfler les paliers) :

| Déclencheur | Options passées au service |
|---|---|
| Changement de lieu (effet sur `config().location`, comparé par clé) | `{ ignoreRetryDelay: true }` |
| Minuteur planifié | `{ ignoreRetryDelay: true }` |
| Événement `online` (fenêtre) | `{ ignoreRetryDelay: true }` |
| `visibilitychange` (visible) et `focus` (fenêtre), seulement si pas de requête en cours et (vue `error`, ou `refreshError`, ou âge ≥ 30 min ou négatif) | `{}` (limiteur actif) |
| Boutons Réessayer / Actualiser (désactivés pendant `refreshing`) | `{ force: true }` |

- Changement de lieu : annuler le minuteur, numéro de séquence + 1, compteur d'échecs à 0 ; lieu nul → `no-location` ; sinon vue `data` depuis `service.cached(ctx, …)` (sans `refreshError`) ou `loading`, puis actualisation.
- Résultat ignoré si la séquence a changé ou si le composant est détruit.
- Succès → `data`, `refreshError: null`, compteur à 0, prochain essai dans `max(60 s, 30 min − âge)`.
- Rejet `throttled` → **aucun changement** : vue, compteur et minuteur intacts (un minuteur est toujours armé après un échec, donc rien n'est perdu).
- Autre échec → compteur + 1 ; `data` gardée avec `refreshError` si un instantané existe pour la même clé, sinon `error` ; prochain essai selon `[60 s, 2 min, 5 min, 10 min, 30 min]` (dernier palier ensuite).
- Destruction : minuteurs annulés, écouteurs retirés, plus aucun appel.
- Minuteurs par `setTimeout` uniquement ; âges toujours calculés depuis `CLOCK` (sortie de veille couverte).

**Rendu** (classes et tokens de `docs/DESIGN.md` ; aucun `innerHTML` ; texte externe par interpolation) :
- `no-location` : `empty-state` (icône `pi pi-map-marker`, `empty`, bouton `btn` « Choisir une ville » qui ouvre le panneau).
- `loading` : `loading` en `text-fg-muted`, `role="status"`.
- `error` : `empty-state` `role="alert"`, message §8.7, bouton « Réessayer ».
- `data`, compact : ligne 1 : `app-weather-icon` (16 px) + température `text-2xl font-semibold tabular-nums` (`temperatureShort`) + bouton engrenage ; ligne 2 : libellé de condition (`sr-only`) et lieu tronqué (`text-xs text-fg-muted`) ; ligne 3 : attribution courte + âge (`text-xs text-fg-muted`).
- `data`, complet : en-tête (lieu `locationLabel` tronqué ; boutons Actualiser `pi pi-refresh` et engrenage `pi pi-cog`, `btn btn-invisible btn-icon btn-compact` avec `aria-label`) ; bloc courant (icône 32 px, `temperature`, libellé visible) ; si `showDetails` : ressenti, humidité, vent ; bandeau `flash flash-attention` `role="status"` si `refreshError` (§8.7), suivi de l'âge ; liste `<ul>` (`aria-label` `forecastLabel`) de `visibleDays(...)`, une `box-row` par jour : libellé du jour (`time.today`, `time.tomorrow`, sinon `formatLocalDate(date, 'weekday-short')`), icône (16 px) + libellé (visible si `showDetails`, sinon `sr-only`), plage min/max, probabilité de pluie si `showDetails` ; liste scrollable (`overflow-y-auto min-h-0`) ; aucun jour restant → liste masquée. Pied : âge et attribution complète.
- **Lignes journalières : `isDay = true`** (icônes de jour).
- **Valeurs absentes** (correction C11) :
  - valeur seule (ressenti, humidité, vent, probabilité de pluie) : l'élément entier est **masqué** ;
  - plage min/max : chaque partie absente est remplacée par `noValue` (« – ») ; rendu visible `[max] / [min]` avec chaque partie `degrees` ou `noValue` (`aria-hidden`), et texte `sr-only` `dayRangeSr` dont chaque partie est `degreesSr` ou `noValueSr` (ex. « Maximum non disponible, minimum 8 °C ») ;
  - code journalier `null` → `conditions.unknown` et icône `unknown`.
- Arrondis par `roundValue`.
- **Attribution** (CC BY 4.0) : bouton `btn btn-invisible` (style lien) affiché chaque fois que des données sont visibles → `urlOpener.open(ctx, 'https://open-meteo.com/')` ; échec → `errors.openLink`.

**Panneau de réglages** : remplace le corps ; `role="group"` + `aria-label` `settings` ; contient `<app-weather-location-picker [disabled]="saving()">`, un `<select>` natif avec `<label>` `daysLabel` (1 à 7, changement → `updateConfig({ ...config, days })`), un bouton `close`. Engrenage avec `aria-expanded`. Ouverture : focus sur le champ de recherche (`afterNextRender`) ; fermeture (bouton, Échap, choix réussi) : focus rendu au bouton d'origine. Choix : `saving` (2e clic ignoré), `ctx.updateConfig({ ...ctx.config(), location: toWeatherLocation(place) })` ; succès → panneau fermé ; échec → `errors.saveLocation`, panneau ouvert.

### 8.6 Sélecteur de lieu (`WeatherLocationPickerComponent`, `app-weather-location-picker`)
`PLACE_SEARCH_DEBOUNCE_MS = 300` ; outputs `picked = output<WeatherPlace>()`, `cancelled = output<void>()` ; input `disabled = input(false)`. Contexte par `injectWidgetContext()` (même injecteur que le widget), `WeatherService`, `UrlOpener`.
- Champ texte, `<label>` `search.label`, `maxlength="100"`, `autocomplete="off"`, `spellcheck="false"`, aide `search.hint`.
- Frappe → minuteur de 300 ms relancé ; moins de 2 caractères → état `too-short`, résultats vidés, aucun appel.
- Séquence : seule la dernière recherche lancée est affichée.
- États `idle | too-short | searching | results | empty | error`, annoncés par une zone `aria-live="polite"`.
- Résultats : `<ul>` de `<button type="button" class="btn btn-invisible">` au texte `placeLabels(...)[i]` (`track place.id`), désactivés si `disabled()` ; clic → `picked.emit(place)`.
- Échap → `cancelled.emit()`.
- Mention `search.attribution` en lien (`urlOpener.open(ctx, 'https://www.geonames.org/')`).
- Destruction : minuteur annulé, réponses ignorées.

### 8.7 Messages d'erreur
| `kind` | Sans données (`error`) | Avec données (`refreshError`) |
|---|---|---|
| `network` | `errors.network` | `offline` |
| `timeout` | `errors.timeout` | `offline` |
| `upstream_status` 429 | `errors.rateLimited` | `staleError` |
| `upstream_status` autre | `errors.upstream` (`{{ status }}`) | `staleError` |
| `too_large`, `invalid_response` | `errors.invalidResponse` | `staleError` |
| `unavailable` (hors Tauri) | `errors.unavailable` | `staleError` |
| `client_unavailable` | `errors.clientUnavailable` | `staleError` |
| `forbidden` | `errors.internal` | `staleError` |
| `invalid_input`, `unknown` | `errors.unknown` | `staleError` |
| `throttled` | jamais affiché (§8.5) | jamais affiché |

Le texte d'origine d'une erreur n'est jamais affiché.

### 8.8 Tests W2b
Contexte factice via `WIDGET_CONTEXT` (comme `shortcuts.component.spec.ts`), `provideAppI18n()`, `ManualClock` comme `CLOCK`, `FakeWeatherApi` comme `WEATHER_API` (service réel), `UrlOpener` factice, `vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })`.
- `weather.config.spec.ts` : `weatherDefaults()` valide ; refus de `days` 0, 8, 2.5, latitude 91, longitude -181, `name` vide ou de 201 caractères ; clé inconnue retirée ; `toWeatherLocation` sans `id`.
- `weather-codes.spec.ts` : les 29 codes ont une clé **présente dans `fr.json`** (JSON chargé dans le test) ; 0 et 1 → `moon` la nuit ; 2 → `cloud-moon` la nuit ; 80 → `rain` la nuit ; 4, 100, `null` → `unknown`.
- `weather-icon.component.spec.ts` : chaque `WeatherIconName` rend exactement un `svg` avec `aria-hidden="true"`, `focusable="false"`, `stroke="currentColor"`, au moins un élément enfant, et aucun attribut `style` ni `fill` autre que `none` ; `size` 32 → `width="32"`.
- `weather-format.spec.ts` : `ageMessage` à 0, 59 s, 60 s, 59 min 59 s, 60 min, 23 h 59, 24 h, −5 min ; `roundValue(-0.4)` → `0` (`Object.is`), `12.5` → `13` ; `placeLabels` (région ou pays absent, deux « Saint-Denis » identiques suffixés) ; `visibleDays` ; `dayKind`.
- `weather.component.spec.ts` :
  1. `location: null` → état vide, aucun appel ; « Choisir une ville » ouvre le panneau.
  2. Lieu configuré → `loading` puis « 13 °C », « Couvert », attribution.
  3. 2×2 → compact ; 4×4 → liste + détails ; 3×4 → liste sans détails.
  4. Horloge au 2026-10-22 avec le fixture du 21 → premier jour « Aujourd'hui » = 22/10, au plus `days` jours ; icônes journalières de jour même si `isDay` courant est faux.
  5. Échec sans données → `errors.network` + Réessayer, qui rappelle l'API avec `force`.
  6. Succès puis échec réseau → données conservées + `offline` + âge.
  7. +30 min (horloge et minuteur) → nouvel appel ; échecs successifs → délais 60 s, 2 min, 5 min.
  8. Événements et limiteur :
     - `visibilitychange` / `focus` : appel seulement si les données sont périmées ou en erreur ;
     - **scénario CA-M4** : données affichées, API en échec réseau, clic Actualiser → échec (bandeau `offline`, minuteur à 60 s) ; `focus` à +10 s → `throttled`, aucun appel, compteur inchangé ; API rétablie à +20 s puis événement `online` → appel immédiat, données à jour, bandeau retiré avant +60 s ;
     - variante sans événement `online` : le minuteur à +60 s réussit (non bloqué par le limiteur) ;
     - après un `throttled`, l'échec suivant planifie le palier 2 min (pas 5 min).
  9. Changement de lieu pendant une requête → réponse de l'ancien lieu ignorée.
  10. Destruction → plus aucun appel après avance des minuteurs.
  11. Attribution → `UrlOpener.open(ctx, 'https://open-meteo.com/')`.
  12. Choix d'un lieu → `updateConfig` avec `toWeatherLocation(place)`, panneau fermé ; `updateConfig` rejeté → `errors.saveLocation` ; double clic → un seul `updateConfig`.
  13. `<select>` jours → `updateConfig({ ...config, days: 7 })`.
  14. Fuseaux de la réponse `Mars/Base` (repli utilisateur, pas d'exception), puis `Etc/GMT+11` et `Antarctica/McMurdo` (acceptés, S3).
  15. Valeurs absentes : `apparentTemperatureC` `null` → pas de « Ressenti » ; `temperatureMaxC` `null` → « – / 8° » visible et « Maximum non disponible, minimum 8 °C » en `sr-only`.
  16. Messages : `client_unavailable` et `forbidden` n'affichent pas `errors.unavailable`.
- `weather-location-picker.component.spec.ts` : « Ami » tapé en 3 touches espacées de 100 ms → 1 appel 300 ms après la dernière ; « A » → aucun appel, aide ; deux recherches dont la première répond en dernier → résultats de la seconde ; nom `<img src=x onerror=alert(1)>` affiché comme texte (aucun `img` dans le DOM) ; clic → `picked` ; Échap → `cancelled` ; erreur → `search.error` ; `[]` → `search.noResults` ; `disabled` → boutons désactivés.
- `widgets.providers.spec.ts` (existant) : passe sans modification.

### 8.9 Critères d'acceptation W2b
- **CA-W2b-1** `npm run test` vert avec §8.8.
- **CA-W2b-2** `npm run lint` (frontières, contrôle des tokens), `npm run format:check` propres ; aucun `any`.
- **CA-W2b-3** `rg -n "@tauri-apps" apps/web/src/app/widgets` vide ; `rg -n "innerHTML|bypassSecurityTrust" apps/web/src/app/widgets/weather apps/web/src/app/core/weather` vide ; `rg -n "from '../../core/weather'" apps/web/src/app/widgets/weather/weather.config.ts apps/web/src/app/widgets/weather/weather.definition.ts` ne montre que des `import type`.
- **CA-W2b-4** `npm run web:build` réussit **sans modifier le budget** ; le widget et `core/weather` sont dans un chunk paresseux. Sinon : s'arrêter et rapporter la taille.
- **CA-W2b-5** `git diff --stat -- apps/web/src/app/data apps/desktop` vide.

**Vérifications manuelles (Marius, `npm run dev` puis exe release)** :
- **CA-M1** Ajouter « Météo » → « Choisir une ville » → « Amiens » : environ 3 résultats ~300 ms après la frappe → choisir « Amiens, Hauts-de-France (France) » : température, condition, 5 jours ; comparer avec https://open-meteo.com/.
- **CA-M2** Relancer l'app : ville et nombre de jours conservés.
- **CA-M3** 2×2 compact ; 4×4 détails et prévisions ; icônes lisibles en clair et en sombre.
- **CA-M4** Couper le Wi-Fi, cliquer « Actualiser » : données gardées, « Hors ligne » et âge ; rétablir le Wi-Fi 20 s plus tard : actualisation automatique en moins d'une minute.
- **CA-M5** Veille de plus de 30 min puis réveil : actualisation au retour sur la fenêtre.
- **CA-M6** Le lien « Open-Meteo » ouvre le navigateur sur https://open-meteo.com/.
- **CA-M7** Thèmes clair et sombre conformes à `docs/DESIGN.md` (bordures, pas d'ombre, focus visible, cibles ≥ 24 px).

Commandes : `npm run format:check`, `npm run lint`, `npm run test`, `npm run web:build`, `npm run dev`.

---

## 9. Clés i18n (`core/i18n/fr.json`, sous `widgets.weather`)
`title` « Météo » ; `description` « Conditions actuelles et prévisions (Open-Meteo) » ; `empty` « Choisissez une ville pour afficher la météo. » ; `chooseCity` « Choisir une ville » ; `settings` « Réglages de la météo » ; `refresh` « Actualiser la météo » ; `close` « Fermer » ; `daysLabel` « Jours de prévision » ; `loading` « Chargement de la météo… » ; `retry` « Réessayer » ; `forecastLabel` « Prévisions » ; `updatedJustNow` « Mis à jour à l'instant » ; `updatedMinutesAgo` « Mis à jour il y a {{ minutes }} min » ; `updatedHoursAgo` « Mis à jour il y a {{ hours }} h » ; `updatedOn` « Mis à jour le {{ date }} » ; `offline` « Hors ligne : dernière météo connue. » ; `staleError` « Actualisation impossible : dernière météo connue. » ; `temperature` « {{ value }} °C » ; `temperatureShort` « {{ value }}° » ; `degrees` « {{ value }}° » ; `degreesSr` « {{ value }} °C » ; `noValue` « – » ; `noValueSr` « non disponible » ; `feelsLike` « Ressenti {{ value }} °C » ; `humidity` « Humidité {{ value }} % » ; `wind` « Vent {{ value }} km/h » ; `precipitationProbability` « Pluie {{ value }} % » ; `dayRangeSr` « Maximum {{ max }}, minimum {{ min }} » ; `attribution` « Données météo : Open-Meteo.com » ; `attributionShort` « Open-Meteo ».

`errors.network` « Connexion impossible. Vérifiez l'accès à internet. » ; `errors.timeout` « Le service météo ne répond pas. » ; `errors.rateLimited` « Trop de requêtes vers le service météo : nouvel essai plus tard. » ; `errors.upstream` « Le service météo a renvoyé une erreur ({{ status }}). » ; `errors.invalidResponse` « Réponse du service météo illisible. » ; `errors.unavailable` « La météo n'est disponible que dans l'application Homebase. » ; `errors.clientUnavailable` « Le module réseau de Homebase n'a pas démarré. Redémarrez l'application. » ; `errors.internal` « Requête refusée par Homebase (erreur interne). » ; `errors.unknown` « Impossible de charger la météo. » ; `errors.saveLocation` « Impossible d'enregistrer la ville. » ; `errors.openLink` « Impossible d'ouvrir le lien. ».

`search.label` « Ville » ; `search.hint` « Saisissez au moins 2 caractères. » ; `search.searching` « Recherche… » ; `search.resultsCount` « Résultats : {{ count }} » ; `search.noResults` « Aucune ville trouvée. » ; `search.error` « Recherche impossible pour le moment. » ; `search.attribution` « Lieux : GeoNames ».

`conditions.c0` … `conditions.c99` (les 29 libellés du tableau §8.3) et `conditions.unknown` « Conditions inconnues ».

Réutilisées : `time.today` « Aujourd'hui », `time.tomorrow` « Demain ».

---

## 10. Cas limites, sécurité, risques

### 10.1 Cas limites
| # | Cas | Comportement |
|---|---|---|
| L1 | Hors ligne au premier affichage | Vue `error` ; essais à 60 s, 2, 5, 10, 30 min, et sur `online` / focus |
| L2 | Coupure après un succès | Dernières données + `offline` + âge ; même paliers |
| L3 | Démarrage automatique avant le réseau | L1 ; pas de cache persistant (décision de Marius) |
| L4 | Sortie de veille | `visibilitychange` / `focus` ; le minuteur en retard compare l'âge à `CLOCK` |
| L5 | Horloge reculée | Âge négatif = périmé ; « Mis à jour à l'instant » |
| L6 | Changement d'heure (25/10/2026) | Âges entre instants, sans effet ; bornes des jours figées au décalage de la requête (W2) : min/max décalés d'une heure au plus après le changement, accepté |
| L7 | Lieu dans un autre fuseau, ou fuseau `Etc/GMT+11` / `Antarctica/McMurdo` | « Aujourd'hui » = date du lieu ; fuseau refusé par Temporal → fuseau utilisateur |
| L8 | Minuit passé, données de la veille | `visibleDays` retire les jours passés au tick suivant ; plus aucun jour → liste masquée |
| L9 | Plusieurs widgets, même lieu | Une requête, un cache ; `days` différents sans nouvelle requête |
| L10 | Double clic (choix, Actualiser) | `saving` ; bouton désactivé pendant `refreshing` ; dédoublonnage |
| L11 | Réponses de recherche dans le désordre | Seule la dernière est affichée |
| L12 | Saisie < 2 ou > 100 caractères, contrôle ou bidi | Aucun appel (UI, service) ; `invalid_input` côté Rust en dernier rempart |
| L13 | Homonymes | Région et pays ; libellés identiques suffixés des coordonnées |
| L14 | HTML ou caractères bidi dans un nom de lieu | Interpolation seule ; entrées bidi écartées par le Rust |
| L15 | Réponse énorme, lente, redirigée, HTML, Content-Length menteur, 4xx/5xx, 429 | `too_large` (64 / 256 kio, contrôlé avant chaque ajout), `timeout`, `upstream_status` (3xx compris), `invalid_response` ; aucune donnée partielle |
| L16 | Valeurs `null` ou aberrantes | Valeur seule masquée, partie de plage « – » ; température ou code courant invalides → `invalid_response` |
| L17 | Code WMO non documenté | « Conditions inconnues » + icône `unknown` |
| L18 | Hors Tauri (`npm run web:start`) | `errors.unavailable`, aucun appel |
| L19 | Client HTTP non construit, URL refusée | `errors.clientUnavailable` / `errors.internal` (jamais « seulement dans l'application ») |
| L20 | Suppression du widget | Rien en base ; aucune requête après destruction |
| L21 | Config importée invalide | Placeholder de l'hôte (ADR-001), aucun appel |
| L22 | Doublons, conflits de synchronisation | Sans objet (aucune donnée persistée, pas de synchro) |
| L23 | Limites Open-Meteo | Un lieu : environ 48 requêtes par jour, plus les actualisations au focus (limitées) ; au plus 4 requêtes simultanées côté Rust ; loin des 10 000/jour |
| L24 | Export de configuration | Nom et coordonnées du lieu, aucun secret |

### 10.2 Sécurité
- Surface ajoutée : 2 commandes IPC aux entrées bornées (liste fermée pour la langue) ; hôtes fixés par une énumération fermée, vérifiés avant chaque requête ; HTTPS seul, TLS 1.2 minimum, aucune redirection, aucun proxy, pas de `Referer`, timeouts, taille max contrôlée avant chaque ajout, 4 requêtes simultanées au plus.
- SSRF : impossible en phase 1 (ni URL, ni hôte, ni chemin ne viennent du front).
- Contenu externe : types stricts côté Rust (caractères de contrôle et bidi écartés), revalidation côté front, interpolation uniquement.
- CSP et capabilities : `connect-src` inchangé et aucune permission `http:*` (tous deux testés).
- Secrets : aucun.
- Vie privée : coordonnées arrondies à 4 décimales et texte de recherche envoyés à Open-Meteo ; aucune géolocalisation ; `User-Agent` sans donnée personnelle ; rien de journalisé.

### 10.3 Conséquences et risques
- Dépendances : reqwest (+ hyper, native-tls/schannel), tokio (`sync`). Lockfile : paquets TLS d'autres plateformes analysés par `cargo audit` (§6.7).
- **R1** Open-Meteo change une unité ou un champ → `invalid_response` visible ; correction ciblée dans `open_meteo.rs`.
- **R2** Blocage pour abus (W9) → `upstream_status` 429/403 ; mitigé par cache, limiteur, dédoublonnage, sémaphore.
- **R3** TLS dépendant de Windows (SChannel) : accepté ; repli rustls + `prebuilt-nasm`.
- **R4** Avis `cargo audit` sur un paquet TLS non compilé sous Windows → politique §6.7.
- **R5** Pas de météo après un démarrage hors ligne : accepté par Marius.
- **R6** Changement des conditions d'Open-Meteo : attribution en place ; revérifier à l'audit de phase 6.

---

## 11. Fixtures

### 11.1 `forecast_paris.json` (réponse réelle du 2026-10-21, verbatim)
```json
{"latitude":48.853382,"longitude":2.355208,"generationtime_ms":0.6449222564697266,"utc_offset_seconds":7200,"timezone":"Europe/Paris","timezone_abbreviation":"GMT+2","elevation":43.0,"current_units":{"time":"iso8601","interval":"seconds","temperature_2m":"°C","apparent_temperature":"°C","relative_humidity_2m":"%","is_day":"","weather_code":"wmo code","wind_speed_10m":"km/h","precipitation":"mm"},"current":{"time":"2026-10-21T11:15","interval":900,"temperature_2m":12.8,"apparent_temperature":9.7,"relative_humidity_2m":74,"is_day":1,"weather_code":3,"wind_speed_10m":18.1,"precipitation":0.00},"daily_units":{"time":"iso8601","weather_code":"wmo code","temperature_2m_max":"°C","temperature_2m_min":"°C","precipitation_probability_max":"%","precipitation_sum":"mm"},"daily":{"time":["2026-10-21","2026-10-22","2026-10-23"],"weather_code":[80,80,61],"temperature_2m_max":[14.9,15.5,13.7],"temperature_2m_min":[8.4,9.0,9.9],"precipitation_probability_max":[35,25,91],"precipitation_sum":[0.30,0.60,3.61]}}
```

### 11.2 `geocode_amiens.json` (réponse réelle du 2026-10-21, `postcodes` raccourci)
```json
{"results":[{"id":3037854,"name":"Amiens","latitude":49.9,"longitude":2.3,"elevation":28.0,"feature_code":"PPLA2","country_code":"FR","admin1_id":11071624,"admin2_id":2974304,"admin3_id":3037853,"admin4_id":6455273,"timezone":"Europe/Paris","population":143086,"postcodes":["80080","80090","80000","80001 CEDEX 1"],"country_id":3017382,"country":"France","admin1":"Hauts-de-France","admin2":"Somme","admin3":"Amiens","admin4":"Amiens"},{"id":2177944,"name":"Amiens","latitude":-28.58803,"longitude":151.80737,"elevation":878.0,"feature_code":"PPL","country_code":"AU","admin1_id":2152274,"admin2_id":7839393,"timezone":"Australia/Brisbane","population":291,"country_id":2077456,"country":"Australie","admin1":"Queensland","admin2":"Southern Downs"},{"id":5884494,"name":"Amiens","latitude":53.31681,"longitude":-107.25119,"elevation":623.0,"feature_code":"PPLL","country_code":"CA","admin1_id":6141242,"admin2_id":6153771,"timezone":"America/Regina","country_id":6251999,"country":"Canada","admin1":"Saskatchewan","admin2":"Spiritwood No. 496"}],"generationtime_ms":0.21624565}
```
Attendu : `(3037854, "Amiens", Some("Hauts-de-France"), Some("France"), 49.9, 2.3)`, `(2177944, "Amiens", Some("Queensland"), Some("Australie"), -28.58803, 151.80737)`, `(5884494, "Amiens", Some("Saskatchewan"), Some("Canada"), 53.31681, -107.25119)`.

---

## 12. Commandes complètes (fin des trois lots)
```
npm ci --ignore-scripts
npm run format:check
npm run lint
npm run test
npm run rust:fmt:check
npm run rust:lint
npm run rust:test
npm run web:build
npm run build
```
Rapport attendu de l'implementer à la fin de chaque lot : fichiers créés et modifiés, résultats des commandes, suppositions confirmées ou infirmées, écarts à la spec, étapes consommées.

---

## 13. Décisions de Marius (2026-10-21)
1. **Cache** : en mémoire seulement, aucune table. **Décidé.**
2. **Icônes** : petit jeu local d'icônes SVG en ligne (Lucide, ISC), colorées par `currentColor` et les tokens, choisies selon le code WMO ; exception inscrite dans `docs/DESIGN.md` §5. **Décidé.**
3. **Valeurs par défaut** : 5 jours affichés, actualisation toutes les 30 min. **Accepté.**
4. **Lien Open-Meteo toujours visible** (permission `open-url`). **Accepté.**
5. **TLS de Windows** (`native-tls`). **Accepté.**
6. **Aucun proxy** (`no_proxy()`) : conservé, mais reste une **supposition (S7) en attente de confirmation** par Marius qu'aucun proxy n'est configuré sur son PC.

---

## 14. Hors de cette spec (coordinateur)
- **ADR-001 §3.8** : non modifié par l'architecte (aucun outil d'édition partielle disponible ; une réécriture complète du fichier de 556 lignes était trop risquée). Remplacer la ligne `network` du tableau par exactement :
  `| `network` | Un service typé par source, sans client HTTP générique côté front : `WeatherService` (phase 1, `core/weather`), puis `FeedService`, `ProbeService`… (phase 3, `OutboundHttp`) | **Aucune** permission `http:*` exposée au JS ; CSP `connect-src` inchangée. *Amendement phase 1* : commandes Rust dédiées (`weather_forecast`, `weather_geocode`) sur le module Rust `net` (reqwest + native-tls) : hôtes fixés par une énumération fermée `Endpoint`, HTTPS seul, aucune redirection ni proxy, timeouts, taille max, sorties désérialisées et validées (`docs/specs/weather-widget.md`). Le filtrage des IP privées (sauf NAS) et les hôtes configurables arrivent en phase 3 avec `OutboundHttp`, sur ce même module (`fetch_feed`, `probe_service`…) |`
- `docs/PLAN.md` (§2 ligne « HTTP sortant », §5 Météo, §6 Requêtes sortantes) et `docs/DESIGN.md` (§5, exception icônes météo) : **mis à jour** par l'architecte.
- Cocher la ROADMAP une fois les critères atteints (non modifiée ici).
- Exception éventuelle dans `.cargo/audit.toml` (§6.7) : décision du coordinateur.
