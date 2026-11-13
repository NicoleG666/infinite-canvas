/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#0A0A0A',
        node: '#1A1D23',
        accent: '#4FC3FF',
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
}
