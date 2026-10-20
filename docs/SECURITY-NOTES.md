# Notes de sécurité

## CSP

CSP définie dans `apps/desktop/src-tauri/tauri.conf.json` (`app.security.csp`) :
`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; … form-action 'none'`.

- **Scripts** : `script-src 'self'` sans `unsafe-inline`. Tauri y ajoute en release un nonce/hash (protection conservée).
- **Styles** : `style-src 'self' 'unsafe-inline'` est nécessaire car PrimeNG et Angular injectent des balises `<style>` à l'exécution. En release, Tauri ajoute un nonce/hash à `style-src` ; or, dès qu'un nonce/hash est présent, les navigateurs ignorent `'unsafe-inline'` et bloquent ces `<style>`. D'où `app.security.dangerousDisableAssetCspModification: ["style-src"]` : Tauri ne modifie plus que les autres directives (dont `script-src`). Le risque accepté est limité à l'injection de styles (pas de script).
- **CSS critique Angular** : l'optimisation `inlineCritical` (beasties) génère `<link media="print" onload="this.media='all'">`, un gestionnaire inline bloqué par `script-src 'self'`. Elle est désactivée dans la configuration `production` de `apps/web/angular.json` (`optimization.styles.inlineCritical: false`).
- **Polices** : PrimeIcons est servi depuis l'origine de l'app (`font-src 'self' data:`).
- `form-action 'none'` : aucun formulaire ne doit pouvoir soumettre vers l'extérieur.
