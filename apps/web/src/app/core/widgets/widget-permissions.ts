import type { WidgetContext } from './widget-context';
import type { WidgetPermissionKind, WidgetTypeId } from './widget-definition';

export class WidgetPermissionError extends Error {
  readonly widgetType: WidgetTypeId;
  readonly permission: WidgetPermissionKind;

  constructor(widgetType: WidgetTypeId, permission: WidgetPermissionKind) {
    super(`Widget "${widgetType}" has not declared the "${permission}" permission`);
    this.name = 'WidgetPermissionError';
    this.widgetType = widgetType;
    this.permission = permission;
  }
}

export function hasWidgetPermission(
  ctx: Pick<WidgetContext, 'permissions'>,
  kind: WidgetPermissionKind,
): boolean {
  return ctx.permissions.has(kind);
}

/** Guard rail, not a security boundary (ADR-001 section 3.8). */
export function assertWidgetPermission(
  ctx: Pick<WidgetContext, 'type' | 'permissions'>,
  kind: WidgetPermissionKind,
): void {
  if (!hasWidgetPermission(ctx, kind)) {
    throw new WidgetPermissionError(ctx.type, kind);
  }
}
