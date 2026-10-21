import type { SearchEngine } from './search.config';

/** Fixed endpoints (https only); the query is the only variable part. */
const SEARCH_ENGINE_URLS: Readonly<Record<SearchEngine, { base: string; param: string }>> = {
  duckduckgo: { base: 'https://duckduckgo.com/', param: 'q' },
  google: { base: 'https://www.google.com/search', param: 'q' },
  bing: { base: 'https://www.bing.com/search', param: 'q' },
  qwant: { base: 'https://www.qwant.com/', param: 'q' },
  ecosia: { base: 'https://www.ecosia.org/search', param: 'q' },
};

/** URL of a web search; the query is encoded by URLSearchParams (no manual concatenation). */
export function buildSearchUrl(engine: SearchEngine, query: string): string {
  const { base, param } = SEARCH_ENGINE_URLS[engine];
  const url = new URL(base);
  url.search = new URLSearchParams({ [param]: query }).toString();
  return url.href;
}
