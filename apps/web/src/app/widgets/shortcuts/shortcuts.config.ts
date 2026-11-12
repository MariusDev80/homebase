import * as v from 'valibot';

/**
 * Nothing to configure yet: the links live in the global `shortcuts` table (shared by every
 * Shortcuts widget and, later, by the search bar). The empty versioned config is kept so a
 * future preference can be added with a normal migration.
 */
export const shortcutsConfigSchema = v.object({});
export type ShortcutsConfig = v.InferOutput<typeof shortcutsConfigSchema>;
export const SHORTCUTS_CONFIG_VERSION = 1;
export const shortcutsDefaults = (): ShortcutsConfig => ({});
