// ============================================================
// Честный срок доставки на витрине — когда мы ОТПРАВИМ деталь и когда
// покупатель её ПОЛУЧИТ (примерно), вместо прежнего "Відправка сьогодні"
// у любого товара, который просто есть в прайсе поставщика.
//
// Откуда берём дни:
//   - деталь на НАШЕМ складе (lib/ownStock.ts) — отправляем сегодня,
//     если заказ сделан до SAME_DAY_CUTOFF_HOUR по Киеву, иначе на
//     следующий рабочий день;
//   - деталь у поставщика — срок отгрузки поставщика (suppliers.delivery_time,
//     свободный текст вида "1-2 дні", "сьогодні", "3 дні") + SUPPLIER_TO_US_DAYS
//     на то, чтобы деталь доехала до нас и мы её отправили. Если срок у
//     поставщика не заполнен — берём DEFAULT_SUPPLIER_DAYS;
//   - "під замовлення" (остатка у поставщика нет) — так же по сроку
//     поставщика; если его нет — точной даты не обещаем ("уточнить менеджер").
//   - сама Нова Пошта — NOVA_POSHTA_DAYS (обычно 1–2 дня).
//
// Воскресенье не считаем днём отправки (в этот день мы не отправляем).
// Файл без серверных зависимостей — работает и на сервере, и в браузере.
// ============================================================

// До скольки часов (по Киеву) успеваем отправить в тот же день
const SAME_DAY_CUTOFF_HOUR = 15;

// Дни, пока деталь от поставщика доедет до нас и уйдёт клиенту
const SUPPLIER_TO_US_DAYS = 1;

// Срок отгрузки поставщика, если в карточке поставщика он не указан
const DEFAULT_SUPPLIER_DAYS: [number, number] = [1, 2];

// Сколько едет Нова Пошта (минимум, максимум)
const NOVA_POSHTA_DAYS: [number, number] = [1, 2];

const WEEKDAYS = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

export interface DeliveryEstimate {
  // Короткий текст про отправку: "сьогодні", "завтра", "пт, 3.10"
  dispatchText: string;
  // Когда получит покупатель: "пт, 3.10" или "пт, 3.10 – сб, 4.10";
  // null — дату не обещаем (под заказ без срока у поставщика)
  arrivalText: string | null;
  // Отправка именно сегодня — для зелёной подсветки
  dispatchToday: boolean;
}

// Разбирает свободный текст срока поставщика в [мин, макс] дней.
// null — понять не удалось
export function parseSupplierDays(text: string | null | undefined): [number, number] | null {
  if (!text || !text.trim()) return null;
  const value = text.toLowerCase();
  if (/сьогодн|сегодн|today/.test(value)) return [0, 0];
  if (/завтра|tomorrow/.test(value)) return [1, 1];

  const numbers = (value.match(/\d+/g) || []).map(Number).filter((n) => Number.isFinite(n));
  if (numbers.length === 0) return null;
  // Часы ("24 год", "48 часов") — переводим в дни
  const inHours = /год|час|hour/.test(value);
  const inWeeks = /тиж|нед|week/.test(value);
  const toDays = (n: number) => (inHours ? Math.ceil(n / 24) : inWeeks ? n * 7 : n);
  const min = toDays(Math.min(...numbers));
  const max = toDays(Math.max(...numbers));
  if (max > 60) return null;
  return [min, max];
}

// Текущая дата и час по Киеву (а не по часовому поясу сервера/браузера)
function kyivNow(now: Date): { date: Date; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  // Дата "в полдень по UTC" — чтобы прибавление дней не сбивалось на переходе часов
  return { date: new Date(Date.UTC(get('year'), get('month') - 1, get('day'), 12)), hour: get('hour') % 24 };
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

// Воскресенье — не отправляем, переносим на понедельник
function skipSunday(date: Date): Date {
  return date.getUTCDay() === 0 ? addDays(date, 1) : date;
}

function formatDay(date: Date): string {
  return `${WEEKDAYS[date.getUTCDay()]}, ${date.getUTCDate()}.${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Главная функция: срок для товара.
//   stock        — остаток у поставщика (products.stock)
//   ownStock     — деталь лежит на нашем складе
//   deliveryTime — срок отгрузки поставщика (suppliers.delivery_time)
export function estimateDelivery(
  input: { stock: number; ownStock?: boolean; deliveryTime?: string | null },
  now: Date = new Date()
): DeliveryEstimate {
  const { date: today, hour } = kyivNow(now);
  const afterCutoff = hour >= SAME_DAY_CUTOFF_HOUR;

  // Через сколько дней (мин/макс) уйдёт со склада
  let dispatchRange: [number, number] | null;
  if (input.ownStock) {
    dispatchRange = afterCutoff ? [1, 1] : [0, 0];
  } else {
    const supplierDays = parseSupplierDays(input.deliveryTime) ?? (input.stock > 0 ? DEFAULT_SUPPLIER_DAYS : null);
    dispatchRange = supplierDays
      ? [supplierDays[0] + SUPPLIER_TO_US_DAYS, supplierDays[1] + SUPPLIER_TO_US_DAYS]
      : null;
  }

  if (!dispatchRange) {
    return { dispatchText: 'термін уточнить менеджер', arrivalText: null, dispatchToday: false };
  }

  const dispatchFrom = skipSunday(addDays(today, dispatchRange[0]));
  const dispatchTo = skipSunday(addDays(today, dispatchRange[1]));
  const dispatchToday = dispatchFrom.getTime() === today.getTime();
  const isTomorrow = dispatchFrom.getTime() === addDays(today, 1).getTime();

  const dispatchText = dispatchToday
    ? 'сьогодні'
    : isTomorrow && dispatchFrom.getTime() === dispatchTo.getTime()
      ? 'завтра'
      : dispatchFrom.getTime() === dispatchTo.getTime()
        ? formatDay(dispatchFrom)
        : `${formatDay(dispatchFrom)} – ${formatDay(dispatchTo)}`;

  const arrivalFrom = addDays(dispatchFrom, NOVA_POSHTA_DAYS[0]);
  const arrivalTo = addDays(dispatchTo, NOVA_POSHTA_DAYS[1]);
  const arrivalText =
    arrivalFrom.getTime() === arrivalTo.getTime() ? formatDay(arrivalFrom) : `${formatDay(arrivalFrom)} – ${formatDay(arrivalTo)}`;

  return { dispatchText, arrivalText, dispatchToday };
}
