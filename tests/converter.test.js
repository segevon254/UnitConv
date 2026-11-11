// Run with: node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const UC = require('../converter.js');

const metric = UC.normalizeSettings({ system: 'metric' });
const imperial = UC.normalizeSettings({ system: 'imperial' });

const convert = (text, settings = metric) =>
  UC.findConversions(text, settings, { locale: 'en-US' }).map((m) => [m.original, m.converted]);

const cases = (settings, table) => {
  for (const [input, expected] of table) {
    test(`${settings.system}: ${JSON.stringify(input)}`, () => assert.deepEqual(convert(input, settings), expected));
  }
};

// ---- Imperial -> metric -------------------------------------------------------
cases(metric, [
  ['We hiked 10 miles today.', [['10 miles', '16.09 km']]],
  ['Distance: 5-10 miles', [['5-10 miles', '8.05–16.09 km']]],
  ['from 5 to 10 mi', [['5 to 10 mi', '8.05–16.09 km']]],
  ['Add 1 1/2 cups of flour', [['1 1/2 cups', '354.88 mL']]],
  ['½ cup sugar and 1½ tsp salt', [['½ cup', '118.29 mL'], ['1½ tsp', '7.39 mL']]],
  ['a 1-1/2 inch pipe', [['1-1/2 inch', '3.81 cm']]],
  ['Bake at 350°F', [['350°F', '176.7°C']]],
  ['It was 75 degrees Fahrenheit', [['75 degrees Fahrenheit', '23.9°C']]],
  ['-5°F tonight', [['-5°F', '-20.6°C']]],
  ['temps 70-75°F', [['70-75°F', '21.1–23.9°C']]],
  ['A 100 sq ft room', [['100 sq ft', '9.29 m²']]],
  ['On 2 acres', [['2 acres', '0.81 ha']]],
  ['He is 5\'10" tall', [['5\'10"', '1.78 m']]],
  ['She is 6 ft 2 in', [['6 ft 2 in', '1.88 m']]],
  ['6′2″ forward', [['6′2″', '1.88 m']]],
  ['16 fl oz bottle', [['16 fl oz', '473.18 mL']]],
  ['3 lbs of beef', [['3 lbs', '1.36 kg']]],
  ['8 oz steak', [['8 oz', '226.8 g']]],
  ['a 10-foot pole', [['10-foot', '3.05 m']]],
  ['rug 12 x 10 ft', [['12 x 10 ft', '3.66 × 3.05 m']]],
  ['a 27" monitor', [['27"', '68.58 cm']]],
  ['a 6.1 in display', [['6.1 in', '15.49 cm']]],
  ['1,000 ft climb', [['1,000 ft', '304.8 m']]],
  ['2 qt pot, 3 gal bucket', [['2 qt', '1.89 L'], ['3 gal', '11.36 L']]],
  ['1 cup + 2 tbsp butter', [['1 cup', '236.59 mL'], ['2 tbsp', '29.57 mL']]],
  ['MARATHON: 26.2 MILES', [['26.2 MILES', '42.16 km']]],
]);

// ---- Metric -> imperial -------------------------------------------------------
cases(imperial, [
  ['5 km run', [['5 km', '3.11 mi']]],
  ['20 °C', [['20 °C', '68°F']]],
  ['500 g', [['500 g', '1.1 lb']]],
  ['250 ml', [['250 ml', '8.45 fl oz']]],
  ['180 cm', [['180 cm', '5.91 ft']]],
  ['a 50 cm shelf', [['50 cm', '19.69 in']]],
  ['1.5 km', [['1.5 km', '0.93 mi']]],
  ['5 L of water', [['5 L', '1.32 gal']]],
  ['3 ha', [['3 ha', '7.41 acres']]],
  ['10–15 kg', [['10–15 kg', '22.05–33.07 lb']]],
]);

// ---- Things that must NOT be converted ---------------------------------------
cases(metric, [
  ['In 2020 we moved', []],
  ['May 5, 2023', []],
  ['the 2019 in review', []],
  ['at 5 in the morning', []],
  ['they raised $5m', []],
  ['drive 60 mph or 60 km/h', []],
  ['speed: 30 miles per hour', []],
  ['2 + 3 = 5 m', []],
  ['x = 4 ft', []],
  ['10 miles (16 km)', []],
  ['10 mi / 16 km', []],
  ['12pt font', []],
  ['He said "Top 10" today', []],
  ['5m views', []],
  ['version 1.2.3 m', []],
  ['COVID-19', []],
  ['scored 3 pts', []],
  ['A4 paper', []],
  ['page 5 of 10', []],
  ['call 555-1234', []],
]);

// ---- Same system is left untouched -------------------------------------------
cases(metric, [['5 km and 20 °C', []]]);
cases(imperial, [['5 miles and 70°F', []]]);

// ---- Fine-grained targets & options -------------------------------------------
test('explicit target unit overrides auto', () => {
  const s = UC.normalizeSettings({ system: 'metric', targets: { length: 'cm' } });
  assert.deepEqual(convert('10 miles', s), [['10 miles', '1,609,344 cm']]);
});

test('explicit target from the other system flips direction for that category only', () => {
  const s = UC.normalizeSettings({ system: 'metric', targets: { temperature: 'f' } });
  assert.deepEqual(convert('20 °C and 10 miles', s), [['20 °C', '68°F'], ['10 miles', '16.09 km']]);
});

test('category can be switched off', () => {
  const s = UC.normalizeSettings({ system: 'metric', targets: { weight: 'off' } });
  assert.deepEqual(convert('3 lbs and 2 cups', s), [['2 cups', '473.18 mL']]);
});

test('precision setting is honoured', () => {
  const s = UC.normalizeSettings({ system: 'metric', precision: 0 });
  assert.deepEqual(convert('10 miles', s), [['10 miles', '16 km']]);
});

test('normalizeSettings rejects junk', () => {
  const s = UC.normalizeSettings({ system: 'x', precision: 99, displayMode: 'nope', targets: { length: 'kg' } });
  assert.deepEqual(s, UC.normalizeSettings());
});

test('parseQty handles fractions and separators', () => {
  assert.equal(UC.parseQty('1 1/2'), 1.5);
  assert.equal(UC.parseQty('1-1/2'), 1.5);
  assert.equal(UC.parseQty('¾'), 0.75);
  assert.equal(UC.parseQty('2½'), 2.5);
  assert.equal(UC.parseQty('1,234.5'), 1234.5);
  assert.equal(UC.parseQty('−4'), -4);
  assert.ok(Number.isNaN(UC.parseQty('3/0')));
});

test('convertValue round-trips', () => {
  assert.ok(Math.abs(UC.convertValue(1, 'mi', 'km') - 1.609344) < 1e-12);
  assert.ok(Math.abs(UC.convertValue(100, 'c', 'f') - 212) < 1e-12);
});
