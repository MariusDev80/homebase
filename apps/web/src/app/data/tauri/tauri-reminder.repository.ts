import type { IdGenerator } from '../clock';
import type { Reminder, ReminderDelivery, ReminderInput } from '../models';
import type { MarkSeenTarget, ReminderRepository } from '../repositories';
import { invokeCommand } from './invoke-command';

/** Exact wire shape of ReminderInputDto: no extra field (deny_unknown_fields on the Rust side). */
function wireInput(input: ReminderInput): ReminderInput {
  return {
    title: input.title,
    startLocal: input.startLocal,
    timeZone: input.timeZone,
    rrule: input.rrule,
    exdates: [...input.exdates],
    enabled: input.enabled,
  };
}

/** ReminderRepository over the `reminder_*` Rust commands. */
export class TauriReminderRepository implements ReminderRepository {
  constructor(private readonly newId: IdGenerator) {}

  list(): Promise<Reminder[]> {
    return invokeCommand<Reminder[]>('reminder_list');
  }

  create(input: ReminderInput & { readonly id?: string }): Promise<Reminder> {
    return invokeCommand<Reminder>('reminder_create', {
      input: { id: input.id ?? this.newId(), ...wireInput(input) },
    });
  }

  update(id: string, input: ReminderInput): Promise<Reminder> {
    return invokeCommand<Reminder>('reminder_update', { id, input: wireInput(input) });
  }

  remove(id: string): Promise<boolean> {
    return invokeCommand<boolean>('reminder_delete', { id });
  }

  unseenDeliveries(limit: number): Promise<ReminderDelivery[]> {
    return invokeCommand<ReminderDelivery[]>('reminder_unseen_deliveries', { limit });
  }

  markSeen(target: MarkSeenTarget): Promise<number> {
    const wire =
      target.kind === 'all'
        ? { kind: 'all' }
        : { kind: 'one', reminderId: target.reminderId, occurrenceKey: target.occurrenceKey };
    return invokeCommand<number>('reminder_mark_seen', { target: wire });
  }
}
