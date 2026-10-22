import type { Config } from "tailwindcss";

// デザイントークンは app/globals.css の CSS 変数（--cb-*）で定義し、ここで Tailwind のクラス名にする。
// 例：bg-accent / text-fg-muted / border-line / rounded-card / shadow-card / p-card
const token = (name: string) => `rgb(var(--cb-${name}) / <alpha-value>)`;

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: token('canvas'),
        surface: token('surface'),
        line: token('line'),
        fg: { DEFAULT: token('fg'), muted: token('fg-muted') },
        accent: { DEFAULT: token('accent'), hover: token('accent-hover'), soft: token('accent-soft'), ink: token('accent-ink') },
        success: { DEFAULT: token('success'), soft: token('success-soft') },
        warning: { DEFAULT: token('warning'), soft: token('warning-soft') },
        danger: { DEFAULT: token('danger'), soft: token('danger-soft') },
        info: { DEFAULT: token('info'), soft: token('info-soft') },
      },
      borderRadius: {
        input: 'var(--cb-radius-input)',
        btn: 'var(--cb-radius-btn)',
        card: 'var(--cb-radius-card)',
        hero: 'var(--cb-radius-hero)',
      },
      boxShadow: {
        card: 'var(--cb-shadow-card)',
      },
      spacing: {
        card: 'var(--cb-space-card)',
        section: 'var(--cb-space-section)',
        'safe-b': 'env(safe-area-inset-bottom)',
      },
      fontFamily: {
        sans: ['var(--font-noto-sans-jp)', '"Hiragino Sans"', '"Hiragino Kaku Gothic ProN"', '"Yu Gothic"', 'Meiryo', 'sans-serif'],
      },
      zIndex: {
        nav: '40',
        overlay: '50',
        // 通知はどの画面（印刷プレビューなど全面表示の画面も含む）よりも上に出す。
        toast: '10050',
      },
    },
  },
  plugins: [],
};
export default config;
