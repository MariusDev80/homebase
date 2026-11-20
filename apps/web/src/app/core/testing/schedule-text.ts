/** Same refusals as `schedule/text.rs`: C0, DEL and C1 controls, bidi and zero-width format characters. */
export function hasControlCharacter(text: string): boolean {
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (
      c <= 0x1f ||
      (c >= 0x7f && c <= 0x9f) ||
      (c >= 0x200b && c <= 0x200f) ||
      (c >= 0x202a && c <= 0x202e) ||
      (c >= 0x2066 && c <= 0x2069) ||
      c === 0xfeff
    ) {
      return true;
    }
  }
  return false;
}
