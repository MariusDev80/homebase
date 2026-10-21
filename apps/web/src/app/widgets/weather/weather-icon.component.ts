import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { WeatherIconName } from './weather-codes';

/**
 * Inline Lucide icons (ISC, see icons/LICENSE-lucide.txt), the only exception to PrimeIcons (DESIGN section 5).
 * The colour comes from `currentColor`: put a tone class on the host.
 */
@Component({
  selector: 'app-weather-icon',
  templateUrl: './weather-icon.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex shrink-0' },
})
export class WeatherIconComponent {
  readonly name = input.required<WeatherIconName>();
  readonly size = input<16 | 32>(16);
}
