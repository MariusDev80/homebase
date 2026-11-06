import { Injectable, computed, signal } from '@angular/core';
import type { CanDeactivateFn } from '@angular/router';
import { inject } from '@angular/core';

export type AppLockKind = 'restore' | 'import' | 'delete';

/**
 * Global freeze of the application while an operation replaces the data (restoration, import).
 * The layout makes the header and the page inert and shows a status overlay; the navigation is
 * refused (see `appUnlockedGuard`). Kept outside `core/backup` so that it stays in the initial
 * bundle without pulling the backup code.
 */
@Injectable({ providedIn: 'root' })
export class AppLock {
  private readonly kindState = signal<AppLockKind | null>(null);
  private readonly statusState = signal<string | null>(null);

  readonly locked = this.kindState.asReadonly();
  readonly isLocked = computed(() => this.kindState() !== null);
  /** i18n key of the progress text shown in the overlay (null: the default of the kind). */
  readonly statusKey = this.statusState.asReadonly();

  lock(kind: AppLockKind): void {
    this.kindState.set(kind);
    this.statusState.set(null);
  }

  setStatus(key: string | null): void {
    this.statusState.set(key);
  }

  unlock(): void {
    this.kindState.set(null);
    this.statusState.set(null);
  }
}

/** `canDeactivate` guard: no navigation (links, Alt+Left, history) while the lock is taken. */
export const appUnlockedGuard: CanDeactivateFn<unknown> = () => !inject(AppLock).isLocked();
