import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { WidgetConfigError, injectWidgetContext } from '../../core/widgets';
import type { HelloConfig } from './hello.config';

@Component({
  selector: 'app-hello-widget',
  imports: [TranslocoPipe],
  templateUrl: './hello.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HelloComponent {
  protected readonly ctx = injectWidgetContext<HelloConfig>();
  protected readonly invalid = signal(false);

  protected async submit(event: Event, value: string): Promise<void> {
    event.preventDefault();
    try {
      await this.ctx.updateConfig({ ...this.ctx.config(), name: value });
      this.invalid.set(false);
    } catch (error) {
      if (error instanceof WidgetConfigError) {
        this.invalid.set(true);
        return;
      }
      throw error;
    }
  }
}
