import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { installTemporal } from './app/core/time/temporal';

// Not an Angular initializer: those run in parallel, a root service could use core/time too early.
installTemporal()
  .then(() => bootstrapApplication(App, appConfig))
  .catch((err) => {
    console.error(err);
    document.body.textContent = 'Homebase: startup failed.';
  });
