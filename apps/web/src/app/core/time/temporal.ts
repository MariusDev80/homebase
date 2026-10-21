// The only import of temporal-polyfill (ADR-003 section 3.4). A ponyfill: it uses the native
// Temporal when the runtime has one (WebView2), the polyfill otherwise (Node 24 tests).
export { Temporal } from 'temporal-polyfill';
