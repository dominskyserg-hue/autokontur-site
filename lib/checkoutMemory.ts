// ============================================================
// Быстрый повторный заказ: после успешного оформления запоминаем в
// браузере покупателя (localStorage, только на ЕГО устройстве) имя,
// фамилию, телефон, город и отделение Новой Почты. В следующий раз
// форма заказа в корзине (components/StorefrontHome.tsx) и окно
// "Купити в 1 клік" (components/QuickOrderModal.tsx) уже заполнены —
// покупателю остаётся нажать "Підтвердити".
//
// На сервер это не отправляется и нигде больше не хранится. Кнопка
// "Очистити" в форме удаляет сохранённые данные (например, если
// заказывали с чужого телефона).
// ============================================================

const STORAGE_KEY = 'autokontur-checkout';

export interface CheckoutMemory {
  customerName: string;
  customerSurname: string;
  customerPhone: string;
  city: string;
  novaPoshtaAddress: string;
  cityRef: string | null;
  warehouseRef: string | null;
  deliveryMethod: 'branch' | 'courier';
}

export function readCheckoutMemory(): Partial<CheckoutMemory> | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CheckoutMemory>;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

// Дописываем к уже сохранённому (из "1 клік" приходят только имя и телефон)
export function saveCheckoutMemory(data: Partial<CheckoutMemory>): void {
  try {
    const current = readCheckoutMemory() ?? {};
    // Пустые значения не затирают ранее сохранённые
    const cleaned = Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== '' && value !== undefined)
    ) as Partial<CheckoutMemory>;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...cleaned }));
  } catch {
    // localStorage недоступен — просто не запоминаем
  }
}

export function clearCheckoutMemory(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ничего страшного
  }
}
