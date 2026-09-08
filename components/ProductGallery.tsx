'use client';

// ============================================================
// Галерея фото на картці товару — головне фото (велике) + мініатюри
// під ним, клік по мініатюрі перемикає головне фото. Кожне фото має
// СВІЙ alt (formuluю alt збирає ProductDetailContent.tsx, тут лише
// показ) — так пошукові боти бачать різний текст для різних фото
// одного товару, а не однаковий на всі, як було раніше.
//
// 'use client' обов'язковий: перемикання активного фото — це
// клієнтський стан (useState), сама сторінка товару (app/p/...)
// лишається серверним компонентом
// ============================================================

import { useState } from 'react';

const PANEL_SOFT = '#1B2436';
const BORDER_SOFT = 'rgba(255,255,255,0.1)';
const ACCENT = '#60A5FA';
const FAINT = '#54607A';

export interface GalleryPhoto {
  url: string;
  alt: string;
}

export default function ProductGallery({ photos }: { photos: GalleryPhoto[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = photos[activeIndex] ?? photos[0];

  return (
    <div>
      <div
        className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl"
        style={{
          background: PANEL_SOFT,
          backgroundImage: active
            ? undefined
            : 'linear-gradient(45deg, rgba(255,255,255,0.04) 25%, transparent 25%), linear-gradient(-45deg, rgba(255,255,255,0.04) 25%, transparent 25%)',
          backgroundSize: '12px 12px',
          border: `1px solid ${BORDER_SOFT}`,
        }}
      >
        {active ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={active.url} alt={active.alt} className="h-full w-full object-cover" />
        ) : (
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={FAINT} strokeWidth="1.4">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <circle cx="8.5" cy="10" r="1.5" />
            <path d="M21 16l-5-5-4 4-2-2-7 7" strokeLinejoin="round" />
          </svg>
        )}
      </div>

      {photos.length > 1 && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {photos.map((photo, index) => (
            <button
              key={photo.url + index}
              type="button"
              onClick={() => setActiveIndex(index)}
              aria-label={photo.alt}
              aria-current={index === activeIndex}
              className="h-14 w-14 shrink-0 overflow-hidden rounded-lg"
              style={{
                border: index === activeIndex ? `2px solid ${ACCENT}` : `1px solid ${BORDER_SOFT}`,
                background: PANEL_SOFT,
              }}
            >
              {/* Мініатюра — декоративна (справжній alt несе велике
                  фото вище, яке показує саме цю картинку після кліку) */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
