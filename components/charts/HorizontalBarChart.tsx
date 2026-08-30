'use client';

// ============================================================
// Горизонтальный барчарт — переиспользуется для трёх разных виджетов
// на экране "Аналитика": топ запчастей, выручка по поставщикам и
// разбивка заказов по статусам (см. components/AnalyticsScreen.tsx).
//
// Каждая строка уже подписана своей категорией слева (название
// запчасти / поставщика / статуса) — поэтому отдельная легенда не
// нужна: подпись рядом с полосой и есть канал идентификации, легенда
// в этом случае просто повторяла бы то же самое текстом ещё раз.
//
// Значение всегда подписано СНАРУЖИ полосы, справа от неё — так оно
// никогда не обрезается, даже когда полоса совсем короткая
// (см. правило "текст не должен обрезаться собственной меткой").
// ============================================================

import { useState } from 'react';

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  // Если не передан — используется общий color пропс компонента
  // (сравнение однородных величин, один тон). Передаётся отдельно
  // только когда сама категория несёт смысл (например, статус заказа)
  color?: string;
}

interface HorizontalBarChartProps {
  data: BarDatum[];
  color?: string;
  formatValue: (value: number) => string;
  emptyMessage?: string;
}

export default function HorizontalBarChart({
  data,
  color = 'var(--accent)',
  formatValue,
  emptyMessage = 'Нет данных за этот период',
}: HorizontalBarChartProps) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  if (data.length === 0) {
    return (
      <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
        {emptyMessage}
      </p>
    );
  }

  const maxValue = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="flex flex-col gap-2.5">
      {data.map((item) => {
        const widthPercent = Math.max((item.value / maxValue) * 100, item.value > 0 ? 2 : 0);
        const isHovered = hoveredKey === item.key;

        return (
          <div
            key={item.key}
            className="flex items-center gap-3"
            onMouseEnter={() => setHoveredKey(item.key)}
            onMouseLeave={() => setHoveredKey(null)}
          >
            <span
              className="text-xs w-32 shrink-0 truncate"
              style={{ color: 'var(--ink-muted)' }}
              title={item.label}
            >
              {item.label}
            </span>
            <div className="flex-1 min-w-0" style={{ background: 'var(--surface-2)', borderRadius: 4 }}>
              {/* Полоса — максимум 20px толщиной (в рамках спецификации
                  "не толще 24px"), скруглён только правый конец —
                  левый край всегда квадратный, "от базовой линии" */}
              <div
                className="h-5 transition-[filter]"
                style={{
                  width: `${widthPercent}%`,
                  background: item.color || color,
                  borderRadius: '0 4px 4px 0',
                  filter: isHovered ? 'brightness(1.2)' : 'none',
                }}
              />
            </div>
            <span
              className="text-xs font-mono w-20 shrink-0 text-right"
              style={{ color: isHovered ? 'var(--ink)' : 'var(--ink-muted)' }}
            >
              {formatValue(item.value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
