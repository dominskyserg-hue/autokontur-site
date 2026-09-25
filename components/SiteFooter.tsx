// ============================================================
// Підвал сайту для сторінок поза Головною (сторінка товару) — та сама
// структура, що й підвал Головної (components/StorefrontHome.tsx):
// опис магазину, навігація, сервіс і доставка, контакти. Серверний
// компонент: контакти передаються з site_settings (lib/siteSettings.ts).
// "Підбір за VIN" тут — посилання на /pidbir-za-vin (на Головній це
// кнопка, що відкриває модальне вікно)
// ============================================================

import Link from 'next/link';
import { Clock, Phone, Send } from 'lucide-react';
import { DominatorLogo } from '@/components/SiteHeader';
import { TECH_ACCENT_BRIGHT, TECH_BORDER, TECH_DISPLAY_FONT, TECH_BODY_FONT, TECH_MUTED, TECH_FAINT } from '@/lib/techTheme';

const TELEGRAM_BOT_USERNAME = 'dominatorparts_orders_bot';

interface SiteFooterProps {
  shopName: string;
  phone: string;
  workingHours: string;
}

const LINK_CLASS = 'text-[13.5px] transition-colors hover:text-[#60A5FA]';

export default function SiteFooter({ shopName, phone, workingHours }: SiteFooterProps) {
  const linkStyle = { fontFamily: TECH_BODY_FONT, color: TECH_MUTED };
  const headingStyle = { fontFamily: TECH_BODY_FONT, color: TECH_FAINT };

  return (
    <footer style={{ borderTop: `1px solid ${TECH_BORDER}`, background: 'linear-gradient(180deg, transparent, rgba(59,130,246,0.03))' }}>
      <div className="mx-auto max-w-6xl px-5 md:px-8">
        <div className="grid grid-cols-2 gap-8 py-12 sm:grid-cols-4">
          <div className="col-span-2 sm:col-span-1">
            <div className="mb-3.5 flex items-center gap-2.5">
              <DominatorLogo />
              <span style={{ fontFamily: TECH_DISPLAY_FONT, fontWeight: 700, fontSize: 15, color: '#fff', letterSpacing: '-0.01em' }}>
                {shopName.toUpperCase()}
              </span>
            </div>
            <p className="max-w-[26ch] text-[13px] leading-relaxed" style={linkStyle}>
              Команда професіоналів з підбору автозапчастин. Знаходимо потрібну деталь за артикулом або за VIN — швидко і без
              помилок сумісності.
            </p>
          </div>

          <div>
            <h4 className="mb-3.5 text-[11px] font-semibold uppercase tracking-[0.06em]" style={headingStyle}>
              Навігація
            </h4>
            <ul className="flex flex-col gap-2.5">
              <li><Link href="/about" className={LINK_CLASS} style={linkStyle}>Про нас</Link></li>
              <li><Link href="/category" className={LINK_CLASS} style={linkStyle}>Категорії</Link></li>
              <li><Link href="/marky" className={LINK_CLASS} style={linkStyle}>Марки авто</Link></li>
              <li><Link href="/contacts" className={LINK_CLASS} style={linkStyle}>Контакти</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="mb-3.5 text-[11px] font-semibold uppercase tracking-[0.06em]" style={headingStyle}>
              Сервіс та доставка
            </h4>
            <ul className="flex flex-col gap-2.5">
              <li><Link href="/delivery" className={LINK_CLASS} style={linkStyle}>Доставка Новою Поштою</Link></li>
              <li><Link href="/returns" className={LINK_CLASS} style={linkStyle}>Повернення та обмін</Link></li>
              <li><Link href="/pidbir-za-vin" className={LINK_CLASS} style={linkStyle}>Підбір за VIN</Link></li>
              <li><Link href="/terms" className={LINK_CLASS} style={linkStyle}>Публічна оферта</Link></li>
              <li><Link href="/privacy" className={LINK_CLASS} style={linkStyle}>Політика конфіденційності</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="mb-3.5 text-[11px] font-semibold uppercase tracking-[0.06em]" style={headingStyle}>
              Контакти
            </h4>
            <div className="flex flex-col gap-3">
              <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className={`flex items-center gap-2.5 ${LINK_CLASS}`} style={linkStyle}>
                <Phone className="h-[15px] w-[15px]" style={{ color: TECH_ACCENT_BRIGHT }} />
                {phone}
              </a>
              <div className="flex items-center gap-2.5 text-[13.5px]" style={linkStyle}>
                <Clock className="h-[15px] w-[15px]" style={{ color: TECH_ACCENT_BRIGHT }} />
                {workingHours}
              </div>
              <a
                href={`https://t.me/${TELEGRAM_BOT_USERNAME}`}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center gap-2.5 ${LINK_CLASS}`}
                style={linkStyle}
              >
                <Send className="h-[15px] w-[15px]" style={{ color: TECH_ACCENT_BRIGHT }} />
                Telegram
              </a>
            </div>
          </div>
        </div>

        <div
          className="flex flex-wrap items-center justify-between gap-3 py-4 text-xs"
          style={{ fontFamily: TECH_BODY_FONT, color: TECH_FAINT, borderTop: `1px solid ${TECH_BORDER}` }}
        >
          <span>
            © {new Date().getFullYear()} {shopName} — автозапчастини з доставкою по Україні
          </span>
        </div>
      </div>
    </footer>
  );
}
