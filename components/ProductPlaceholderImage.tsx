// ============================================================
// Заглушка для картки товару, коли фото так і не знайшлось (ні
// вручну в адмінці, ні фоновою чергою — lib/productImagePipeline.ts).
// Замість порожньої іконки показує бренд і артикул прямо на
// "картинці" — так товар лишається впізнаваним у сітці навіть без
// фото, а не зливається з сусідніми порожніми картками.
//
// Це звичайний React-компонент (малює SVG у розмітці), а не
// растрове зображення — не потребує жодної обробки чи збереження
// файлу, миттєво адаптується під будь-який розмір контейнера
// ============================================================

interface ProductPlaceholderImageProps {
  brand: string | null;
  article: string;
  className?: string;
}

export default function ProductPlaceholderImage({
  brand,
  article,
  className,
}: ProductPlaceholderImageProps) {
  return (
    <svg
      viewBox="0 0 200 200"
      className={className}
      style={{ width: '100%', height: '100%' }}
      role="img"
      aria-label={`Фото відсутнє: ${brand || ''} ${article}`.trim()}
    >
      <rect width="200" height="200" fill="#EAE2D3" />
      <svg x="70" y="60" width="60" height="60" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="5" width="18" height="14" rx="2" stroke="#9A8C77" strokeWidth="1.4" />
        <circle cx="8.5" cy="10" r="1.5" stroke="#9A8C77" strokeWidth="1.4" />
        <path d="M21 16l-5-5-4 4-2-2-7 7" stroke="#9A8C77" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
      {brand && (
        <text
          x="100"
          y="140"
          textAnchor="middle"
          fontSize="13"
          fontWeight="700"
          fill="#6B5D4A"
          style={{ textTransform: 'uppercase' }}
        >
          {brand.length > 16 ? `${brand.slice(0, 16)}…` : brand}
        </text>
      )}
      <text x="100" y="160" textAnchor="middle" fontSize="12" fill="#8A7F70" fontFamily="monospace">
        {article.length > 18 ? `${article.slice(0, 18)}…` : article}
      </text>
    </svg>
  );
}
