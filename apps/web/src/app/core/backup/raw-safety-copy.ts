/**
 * Name of a raw safety copy folder written by Rust (`homebase-<stamp>-pre-restore-raw`), where the
 * stamp is a UTC instant without `-` or `:` (`20261021T081500.123Z`). Same shape as the Rust
 * check; the front only ever receives names, never paths.
 */
export const RAW_SAFETY_COPY_PATTERN =
  /^homebase-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\.\d{3})Z-pre-restore-raw$/;

/**
 * ISO 8601 instant carried by the name of a raw safety copy, or null when the name has another
 * shape. Pure re-formatting of the stamp: the date itself is read and shown through `core/time`.
 */
export function rawSafetyCopyInstant(name: string): string | null {
  const m = RAW_SAFETY_COPY_PATTERN.exec(name);
  return m === null ? null : `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7]}Z`;
}
