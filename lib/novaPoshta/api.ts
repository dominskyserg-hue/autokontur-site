// ============================================================
// Низкоуровневый вызов официального API Новой Почты — общий для
// всех методов (Address, Counterparty, InternetDocument). Раньше
// каждый роут (app/api/nova-poshta/cities|warehouses/route.ts) писал
// один и тот же fetch() самостоятельно; здесь он вынесен в одно
// место, потому что новых вызовов (Counterparty, InternetDocument)
// стало значительно больше — дублировать этот блок в каждом файле
// уже не оправдано.
// ============================================================

const NOVA_POSHTA_API_URL = 'https://api.novaposhta.ua/v2.0/json/';

interface NovaPoshtaApiResponse<T> {
  success: boolean;
  data: T[];
  errors: string[];
  warnings: string[];
}

export class NovaPoshtaApiError extends Error {}

// Бросает NovaPoshtaApiError с понятным текстом, если API-ключ не
// настроен, сеть недоступна или сама Нова Пошта вернула success: false
export async function callNovaPoshtaApi<T>(
  modelName: string,
  calledMethod: string,
  methodProperties: Record<string, unknown> = {}
): Promise<T[]> {
  const apiKey = process.env.NOVA_POSHTA_API_KEY;
  if (!apiKey) {
    throw new NovaPoshtaApiError('Інтеграція з Новою Поштою не налаштована (немає NOVA_POSHTA_API_KEY).');
  }

  const response = await fetch(NOVA_POSHTA_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey, modelName, calledMethod, methodProperties }),
  });

  if (!response.ok) {
    throw new NovaPoshtaApiError(`Нова Пошта повернула статус ${response.status}`);
  }

  const data = (await response.json()) as NovaPoshtaApiResponse<T>;

  if (!data.success) {
    throw new NovaPoshtaApiError(data.errors?.join('; ') || 'Нова Пошта повернула помилку без опису.');
  }

  return data.data;
}

// Украинский номер телефона в формат, который принимает Нова Пошта —
// 380XXXXXXXXX, без "+" и без ведущего нуля. Тот же вход, что и в
// разных местах сайта уже пишут вручную ("0501234567", "+380501234567",
// "380501234567") — нормализуем один раз здесь
export function toNovaPoshtaPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('380')) return digits;
  if (digits.length === 10 && digits.startsWith('0')) return `38${digits}`;
  if (digits.length === 9) return `380${digits}`;
  return digits;
}
