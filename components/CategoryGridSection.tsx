'use client';

// ============================================================
// "Каталог за системами авто" (Розділи) — велика преміальна сітка
// карток замість попередньої дрібної іконної сітки. Дані ті самі, що
// і раніше (lib/departments.ts, DEPARTMENTS) — змінилась лише подача:
//
//   1. Картки крупніші, з градієнтним "скляним" фоном і неоновим
//      світінням рамки при наведенні (та ж мова дизайну, що і в
//      картці товару/модалках — TECH_GLOW з lib/techTheme.ts,
//      продубльований тут через Tailwind-утиліту shadow-glow з
//      tailwind.config.ts).
//   2. Клік по картці більше НЕ веде одразу на сторінку — спочатку
//      відкривається VehicleFilterModal з пропозицією уточнити
//      марку/модель/рік/двигун, і лише після цього (або після
//      "Пропустити") покупач потрапляє в каталог.
//
// Куди саме веде клік — resolveDestination() нижче:
//   - розділ БЕЗ жодної категорії товару (напр. "Паливна система") ->
//     "/?vin=1" (Головна сама відкриє заявку "Підбір за VIN", див.
//     ефект у components/StorefrontHome.tsx) — та сама логіка, що і в
//     старій сітці розділів, лише тепер через модалку, а не миттєво.
//   - розділ РІВНО з однією категорією -> одразу на неї,
//     "/category/[slug]", і якщо покупач обрав марку — додає ?marka=
//     (це вже вміє читати app/category/[slug]/page.tsx).
//   - розділ з КІЛЬКОМА категоріями -> на хаб розділу "/rozdil/[slug]"
//     (app/rozdil/[slug]/page.tsx), де покупець сам обирає потрібну
//     вузьку категорію зі списку — єдиної сторінки "всі товари
//     розділу одразу" в каталозі поки що немає, тому модель/рік/двигун
//     у цьому випадку на результат ще не впливають (лише марка, і то
//     тільки якщо в розділі одна категорія)
// ============================================================

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { DEPARTMENTS, type DepartmentDef } from '@/lib/departments';
import { getCategoryBySlug } from '@/lib/categories';
import { CAR_MAKES } from '@/lib/carMakes';
import { TECH_DISPLAY_FONT, TECH_BODY_FONT, TECH_FAINT } from '@/lib/techTheme';
import VehicleFilterModal, { type VehicleSelection } from './VehicleFilterModal';

// ------------------------------------------------------------
// ІКОНКИ РОЗДІЛІВ
// ------------------------------------------------------------
// Навмисно СВОЇ inline-SVG-компоненти, а не lucide-react: у
// цьому середовищі (пісочниця з жорстким лімітом пам'яті на процес)
// компіляція "/" падала з "JavaScript heap out of memory" саме через
// велику кількість РІЗНИХ іменованих імпортів з lucide-react одразу в
// кількох файлах (перевірено дослідно — один-єдиний lucide-компонент
// компілювався нормально, 18 різних — ні). StorefrontHome.tsx і так
// вже містив рівно такий самий набір з 17 намальованих іконок розділів
// до цього рефакторингу — тут вони просто перенесені без змін
function EngineIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="9" width="14" height="9" rx="1" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M7 9V6h6v3" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="19" cy="13.5" r="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M17 13.5h-3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6 18v2M12 18v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function TransmissionIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
      <rect x="5" y="16" width="14" height="4" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8.5 16c0-2.2 1.6-4 3.5-4s3.5 1.8 3.5 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="12" y1="12.3" x2="12" y2="3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="2.8" r="1.9" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function SteeringWheelIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="2.3" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 5.5v4.2M6.5 15.8l3.5-2.3M17.5 15.8l-3.5-2.3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CarBodyIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
      <path
        d="M3.5 16 4 12.5c.3-1 1-1.8 2-2.2l2.3-.9 1.6-2.4c.4-.6 1-1 1.7-1h3.4c.7 0 1.3.4 1.7 1l1.6 2.4 2.3.9c1 .4 1.7 1.2 2 2.2l.5 3.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line x1="2" y1="16" x2="22" y2="16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="7" cy="16" r="1.8" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="17" cy="16" r="1.8" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function ServiceWrenchIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
      <path
        d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PistonIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="6.5" r="4" stroke="currentColor" strokeWidth="1.7" />
      <line x1="12" y1="10.5" x2="12" y2="14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <rect x="9.5" y="14" width="5" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function FuelCanIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
      <rect x="5" y="7" width="14" height="12" rx="1.6" stroke="currentColor" strokeWidth="1.7" />
      <rect x="9.5" y="4" width="5" height="3" rx="1" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="15.5" cy="11.2" r="1.2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function ExhaustIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
      <path d="M2.5 12h5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="8" y="9" width="8" height="6" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16 12h3.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <ellipse cx="21" cy="12" rx="1.3" ry="2.2" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function CoolingFanIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M12 12 12 5.5M12 12 17.3 8.8M12 12 17.3 15.2M12 12 12 18.5M12 12 6.7 15.2M12 12 6.7 8.8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function VentIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="7.5" width="18" height="9" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7.5 7.5v9M12 7.5v9M16.5 7.5v9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ShockAbsorberIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
      <line x1="12" y1="2" x2="12" y2="5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <ellipse cx="12" cy="7" rx="4" ry="1.3" stroke="currentColor" strokeWidth="1.5" />
      <ellipse cx="12" cy="10" rx="4" ry="1.3" stroke="currentColor" strokeWidth="1.5" />
      <ellipse cx="12" cy="13" rx="4" ry="1.3" stroke="currentColor" strokeWidth="1.5" />
      <ellipse cx="12" cy="16" rx="4" ry="1.3" stroke="currentColor" strokeWidth="1.5" />
      <line x1="12" y1="18" x2="12" y2="21" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
      <path d="M8.5 4h7L19 10l-3.5 6h-7L5 10z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <circle cx="12" cy="10" r="2" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function SeatIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
      <rect x="9.5" y="2" width="5" height="3.6" rx="1.6" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M6.5 8.2a2.7 2.7 0 0 1 2.7-2.7h5.6a2.7 2.7 0 0 1 2.7 2.7V13H6.5z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <rect x="5" y="14.5" width="14" height="4.3" rx="1.8" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 3 19 6v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M9 12l2 2 4-4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BatteryIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="8" width="16" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
      <rect x="19" y="11" width="2" height="3" rx="0.5" fill="currentColor" />
      <line x1="7.5" y1="8" x2="7.5" y2="6.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="12.5" y1="8" x2="12.5" y2="6.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12.3 10.5 9.3 14.3h2.2l-0.9 3 3.6-4.3h-2.1z" fill="currentColor" />
    </svg>
  );
}

function BagIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
      <path d="M6 8h12l-1 12H7z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function WheelIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 3v6.4M12 14.6V21M3 12h6.4M14.6 12H21M5.6 5.6l4.5 4.5M13.9 13.9l4.5 4.5M5.6 18.4l4.5-4.5M13.9 10.1l4.5-4.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BrakeDiscIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="2.2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="6.2" r="0.9" fill="currentColor" />
      <circle cx="16.8" cy="9.5" r="0.9" fill="currentColor" />
      <circle cx="15.1" cy="15.3" r="0.9" fill="currentColor" />
      <circle cx="8.9" cy="15.3" r="0.9" fill="currentColor" />
      <circle cx="7.2" cy="9.5" r="0.9" fill="currentColor" />
    </svg>
  );
}

// Іконка на кожен розділ — той самий курований довідник, що був і до
// редизайну (мапа id розділу -> компонент іконки вище)
const DEPARTMENT_ICONS: Record<string, () => React.JSX.Element> = {
  to: ServiceWrenchIcon,
  'dvyhun-detali': PistonIcon,
  palyvna: FuelCanIcon,
  vypusk: ExhaustIcon,
  oholodzhennya: CoolingFanIcon,
  'dvyhun-v-zbori': EngineIcon,
  opalennya: VentIcon,
  transmisiya: TransmissionIcon,
  hodova: ShockAbsorberIcon,
  kuzov: CarBodyIcon,
  kriplennya: BoltIcon,
  halmivna: BrakeDiscIcon,
  kermo: SteeringWheelIcon,
  salon: SeatIcon,
  dysky: WheelIcon,
  bezpeka: ShieldIcon,
  elektro: BatteryIcon,
  aksesuary: BagIcon,
};

// Текст плаваючого бейджа при наведенні — назви вузьких категорій
// розділу (до двох, з "+N" якщо більше), або "Підбір за VIN" для
// розділів, де товарів ще немає взагалі
function getBadgeLabel(department: DepartmentDef): string {
  if (department.categorySlugs.length === 0) return 'Підбір за VIN';

  const names = department.categorySlugs
    .map((slug) => getCategoryBySlug(slug)?.name)
    .filter((name): name is string => Boolean(name));

  if (names.length === 0) return `${department.categorySlugs.length} категорій`;

  const preview = names.slice(0, 2).join(' · ');
  const extra = names.length > 2 ? ` +${names.length - 2}` : '';
  return `${preview}${extra}`;
}

// Назва марки з VehicleFilterModal ("Toyota") -> slug для /marky та
// для ?marka= у app/category/[slug]/page.tsx ("toyota")
function findMakeSlug(makeName: string): string | null {
  const found = CAR_MAKES.find((carMake) => carMake.name.toLowerCase() === makeName.toLowerCase());
  return found ? found.slug : null;
}

function resolveDestination(department: DepartmentDef, selection: VehicleSelection | null): string {
  const makeSlug = selection?.make ? findMakeSlug(selection.make) : null;

  if (department.categorySlugs.length === 0) {
    // Товарів у цьому розділі поки що немає — ведемо на Головну, де
    // ефект в components/StorefrontHome.tsx сам відкриє заявку "Підбір
    // за VIN". Якщо покупач встиг щось обрати в модалці (марка/модель/
    // рік/двигун), передаємо це параметрами — інакше вибір губився б,
    // і покупачу довелось би вводити ті самі дані ще раз вручну у
    // формі заявки
    const params = new URLSearchParams({ vin: '1', category: department.name });
    if (selection?.make) params.set('make', selection.make);
    if (selection?.model) params.set('model', selection.model);
    if (selection?.year) params.set('year', selection.year);
    if (selection?.engine) params.set('engine', selection.engine);
    return `/?${params.toString()}`;
  }

  if (department.categorySlugs.length === 1) {
    const base = `/category/${department.categorySlugs[0]}`;
    return makeSlug ? `${base}?marka=${makeSlug}` : base;
  }

  return `/rozdil/${department.slug}`;
}

interface CategoryGridSectionProps {
  title?: string;
  subtitle?: string;
  // Викликається ЗАМІСТЬ переходу на "/?vin=1..." для розділу без
  // жодної категорії товару. CategoryGridSection рендериться ВСЕРЕДИНІ
  // components/StorefrontHome.tsx (та сама сторінка "/"), тому клієнтський
  // router.push('/?vin=1...') на ЦЮ Ж адресу не перемонтовує компонент —
  // useEffect, який мав би зчитати нові query-параметри, просто не
  // спрацьовує вдруге (Next.js App Router лишає інстанс сторінки як є
  // при навігації в межах одного маршруту). Пряма передача даних через
  // callback працює завжди, незалежно від цієї особливості навігації —
  // якщо колись CategoryGridSection знадобиться на іншій сторінці без
  // доступу до стану заявки "Підбір за VIN", він сам впаде назад на
  // "/?vin=1..." (див. resolveDestination нижче)
  onOpenVinRequest?: (category: string, selection: VehicleSelection | null) => void;
}

export default function CategoryGridSection({
  title = 'Розділи',
  subtitle = 'Каталог за системами авто',
  onOpenVinRequest,
}: CategoryGridSectionProps) {
  const router = useRouter();
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null);
  const [activeDepartment, setActiveDepartment] = useState<DepartmentDef | null>(null);

  const closeModal = () => setActiveDepartment(null);

  const goToDestination = (department: DepartmentDef, selection: VehicleSelection | null) => {
    if (department.categorySlugs.length === 0 && onOpenVinRequest) {
      onOpenVinRequest(department.name, selection);
      return;
    }
    router.push(resolveDestination(department, selection));
  };

  const handleSubmit = (selection: VehicleSelection) => {
    if (!activeDepartment) return;
    goToDestination(activeDepartment, selection);
    closeModal();
  };

  const handleSkip = () => {
    if (!activeDepartment) return;
    goToDestination(activeDepartment, null);
    closeModal();
  };

  return (
    <>
      <div>
        <p
          className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em]"
          style={{ fontFamily: TECH_BODY_FONT, color: TECH_FAINT }}
        >
          {subtitle}
        </p>
        <h2 className="mb-5 text-xl" style={{ fontFamily: TECH_DISPLAY_FONT, fontWeight: 600, color: '#fff' }}>
          {title}
        </h2>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 md:gap-5 lg:grid-cols-4">
          {DEPARTMENTS.map((department) => {
            const Icon = DEPARTMENT_ICONS[department.slug];
            const isHovered = hoveredSlug === department.slug;

            return (
              <motion.button
                key={department.slug}
                type="button"
                onMouseEnter={() => setHoveredSlug(department.slug)}
                onMouseLeave={() => setHoveredSlug((current) => (current === department.slug ? null : current))}
                onClick={() => setActiveDepartment(department)}
                whileHover={{ y: -4 }}
                whileTap={{ scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 400, damping: 24 }}
                className="group relative flex min-h-[176px] flex-col items-start gap-4 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/80 to-slate-900/30 p-6 text-left backdrop-blur-md transition-colors hover:border-blue-500/40 hover:shadow-glow md:p-8"
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5 text-slate-400 transition-colors group-hover:bg-blue-500/10 group-hover:text-blue-400">
                  <Icon />
                </div>

                <span className="text-base font-semibold leading-tight text-white md:text-lg" style={{ fontFamily: TECH_DISPLAY_FONT }}>
                  {department.name}
                </span>

                {/* Плаваючий бейдж — підкатегорії розділу або "Підбір за
                    VIN", з'являється тільки при наведенні (desktop);
                    на дотик-екранах просто не заважає — клік одразу
                    відкриває модалку */}
                <AnimatePresence>
                  {isHovered && (
                    <motion.span
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 6 }}
                      transition={{ duration: 0.16 }}
                      className="absolute bottom-4 left-6 right-6 truncate rounded-full border border-blue-500/25 bg-blue-500/10 px-3 py-1.5 text-[11px] font-medium text-blue-300 md:left-8 md:right-8"
                      style={{ fontFamily: TECH_BODY_FONT }}
                    >
                      {getBadgeLabel(department)}
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.button>
            );
          })}
        </div>
      </div>

      <VehicleFilterModal
        open={activeDepartment !== null}
        categoryName={activeDepartment?.name ?? ''}
        onClose={closeModal}
        onSubmit={handleSubmit}
        onSkip={handleSkip}
      />
    </>
  );
}
