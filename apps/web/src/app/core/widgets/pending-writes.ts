import { Injectable } from '@angular/core';

/**
 * Registry of deferred writes (debounced note saves, coalesced layout writes). An operation that
 * replaces or deletes instances behind the front's back (configuration import) calls `flushAll`
 * first, so that no late write reaches a row that no longer exists.
 */
@Injectable({ providedIn: 'root' })
export class PendingWrites {
  private readonly flushers = new Set<() => Promise<void>>();

  /** Number of registered flushers (diagnostics and tests). */
  get count(): number {
    return this.flushers.size;
  }

  /** Registers a function that writes what is pending now. Returns the unregistration. */
  register(flush: () => Promise<void>): () => void {
    this.flushers.add(flush);
    return () => {
      this.flushers.delete(flush);
    };
  }

  /** Runs every flusher and waits for all of them. A failing one never blocks the others. */
  async flushAll(): Promise<void> {
    await Promise.allSettled([...this.flushers].map((flush) => flush()));
  }
}
