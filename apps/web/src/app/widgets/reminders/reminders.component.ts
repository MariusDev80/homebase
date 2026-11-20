import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ReminderStore } from '../../core/reminders';
import { TimeDisplay, UserTimeZone, createNowSignal } from '../../core/time';
import { injectWidgetContext } from '../../core/widgets';
import type { Reminder, ReminderDelivery } from '../../data';
import { ReminderDetailComponent } from './reminder-detail.component';
import type { ReminderDetailResult } from './reminder-detail.component';
import { problemOf } from './reminder-form';
import { createLabelFormat } from './reminder-format';
import { deliveryLabel, upcomingLabel, zoneSuffix } from './reminder-label';
import type { RemindersConfig } from './reminders.config';

const ANNOUNCE: Record<Exclude<ReminderDetailResult, 'cancelled'>, string> = {
  saved: 'widgets.reminders.announce.saved',
  deleted: 'widgets.reminders.announce.deleted',
  skipped: 'widgets.reminders.announce.skipped',
  'not-ringing': 'widgets.reminders.notRinging',
};

interface Row {
  readonly reminder: Reminder;
  readonly when: string;
  readonly recurring: boolean;
}

interface DeliveryRow {
  readonly delivery: ReminderDelivery;
  readonly when: string;
  readonly skippedKey: string;
}

@Component({
  selector: 'app-reminders-widget',
  imports: [TranslocoPipe, ReminderDetailComponent],
  templateUrl: './reminders.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full min-h-0 flex-col gap-2 focus:outline-none', tabindex: '-1' },
})
export class RemindersComponent {
  protected readonly ctx = injectWidgetContext<RemindersConfig>();
  protected readonly store = inject(ReminderStore);
  private readonly userZone = inject(UserTimeZone);
  private readonly display = inject(TimeDisplay);
  private readonly transloco = inject(TranslocoService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly now = createNowSignal(60_000, inject(DestroyRef));
  private readonly fmt = createLabelFormat(this.transloco, this.display);

  protected readonly headingId = `reminders-heading-${this.ctx.instanceId}`;
  protected readonly finishedId = `reminders-finished-${this.ctx.instanceId}`;
  protected readonly view = signal<'main' | 'form'>('main');
  protected readonly editing = signal<Reminder | null>(null);
  protected readonly finishedOpen = signal(false);
  protected readonly busy = signal(false);
  /** i18n key of the last failed action (mark as seen, delete). */
  protected readonly actionError = signal<string | null>(null);
  protected readonly announcement = signal('');
  /** Warning shown after a save the scheduler will never ring. */
  protected readonly notice = signal<string | null>(null);
  /** Id of the unreadable reminder whose deletion is awaiting confirmation. */
  protected readonly confirmingInvalid = signal<string | null>(null);

  protected readonly unavailable = computed(() => this.store.error()?.kind === 'unavailable');
  protected readonly loadError = computed(() => this.store.error() !== null && !this.unavailable());
  protected readonly actionMessage = computed(() =>
    this.unavailable() ? null : this.actionError(),
  );

  private failedAt: readonly Reminder[] | null = null;
  private openerKey = 'new';

  private safe(build: () => string): string {
    try {
      return build();
    } catch {
      return '';
    }
  }

  private row(r: Reminder): Row {
    const zone = this.userZone.id();
    const at = r.nextFireAt;
    const when =
      at === null
        ? this.t('widgets.reminders.noNext')
        : this.safe(() => upcomingLabel(at, r.nextFireKey, r.timeZone, this.now(), zone, this.fmt));
    return { reminder: r, when, recurring: r.rrule !== null };
  }

  protected readonly upcoming = computed<readonly Row[]>(() =>
    this.store
      .reminders()
      .filter((r) => r.status === 'scheduled')
      // A scheduled reminder without a next occurrence goes last.
      .sort(
        (a, b) =>
          Number(a.nextFireAt === null) - Number(b.nextFireAt === null) ||
          (a.nextFireAt ?? '').localeCompare(b.nextFireAt ?? ''),
      )
      .map((r) => this.row(r)),
  );
  protected readonly paused = computed<readonly Row[]>(() =>
    this.store
      .reminders()
      .filter((r) => r.status === 'disabled')
      .map((r) => this.row(r)),
  );
  protected readonly finished = computed<readonly Row[]>(() =>
    this.store
      .reminders()
      .filter((r) => r.status === 'finished')
      .map((r) => this.row(r)),
  );
  protected readonly invalid = computed(() =>
    this.store.reminders().filter((r) => r.status === 'invalid'),
  );
  protected readonly rung = computed<readonly DeliveryRow[]>(() =>
    this.store.unseen().map((delivery) => ({
      delivery,
      when: this.safe(() => deliveryLabel(delivery, this.now(), this.userZone.id(), this.fmt)),
      skippedKey:
        delivery.skippedCount === 1
          ? 'widgets.reminders.skippedTextOne'
          : 'widgets.reminders.skippedTextMany',
    })),
  );
  protected readonly isEmpty = computed(
    () => this.store.reminders().length === 0 && this.store.unseen().length === 0,
  );

  constructor() {
    // A successful re-read after a failed action clears its message.
    effect(() => {
      const list = this.store.reminders();
      untracked(() => {
        if (list !== this.failedAt) this.actionError.set(null);
      });
    });
  }

  /** "17 nov. 2026 09:00", with "(09:00 Paris)" when the reminder zone is not the user's. */
  protected finishedTime(row: Row): string {
    const r = row.reminder;
    return this.safe(() => {
      const date = this.display.formatLocalDate(r.startLocal.slice(0, 10), 'short');
      const suffix = zoneSuffix(r.startLocal, r.timeZone, this.userZone.id());
      return `${date} ${r.startLocal.slice(11, 16)}${suffix === '' ? '' : ` ${suffix}`}`;
    });
  }

  protected openNew(): void {
    this.openForm(null, 'new');
  }

  protected openDetail(reminder: Reminder): void {
    this.openForm(reminder, `detail-${reminder.id}`);
  }

  private openForm(reminder: Reminder | null, key: string): void {
    this.openerKey = key;
    this.announcement.set('');
    this.notice.set(null);
    this.confirmingInvalid.set(null);
    this.editing.set(reminder);
    this.view.set('form');
  }

  protected closeForm(result: ReminderDetailResult): void {
    this.view.set('main');
    this.editing.set(null);
    if (result === 'cancelled') {
      this.announcement.set('');
    } else {
      this.announcement.set(this.t(ANNOUNCE[result]));
      if (result === 'not-ringing') this.notice.set(ANNOUNCE[result]);
    }
    this.focus(result === 'saved' || result === 'cancelled' ? this.openerKey : null);
  }

  protected toggleFinished(): void {
    this.finishedOpen.update((open) => !open);
  }

  protected askRemoveInvalid(id: string): void {
    this.confirmingInvalid.set(id);
  }

  protected cancelRemoveInvalid(): void {
    this.confirmingInvalid.set(null);
  }

  protected async removeInvalid(id: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.actionError.set(null);
    try {
      await this.store.remove(id);
      this.confirmingInvalid.set(null);
      this.announcement.set(this.t('widgets.reminders.announce.deleted'));
    } catch (error) {
      this.failedAt = this.store.reminders();
      this.actionError.set(problemOf(error).key);
    } finally {
      this.busy.set(false);
    }
    this.focus(null);
  }

  protected async markSeen(delivery: ReminderDelivery): Promise<void> {
    await this.seen({
      kind: 'one',
      reminderId: delivery.reminderId,
      occurrenceKey: delivery.occurrenceKey,
    });
  }

  protected async markAllSeen(): Promise<void> {
    await this.seen({ kind: 'all' });
  }

  private async seen(target: Parameters<ReminderStore['markSeen']>[0]): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.actionError.set(null);
    try {
      await this.store.markSeen(target);
      this.announcement.set(this.t('widgets.reminders.announce.seen'));
    } catch (error) {
      this.failedAt = this.store.reminders();
      this.actionError.set(problemOf(error).key);
    } finally {
      this.busy.set(false);
    }
    this.focus(null);
  }

  /** Returns the focus to the control that opened the form, else to the first useful control. */
  private focus(key: string | null): void {
    afterNextRender(
      () => {
        const host = this.host.nativeElement;
        const target =
          (key === null ? null : host.querySelector<HTMLElement>(`[data-focus-key="${key}"]`)) ??
          host.querySelector<HTMLElement>('[data-focus-key="rung"]') ??
          host.querySelector<HTMLElement>(`#${CSS.escape(this.headingId)}`) ??
          host;
        target.focus();
      },
      { injector: this.injector },
    );
  }

  protected t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(key, params);
  }
}
