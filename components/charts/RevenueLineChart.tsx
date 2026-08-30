'use client';

// ============================================================
// Линейный график "Выручка по дням". Один ряд данных (выручка),
// поэтому легенда не нужна — что именно показано, видно из
// заголовка над графиком (см. components/AnalyticsScreen.tsx).
//
// По наведению — вертикальная линия-прицел, которая "прилипает"
// к ближайшей точке, и подсказка с датой и суммой. Это ожидаемое
// поведение для линейного графика: читатель наводит примерно на
// дату, а не старается попасть точно в 2-пиксельную линию.
// ============================================================

import { useRef, useState } from 'react';
import type { MouseEvent } from 'react';

interface RevenueLineChartProps {
  data: Array<{ date: string; revenue: number }>;
}

const WIDTH = 720;
const HEIGHT = 220;
const PADDING = { top: 16, right: 12, bottom: 28, left: 64 };

// Округляет верхнюю границу оси Y до "красивого" числа (1, 2, 5, 10
// умноженное на степень десяти) — так подписи по оси выглядят как
// 0 / 1 000 / 2 000, а не 0 / 743 / 1486
function niceCeiling(value: number): number {
  if (value <= 0) return 100;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const residual = value / magnitude;
  let niceResidual: number;
  if (residual <= 1) niceResidual = 1;
  else if (residual <= 2) niceResidual = 2;
  else if (residual <= 5) niceResidual = 5;
  else niceResidual = 10;
  return niceResidual * magnitude;
}

function formatMoneyShort(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace('.0', '')}K`;
  return value.toLocaleString('ru-RU');
}

function formatDateShort(iso: string): string {
  const date = new Date(iso + 'T00:00:00');
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

export default function RevenueLineChart({ data }: RevenueLineChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const innerWidth = WIDTH - PADDING.left - PADDING.right;
  const innerHeight = HEIGHT - PADDING.top - PADDING.bottom;

  const maxRevenue = Math.max(...data.map((d) => d.revenue), 0);
  const axisMax = niceCeiling(maxRevenue);

  const xForIndex = (i: number) =>
    PADDING.left + (data.length <= 1 ? innerWidth / 2 : (i / (data.length - 1)) * innerWidth);
  const yForValue = (v: number) => PADDING.top + innerHeight - (v / axisMax) * innerHeight;

  const linePath = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${xForIndex(i).toFixed(1)} ${yForValue(d.revenue).toFixed(1)}`)
    .join(' ');
  const baselineY = PADDING.top + innerHeight;
  const areaPath =
    data.length > 0
      ? `${linePath} L ${xForIndex(data.length - 1).toFixed(1)} ${baselineY} L ${xForIndex(0).toFixed(1)} ${baselineY} Z`
      : '';

  const handleMouseMove = (event: MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || data.length === 0) return;
    const pointerX = ((event.clientX - rect.left) / rect.width) * WIDTH;

    // Ищем ближайшую точку данных к позиции курсора — "прилипание"
    // прицела, о котором сказано в шапке файла
    let nearestIndex = 0;
    let nearestDistance = Infinity;
    data.forEach((_, i) => {
      const distance = Math.abs(xForIndex(i) - pointerX);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = i;
      }
    });
    setHoverIndex(nearestIndex);
  };

  // Подписи по оси X — только начало, середина и конец периода,
  // иначе при 90 днях подписи наложились бы друг на друга
  const xLabelIndexes =
    data.length <= 1
      ? [0]
      : Array.from(new Set([0, Math.floor((data.length - 1) / 2), data.length - 1]));

  const yTickValues = [0, axisMax * 0.5, axisMax];
  const hovered = hoverIndex !== null ? data[hoverIndex] : null;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-auto"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        {/* ---- горизонтальные линии сетки (тонкие, рецессивные) ---- */}
        {yTickValues.map((value) => (
          <line
            key={value}
            x1={PADDING.left}
            x2={WIDTH - PADDING.right}
            y1={yForValue(value)}
            y2={yForValue(value)}
            stroke="var(--line)"
            strokeWidth={1}
          />
        ))}

        {/* ---- подписи оси Y ---- */}
        {yTickValues.map((value) => (
          <text
            key={value}
            x={PADDING.left - 10}
            y={yForValue(value) + 4}
            textAnchor="end"
            fontSize={11}
            fill="var(--ink-faint)"
          >
            {formatMoneyShort(value)}
          </text>
        ))}

        {/* ---- подписи оси X ---- */}
        {xLabelIndexes.map((i) => (
          <text
            key={i}
            x={xForIndex(i)}
            y={HEIGHT - 8}
            textAnchor="middle"
            fontSize={11}
            fill="var(--ink-faint)"
          >
            {formatDateShort(data[i].date)}
          </text>
        ))}

        {/* ---- заливка под линией — 10% "дымка", не сплошной блок ---- */}
        {areaPath && <path d={areaPath} fill="var(--accent)" opacity={0.1} />}

        {/* ---- сама линия — 2px, скруглённые концы/стыки ---- */}
        {linePath && (
          <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        )}

        {/* ---- прицел + точка при наведении ---- */}
        {hovered && (
          <>
            <line
              x1={xForIndex(hoverIndex as number)}
              x2={xForIndex(hoverIndex as number)}
              y1={PADDING.top}
              y2={baselineY}
              stroke="var(--ink-faint)"
              strokeWidth={1}
            />
            {/* Кольцо в цвете поверхности вокруг точки — чтобы маркер
                оставался читаемым, даже пересекая саму линию графика */}
            <circle cx={xForIndex(hoverIndex as number)} cy={yForValue(hovered.revenue)} r={6} fill="var(--surface)" />
            <circle cx={xForIndex(hoverIndex as number)} cy={yForValue(hovered.revenue)} r={4} fill="var(--accent)" />
          </>
        )}
      </svg>

      {/* ---- подсказка ---- */}
      {hovered && hoverIndex !== null && (
        <div
          className="absolute top-2 pointer-events-none px-2.5 py-1.5 rounded-md text-xs whitespace-nowrap"
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--line)',
            left: `${(xForIndex(hoverIndex) / WIDTH) * 100}%`,
            transform:
              hoverIndex < data.length / 2 ? 'translateX(8px)' : 'translateX(calc(-100% - 8px))',
          }}
        >
          <div style={{ color: 'var(--ink-muted)' }}>{formatDateShort(hovered.date)}</div>
          {/* Значение — акцентная, крупная часть подсказки; название
              серии второстепенно (здесь его нет — ряд один) */}
          <div className="font-mono font-semibold">{formatMoneyShort(hovered.revenue)}</div>
        </div>
      )}
    </div>
  );
}
