/**
 * `HB_TRIM` (spec backup-restore 4.3): the union of JS `String.prototype.trim` and Rust
 * `str::trim` whitespace. Every member is in the BMP, so scanning UTF-16 code units is safe.
 * Same set and same test vectors as `hb_trim` on the Rust side (`backup/names.rs`).
 */
function isHbTrimUnit(code: number): boolean {
  return (
    (code >= 0x0009 && code <= 0x000d) ||
    code === 0x0020 ||
    code === 0x0085 ||
    code === 0x00a0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

/** Removes the `HB_TRIM` characters at both ends (never in the middle). */
export function hbTrim(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && isHbTrimUnit(text.charCodeAt(start))) start++;
  while (end > start && isHbTrimUnit(text.charCodeAt(end - 1))) end--;
  return text.slice(start, end);
}

/** Length in Unicode code points (`chars().count()` in Rust, `length()` in SQLite). */
export function codePointLength(text: string): number {
  return [...text].length;
}
