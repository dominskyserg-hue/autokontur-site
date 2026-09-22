// ============================================================
// Общие для экрана "Заказы" константы и форматтеры — статусы заказа,
// статусы отдельной позиции заказа, форматирование денег/даты.
// Используется и списком заказов (components/OrdersScreen.tsx), и
// модальным окном карточки заказа (components/OrderDetailsModal.tsx) —
// раньше всё это жило в одном файле вместе с самой модалкой, вынесено
// сюда при разделении, чтобы у обоих компонентов был один источник
// правды, а не два рассинхронизирующихся копии
// ============================================================

// Было 5 статусов, стало 7 (секция 28 schema.sql, финансово-складской
// модуль) — детальнее отражают цепочку "нужно заказать у поставщика →
// пришло на склад → готово к выдаче"
export type OrderStatus =
  | 'new'
  | 'processing'
  | 'ordered_from_supplier'
  | 'in_stock'
  | 'ready_for_pickup'
  | 'shipped'
  | 'cancelled';

export const STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'Новое',
  processing: 'В обработке',
  ordered_from_supplier: 'Заказано у поставщика',
  in_stock: 'На складе',
  ready_for_pickup: 'Готов к выдаче',
  shipped: 'Отгружен',
  cancelled: 'Отменён',
};

// Цвета бейджа статуса — фон/текст. Заданы напрямую (не через общие
// CSS-переменные темы), потому что это цвета конкретно ДЛЯ статусов,
// а не часть общей палитры оформления
export const STATUS_COLORS: Record<OrderStatus, { bg: string; fg: string }> = {
  new: { bg: '#1B2142', fg: '#8FA8FF' },
  processing: { bg: '#3A2A16', fg: '#F2A65A' },
  ordered_from_supplier: { bg: '#2B1F4A', fg: '#B79CFF' },
  in_stock: { bg: '#173A3A', fg: '#4FD1D1' },
  ready_for_pickup: { bg: '#12301F', fg: '#3FBE8B' },
  shipped: { bg: '#0F2E1A', fg: '#34D399' },
  cancelled: { bg: '#3A1E22', fg: '#F2635F' },
};

// Порядок статусов в выпадающем списке — не алфавитный, а
// "естественный" порядок жизни заказа, от нового до готового/отменённого
export const STATUS_OPTIONS: OrderStatus[] = [
  'new',
  'processing',
  'ordered_from_supplier',
  'in_stock',
  'ready_for_pickup',
  'shipped',
  'cancelled',
];

// Статус ОТДЕЛЬНОЙ позиции в закупочном цикле (секция 28 schema.sql) —
// независим от статуса самого заказа
export type OrderItemStatus = 'pending' | 'ordered_from_supplier' | 'in_stock' | 'shipped' | 'cancelled' | 'returned';

export const ITEM_STATUS_LABELS: Record<OrderItemStatus, string> = {
  pending: 'Ожидает закупки',
  ordered_from_supplier: 'Заказано у поставщика',
  in_stock: 'На складе',
  shipped: 'Отгружено',
  cancelled: 'Отменено',
  returned: 'Возвращено',
};

export const ITEM_STATUS_COLORS: Record<OrderItemStatus, { bg: string; fg: string }> = {
  pending: { bg: '#3A2A16', fg: '#F2A65A' },
  ordered_from_supplier: { bg: '#2B1F4A', fg: '#B79CFF' },
  in_stock: { bg: '#173A3A', fg: '#4FD1D1' },
  shipped: { bg: '#0F2E1A', fg: '#34D399' },
  cancelled: { bg: '#3A1E22', fg: '#F2635F' },
  returned: { bg: '#3A1E22', fg: '#F2635F' },
};

// Копейки не показываем — только целые гривны, округлённые ВВЕРХ
export function formatMoney(value: number): string {
  return Math.ceil(value).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Короткая, читаемая часть UUID для отображения — полный id всё равно
// виден в панели деталей и в самом запросе к API
export function shortId(id: string): string {
  return `#${id.slice(0, 8)}`;
}
