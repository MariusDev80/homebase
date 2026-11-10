import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Dialog } from 'primeng/dialog';
import { DashboardListStore } from '../dashboard/dashboard-list.store';
import { DashboardThemeFlow } from '../dashboard/dashboard-theme-flow';
import {
  CARD_TINTS,
  DASHBOARD_THEME_SPEC,
  DEFAULT_CARD_THEME,
  THEME_SLOTS,
  TINT_DEFAULT,
  bodyTint,
  cardThemeStyle,
  knownTint,
  resolveCardTheme,
  tintSwatchStyle,
  withTint,
} from '../dashboard/dashboard-theme';
import type { CardTheme, CardTint, ThemeSlot } from '../dashboard/dashboard-theme';
import { serializeConfig } from '../widgets/widget-config';

/** Choices of a group: the default (null) then every tint, in the order of the palette. */
const CHOICES: readonly (CardTint | null)[] = [null, ...CARD_TINTS];

/**
 * Theme panel of the current dashboard (spec dashboard-theme 4.6). The choices only change a
 * draft, shown live on the grid through DashboardThemeFlow.preview; nothing is written before
 * "Enregistrer". Cancel and Escape drop the draft.
 */
@Component({
  selector: 'app-dashboard-theme-dialog',
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
      position="bottomleft"
      maskStyleClass="dialog-mask-clear"
      [header]="'dashboardTheme.title' | transloco: { name: dashboardName() }"
      [style]="{ width: '22rem', maxWidth: '92vw' }"
      data-testid="dashboard-theme-dialog"
    >
      <form
        novalidate
        class="flex flex-col items-start gap-3"
        [attr.aria-busy]="busy()"
        (submit)="save($event)"
      >
        @if (readOnly()) {
          <p class="flash flash-attention" data-testid="dashboard-theme-future">
            <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
            {{ 'dashboardTheme.future' | transloco }}
          </p>
        }
        @if (invalid()) {
          <p class="flash flash-attention" data-testid="dashboard-theme-invalid">
            <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
            {{ 'dashboardTheme.invalid' | transloco }}
          </p>
        }

        @for (slot of slots; track slot) {
          <fieldset
            #group
            class="flex w-full flex-col gap-2"
            [disabled]="readOnly()"
            [attr.data-testid]="'dashboard-theme-' + slot"
          >
            <legend class="font-semibold">{{ groupLabelKey(slot) | transloco }}</legend>
            <p class="text-xs text-fg-muted" aria-hidden="true">{{ selectedName(slot) }}</p>
            <div class="flex flex-wrap gap-2">
              @for (tint of choices; track tint ?? 'default') {
                @let name = choiceNameKey(slot, tint) | transloco;
                <label
                  class="tint-choice"
                  [attr.title]="name"
                  [style]="swatchStyle(slot, tint)"
                  [attr.data-slot]="slot"
                  [attr.data-tint]="tint ?? 'default'"
                >
                  <input
                    class="sr-only"
                    type="radio"
                    [name]="'dashboard-theme-' + slot"
                    [checked]="draft()[slot] === (tint ?? defaultValue)"
                    (change)="choose(slot, tint)"
                  />
                  <i class="pi pi-check" aria-hidden="true"></i>
                  <span class="sr-only">{{ name }}</span>
                </label>
              }
            </div>
            @if (isUnknown(slot)) {
              <p class="text-xs text-fg-muted" data-testid="dashboard-theme-unknown">
                {{ 'dashboardTheme.unknownTint' | transloco }}
              </p>
            }
          </fieldset>
        }

        <div class="w-full" aria-hidden="true" data-testid="dashboard-theme-preview">
          <div class="card-theme" [style]="previewStyle()">
            <section class="box">
              <header class="box-header">
                <i class="pi pi-th-large"></i>
                <span>{{ 'dashboardTheme.preview' | transloco }}</span>
                <i class="pi pi-trash ml-auto"></i>
              </header>
              <div class="box-body">
                <p class="text-fg">{{ 'dashboardTheme.previewText' | transloco }}</p>
                <p class="text-fg-muted">{{ 'dashboardTheme.previewMuted' | transloco }}</p>
                <p class="text-accent">{{ 'dashboardTheme.previewLink' | transloco }}</p>
              </div>
            </section>
          </div>
        </div>

        @if (failed()) {
          <p role="alert" class="flash flash-danger" data-testid="dashboard-theme-error">
            <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
            {{ 'dashboardTheme.error' | transloco }}
          </p>
        }

        <div class="flex gap-2 self-end">
          @if (readOnly()) {
            <button
              #closeButton
              type="button"
              class="btn"
              data-testid="dashboard-theme-close"
              (click)="cancel()"
            >
              {{ 'dashboardTheme.close' | transloco }}
            </button>
          } @else {
            <button
              type="button"
              class="btn"
              data-testid="dashboard-theme-cancel"
              [disabled]="busy()"
              (click)="cancel()"
            >
              {{ 'dashboardTheme.cancel' | transloco }}
            </button>
            <button
              type="submit"
              class="btn btn-primary"
              data-testid="dashboard-theme-save"
              [disabled]="busy()"
            >
              {{ 'dashboardTheme.save' | transloco }}
            </button>
          }
        </div>
      </form>
    </p-dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardThemeDialogComponent {
  private readonly list = inject(DashboardListStore);
  private readonly themeFlow = inject(DashboardThemeFlow);
  private readonly injector = inject(Injector);
  private readonly transloco = inject(TranslocoService);

  protected readonly slots = THEME_SLOTS;
  protected readonly choices = CHOICES;
  protected readonly defaultValue = TINT_DEFAULT;

  private readonly dashboard = this.list
    .dashboards()
    .find((d) => d.id === this.themeFlow.dashboardId());
  private readonly resolved = this.dashboard
    ? resolveCardTheme(this.dashboard.theme, this.dashboard.themeVersion)
    : null;

  protected readonly dashboardName = signal(this.dashboard?.name ?? '');
  /** A theme of a newer version cannot be edited here. */
  protected readonly readOnly = signal(this.resolved?.status === 'future');
  protected readonly invalid = signal(this.resolved?.status === 'invalid');
  protected readonly draft = signal<CardTheme>(
    this.resolved?.status === 'ok' ? this.resolved.theme : { ...DEFAULT_CARD_THEME },
  );
  protected readonly busy = signal(false);
  protected readonly failed = signal(false);
  protected readonly previewStyle = computed(() => cardThemeStyle(this.draft()));

  private readonly firstGroup = viewChild<ElementRef<HTMLElement>>('group');
  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');

  constructor() {
    if (!this.dashboard) {
      // The dashboard is gone: nothing to edit, nothing written.
      afterNextRender(() => this.themeFlow.close(), { injector: this.injector });
      return;
    }
    afterNextRender(() => this.focusInitial(), { injector: this.injector });
  }

  private focusInitial(): void {
    const close = this.closeButton()?.nativeElement;
    if (close) {
      close.focus();
      return;
    }
    const group = this.firstGroup()?.nativeElement;
    const target =
      group?.querySelector<HTMLInputElement>('input:checked') ??
      group?.querySelector<HTMLInputElement>('input');
    target?.focus();
  }

  protected groupLabelKey(slot: ThemeSlot): string {
    return slot === 'cardBody' ? 'dashboardTheme.body' : 'dashboardTheme.header';
  }

  protected choiceNameKey(slot: ThemeSlot, tint: CardTint | null): string {
    if (tint) return `dashboardTheme.tints.${tint}`;
    return slot === 'cardBody' ? 'dashboardTheme.default' : 'dashboardTheme.headerDefault';
  }

  /** The default of the header shows what "same as the background" will give. */
  protected swatchStyle(slot: ThemeSlot, tint: CardTint | null): Readonly<Record<string, string>> {
    if (tint) return tintSwatchStyle(tint);
    return tintSwatchStyle(slot === 'cardHeader' ? bodyTint(this.draft()) : null);
  }

  protected isUnknown(slot: ThemeSlot): boolean {
    const value = this.draft()[slot];
    return value !== TINT_DEFAULT && knownTint(value) === null;
  }

  /** Name of the chosen value, visual only (a screen reader gets it from the checked radio). */
  protected selectedName(slot: ThemeSlot): string {
    const value = this.draft()[slot];
    const tint = knownTint(value);
    if (tint === null && value !== TINT_DEFAULT) return '';
    return this.transloco.translate(this.choiceNameKey(slot, tint));
  }

  protected choose(slot: ThemeSlot, tint: CardTint | null): void {
    if (this.readOnly()) return;
    this.draft.set(withTint(this.draft(), slot, tint));
    this.themeFlow.setPreview(this.draft());
  }

  /** Escape closes the panel at rest; it is ignored while the write runs. */
  protected onEscape(): void {
    this.cancel();
  }

  protected cancel(): void {
    if (this.busy()) return;
    this.themeFlow.close();
  }

  protected async save(event: Event): Promise<void> {
    // The CSP forbids form submission (form-action 'none'): the form is handled here.
    event.preventDefault();
    if (this.busy() || this.readOnly() || this.themeFlow.phase() !== 'editing') return;
    // The write ends on the dashboard and the session it started in (D8, C11).
    const id = this.themeFlow.dashboardId();
    const session = this.themeFlow.editingSession();
    if (id === null || session === null) return;
    this.failed.set(false);
    const serialized = serializeConfig(DASHBOARD_THEME_SPEC, this.draft());
    if (!serialized.ok) {
      console.error('Could not serialize the dashboard theme', serialized.reason);
      this.failed.set(true);
      return;
    }
    this.busy.set(true);
    try {
      await this.list.updateTheme(id, serialized.config, serialized.version);
      this.themeFlow.close(session);
    } catch (error: unknown) {
      console.error('Could not save the dashboard theme', error);
      this.failed.set(true);
    } finally {
      this.busy.set(false);
    }
  }
}
