import { isTauri } from '@tauri-apps/api/core';

/** True when running inside the Tauri shell. The single detection used by data/ and core/. */
export function isTauriRuntime(): boolean {
  return isTauri() || '__TAURI_INTERNALS__' in globalThis;
}
