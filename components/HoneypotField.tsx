// ============================================================
// Скрытое поле-ловушка (honeypot) для публичных форм: заказ в корзине,
// "Купити в 1 клік", VIN-запросы.
//
// Человек его не видит (спрятано за пределами экрана через CSS, не
// display:none — часть ботов такие поля пропускает), до него нельзя
// дойти клавишей Tab (tabIndex=-1), браузер не подставит туда
// автозаполнение (autoComplete=off). Бот, который заполняет все поля
// формы подряд, впишет туда что-нибудь — и сервер
// (app/api/orders/create, app/api/vin-requests) ответит "успешно", но
// ничего не сохранит.
//
// Использование: <HoneypotField /> внутри <form>, а при отправке —
// website: readHoneypot(event.currentTarget) в теле запроса
// ============================================================

export const HONEYPOT_FIELD_NAME = 'website';

export default function HoneypotField() {
  return (
    <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', top: 'auto', width: 1, height: 1, overflow: 'hidden' }}>
      <label>
        Ваш сайт
        <input type="text" name={HONEYPOT_FIELD_NAME} tabIndex={-1} autoComplete="off" defaultValue="" />
      </label>
    </div>
  );
}

// Значение ловушки из отправляемой формы ('' — человек, иначе бот)
export function readHoneypot(form: HTMLFormElement | null): string {
  const field = form?.elements.namedItem(HONEYPOT_FIELD_NAME);
  return field instanceof HTMLInputElement ? field.value : '';
}
