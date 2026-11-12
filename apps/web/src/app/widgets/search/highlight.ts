export interface TextSegment {
  readonly text: string;
  readonly match: boolean;
}

/**
 * Splits `text` into plain and matching segments (every occurrence of `query`, case-insensitive).
 * Rendered as text nodes by the template, never as HTML.
 */
export function highlightSegments(text: string, query: string): TextSegment[] {
  const needle = query.trim().toLowerCase();
  const haystack = text.toLowerCase();
  // toLowerCase can change the length of a few characters: skip highlighting rather than misalign.
  if (needle === '' || haystack.length !== text.length) {
    return [{ text, match: false }];
  }
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, cursor)) {
    if (at > cursor) segments.push({ text: text.slice(cursor, at), match: false });
    segments.push({ text: text.slice(at, at + needle.length), match: true });
    cursor = at + needle.length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments.length === 0 ? [{ text, match: false }] : segments;
}
