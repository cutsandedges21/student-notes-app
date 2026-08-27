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
      },
      fontFamily: {
        sans: [
          '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto',
          '"Helvetica Neue"', 'Arial', 'sans-serif',
        ],
        doc: ['Georgia', 'Cambria', '"Times New Roman"', 'serif'],
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
