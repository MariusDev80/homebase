import { DASHBOARD_ICON_PATTERN, DEFAULT_DASHBOARD_ICON } from '../../data';
import { DASHBOARD_ICONS, dashboardIconClass } from './dashboard-icons';

describe('dashboardIconClass', () => {
  it('lists 24 distinct icons that all match the stored format', () => {
    expect(DASHBOARD_ICONS).toHaveLength(24);
    expect(new Set(DASHBOARD_ICONS).size).toBe(24);
    expect(DASHBOARD_ICONS).toContain(DEFAULT_DASHBOARD_ICON);
    for (const icon of DASHBOARD_ICONS) expect(DASHBOARD_ICON_PATTERN.test(icon)).toBe(true);
  });

  it('builds a class for a listed icon only', () => {
    expect(dashboardIconClass('chart-line')).toBe('pi pi-chart-line');
  });

  it.each(['pi pi-x', '', 'A', 'unknown-icon', 'x'.repeat(40)])(
    'falls back to the default icon for %j',
    (icon) => {
      expect(dashboardIconClass(icon)).toBe('pi pi-th-large');
    },
  );
});
