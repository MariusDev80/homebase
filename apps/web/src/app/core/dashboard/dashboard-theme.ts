import * as v from 'valibot';
import type { JsonObject } from '../../data';
import { resolveConfig } from '../widgets/widget-config';
import type { WidgetConfigSpec } from '../widgets/widget-definition';

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

// Type alias (not an interface): assignable to JsonObject.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type CardTheme = { cardBody: string; cardHeader: string };
export type ThemeSlot = keyof CardTheme;
export const THEME_SLOTS: readonly ThemeSlot[] = ['cardBody', 'cardHeader'];
export const DEFAULT_CARD_THEME: CardTheme = { cardBody: TINT_DEFAULT, cardHeader: TINT_DEFAULT };

const slotValue = v.optional(v.pipe(v.string(), v.regex(TINT_VALUE_PATTERN)), TINT_DEFAULT);

/** Theme v1. A new option = version + 1 and a migration (ADR-001, like a widget config). */
export const DASHBOARD_THEME_SPEC: WidgetConfigSpec<CardTheme> = {
  version: 1,
  schema: v.strictObject({ cardBody: slotValue, cardHeader: slotValue }),
  defaults: () => ({ ...DEFAULT_CARD_THEME }),
  migrations: {},
};

export type ResolvedCardTheme =
  | { readonly status: 'ok'; readonly theme: CardTheme }
  /** Version newer than this build: shown by default, the panel is read-only. */
  | { readonly status: 'future' }
  /** Anything else: shown by default; replaced by the next save. */
  | { readonly status: 'invalid' };

/** resolveConfig(DASHBOARD_THEME_SPEC, version, data); never throws. */
export function resolveCardTheme(data: JsonObject, version: number): ResolvedCardTheme {
  const resolved = resolveConfig(DASHBOARD_THEME_SPEC, version, data);
  if (resolved.status === 'ok') return { status: 'ok', theme: resolved.config };
  return resolved.reason === 'future-version' ? { status: 'future' } : { status: 'invalid' };
}

/** The tint when `value` is in CARD_TINTS (Array.includes, never an object lookup), else null. */
export function knownTint(value: string): CardTint | null {
  const tints: readonly string[] = CARD_TINTS;
  return tints.includes(value) ? (value as CardTint) : null;
}

/** Effective tints (D5): body = knownTint(cardBody); header = knownTint(cardHeader) ?? body. */
export function bodyTint(theme: CardTheme): CardTint | null {
  return knownTint(theme.cardBody);
}
export function headerTint(theme: CardTheme): CardTint | null {
  return knownTint(theme.cardHeader) ?? bodyTint(theme);
}

/** Copy of `theme` with `slot` set to `tint` (null = TINT_DEFAULT). Never mutates its input. */
export function withTint(theme: CardTheme, slot: ThemeSlot, tint: CardTint | null): CardTheme {
  return { ...theme, [slot]: tint ?? TINT_DEFAULT };
}

const MEANING_COLORS = ['accent', 'danger', 'success', 'attention'] as const;

/**
 * Inline custom properties of a `.card-theme` scope (spec 4.5), from the effective tints only
 * (ids of CARD_TINTS, never a stored value). No effective tint: no property (scope defaults).
 */
export function cardThemeStyle(theme: CardTheme | null): Readonly<Record<string, string>> {
  const style: Record<string, string> = {};
  if (!theme) return style;
  const body = bodyTint(theme);
  const header = headerTint(theme);
  if (body) {
    style['--hb-card-body-bg'] = `var(--hb-tint-${body}-body)`;
    style['--hb-card-body-muted'] = `var(--hb-tint-${body}-muted)`;
    for (const color of MEANING_COLORS) {
      style[`--hb-card-body-${color}`] = `var(--hb-on-tint-${color})`;
    }
  }
  if (header) {
    style['--hb-card-header-bg'] = `var(--hb-tint-${header}-header)`;
    style['--hb-card-header-muted'] = `var(--hb-tint-${header}-muted)`;
    style['--hb-card-header-border'] = `var(--hb-tint-${header}-border)`;
  }
  const frame = body ?? header;
  if (frame) style['--hb-card-body-border'] = `var(--hb-tint-${frame}-border)`;
  return style;
}

/**
 * Inline style of a swatch of the panel (header color on top of the body color). tint null: the
 * default tokens.
 */
export function tintSwatchStyle(tint: CardTint | null): Readonly<Record<string, string>> {
  if (!tint) {
    return {
      '--hb-swatch-top': 'var(--hb-bg-subtle)',
      '--hb-swatch-fill': 'var(--hb-bg)',
      '--hb-swatch-border': 'var(--hb-border)',
      '--hb-swatch-ink': 'var(--hb-fg-muted)',
    };
  }
  return {
    '--hb-swatch-top': `var(--hb-tint-${tint}-header)`,
    '--hb-swatch-fill': `var(--hb-tint-${tint}-body)`,
    '--hb-swatch-border': `var(--hb-tint-${tint}-border)`,
    '--hb-swatch-ink': `var(--hb-tint-${tint}-muted)`,
  };
}
