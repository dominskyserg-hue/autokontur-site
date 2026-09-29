// ============================================================
// Токен хранилища Vercel Blob — одна функция для всего проекта.
//
// Локально (в .env.local) токен лежит в стандартной переменной
// BLOB_READ_WRITE_TOKEN. А на Vercel хранилище (store_khIb8AmQctsKdmXz)
// подключено к проекту с префиксом "bazaa_" — там переменная называется
// bazaa_READ_WRITE_TOKEN, а стандартной BLOB_READ_WRITE_TOKEN НЕТ.
//
// Функция put() из @vercel/blob без явного token сама ищет только
// BLOB_READ_WRITE_TOKEN — поэтому на проде без этой функции любое
// сохранение файла падало с ошибкой "No token found". Здесь мы берём
// ту переменную, которая есть, и передаём её в put() явно.
// Тот же выбор хоста хранилища — в next.config.mjs (rewrite фида)
// ============================================================

export function blobToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.bazaa_READ_WRITE_TOKEN || undefined;
}
