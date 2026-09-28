// ============================================================
// Бейдж "Відновлена" — товар не новый: реставрированный, восстановленный
// (Reman, Rebuilding) или б/у. Признак — products.is_refurbished, его
// ставит база по названию и бренду (schema.sql, раздел "ВОССТАНОВЛЕННЫЕ И
// Б/У ДЕТАЛИ"). Цвет янтарный — чтобы не путать с зелёным "В наявності"
// и оранжевым "Під замовлення"
// ============================================================

import { TECH_BODY_FONT } from '@/lib/techTheme';

const AMBER = '#FBBF24';
const AMBER_SOFT = 'rgba(251,191,36,0.14)';

export default function RefurbishedBadge() {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{ fontFamily: TECH_BODY_FONT, background: AMBER_SOFT, color: AMBER }}
      title="Відновлена деталь: реставрована або б/у, не нова"
    >
      <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Відновлена
    </span>
  );
}
