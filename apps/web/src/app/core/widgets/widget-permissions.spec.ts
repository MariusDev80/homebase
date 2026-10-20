import {
  WidgetPermissionError,
  assertWidgetPermission,
  hasWidgetPermission,
} from './widget-permissions';

const ctx = { type: 'demo', permissions: new Set(['network'] as const) };

describe('widget permissions', () => {
  it('reports declared and undeclared permissions', () => {
    expect(hasWidgetPermission(ctx, 'network')).toBe(true);
    expect(hasWidgetPermission(ctx, 'open-url')).toBe(false);
  });

  it('assert passes when declared', () => {
    expect(() => assertWidgetPermission(ctx, 'network')).not.toThrow();
  });

  it('assert throws an error carrying the widget type and permission', () => {
    try {
      assertWidgetPermission(ctx, 'launch-apps');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(WidgetPermissionError);
      expect(error).toMatchObject({ widgetType: 'demo', permission: 'launch-apps' });
    }
  });
});
