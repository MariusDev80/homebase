import { Routes } from '@angular/router';
import { dashboardHomeGuard } from './core/dashboard/dashboard-home.guard';
import { appUnlockedGuard } from './core/lock';

const dashboard = () =>
  import('./core/dashboard/dashboard.component').then((m) => m.DashboardComponent);

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'pages.dashboard.title',
    canActivate: [dashboardHomeGuard],
    canDeactivate: [appUnlockedGuard],
    loadComponent: dashboard,
  },
  {
    path: 'dashboards/:id',
    title: 'pages.dashboard.title',
    canDeactivate: [appUnlockedGuard],
    loadComponent: dashboard,
  },
  {
    path: 'settings',
    title: 'pages.settings.title',
    canDeactivate: [appUnlockedGuard],
    loadComponent: () => import('./features/settings/settings.page').then((m) => m.SettingsPage),
  },
  { path: '**', redirectTo: '' },
];
