const EXCERPT_BEFORE = 30;
const EXCERPT_LENGTH = 100;

// JS \s is exactly the Rust set (spec 4.3) minus U+0085.
const HB_TRIM = /[\s\u0085]/;

/**
 * Same trim as Rust `hb_trim` (data/validate.rs): JS `trim()` whitespace plus U+0085, which JS
 * keeps. Used for the excerpt term so it matches the query the commands searched.
 */
export function hbTrim(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && HB_TRIM.test(text.charAt(start))) start++;
  while (end > start && HB_TRIM.test(text.charAt(end - 1))) end--;
  return text.slice(start, end);
}

/** Short single-line excerpt of `body` around the first occurrence of `term` (ASCII-insensitive). */
export function excerptAround(body: string, term: string): string {
  const lowerBody = body.toLowerCase();
  const index = lowerBody.length === body.length ? lowerBody.indexOf(term.toLowerCase()) : -1;
  const start = index > EXCERPT_BEFORE ? index - EXCERPT_BEFORE : 0;
  const slice = body
    .slice(start, start + EXCERPT_LENGTH)
    .replace(/\s+/g, ' ')
    .trim();
  const prefix = start > 0 ? '…' : '';
  const suffix = start + EXCERPT_LENGTH < body.length ? '…' : '';
  return slice === '' ? '' : `${prefix}${slice}${suffix}`;
}
