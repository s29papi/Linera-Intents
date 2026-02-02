/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#2f81f7',
          dark: '#2563eb'
        }
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(47, 129, 247, 0.3), 0 20px 60px rgba(0, 0, 0, 0.6)'
      }
    }
  },
  plugins: []
};
