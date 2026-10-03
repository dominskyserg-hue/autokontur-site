// ============================================================
// "Моє авто" покупателя — марка и модель, сохранённые в браузере
// (localStorage). Личный кабинет с гаражом сейчас выключен, поэтому
// авто запоминаем прямо на устройстве, без входа.
//
// Где используется:
//   - components/FitCheck.tsx — на странице товара "Підходить до
//     вашого Hyundai Accent ✓" / "перевірте сумісність";
//   - components/SearchNotFoundRequest.tsx — авто сразу подставляется
//     в заявку "Не знайшли деталь?";
//   - components/CategoryGridSection.tsx — подбор по авто в категории
//     тоже сохраняет выбранное авто сюда.
//
// После каждого изменения шлём событие MY_CAR_UPDATED_EVENT, чтобы все
// блоки на странице сразу обновились. Только для браузера.
// ============================================================

export const MY_CAR_STORAGE_KEY = 'autokontur-my-car';
export const MY_CAR_UPDATED_EVENT = 'autokontur:my-car-updated';

export interface MyCar {
  make: string;
  model: string;
}

export function readMyCar(): MyCar | null {
  try {
    const raw = window.localStorage.getItem(MY_CAR_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MyCar>;
    if (!parsed.make || typeof parsed.make !== 'string') return null;
    return { make: parsed.make, model: typeof parsed.model === 'string' ? parsed.model : '' };
  } catch {
    // Повреждённые данные или localStorage недоступен — авто не выбрано
    return null;
  }
}

// null — забыть авто
export function saveMyCar(car: MyCar | null): void {
  try {
    if (car && car.make.trim()) {
      window.localStorage.setItem(
        MY_CAR_STORAGE_KEY,
        JSON.stringify({ make: car.make.trim(), model: car.model.trim() })
      );
    } else {
      window.localStorage.removeItem(MY_CAR_STORAGE_KEY);
    }
    window.dispatchEvent(new Event(MY_CAR_UPDATED_EVENT));
  } catch {
    // localStorage недоступен (приватный режим) — просто не запоминаем
  }
}

export function myCarLabel(car: MyCar): string {
  return [car.make, car.model].filter(Boolean).join(' ');
}

// Сравнение названий без регистра, пробелов, дефисов и знаков:
// "Mercedes-Benz" = "MERCEDES BENZ", "Accent (MC)" -> "accentmc"
function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9а-яёіїєґ]/g, '');
}

// Похожие написания марок у поставщиков и в каталоге
const MAKE_ALIASES: Record<string, string> = {
  vw: 'volkswagen',
  mercedes: 'mercedesbenz',
  mb: 'mercedesbenz',
  chevy: 'chevrolet',
};

function normalizeMake(value: string): string {
  const key = normalize(value);
  return MAKE_ALIASES[key] ?? key;
}

// Подходит ли запись совместимости (марка + модель/поколение) под
// "моё авто". Модель сравниваем по началу слова: "Accent" подходит к
// "Accent (MC)" и "Accent RB"; если в совместимости модель не указана —
// совпадение по одной марке считаем "частичным" (см. FitCheck)
export function carMatches(
  car: MyCar,
  compat: { make: string; makeRaw?: string; model: string }
): 'full' | 'make' | 'none' {
  const carMake = normalizeMake(car.make);
  const makeOk = [compat.make, compat.makeRaw || ''].some((value) => value && normalizeMake(value) === carMake);
  if (!makeOk) return 'none';

  const carModel = normalize(car.model);
  const compatModel = normalize(compat.model);
  if (!carModel || !compatModel) return 'make';
  return compatModel.startsWith(carModel) || carModel.startsWith(compatModel) ? 'full' : 'none';
}
