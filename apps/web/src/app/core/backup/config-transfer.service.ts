import { Injectable, inject } from '@angular/core';
import {
  CLOCK,
  DASHBOARD_REPOSITORY,
  SETTINGS_REPOSITORY,
  WIDGET_INSTANCE_REPOSITORY,
} from '../../data';
import { WidgetRegistry } from '../widgets';
import { BackupError, BackupService } from './backup.service';
import type { ConfigImportPlan, ImportIssue, ImportOutcome, ImportPreview } from './backup.types';
import {
  CONFIG_LIMITS,
  buildConfigExport,
  buildImportPreview,
  parseConfigImport,
  serializeConfigExport,
  utf8ByteLength,
} from './config-transfer';

/** A file that passed validation: the plan to apply and what applying it would do. */
export type ConfigImportAnalysis =
  | { readonly ok: true; readonly plan: ConfigImportPlan; readonly preview: ImportPreview }
  | {
      readonly ok: false;
      readonly issues: readonly ImportIssue[];
      readonly truncated: boolean;
    };

/**
 * Export / import of the configuration (dashboards, widgets, settings) as a JSON file
 * (spec backup-restore 4.12). Validation happens here; Rust re-checks and writes atomically.
 */
@Injectable({ providedIn: 'root' })
export class ConfigTransferService {
  private readonly backup = inject(BackupService);
  private readonly registry = inject(WidgetRegistry);
  private readonly clock = inject(CLOCK);
  private readonly dashboards = inject(DASHBOARD_REPOSITORY);
  private readonly widgets = inject(WIDGET_INSTANCE_REPOSITORY);
  private readonly settings = inject(SETTINGS_REPOSITORY);

  isAvailable(): boolean {
    return this.backup.isAvailable();
  }

  /**
   * Builds the document from the current data and asks Rust to save it. `false` when the user
   * cancels the dialog. Rejects with a BackupError (`unavailable`, `too_large`, ...).
   */
  async exportToFile(): Promise<boolean> {
    if (!this.backup.isAvailable()) {
      throw new BackupError({ kind: 'unavailable' });
    }
    const exportedAt = this.clock.nowIso();
    const dashboards = await this.dashboards.list();
    const withWidgets = await Promise.all(
      dashboards.map(async (dashboard) => ({
        id: dashboard.id,
        name: dashboard.name,
        sortOrder: dashboard.sortOrder,
        icon: dashboard.icon,
        widgets: (await this.widgets.listByDashboard(dashboard.id)).map((widget) => ({
          id: widget.id,
          widgetType: widget.widgetType,
          grid: widget.grid,
          config: widget.config,
          configVersion: widget.configVersion,
        })),
      })),
    );
    const settings = await this.settings.getAll();
    const text = serializeConfigExport(
      buildConfigExport({ exportedAt, dashboards: withWidgets, settings }),
    );
    if (utf8ByteLength(text) > CONFIG_LIMITS.maxFileBytes) {
      throw new BackupError({ kind: 'too_large' });
    }
    return this.backup.saveConfigFile(text);
  }

  /** Opens the file dialog (Rust) and analyses the chosen file. `null` when cancelled. */
  async pickAndAnalyze(): Promise<ConfigImportAnalysis | null> {
    const text = await this.backup.pickConfigFile();
    return text === null ? null : this.analyze(text);
  }

  /** Validates `text` against the registry and compares it with the current data. */
  async analyze(text: string): Promise<ConfigImportAnalysis> {
    const parsed = parseConfigImport(text, (type) => this.registry.get(type));
    if (!parsed.ok) {
      return { ok: false, issues: parsed.issues, truncated: parsed.truncated };
    }
    const dashboards = await this.dashboards.list();
    const widgets = (
      await Promise.all(dashboards.map((d) => this.widgets.listByDashboard(d.id)))
    ).flat();
    return {
      ok: true,
      plan: parsed.value.plan,
      preview: buildImportPreview(parsed.value, { dashboards, widgets }),
    };
  }

  /**
   * Replaces the configuration (Rust takes a `pre-import` backup first). The caller reloads the
   * page afterwards.
   */
  apply(plan: ConfigImportPlan): Promise<ImportOutcome> {
    return this.backup.applyConfigImport(plan);
  }
}
