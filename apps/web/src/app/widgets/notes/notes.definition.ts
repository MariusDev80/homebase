import { defineWidget } from '../../core/widgets';
import {
  NOTES_CONFIG_VERSION,
  NotesConfig,
  notesConfigSchema,
  notesDefaults,
} from './notes.config';

export const notesWidget = defineWidget<NotesConfig>({
  type: 'notes',
  titleKey: 'widgets.notes.title',
  descriptionKey: 'widgets.notes.description',
  icon: 'pi pi-file-edit',
  loadComponent: () => import('./notes.component').then((m) => m.NotesComponent),
  size: { min: { w: 2, h: 2 }, default: { w: 4, h: 3 }, max: { w: 12, h: 8 } },
  config: {
    version: NOTES_CONFIG_VERSION,
    schema: notesConfigSchema,
    defaults: notesDefaults,
    migrations: {},
  },
  permissions: [],
  // The note is deleted with the widget (ADR-001 amendment: removeConfirmKey).
  removeConfirmKey: 'widgets.notes.removeConfirm',
});
