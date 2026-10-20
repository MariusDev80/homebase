import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LayoutComponent } from './core/layout/layout.component';
import { ThemeService } from './core/theme';

@Component({
  selector: 'app-root',
  imports: [LayoutComponent],
  template: `<app-layout />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  // Instantiated eagerly so the theme class is applied at startup.
  private readonly theme = inject(ThemeService);
}
