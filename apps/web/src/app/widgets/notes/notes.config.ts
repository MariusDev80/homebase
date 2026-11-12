import * as v from 'valibot';

/** Preferences and references only: the note itself lives in the `notes` table. */
export const notesConfigSchema = v.object({
  noteId: v.nullable(v.pipe(v.string(), v.minLength(1), v.maxLength(64))),
});
export type NotesConfig = v.InferOutput<typeof notesConfigSchema>;
export const NOTES_CONFIG_VERSION = 1;
export const notesDefaults = (): NotesConfig => ({ noteId: null });
