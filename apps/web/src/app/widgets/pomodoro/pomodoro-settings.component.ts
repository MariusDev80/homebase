import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  output,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { PendingWrites, injectWidgetContext } from '../../core/widgets';
import * as v from 'valibot';
import { POMODORO_BOUNDS, pomodoroConfigSchema } from './pomodoro.config';
import type { PomodoroConfig, PomodoroSettingKey } from './pomodoro.config';

/** Delay between the last keystroke and the automatic save (DESIGN.md, panel). */
export const POMODORO_SETTINGS_SAVE_DEBOUNCE_MS = 800;

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface Field {
  readonly key: PomodoroSettingKey;
  readonly min: number;
  readonly max: number;
}

const KEYS: readonly PomodoroSettingKey[] = [
  'workMinutes',
  'shortBreakMinutes',
  'longBreakMinutes',
  'longBreakEvery',
];

/** Whole number as typed, accepted by the config schema, or null (empty, decimal, unreadable). */
function parseSetting(key: PomodoroSettingKey, text: string): number | null {
  const trimmed = text.trim();
  if (!/^[0-9]{1,4}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return v.safeParse(pomodoroConfigSchema.entries[key], value).success ? value : null;
}

/** Settings panel of the pomodoro: durations and cycle length, saved as the user types. */
@Component({
  selector: 'app-pomodoro-settings',
  imports: [TranslocoPipe],
  templateUrl: './pomodoro-settings.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-0 flex-1 flex-col' },
})
export class PomodoroSettingsComponent {
  readonly closed = output<void>();

  private readonly ctx = injectWidgetContext<PomodoroConfig>();
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly fields: readonly Field[] = KEYS.map((key) => ({
    key,
    ...POMODORO_BOUNDS[key],
  }));
  protected readonly instanceId = this.ctx.instanceId;
  /** What each field shows: the saved value until the user types. */
  protected readonly drafts = signal<Record<PomodoroSettingKey, string>>(this.fromConfig());
  protected readonly invalid = signal<ReadonlySet<PomodoroSettingKey>>(new Set());
  protected readonly saveState = signal<SaveState>('idle');

  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | null = null;
  private finished = false;
  private dirty = false;

  constructor() {
    const unregister = inject(PendingWrites).register(() => this.flush());
    inject(DestroyRef).onDestroy(() => {
      this.finished = true;
      clearTimeout(this.timer);
      void this.write().finally(unregister);
    });
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLInputElement>('input')?.focus(),
      { injector: this.injector },
    );
  }

  private fromConfig(): Record<PomodoroSettingKey, string> {
    const c = this.ctx.config();
    return {
      workMinutes: String(c.workMinutes),
      shortBreakMinutes: String(c.shortBreakMinutes),
      longBreakMinutes: String(c.longBreakMinutes),
      longBreakEvery: String(c.longBreakEvery),
    };
  }

  protected onInput(key: PomodoroSettingKey, event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    this.drafts.update((d) => ({ ...d, [key]: text }));
    this.dirty = true;
    const next = new Set(this.invalid());
    if (parseSetting(key, text) === null) next.add(key);
    else next.delete(key);
    this.invalid.set(next);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.write(), POMODORO_SETTINGS_SAVE_DEBOUNCE_MS);
  }

  protected onBlur(): void {
    void this.flush();
  }

  protected async back(): Promise<void> {
    if (this.finished) return;
    await this.flush();
    this.finished = true;
    this.closed.emit();
  }

  private flush(): Promise<void> {
    clearTimeout(this.timer);
    return this.write();
  }

  private write(): Promise<void> {
    this.running ??= this.drain().finally(() => (this.running = null));
    return this.running;
  }

  /** One save loop at a time: edits made while it runs are picked up by the same loop. */
  private async drain(): Promise<void> {
    while (this.dirty) {
      this.dirty = false;
      if (!(await this.save())) {
        // Kept dirty: a later blur or back retries.
        this.dirty = true;
        return;
      }
    }
  }

  /** Saves the valid fields (a field with an error keeps its saved value); false on failure. */
  private async save(): Promise<boolean> {
    const saved = this.ctx.config();
    const draft = this.drafts();
    const next: { -readonly [K in keyof PomodoroConfig]: PomodoroConfig[K] } = { ...saved };
    for (const key of KEYS) {
      const value = parseSetting(key, draft[key]);
      if (value !== null) next[key] = value;
    }
    if (KEYS.every((key) => next[key] === saved[key])) return true;
    this.saveState.set('saving');
    try {
      await this.ctx.updateConfig(next);
      this.saveState.set('saved');
      return true;
    } catch {
      this.saveState.set('error');
      return false;
    }
  }
}
