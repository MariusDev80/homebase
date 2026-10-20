// Applies the saved theme before the first paint (loaded synchronously from index.html).
// Served as a same-origin file so that the CSP needs neither 'unsafe-inline' nor a hash.
// The key and class name must stay in sync with core/theme/theme.service.ts.
(function () {
  var mode = null;
  try {
    mode = window.localStorage.getItem('hb.theme');
  } catch (e) {
    // Storage unavailable: fall back to the system theme.
  }
  var dark = false;
  try {
    dark =
      mode === 'dark' ||
      (mode !== 'light' &&
        !!window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
  } catch (e) {
    // The Angular ThemeService applies the theme once it starts.
  }
  document.documentElement.classList.toggle('app-dark', dark);
})();
