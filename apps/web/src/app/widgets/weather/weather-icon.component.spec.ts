import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { WeatherIconName } from './weather-codes';
import { WeatherIconComponent } from './weather-icon.component';

const NAMES: WeatherIconName[] = [
  'sun',
  'moon',
  'cloud-sun',
  'cloud-moon',
  'cloud',
  'fog',
  'drizzle',
  'rain',
  'freezing',
  'showers',
  'snow',
  'snowflake',
  'thunderstorm',
  'unknown',
];

@Component({
  imports: [WeatherIconComponent],
  template: `<app-weather-icon [name]="name()" [size]="size()" />`,
})
class HostComponent {
  readonly name = signal<WeatherIconName>('sun');
  readonly size = signal<16 | 32>(16);
}

describe('WeatherIconComponent', () => {
  it.each(NAMES)('renders a single safe svg for %s', (name) => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.name.set(name);
    fixture.detectChanges();
    const svgs = fixture.nativeElement.querySelectorAll('svg') as NodeListOf<SVGElement>;
    expect(svgs).toHaveLength(1);
    const svg = svgs[0];
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('fill')).toBe('none');
    expect(svg.children.length).toBeGreaterThan(0);
    for (const element of [svg, ...Array.from(svg.querySelectorAll('*'))]) {
      expect(element.hasAttribute('style')).toBe(false);
      expect(element.hasAttribute('xlink:href')).toBe(false);
      if (element !== svg) expect(element.hasAttribute('fill')).toBe(false);
    }
  });

  it('applies the size', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.size.set(32);
    fixture.detectChanges();
    const svg = fixture.nativeElement.querySelector('svg') as SVGElement;
    expect(svg.getAttribute('width')).toBe('32');
    expect(svg.getAttribute('height')).toBe('32');
  });
});
