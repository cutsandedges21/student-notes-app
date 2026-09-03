/*
 * Every colour token resolves to a CSS variable rather than a literal hex.
 *
 * This is what makes dark mode a change to eleven lines of CSS instead of a
 * change to the ~650 utility classes that use these tokens: `bg-surface` keeps
 * meaning "the surface colour", and index.css decides what that is under
 * `:root` and under `.dark`. Adding `dark:` variants at every call site would
 * have been the same design expressed once per usage, and would have gone stale
 * the first time somebody added a component without one.
 *
 * The variables hold space-separated RGB channels rather than `#rrggbb` so the
 * slash-opacity syntax keeps working -- `bg-ink/30` and `bg-accent/20` are both
 * already in use, and neither can be expressed if the variable carries a
 * complete colour.
 */
const token = (name) => `rgb(var(--c-${name}) / <alpha-value>)`

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  /*
   * Class-based rather than `media`. The OS preference is still the default --
   * see themeStore.ts -- but a student reading in a bright library on a laptop
   * that is globally dark needs to be able to override it for this app alone,
   * and `media` offers no way to do that.
   */
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: token('ink'),
          muted: token('ink-muted'),
          /** Hints under form fields: quieter than muted, louder than faint. */
          subtle: token('ink-subtle'),
          faint: token('ink-faint'),
        },
        surface: {
          DEFAULT: token('surface'),
          backdrop: token('surface-backdrop'),
          hover: token('surface-hover'),
        },
        line: {
          DEFAULT: token('line'),
          strong: token('line-strong'),
        },
        accent: {
          DEFAULT: token('accent'),
          hover: token('accent-hover'),
          subtle: token('accent-subtle'),
          /*
           * Text and icons on a filled accent surface, where `text-white` used
           * to be. White is only correct while the accent is #1a73e8; the dark
           * accent is a pale #8ab4f8 and white on it lands near 1.9:1.
           */
          on: token('accent-on'),
        },
        /*
         * Errors and destructive actions.
         *
         * Previously Tailwind's stock `red-600`/`red-700`, which is a fixed
         * light-mode colour: on the dark surface it lands around 3.8:1, under
         * the 4.5:1 that error text of all things has to clear. Tokenised so it
         * can lighten with the background.
         *
         * `on` is the text colour for a filled danger button. It is a token
         * rather than `text-white` because in dark mode the fill is a pale red
         * and white on it is unreadable.
         */
        danger: {
          DEFAULT: token('danger'),
          strong: token('danger-strong'),
          soft: token('danger-soft'),
          wash: token('danger-wash'),
          on: token('danger-on'),
        },
        /*
         * The editor chrome is a deliberate reproduction of the Google Docs
         * top bar, so its palette is spelled out separately from the tokens
         * above: those describe the rest of the app and are free to move, while
         * these have to keep matching a fixed reference.
         *
         * In dark mode there is no such reference to match -- Docs' own dark
         * chrome is a different design, not a recolour -- so the dark values in
         * index.css are the closest equivalent in the same Google grey/blue
         * family rather than a copy of anything.
         */
        docs: {
          text: token('docs-text'),
          icon: token('docs-icon'),
          toolbar: token('docs-toolbar'),
          /** Hover inside the toolbar pill, which already sits on the toolbar. */
          hover: token('docs-hover'),
          /** Hover for controls sitting directly on the chrome. */
          'chrome-hover': token('docs-chrome-hover'),
          divider: token('docs-divider'),
          outline: token('docs-outline'),
          chip: token('docs-chip'),
          'chip-hover': token('docs-chip-hover'),
          'chip-text': token('docs-chip-text'),
          active: token('docs-active'),
          /** Toggled-on formatting buttons: a clear grey "in use" state. */
          pressed: token('docs-pressed'),
          'active-icon': token('docs-active-icon'),
          marker: token('docs-marker'),
          /** Ruler margin regions -- the part outside the writable width. */
          ruler: token('docs-ruler'),
          tick: token('docs-tick'),
          'tick-text': token('docs-tick-text'),
          avatar: token('docs-avatar'),
        },
      },
      fontFamily: {
        sans: [
          '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto',
          '"Helvetica Neue"', 'Arial', 'sans-serif',
        ],
        doc: ['Arial', 'Helvetica', 'sans-serif'],
        /* Docs chrome type. Google Sans is not public; Roboto is what Docs
           itself falls back to, and it is already loaded in index.html. */
        ui: ['"Google Sans"', 'Roboto', 'Arial', 'sans-serif'],
      },
      /*
       * Shadows are variables for the same reason the colours are, but they
       * carry the whole value rather than a colour: a dark surface needs more
       * than a recoloured shadow. Google's grey at 15% is invisible against
       * #202124, so the dark set in index.css raises the opacity as well as
       * blackening the tint. Elevation on a dark background is mostly carried
       * by the surface being lighter than its backdrop; the shadow only has to
       * stop the edge dissolving.
       */
      boxShadow: {
        sheet: 'var(--shadow-sheet)',
        pill: 'var(--shadow-pill)',
        /* Google's elevation-2, used by every Docs menu and popover. */
        menu: 'var(--shadow-menu)',
      },
      transitionDuration: {
        DEFAULT: '150ms',
      },
      maxWidth: {
        sheet: '816px',
      },
    },
  },
  plugins: [],
}
