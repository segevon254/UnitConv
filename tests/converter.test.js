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

// ---- UK imperial ----------------------------------------------------------------
const uk = UC.normalizeSettings({ system: 'uk' });
const convertWith = (text, settings, options) =>
  UC.findConversions(text, settings, { locale: 'en-US', ...options }).map((m) => [m.original, m.converted]);

test('UK system: metric volumes go to UK measures', () => {
  assert.deepEqual(convertWith('2 L and 500 ml', uk), [['2 L', '3.52 pt'], ['500 ml', '17.6 fl oz']]);
});

test('UK system: US gallons convert to UK gallons, labelled', () => {
  assert.deepEqual(convertWith('5 US gallons, 1 gallon', uk), [['5 US gallons', '4.16 UK gal'], ['1 gallon', '0.83 UK gal']]);
});

test('UK system leaves UK measures and shared units alone', () => {
  assert.deepEqual(convertWith('2 imperial pints, 5 miles, 3 lb', uk), []);
});

test('explicit UK qualifiers are read as UK measures', () => {
  assert.deepEqual(convertWith('10 imperial gallons, 2 UK pints, 3 imp. gal', metric), [
    ['10 imperial gallons', '45.46 L'], ['2 UK pints', '1.14 L'], ['3 imp. gal', '13.64 L'],
  ]);
});

test('British page: unqualified pints are UK pints, "US" still wins', () => {
  assert.deepEqual(convertWith('2 pints, 2 US pints', metric, { volumeStandard: 'uk' }), [
    ['2 pints', '1.14 L'], ['2 US pints', '946.35 mL'],
  ]);
});

test('US system on a British page converts UK gallons to US gallons', () => {
  assert.deepEqual(convertWith('2 gallons', imperial, { volumeStandard: 'uk' }), [['2 gallons', '2.4 US gal']]);
});

test('stone and stone + pounds', () => {
  assert.deepEqual(convertWith('11 st 4 lb, 11st 4lb, 12 stone, 13 st', metric), [
    ['11 st 4 lb', '71.67 kg'], ['11st 4lb', '71.67 kg'], ['12 stone', '76.2 kg'], ['13 st', '82.55 kg'],
  ]);
});

test('ordinals and street names are not stone', () => {
  assert.deepEqual(convertWith('the 1st place, 21st century, 5 St Mary', metric), []);
});

test('resolveVolumeStandard', () => {
  assert.equal(UC.resolveVolumeStandard('auto', { hostname: 'www.bbc.co.uk' }), 'uk');
  assert.equal(UC.resolveVolumeStandard('auto', { lang: 'en-GB' }), 'uk');
  assert.equal(UC.resolveVolumeStandard('auto', { hostname: 'example.com', lang: 'en' }), 'us');
  assert.equal(UC.resolveVolumeStandard('uk', { hostname: 'example.com' }), 'uk');
});

// ---- Temperature disambiguation ---------------------------------------------------
cases(metric, [
  ['Forecast: high of 75F today', [['75F', '23.9°C']]],
  ['Preheat the oven to 350 F', [['350 F', '176.7°C']]],
  ['Today 72 F and sunny', [['72 F', '22.2°C']]],
  ['highs 75-80F', [['75-80F', '23.9–26.7°C']]],
  ['Highs near 75°, lows 60°F', [['75°', '23.9°C'], ['60°F', '15.6°C']]],
  ['turn 45° to the left, it is 70°F', [['70°F', '21.1°C']]],
  // without temperature words a bare letter is not a unit
  ['It is 75F', []],
  ['Apartment 3C, high temps', []],
  ['Grade 4F', []],
  ['size 12C, temperatures low', []],
  ['Vitamin C 500 mg', []],
  // bare degrees with no °F/°C anywhere, or that are angles
  ['rotate 90 degrees', []],
  ['40.7° N, 74° W', []],
  ['overnight lows 50s, 58°', []],
  ['40°F below zero', []],
]);

test('bare degrees resolved from the surrounding element', () => {
  const ctx = { getContext: () => 'Weather for Boston, temperatures in °F' };
  assert.deepEqual(convertWith('High 75°', metric, ctx), [['75°', '23.9°C']]);
  assert.deepEqual(convertWith('Low 60 degrees', metric, ctx), [['60 degrees', '15.6°C']]);
  assert.deepEqual(convertWith('75F', metric, ctx), [['75F', '23.9°C']]);
});

test('temperature differences have no 32° offset', () => {
  assert.deepEqual(convertWith('30 degrees warmer: 80°F', metric), [['30 degrees', '16.7°C'], ['80°F', '26.7°C']]);
  assert.deepEqual(convertWith('temps rose by 10°F', metric), [['10°F', '5.6°C']]);
  assert.deepEqual(convertWith('a rise of 2 °C', imperial), [['2 °C', '3.6°F']]);
});

test('ambiguous "degrees" cannot be chosen as a target', () => {
  assert.equal(UC.normalizeSettings({ targets: { temperature: 'deg' } }).targets.temperature, 'auto');
});

test('UK system uses °C for temperatures', () => {
  assert.deepEqual(convertWith('highs of 75°F, 20 °C', uk), [['75°F', '23.9°C']]);
  const ukF = UC.normalizeSettings({ system: 'uk', targets: { temperature: 'f' } });
  assert.deepEqual(convertWith('highs of 75°F, 20 °C', ukF), [['20 °C', '68°F']]);
});
