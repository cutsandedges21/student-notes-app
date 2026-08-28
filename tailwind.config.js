/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#202124',
          muted: '#5f6368',
          faint: '#80868b',
        },
        surface: {
          DEFAULT: '#ffffff',
          backdrop: '#f8f9fa',
          hover: '#f1f3f4',
        },
        line: {
          DEFAULT: '#e0e0e0',
          strong: '#dadce0',
        },
        accent: {
          DEFAULT: '#1a73e8',
          hover: '#1765cc',
          subtle: '#e8f0fe',
        },
        /*
         * The editor chrome is a deliberate reproduction of the Google Docs
         * top bar, so its palette is spelled out here rather than reusing the
         * tokens above: those describe the rest of the app and are free to
         * move, while these have to keep matching a fixed reference.
         */
        docs: {
          text: '#1f1f1f',
          icon: '#444746',
          toolbar: '#edf2fa',
          /** Hover inside the toolbar pill, which already sits on #edf2fa. */
          hover: '#dde3ea',
          /** Hover for controls sitting directly on the white chrome. */
          'chrome-hover': '#e8eaed',
          divider: '#c7c7c7',
          outline: '#747775',
          chip: '#c2e7ff',
          'chip-hover': '#b0ddff',
          'chip-text': '#001d35',
          active: '#d3e3fd',
          'active-icon': '#0b57d0',
          marker: '#0b57d0',
          /** Ruler margin regions -- the part outside the writable width. */
          ruler: '#f1f3f4',
          tick: '#bdc1c6',
          'tick-text': '#5f6368',
          avatar: '#0f6b4f',
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
      boxShadow: {
        sheet: '0 1px 3px rgba(60,64,67,0.15), 0 4px 8px rgba(60,64,67,0.08)',
        pill: '0 2px 6px rgba(60,64,67,0.28)',
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
