/** Longest URL accepted (aligned with CHECK length(url) <= 2048 of the shortcuts table). */
export const WEB_URL_MAX_LENGTH = 2048;

export type WebUrlErrorReason = 'invalid' | 'protocol' | 'credentials' | 'too-long';

export type WebUrlResult =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: WebUrlErrorReason };

/**
 * The single rule for URLs the app may open: parsable by `new URL()`, `http:` or `https:`
 * only, no credentials, at most 2048 characters. On success `url` is the normalised
 * `URL.href` (lowercase scheme and host, escaped characters).
 */
export function parseWebUrl(input: string): WebUrlResult {
  const trimmed = input.trim();
  if (trimmed.length > WEB_URL_MAX_LENGTH) {
    return { ok: false, reason: 'too-long' };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'protocol' };
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return { ok: false, reason: 'credentials' };
  }
  if (parsed.href.length > WEB_URL_MAX_LENGTH) {
    return { ok: false, reason: 'too-long' };
  }
  return { ok: true, url: parsed.href };
}
