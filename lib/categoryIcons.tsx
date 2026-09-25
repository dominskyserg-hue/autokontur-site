// ============================================================
// Іконка категорії деталі — для заглушки товару без фото (components/
// ProductGallery.tsx): замість порожнього квадрата показуємо, ЩО це за
// деталь (диск, фільтр, свічка...). Ключ — slug широкої категорії
// lib/categories.ts; невідома категорія — загальна іконка "деталь"
// ============================================================

import type { LucideIcon } from 'lucide-react';
import {
  Disc3,
  Filter,
  Wind,
  Sparkles,
  Cog,
  Droplet,
  Zap,
  Thermometer,
  Car,
  Fuel,
  Wrench,
  CircleDot,
  Waves,
  Settings2,
  Flame,
  Package,
} from 'lucide-react';

const ICON_BY_CATEGORY: Record<string, LucideIcon> = {
  'halmivni-kolodky': Disc3,
  'halmivni-dysky': Disc3,
  amortyzatory: Waves,
  'sailentbloky-vazhelia': CircleDot,
  'vtulky-stabilizatora': CircleDot,
  'kulovi-opory': CircleDot,
  'vazheli-pidvisky': Wrench,
  'pidshypnyky-matochyny': Settings2,
  'oliyni-filtry': Filter,
  'povitryani-filtry': Filter,
  'salonni-filtry': Wind,
  'svichky-zapaliuvannia': Sparkles,
  'remeni-rolyky-grm': Cog,
  'motorni-olyvy': Droplet,
  'halmivna-ridyna': Droplet,
  'kermove-upravlinnya': Settings2,
  'generatory-startery': Zap,
  'prokladky-dvyhuna': Wrench,
  'palyvna-systema': Fuel,
  'systema-oholodzhennya': Thermometer,
  'systema-vypusku': Flame,
  'opalennya-klimat': Thermometer,
  'transmisiya-kpp': Cog,
  'kuzov-detali': Car,
};

export function getCategoryIcon(categorySlug: string | null | undefined): LucideIcon {
  return (categorySlug && ICON_BY_CATEGORY[categorySlug]) || Package;
}
