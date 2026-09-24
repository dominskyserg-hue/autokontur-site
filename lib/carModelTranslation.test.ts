// ============================================================
// Юніт-тести для cleanApplicability() — усі приклади взяті з РЕАЛЬНИХ
// даних бойової бази (перевірено окремим аналізом,
// .tecdoc-scratch/applicability-audit/products.csv), а не вигадані.
//
// Запуск: npx tsx --test lib/carModelTranslation.test.ts
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanApplicability } from './carModelTranslation';

// ---- Сирі TecDoc-коди "#...#" — застосовність НЕ показуємо ----

test('Bcguma BC3304 (з задачі): код "#...#" + російський текст -> null', () => {
  // Реальний товар: brand=Bcguma, article=BC3304, car_make=TOYOTA
  assert.equal(cleanApplicability('TOYOTA #T17#,  #E10# переднего рычага задний'), null);
});

test('одиночний код "#T30" -> null', () => {
  assert.equal(cleanApplicability('X-Trail #T30 `06.01~.R (M10X1.25)'), null);
});

test('код всередині складеного рядка -> null, навіть якщо решта тексту чиста', () => {
  assert.equal(cleanApplicability('Corolla #E104,Sprinter Carib AE114(5) `95~.R'), null);
});

// ---- Чистий текст без кирилиці — не змінюється (тільки пробіли) ----

test('чиста латиниця без кирилиці і без "#" лишається як є', () => {
  assert.equal(cleanApplicability('MAZDA 323 (BJ) 1.3I,1.5I,1.6I 16V 05/1998-'), 'MAZDA 323 (BJ) 1.3I,1.5I,1.6I 16V 05/1998-');
});

test('подвійні пробіли схлопуються', () => {
  assert.equal(cleanApplicability('Prado  120 rear'), 'Prado 120 задній');
});

// ---- Порожня/відсутня модель — це нормально, не помилка ----

test('порожній рядок -> порожній рядок (не null)', () => {
  assert.equal(cleanApplicability(''), '');
});

test('null -> порожній рядок', () => {
  assert.equal(cleanApplicability(null), '');
});

test('undefined -> порожній рядок', () => {
  assert.equal(cleanApplicability(undefined), '');
});

test('рядок з самих пробілів -> порожній рядок', () => {
  assert.equal(cleanApplicability('   '), '');
});

// ---- Англійські позначки сторони (rear/front/left/right) ----

test('rear -> задній (MONROE D8019, реальний товар)', () => {
  assert.equal(cleanApplicability('Prado 120 rear'), 'Prado 120 задній');
});

test('front -> передній, з великої літери -> Передній', () => {
  assert.equal(cleanApplicability('Front Golf V'), 'Передній Golf V');
});

test('left/right теж перекладаються', () => {
  assert.equal(cleanApplicability('Left rear Corolla'), 'Лівий задній Corolla');
});

// ---- Реальні приклади з російським текстом, який ПОВНІСТЮ перекладається ----

test('CTR CVT9 (реальний товар): "Переднего рычага передний" -> повний переклад', () => {
  assert.equal(
    cleanApplicability('Переднего рычага передний CARINA E AT190 (UK)'),
    'Переднього важеля передній CARINA E AT190 (UK)'
  );
});

test('NTY ZWDSB012 (реальний товар): типова помилка "нижный" теж розпізнається', () => {
  assert.equal(cleanApplicability('Рычаг передний нижный правый FORESTER 13-'), 'Важіль передній нижній правий FORESTER 13-');
});

test('N2406WB (реальний товар): "переднего рычага задний" з переліком кодів моделей', () => {
  assert.equal(
    cleanApplicability('переднего рычага задний  T12, J30, U11, U12,'),
    'переднього важеля задній T12, J30, U11, U12,'
  );
});

test('AJUSA 81008400 (реальний товар): багато типів кузова в одному рядку', () => {
  const input =
    'FORD COURIER Автофургон / микроавтобус `91-03`; ESCORT V седан `93-95`; ESCORT VI Фургон/универсал `95-01`; FIESTA Фургон/хетчбэк `89-03`; SIERRA II Хэтчбэк `88-93`';
  const result = cleanApplicability(input);
  assert.notEqual(result, null);
  assert.ok(result!.includes('Автофургон'));
  assert.ok(result!.includes('мікроавтобус'));
  assert.ok(result!.includes('седан'));
  assert.ok(result!.includes('Фургон/універсал'));
  assert.ok(result!.includes('Фургон/хетчбек'));
  assert.ok(result!.includes('Хетчбек'));
  // жодних російських літер ы/э/ъ/ё в результаті лишитись не повинно
  assert.doesNotMatch(result!, /[ыэъё]/i);
});

// ---- Реальні приклади, де в тексті лишається НЕВІДОМЕ слово -> null ----

test('TENACITY AAMTO1059 (реальний товар): "сайлентблок" не в словнику -> null', () => {
  assert.equal(cleanApplicability('Задний сайлентблок заднего нижнего рычага Corolla 140'), null);
});

test('SATO TECH G1201R (реальний товар): назва кольору "Красный" не в словнику -> null', () => {
  assert.equal(cleanApplicability('Красный антифриз концентрат  1,5л'), null);
});

test('HYUNDAI 2113403000 (реальний товар): "крышки" не в словнику -> null', () => {
  assert.equal(cleanApplicability('передней крышки L4NA'), null);
});

test('одне невідоме слово серед перекладених псує весь результат', () => {
  assert.equal(cleanApplicability('передний пыльник'), null);
});
