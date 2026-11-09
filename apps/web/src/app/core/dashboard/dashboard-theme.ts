/** Tint ids, in the order of the panel. Lowercase ASCII letters only (tokens --hb-tint-<id>-*). */
export const CARD_TINTS = [
  'rose',
  'peach',
  'vanilla',
  'anis',
  'mint',
  'lagoon',
  'sky',
  'periwinkle',
  'lavender',
  'orchid',
  'slate',
  'sand',
] as const;
export type CardTint = (typeof CARD_TINTS)[number];

/** Stored value of a slot left to its default (body: current Box; header: follows the body). Never a tint id. */
export const TINT_DEFAULT = 'default';
/** Shape of a stored slot value: a tint of a newer build is kept as is (rendered as default). */
export const TINT_VALUE_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

/** The tint when `value` is in CARD_TINTS (Array.includes, never an object lookup), else null. */
export function knownTint(value: string): CardTint | null {
  const tints: readonly string[] = CARD_TINTS;
  return tints.includes(value) ? (value as CardTint) : null;
}
