import Aura from '@primeuix/themes/aura';
import { definePreset } from '@primeuix/themes';

/**
 * PrimeNG preset derived from Aura. Every color, radius and the focus ring point to the --hb-*
 * tokens (docs/DESIGN.md section 5), so PrimeNG components follow the app theme instantly.
 * Light and dark share the same definition: the variables switch on `.app-dark`.
 */
const radius = 'var(--hb-radius)';

const mix = (percent: number, target: string): string =>
  `color-mix(in srgb, ${target} ${percent}%, var(--hb-bg))`;

const colors = {
  primary: {
    color: 'var(--hb-accent)',
    contrastColor: 'var(--hb-fg-on-emphasis)',
    hoverColor: 'color-mix(in srgb, var(--hb-accent) 85%, var(--hb-fg))',
    activeColor: 'color-mix(in srgb, var(--hb-accent) 70%, var(--hb-fg))',
  },
  highlight: {
    background: 'var(--hb-accent-subtle)',
    focusBackground: 'var(--hb-accent-subtle)',
    color: 'var(--hb-fg)',
    focusColor: 'var(--hb-fg)',
  },
  formField: {
    background: 'var(--hb-bg-inset)',
    disabledBackground: 'var(--hb-bg-subtle)',
    filledBackground: 'var(--hb-bg-inset)',
    filledHoverBackground: 'var(--hb-bg-inset)',
    filledFocusBackground: 'var(--hb-bg-inset)',
    borderColor: 'var(--hb-border)',
    hoverBorderColor: 'var(--hb-border)',
    focusBorderColor: 'var(--hb-accent)',
    invalidBorderColor: 'var(--hb-danger)',
    color: 'var(--hb-fg)',
    disabledColor: 'var(--hb-fg-muted)',
    placeholderColor: 'var(--hb-fg-muted)',
    invalidPlaceholderColor: 'var(--hb-danger)',
    floatLabelColor: 'var(--hb-fg-muted)',
    floatLabelFocusColor: 'var(--hb-accent)',
    floatLabelActiveColor: 'var(--hb-fg-muted)',
    floatLabelInvalidColor: 'var(--hb-danger)',
    iconColor: 'var(--hb-fg-muted)',
    shadow: 'none',
  },
  text: {
    color: 'var(--hb-fg)',
    hoverColor: 'var(--hb-fg)',
    mutedColor: 'var(--hb-fg-muted)',
    hoverMutedColor: 'var(--hb-fg)',
  },
  content: {
    background: 'var(--hb-bg)',
    hoverBackground: 'var(--hb-hover)',
    borderColor: 'var(--hb-border)',
    color: 'var(--hb-fg)',
    hoverColor: 'var(--hb-fg)',
  },
  overlay: {
    select: {
      background: 'var(--hb-bg)',
      borderColor: 'var(--hb-border)',
      color: 'var(--hb-fg)',
    },
    popover: {
      background: 'var(--hb-bg)',
      borderColor: 'var(--hb-border)',
      color: 'var(--hb-fg)',
    },
    modal: {
      background: 'var(--hb-bg)',
      borderColor: 'var(--hb-border)',
      color: 'var(--hb-fg)',
    },
  },
  list: {
    option: {
      focusBackground: 'var(--hb-hover)',
      selectedBackground: 'var(--hb-accent-subtle)',
      selectedFocusBackground: 'var(--hb-accent-subtle)',
      color: 'var(--hb-fg)',
      focusColor: 'var(--hb-fg)',
      selectedColor: 'var(--hb-fg)',
      selectedFocusColor: 'var(--hb-fg)',
      icon: { color: 'var(--hb-fg-muted)', focusColor: 'var(--hb-fg)' },
    },
    optionGroup: { background: 'transparent', color: 'var(--hb-fg-muted)' },
  },
  navigation: {
    item: {
      focusBackground: 'var(--hb-hover)',
      activeBackground: 'var(--hb-accent-subtle)',
      color: 'var(--hb-fg)',
      focusColor: 'var(--hb-fg)',
      activeColor: 'var(--hb-fg)',
      icon: {
        color: 'var(--hb-fg-muted)',
        focusColor: 'var(--hb-fg)',
        activeColor: 'var(--hb-fg)',
      },
    },
    submenuLabel: { background: 'transparent', color: 'var(--hb-fg-muted)' },
    submenuIcon: {
      color: 'var(--hb-fg-muted)',
      focusColor: 'var(--hb-fg)',
      activeColor: 'var(--hb-fg)',
    },
  },
  // Aura components read surface.* directly; map the scale onto the neutral tokens.
  surface: {
    0: 'var(--hb-bg)',
    50: 'var(--hb-bg-subtle)',
    100: 'var(--hb-bg-subtle)',
    200: 'var(--hb-border)',
    300: 'var(--hb-border)',
    400: 'var(--hb-fg-muted)',
    500: 'var(--hb-fg-muted)',
    600: 'var(--hb-fg-muted)',
    700: 'var(--hb-fg)',
    800: 'var(--hb-fg)',
    900: 'var(--hb-fg)',
    950: 'var(--hb-fg)',
  },
};

export const HomebasePreset = definePreset(Aura, {
  primitive: {
    borderRadius: {
      none: '0',
      xs: radius,
      sm: radius,
      md: radius,
      lg: radius,
      xl: 'var(--hb-radius-lg)',
    },
  },
  semantic: {
    transitionDuration: '0.1s',
    focusRing: {
      width: '2px',
      style: 'solid',
      color: 'var(--hb-focus)',
      offset: '2px',
      shadow: 'none',
    },
    primary: {
      50: 'var(--hb-accent-subtle)',
      100: mix(15, 'var(--hb-accent)'),
      200: mix(30, 'var(--hb-accent)'),
      300: mix(50, 'var(--hb-accent)'),
      400: mix(75, 'var(--hb-accent)'),
      500: 'var(--hb-accent)',
      600: 'var(--hb-accent)',
      700: 'color-mix(in srgb, var(--hb-accent) 85%, var(--hb-fg))',
      800: 'color-mix(in srgb, var(--hb-accent) 70%, var(--hb-fg))',
      900: 'color-mix(in srgb, var(--hb-accent) 55%, var(--hb-fg))',
      950: 'color-mix(in srgb, var(--hb-accent) 40%, var(--hb-fg))',
    },
    formField: { borderRadius: radius },
    list: { option: { borderRadius: radius }, optionGroup: {} },
    content: { borderRadius: radius },
    mask: { background: 'color-mix(in srgb, var(--hb-bg-inset) 60%, transparent)' },
    navigation: { item: { borderRadius: radius }, submenuLabel: {}, submenuIcon: {} },
    overlay: {
      select: { borderRadius: radius, shadow: 'var(--hb-shadow-floating)' },
      popover: { borderRadius: radius, padding: '0.5rem', shadow: 'var(--hb-shadow-floating)' },
      modal: {
        borderRadius: 'var(--hb-radius-lg)',
        padding: '1.5rem',
        shadow: 'var(--hb-shadow-floating)',
      },
    },
    colorScheme: { light: colors, dark: colors },
  },
});
