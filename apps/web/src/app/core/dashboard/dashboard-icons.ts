import { DEFAULT_DASHBOARD_ICON } from '../../data';

/** Closed list of dashboard icons (PrimeIcons names, without the `pi-` prefix). */
export const DASHBOARD_ICONS = [
  'th-large',
  'home',
  'briefcase',
  'desktop',
  'code',
  'wrench',
  'chart-line',
  'wallet',
  'calendar',
  'book',
  'graduation-cap',
  'pencil',
  'palette',
  'camera',
  'video',
  'microphone',
  'headphones',
  'play-circle',
  'trophy',
  'star',
  'heart',
  'users',
  'globe',
  'bolt',
] as const;

export type DashboardIcon = (typeof DASHBOARD_ICONS)[number];

function isListed(icon: string): icon is DashboardIcon {
  return (DASHBOARD_ICONS as readonly string[]).includes(icon);
}

/** Only a listed icon produces a class; anything else shows the default icon. */
export function dashboardIconClass(icon: string): string {
  return `pi pi-${isListed(icon) ? icon : DEFAULT_DASHBOARD_ICON}`;
}
