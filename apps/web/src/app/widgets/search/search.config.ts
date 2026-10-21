import * as v from 'valibot';

/** Closed list: the engine is a key into SEARCH_ENGINE_URLS, never a free URL. */
export const SEARCH_ENGINES = ['duckduckgo', 'google', 'bing', 'qwant', 'ecosia'] as const;
export type SearchEngine = (typeof SEARCH_ENGINES)[number];

export const searchConfigSchema = v.object({
  engine: v.picklist(SEARCH_ENGINES),
});
export type SearchConfig = v.InferOutput<typeof searchConfigSchema>;
export const SEARCH_CONFIG_VERSION = 1;
export const searchDefaults = (): SearchConfig => ({ engine: 'duckduckgo' });

export function isSearchEngine(value: string): value is SearchEngine {
  return (SEARCH_ENGINES as readonly string[]).includes(value);
}
