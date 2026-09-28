import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eef4ff',
          100: '#dbe7ff',
          200: '#bfd4ff',
          300: '#93b6ff',
          400: '#6b95ff',
          500: '#4a76fb',
          600: '#3659ef',
          700: '#2c46d6',
          800: '#293bac',
          900: '#273887',
          950: '#1b2352',
        },
        accent: {
          300: '#d0b4ff',
          400: '#b48cff',
          500: '#9a66ff',
          600: '#8347f5',
        },
        // Cool-tinted neutrals so dark surfaces read as layered rather than flat gray
        surface: {
          50: '#f7f8fa',
          100: '#eef0f4',
          200: '#dadde5',
          300: '#b9bdc9',
          400: '#8c92a3',
          500: '#636a7c',
          600: '#434959',
          700: '#2d323f',
          800: '#1d212b',
          850: '#171a22',
          900: '#12151b',
          950: '#0a0c10',
        },
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', 'Segoe UI', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'Cascadia Code', 'Consolas', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 8px 24px -12px rgba(0,0,0,0.6)',
        lift: '0 1px 0 0 rgba(255,255,255,0.06) inset, 0 18px 40px -16px rgba(0,0,0,0.7), 0 0 0 1px rgba(107,149,255,0.18)',
        glow: '0 0 0 1px rgba(107,149,255,0.35), 0 8px 30px -8px rgba(74,118,251,0.55)',
        pop: '0 24px 60px -20px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.06)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'scale-in': { from: { opacity: '0', transform: 'scale(0.96) translateY(4px)' }, to: { opacity: '1', transform: 'scale(1) translateY(0)' } },
        shimmer: { from: { backgroundPosition: '-400px 0' }, to: { backgroundPosition: '400px 0' } },
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-8px)' } },
      },
      animation: {
        'fade-in': 'fade-in 0.18s ease-out',
        'slide-up': 'slide-up 0.28s cubic-bezier(0.2, 0.8, 0.2, 1) both',
        'scale-in': 'scale-in 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)',
        shimmer: 'shimmer 1.4s linear infinite',
        float: 'float 6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
export default config;
