import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { Dialog } from 'primeng/dialog';
import { DEFAULT_DASHBOARD_ICON, type Dashboard } from '../../data';
import { DASHBOARD_ICONS, dashboardIconClass } from '../dashboard/dashboard-icons';
import { DashboardLimitError, DashboardListStore } from '../dashboard/dashboard-list.store';

const NAME_MAX_LENGTH = 100;

/** Creation (dashboard null) and edition (name and icon) of a dashboard. */
@Component({
  selector: 'app-dashboard-form-dialog',
  imports: [TranslocoPipe, Dialog],
  host: { '(document:keydown.escape)': 'onEscape()' },
  template: `
    <p-dialog
      [visible]="true"
      [modal]="true"
      [closable]="false"
      [closeOnEscape]="false"
      [focusOnShow]="false"
      appendTo="body"
      [header]="
        (dashboard() ? 'dashboards.form.titleEdit' : 'dashboards.form.titleCreate') | transloco
      "
      [style]="{ width: '32rem', maxWidth: '92vw' }"
      data-testid="dashboard-form-dialog"
    >
      <form
        novalidate
        class="flex flex-col items-start gap-3"
        [attr.aria-busy]="busy()"
        (submit)="submit($event)"
      >
        <div class="flex w-full flex-col">
          <label for="dashboard-form-name" class="font-semibold">
            {{ 'dashboards.form.name' | transloco }}
          </label>
          <input
            #nameInput
            id="dashboard-form-name"
            type="text"
            class="field"
            autocomplete="off"
            data-testid="dashboard-form-name"
            [value]="name()"
            [disabled]="busy()"
            [attr.aria-invalid]="nameError() ? 'true' : null"
            [attr.aria-describedby]="nameError() ? 'dashboard-form-name-error' : null"
            (input)="onNameInput($event)"
          />
          @if (nameError()) {
            <p
              id="dashboard-form-name-error"
              class="field-error"
              data-testid="dashboard-form-name-error"
            >
              {{ 'dashboards.form.nameInvalid' | transloco }}
            </p>
          }
        </div>

        <fieldset class="flex flex-col gap-2" [disabled]="busy()">
          <legend class="font-semibold">{{ 'dashboards.form.icon' | transloco }}</legend>
          <div class="flex flex-wrap gap-2">
            @for (option of icons; track option) {
              <label
                class="icon-choice"
                [attr.title]="'dashboards.icons.' + option | transloco"
                [attr.data-icon]="option"
              >
                <input
                  class="sr-only"
                  type="radio"
                  name="dashboard-icon"
                  [value]="option"
                  [checked]="icon() === option"
                  (change)="icon.set(option)"
                />
                <i [class]="iconClass(option)" aria-hidden="true"></i>
                <span class="sr-only">{{ 'dashboards.icons.' + option | transloco }}</span>
              </label>
            }
          </div>
        </fieldset>

        @if (errorKey(); as key) {
          <p role="alert" class="flash flash-danger" data-testid="dashboard-form-error">
            <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
            {{ key | transloco }}
          </p>
        }

        <div class="flex gap-2 self-end">
          <button
            type="button"
            class="btn"
            data-testid="dashboard-form-cancel"
            [disabled]="busy()"
            (click)="cancel()"
          >
            {{ 'dashboards.form.cancel' | transloco }}
          </button>
          <button
            type="submit"
            class="btn btn-primary"
            data-testid="dashboard-form-submit"
            [disabled]="busy()"
          >
            {{ (dashboard() ? 'dashboards.form.save' : 'dashboards.form.create') | transloco }}
          </button>
        </div>
      </form>
    </p-dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardFormDialogComponent {
  private readonly list = inject(DashboardListStore);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);

  /** The dashboard to edit; null to create one. Read once, when the dialog opens. */
  readonly dashboard = input.required<Dashboard | null>();
  /** The saved dashboard, or null when the dialog was dismissed. */
  readonly closed = output<Dashboard | null>();

  protected readonly icons = DASHBOARD_ICONS;
  protected readonly iconClass = dashboardIconClass;
  protected readonly name = linkedSignal(() => this.dashboard()?.name ?? '');
  /** A stored icon outside the closed list is kept as is (it just checks no radio). */
  protected readonly icon = linkedSignal<string>(
    () => this.dashboard()?.icon ?? DEFAULT_DASHBOARD_ICON,
  );
  protected readonly busy = signal(false);
  protected readonly submitted = signal(false);
  protected readonly errorKey = signal<string | null>(null);
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');

  protected readonly nameError = computed(() => this.submitted() && !this.nameValid());
  private readonly nameValid = computed(() => {
    const length = this.name().trim().length;
    return length >= 1 && length <= NAME_MAX_LENGTH;
  });

  constructor() {
    afterNextRender(() => this.focusName(), { injector: this.injector });
  }

  private focusName(): void {
    this.nameInput()?.nativeElement.focus();
  }

  protected onNameInput(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
  }

  /** Escape closes the dialog at rest; it is ignored while a write is running. */
  protected onEscape(): void {
    if (!this.busy()) this.closed.emit(null);
  }

  protected cancel(): void {
    if (!this.busy()) this.closed.emit(null);
  }

  protected async submit(event: Event): Promise<void> {
    // The CSP forbids form submission (form-action 'none'): the form is handled here.
    event.preventDefault();
    if (this.busy()) return;
    this.submitted.set(true);
    if (!this.nameValid()) {
      this.focusName();
      return;
    }
    this.errorKey.set(null);
    this.busy.set(true);
    const input = { name: this.name().trim(), icon: this.icon() };
    try {
      const current = this.dashboard();
      if (current) {
        const saved = await this.list.update(current.id, input);
        this.closed.emit(saved);
      } else {
        const created = await this.list.create(input);
        await this.router.navigate(['/dashboards', created.id]);
        this.closed.emit(created);
      }
    } catch (error: unknown) {
      this.errorKey.set(
        error instanceof DashboardLimitError ? 'dashboards.limit' : 'dashboards.form.error',
      );
      if (!(error instanceof DashboardLimitError)) {
        console.error('Could not save the dashboard', error);
      }
      afterNextRender(() => this.focusName(), { injector: this.injector });
    } finally {
      this.busy.set(false);
    }
  }
}
