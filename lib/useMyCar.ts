'use client';

// ============================================================
// React-хук: текущее "моє авто" (lib/myCar.ts) с автообновлением, когда
// авто меняют в другом месте страницы (шапка, карточка товара).
// undefined — ещё не прочитали из браузера (первый рендер на сервере)
// ============================================================

import { useEffect, useState } from 'react';
import { readMyCar, MY_CAR_STORAGE_KEY, MY_CAR_UPDATED_EVENT, type MyCar } from '@/lib/myCar';

export function useMyCar(): MyCar | null | undefined {
  const [car, setCar] = useState<MyCar | null | undefined>(undefined);

  useEffect(() => {
    const sync = () => setCar(readMyCar());
    // Изменение в другой вкладке браузера — событие storage
    const onStorage = (event: StorageEvent) => {
      if (event.key === MY_CAR_STORAGE_KEY) sync();
    };
    sync();
    window.addEventListener(MY_CAR_UPDATED_EVENT, sync);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(MY_CAR_UPDATED_EVENT, sync);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return car;
}
