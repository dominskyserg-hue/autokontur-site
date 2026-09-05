import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      // CSS-змінні прив'язані до next/font у app/layout.tsx — не
      // хардкодимо назву шрифта напряму, інакше next/font не зможе
      // підмінити фолбек. Existing "Bebas Neue"/"Rajdhani"/"Barlow"
      // (вітрина) та системні шрифти адмінки лишаються як є — це
      // ДОДАТКОВА пара шрифтів для нового "Tech Premium" розділу
      // (наразі — шапка + hero на Головній), а не заміна старої
      fontFamily: {
        display: ['var(--font-space-grotesk)', 'Space Grotesk', 'sans-serif'],
        techSans: ['var(--font-inter-tech)', 'Inter', 'sans-serif'],
      },
      colors: {
        bg: '#0B0F17',
        surface: '#141B29',
        surface2: '#1B2436',
        accent: {
          DEFAULT: '#3B82F6',
          bright: '#60A5FA',
          dim: '#1D4ED8',
        },
        heat: '#FF6B00',
        ink: '#F1F5F9',
        muted: '#94A3B8',
        faint: '#54607A',
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(59,130,246,0.4), 0 0 24px 2px rgba(59,130,246,0.35)',
        'glow-lg': '0 0 0 1px rgba(59,130,246,0.5), 0 0 60px 8px rgba(59,130,246,0.28)',
        'glow-heat': '0 0 24px 2px rgba(255,107,0,0.35)',
      },
    },
  },
  plugins: [
    // strategy: 'class' — свідомо НЕ 'base' (значення за замовчуванням).
    // 'base' скинув би стилі АБСОЛЮТНО ВСІХ <input>/<select> на сайті
    // одразу (адмінка, форма оформлення замовлення, форми постачальників),
    // а не лише нових полів у Hero. З 'class' плагін застосовується
    // тільки там, де явно додано класи form-input/form-select
    require('@tailwindcss/forms')({ strategy: 'class' }),
  ],
};

export default config;
