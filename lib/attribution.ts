// ============================================================
// Сквозная атрибуция заказов: откуда пришёл покупатель (Google Ads,
// органический поиск, соцсети, реферальная ссылка, прямой заход).
//
// Как это работает:
//   1. При первой же загрузке ЛЮБОЙ страницы сайта компонент
//      components/AttributionCapture.tsx (подключён один раз в
//      app/layout.tsx, поэтому отрабатывает на каждой странице, а не
//      только на Главной) вызывает captureAttributionOnce() ниже.
//   2. captureAttributionOnce() смотрит на query-параметры текущего
//      URL (utm_source, utm_medium, utm_campaign, utm_term,
//      utm_content, gclid) и на document.referrer.
//   3. Если в localStorage уже что-то сохранено с прошлого визита —
//      функция сразу выходит: первое касание уже зафиксировано и не
//      должно перезаписываться при обычных переходах покупателя по
//      сайту (это и есть first-touch — атрибуция по ПЕРВОМУ визиту,
//      а не по последнему).
//   4. Если это первый визит браузера на сайт — сохраняет найденные
//      значения в localStorage одним объектом (даже если все поля
//      пустые — см. комментарий внутри captureAttributionOnce).
//   5. Когда покупатель доходит до оформления заказа,
//      components/StorefrontHome.tsx вызывает getStoredAttribution()
//      и передаёт всё это вместе с остальными полями формы в
//      POST /api/orders/create, а тот роут сохраняет их в новые
//      колонки таблицы orders (миграция — в конце schema.sql).
//
// gclid Google Ads подставляет в ссылку объявления САМ, автоматически
// (автотегирование "Auto-tagging" в настройках аккаунта, включено по
// умолчанию) — отдельно настраивать в самой рекламе для этого ничего
// не нужно, достаточно просто считать этот параметр из адресной строки.
// ============================================================

const STORAGE_KEY = 'dp_attribution';

// Ровно те же семь полей, что и новые колонки в таблице orders (см.
// миграцию в конце schema.sql) — так их не перепутать при передаче
// между localStorage → форма заказа → API-роут → база
export interface StoredAttribution {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  gclid: string | null;
  referrer: string | null;
}

const EMPTY_ATTRIBUTION: StoredAttribution = {
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  utmTerm: null,
  utmContent: null,
  gclid: null,
  referrer: null,
};

// Достаёт один query-параметр из URL и обрезает пробелы. Пустая
// строка (?utm_source=) считается отсутствующим значением — так же,
// как и полное отсутствие параметра, а не сохраняется как "" в базу
function readParam(params: URLSearchParams, key: string): string | null {
  const trimmed = params.get(key)?.trim();
  return trimmed ? trimmed : null;
}

// true-значение (сама ссылка), если referrer ведёт с постороннего
// домена — переход с одной страницы нашего же сайта на другую НЕ
// должен считаться "рефералом". Если referrer вообще пустой (прямой
// заход или браузер его не передал) или его не удалось разобрать как
// URL — возвращаем null, а не бросаем ошибку
function readExternalReferrer(): string | null {
  const referrer = document.referrer;
  if (!referrer) return null;

  try {
    const referrerHost = new URL(referrer).hostname;
    if (referrerHost === window.location.hostname) return null;
    return referrer;
  } catch {
    return null;
  }
}

// Записывает атрибуцию первого визита в localStorage — ОДИН раз за
// всё время, пока покупатель не очистит данные браузера. Вызывать
// нужно на КАЖДОЙ странице сайта (см. components/AttributionCapture.tsx),
// но реально что-то сохраняется только при самом первом вызове
export function captureAttributionOnce(): void {
  if (typeof window === 'undefined') return;

  try {
    // Уже что-то сохранено с прошлого визита — первое касание уже
    // зафиксировано, повторно ничего не трогаем (это и есть
    // "first-touch": важен первый визит, а не последний)
    if (window.localStorage.getItem(STORAGE_KEY)) return;

    const params = new URLSearchParams(window.location.search);

    const attribution: StoredAttribution = {
      utmSource: readParam(params, 'utm_source'),
      utmMedium: readParam(params, 'utm_medium'),
      utmCampaign: readParam(params, 'utm_campaign'),
      utmTerm: readParam(params, 'utm_term'),
      utmContent: readParam(params, 'utm_content'),
      gclid: readParam(params, 'gclid'),
      referrer: readExternalReferrer(),
    };

    // Сохраняем ДАЖЕ ЕСЛИ все поля оказались пустыми (прямой заход
    // без UTM/gclid и без внешнего referrer) — это специально: без
    // этой записи каждая следующая страница сайта заново пыталась бы
    // прочитать свой document.referrer, а на второй странице
    // referrer'ом уже будет сам же наш сайт — ложное совпадение с
    // "рефералом". Пустая запись — это тоже валидный результат
    // first-touch ("прямой заход"), а не ошибка
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(attribution));
  } catch {
    // localStorage может быть недоступен (приватный режим браузера,
    // отключённые cookies/storage) — атрибуция в этом случае просто
    // не сработает, но оформление заказа НЕ должно из-за этого
    // сломаться, поэтому ошибку молча проглатываем
  }
}

// Читает сохранённую атрибуцию первого визита — вызывается один раз,
// в момент отправки формы заказа (components/StorefrontHome.tsx).
// Если ничего не сохранено (localStorage недоступен, JSON битый, или
// captureAttributionOnce почему-то не успел отработать) — возвращает
// объект из одних null, а не бросает ошибку: заказ должен успешно
// оформиться и без атрибуции
export function getStoredAttribution(): StoredAttribution {
  if (typeof window === 'undefined') return EMPTY_ATTRIBUTION;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_ATTRIBUTION;
    return { ...EMPTY_ATTRIBUTION, ...JSON.parse(raw) };
  } catch {
    return EMPTY_ATTRIBUTION;
  }
}
