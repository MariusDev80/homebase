import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { DashboardListStore } from './dashboard-list.store';

/** `/` goes to the last opened dashboard, else the first. Never rejects the navigation. */
export const dashboardHomeGuard: CanActivateFn = async () => {
  const list = inject(DashboardListStore);
  const router = inject(Router);
  const transloco = inject(TranslocoService);
  try {
    await list.load(transloco.translate('dashboard.defaultName'));
    const id = await list.defaultTargetId();
    return id === null ? true : router.createUrlTree(['/dashboards', id]);
  } catch {
    return true;
  }
};
