// Node 24 has no native Temporal: install the polyfill as a global before any spec, like the
// WebView2 runtime provides it (ADR-003 section 3.4). The setup file and the specs do not share
// module instances, so core/time/temporal.ts picks it up from globalThis when it loads.
import 'temporal-polyfill/global';
