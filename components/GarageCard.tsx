'use client';

// ============================================================
// Картка одного автомобіля у вкладці "Мій Гараж" особистого кабінету
// (components/CustomerDashboard.tsx). Активне авто (isActive) —
// підсвічується неоновою рамкою й показує бейдж "Активне" — саме на
// нього орієнтується кнопка "Знайти запчастини для цього авто".
//
// Стиль — Tech Premium (lib/techTheme.ts), той самий, що і в решті
// кабінету. 'use client' обов'язковий: компонент використовує
// Framer Motion (motion.div з hover/tap-анімаціями)
// ============================================================

import { motion } from 'framer-motion';
import Link from 'next/link';
import { Car, Trash2, Fuel, Hash, Search } from 'lucide-react';
import {
  TECH_SURFACE_2,
  TECH_BORDER,
  TECH_BORDER_2,
  TECH_ACCENT,
  TECH_ACCENT_BRIGHT,
  TECH_ACCENT_DIM,
  TECH_MUTED,
  TECH_FAINT,
  TECH_GLOW,
  TECH_DISPLAY_FONT,
  TECH_MONO_FONT,
} from '@/lib/techTheme';

export interface GarageVehicle {
  id: string;
  make: string;
  model: string;
  year: number | null;
  engine: string | null;
  vin: string | null;
  isActive: boolean;
}

interface GarageCardProps {
  vehicle: GarageVehicle;
  findPartsHref: string;
  settingActive: boolean;
  deleting: boolean;
  onSetActive: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function GarageCard({
  vehicle,
  findPartsHref,
  settingActive,
  deleting,
  onSetActive,
  onDelete,
}: GarageCardProps) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.2 }}
      className="relative overflow-hidden rounded-2xl p-5"
      style={{
        background: TECH_SURFACE_2,
        border: `1px solid ${vehicle.isActive ? 'rgba(59,130,246,0.55)' : TECH_BORDER}`,
        boxShadow: vehicle.isActive ? TECH_GLOW : 'none',
      }}
    >
      {vehicle.isActive && (
        <div
          className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full blur-3xl"
          style={{ background: 'rgba(59,130,246,0.22)' }}
        />
      )}

      <div className="relative flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 flex-none items-center justify-center rounded-xl"
            style={{
              background: vehicle.isActive
                ? `linear-gradient(135deg, ${TECH_ACCENT}, ${TECH_ACCENT_DIM})`
                : 'rgba(255,255,255,0.06)',
              color: vehicle.isActive ? '#fff' : TECH_MUTED,
            }}
          >
            <Car className="h-5 w-5" />
          </div>
          <div>
            <p className="text-base font-semibold" style={{ fontFamily: TECH_DISPLAY_FONT, color: '#fff' }}>
              {vehicle.make} {vehicle.model}
            </p>
            <p className="text-xs" style={{ color: TECH_FAINT }}>
              {vehicle.year ? `${vehicle.year} р.` : 'Рік не вказано'}
            </p>
          </div>
        </div>

        {vehicle.isActive && (
          <span
            className="whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium"
            style={{ background: 'rgba(59,130,246,0.16)', color: TECH_ACCENT_BRIGHT }}
          >
            Активне
          </span>
        )}
      </div>

      <div className="relative mt-4 flex flex-col gap-1.5 text-xs" style={{ color: TECH_MUTED }}>
        {vehicle.engine && (
          <div className="flex items-center gap-1.5">
            <Fuel className="h-3.5 w-3.5 flex-none" style={{ color: TECH_FAINT }} />
            <span>{vehicle.engine}</span>
          </div>
        )}
        {vehicle.vin && (
          <div className="flex items-center gap-1.5">
            <Hash className="h-3.5 w-3.5 flex-none" style={{ color: TECH_FAINT }} />
            <span style={{ fontFamily: TECH_MONO_FONT }}>{vehicle.vin}</span>
          </div>
        )}
      </div>

      <div className="relative mt-4 flex flex-wrap items-center gap-2">
        {!vehicle.isActive && (
          <button
            type="button"
            disabled={settingActive}
            onClick={() => onSetActive(vehicle.id)}
            className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors hover:bg-white/5 disabled:opacity-50"
            style={{ border: `1px solid ${TECH_BORDER_2}`, color: TECH_MUTED }}
          >
            {settingActive ? 'Обираємо...' : 'Зробити активним'}
          </button>
        )}

        <Link
          href={findPartsHref}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-shadow hover:shadow-glow"
          style={{ background: `linear-gradient(90deg, ${TECH_ACCENT}, ${TECH_ACCENT_DIM})`, color: '#fff' }}
        >
          <Search className="h-3.5 w-3.5" />
          Знайти запчастини
        </Link>

        <button
          type="button"
          disabled={deleting}
          onClick={() => onDelete(vehicle.id)}
          aria-label="Видалити авто"
          className="ml-auto rounded-lg p-1.5 transition-colors hover:bg-white/5 disabled:opacity-50"
          style={{ color: TECH_FAINT }}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </motion.div>
  );
}
