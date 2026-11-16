/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        rag: { green: '#0ca30c', amber: '#fab219', serious: '#ec835a', red: '#d03b3b' },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', '-apple-system', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Consolas', 'Liberation Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};
