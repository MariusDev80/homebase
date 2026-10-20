export interface Clock {
  /** Current instant in the exact `Date.prototype.toISOString()` format. */
  nowIso(): string;
}

/** UUID v4, lowercase. */
export type IdGenerator = () => string;

export const systemClock: Clock = { nowIso: () => new Date().toISOString() };

export const randomUuid: IdGenerator = () => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID().toLowerCase();
  }
  // RFC 4122 v4 fallback (randomUUID may be missing outside secure contexts).
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
