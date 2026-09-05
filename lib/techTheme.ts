// ============================================================
// Спільні кольори/шрифти "Tech Premium" — для серверних сторінок
// вітрини, які досі не переносили на свою власну копію токенів
// (категорії, марки авто, розділи, статичні сторінки типу "Про нас").
//
// Головна (components/StorefrontHome.tsx) і картка товару
// (components/ProductDetailContent.tsx) мають ТІ Ж САМІ значення, але
// й далі тримають власні локальні константи — вони вже існували до
// цього файлу, і чіпати робочий код заради самого лише імпорту сенсу
// нема. А от сторінки нижче (category/marky/rozdil/InfoPage) раніше
// дублювали один і той же набір кольорів у КОЖНОМУ файлі окремо —
// тут це винесено один раз, щоб не розходились під час майбутніх правок
// ============================================================

export const TECH_BG = '#0B0F17';
export const TECH_SURFACE = 'rgba(20,27,41,0.6)';
export const TECH_SURFACE_2 = '#1B2436';
export const TECH_BORDER = 'rgba(255,255,255,0.08)';
export const TECH_BORDER_2 = 'rgba(255,255,255,0.14)';

export const TECH_ACCENT = '#3B82F6';
export const TECH_ACCENT_BRIGHT = '#60A5FA';
export const TECH_ACCENT_DIM = '#1D4ED8';

export const TECH_INK = '#F1F5F9';
export const TECH_MUTED = '#94A3B8';
export const TECH_FAINT = '#54607A';

export const TECH_GOOD = '#34D399';
export const TECH_GOOD_SOFT = 'rgba(52,211,153,0.14)';
export const TECH_HEAT = '#FF6B00';
export const TECH_HEAT_SOFT = 'rgba(255,107,0,0.14)';

export const TECH_GLOW = '0 0 0 1px rgba(59,130,246,0.4), 0 0 24px 2px rgba(59,130,246,0.35)';
export const TECH_GLOW_LG = '0 0 0 1px rgba(59,130,246,0.5), 0 0 44px 6px rgba(59,130,246,0.28)';

export const TECH_DISPLAY_FONT = 'var(--font-space-grotesk), "Space Grotesk", sans-serif';
export const TECH_BODY_FONT = 'var(--font-inter-tech), Inter, sans-serif';
export const TECH_MONO_FONT = 'var(--font-jetbrains-mono), "JetBrains Mono", ui-monospace, monospace';
