import { Injectable } from '@angular/core';
import { invoke, isTauri } from '@tauri-apps/api/core';

/** Error payload serialized by the Rust `SpikeError` enum. */
export type SystemError =
  | { kind: 'delayOutOfRange'; min: number; max: number; got: number }
  | { kind: 'plugin'; message: string }
  | { kind: 'unavailable' };

export class SystemUnavailableError extends Error {
  readonly systemError: SystemError = { kind: 'unavailable' };

  constructor() {
    super('System features are only available in the desktop app');
    this.name = 'SystemUnavailableError';
  }
}

/** Thin wrapper around the Tauri commands (the only place importing @tauri-apps). */
@Injectable({ providedIn: 'root' })
export class SystemService {
  /** True when running inside the Tauri desktop shell. */
  isAvailable(): boolean {
    return isTauri();
  }

  async scheduleTestNotification(delaySecs: number): Promise<void> {
    await this.call<void>('schedule_test_notification', { delaySecs });
  }

  async getAutostart(): Promise<boolean> {
    return this.call<boolean>('get_autostart');
  }

  async setAutostart(enabled: boolean): Promise<void> {
    await this.call<void>('set_autostart', { enabled });
  }

  private async call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    if (!this.isAvailable()) {
      throw new SystemUnavailableError();
    }
    return invoke<T>(command, args);
  }
}
