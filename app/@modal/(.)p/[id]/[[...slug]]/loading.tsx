// ============================================================
// Next.js сам обгортає page.tsx в цьому ж маршруті в Suspense і
// показує цей файл, поки серверний компонент ProductModal чекає на
// дані з бази (loadProductPageData — це кілька SQL-запитів, включно
// з новими tecdocCrosses/tecdocCompatibility, тому чекати доводиться
// помітно довше, ніж раніше).
//
// БЕЗ цього файлу клік по картці товару якийсь час не давав ЖОДНОЇ
// візуальної реакції (URL у рядку адреси вже змінювався, а сам
// каталог на екрані лишався незмінним, поки не прийдуть дані) —
// виглядало так, ніби клік "не спрацював" або модальне вікно
// зламалося. Тепер рамка модального вікна (той самий
// ProductModalShell — фон, кнопка закриття, клік по фону) з'являється
// МИТТЄВО з коротким спінером замість вмісту, а сам товар підвантажується
// вже всередину неї за мить
// ============================================================

import ProductModalShell from '@/components/ProductModalShell';

export default function ProductModalLoading() {
  return (
    <ProductModalShell>
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div
          className="w-10 h-10 rounded-full animate-spin"
          style={{ border: '3px solid #EAEDF2', borderTopColor: '#1D5FD6' }}
          aria-hidden="true"
        />
        <p className="text-sm" style={{ color: '#5C6678' }}>
          Завантаження товару...
        </p>
      </div>
    </ProductModalShell>
  );
}
