// ============================================================
// Откуда пришёл клиент — человеческое название источника заказа по
// тем меткам, которые сайт сохраняет при оформлении (lib/attribution.ts,
// колонки orders.utm_*, gclid, referrer в schema.sql).
//
// Используется окном заказа (плашка "Звідки клієнт"): так видно, какие
// заказы принесла реклама Google Ads (в том числе кампания DSA), а
// какие — обычный поиск Google или прямой заход.
//
// Порядок проверок важен: gclid надёжнее всего говорит о клике по
// рекламе Google Ads, потом UTM-метки (их ставим сами в ссылках), и
// только потом referrer (сайт, с которого перешли).
// ============================================================

export interface OrderSourceInput {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  gclid: string | null;
  referrer: string | null;
}

export type OrderSourceKind = 'ads' | 'search' | 'social' | 'messenger' | 'other' | 'direct';

export interface OrderSource {
  label: string; // коротко: "Google Ads"
  detail: string | null; // подробности: кампания, ключевое слово, сайт
  kind: OrderSourceKind; // для цвета плашки
}

// Хост из адреса referrer без "www." — "https://www.google.com/..." -> "google.com"
function referrerHost(referrer: string): string | null {
  try {
    return new URL(referrer).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function joinDetail(parts: Array<string | null | undefined>): string | null {
  const filled = parts.filter((part): part is string => Boolean(part && part.trim()));
  return filled.length > 0 ? filled.join(' · ') : null;
}

export function describeOrderSource(input: OrderSourceInput): OrderSource {
  const source = (input.utmSource || '').toLowerCase();
  const medium = (input.utmMedium || '').toLowerCase();
  const campaignDetail = joinDetail([
    input.utmCampaign ? `кампанія: ${input.utmCampaign}` : null,
    input.utmTerm ? `запит: ${input.utmTerm}` : null,
  ]);

  // ---- 1. Клик по рекламе Google Ads (gclid ставит сам Google) ----
  if (input.gclid) {
    return { label: 'Google Ads', detail: campaignDetail, kind: 'ads' };
  }

  // ---- 2. UTM-метки ----
  if (source) {
    const isPaid = ['cpc', 'ppc', 'paid', 'paidsocial', 'paid_social', 'ads', 'display'].includes(medium);
    if (source.includes('google')) {
      return isPaid
        ? { label: 'Google Ads', detail: campaignDetail, kind: 'ads' }
        : { label: 'Google', detail: joinDetail([medium || null, campaignDetail]), kind: 'search' };
    }
    if (['facebook', 'fb', 'instagram', 'ig', 'meta'].some((s) => source.includes(s))) {
      return {
        label: isPaid ? 'Реклама Facebook/Instagram' : 'Facebook/Instagram',
        detail: campaignDetail,
        kind: isPaid ? 'ads' : 'social',
      };
    }
    if (source.includes('telegram') || source === 'tg') {
      return { label: 'Telegram', detail: campaignDetail, kind: 'messenger' };
    }
    if (source.includes('viber')) {
      return { label: 'Viber', detail: campaignDetail, kind: 'messenger' };
    }
    return {
      label: `Мітка: ${input.utmSource}`,
      detail: joinDetail([medium || null, campaignDetail]),
      kind: isPaid ? 'ads' : 'other',
    };
  }

  // ---- 3. Сайт, с которого перешли (referrer) ----
  if (input.referrer) {
    const host = referrerHost(input.referrer);
    if (host) {
      if (/(^|\.)google\./.test(host)) return { label: 'Google пошук', detail: 'безкоштовна видача', kind: 'search' };
      if (/(^|\.)bing\.com$/.test(host)) return { label: 'Bing пошук', detail: null, kind: 'search' };
      if (/(facebook|instagram|fb)\./.test(host) || host === 'l.facebook.com') {
        return { label: 'Facebook/Instagram', detail: host, kind: 'social' };
      }
      if (/(telegram|t)\.me$|telegram\.org$/.test(host)) return { label: 'Telegram', detail: host, kind: 'messenger' };
      return { label: `Сайт: ${host}`, detail: null, kind: 'other' };
    }
  }

  // ---- 4. Ничего нет — прямой заход (закладка, набрали адрес) или
  // заказ оформил менеджер из админки ----
  return { label: 'Прямий захід / менеджер', detail: null, kind: 'direct' };
}
