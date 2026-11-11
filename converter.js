/*
 * UnitConv — shared conversion engine.
 *
 * Loaded by the content script, the popup and the options page (and by the
 * Node test-suite). The engine itself is pure: it takes a string and returns a
 * list of conversions. A couple of small DOM helpers at the bottom are only
 * executed when called from a page context.
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Settings schema
  // ---------------------------------------------------------------------------

  const STORAGE_KEY = 'unitconvSettings';
  // 'imperial' = US customary, 'uk' = British imperial (UK pints, gallons, fl oz).
  const SYSTEMS = ['metric', 'imperial', 'uk'];
  const SYSTEM_NAMES = { metric: 'Metric', imperial: 'US customary', uk: 'UK imperial' };
  const DISPLAY_MODES = ['annotate', 'replace', 'tooltip'];
  // How to read an unqualified "gallon", "pint", "quart" or "fl oz" on a page.
  const VOLUME_SOURCES = ['auto', 'us', 'uk'];

  const CATEGORIES = [
    { id: 'length', name: 'Length / distance' },
    { id: 'weight', name: 'Weight' },
    { id: 'volume', name: 'Volume' },
    { id: 'temperature', name: 'Temperature' },
    { id: 'area', name: 'Area' },
  ];

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    system: 'metric',
    displayMode: 'annotate',
    precision: 2,
    highlight: true,
    hoverOriginal: true,
    volumeSource: 'auto',
    // Advanced: one rule per source unit, e.g. { mi: 'km', ft: 'cm', f: 'off' }.
    // Rules beat the category and system settings. Only non-default entries are stored.
    unitRulesEnabled: false,
    unitTargets: Object.freeze({}),
    targets: Object.freeze({
      length: 'auto',
      weight: 'auto',
      volume: 'auto',
      temperature: 'auto',
      area: 'auto',
    }),
  });

  // ---------------------------------------------------------------------------
  // Unit definitions
  // ---------------------------------------------------------------------------

  /**
   * Expands words into a case-tolerant regex fragment:
   * W('miles') -> "[Mm]iles|MILES". Spaces become \s+.
   */
  function W(...words) {
    return words
      .map((w) => {
        const rest = w.slice(1).replace(/ /g, '\\s+');
        const upper = w.toUpperCase().replace(/ /g, '\\s+');
        return `[${w[0].toUpperCase()}${w[0]}]${rest}|${upper}`;
      })
      .join('|');
  }

  const SQ = String.raw`(?:[Ss]q|SQ)\.?\s?`;
  // "5 US gallons" / "2 UK pints", "2 imperial pints", "3 imp. gal"
  const USP = String.raw`(?:(?:US|U\.S\.)\s?)?`;
  const UKP = String.raw`(?:UK|U\.K\.|[Ii]mperial|IMPERIAL|[Ii]mp\.?|IMP\.?)\s?`;

  // Order matters only for readability/priority: more specific units first.
  // `factor` converts 1 unit to the category base (m, g, mL, m²).
  const UNITS = [
    // ---- Area (base: square metre) — before length so "sq ft" beats "ft"
    { id: 'sqmi', cat: 'area', sys: 'imperial', factor: 2589988.110336, label: 'mi²', name: 'Square miles',
      forms: [`${SQ}mi(?:les?)?`, 'mi²', W('square miles', 'square mile')] },
    { id: 'sqkm', cat: 'area', sys: 'metric', factor: 1e6, label: 'km²', name: 'Square kilometres',
      forms: [`${SQ}km`, 'km²', 'km2', W('square kilometers', 'square kilometer', 'square kilometres', 'square kilometre')] },
    { id: 'sqcm', cat: 'area', sys: 'metric', factor: 1e-4, label: 'cm²', name: 'Square centimetres',
      forms: [`${SQ}cm`, 'cm²', 'cm2', W('square centimeters', 'square centimeter', 'square centimetres', 'square centimetre')] },
    { id: 'sqm', cat: 'area', sys: 'metric', factor: 1, label: 'm²', name: 'Square metres',
      forms: [`${SQ}m(?:et(?:er|re)s?)?`, 'm²', 'm2', W('square meters', 'square meter', 'square metres', 'square metre')] },
    { id: 'ha', cat: 'area', sys: 'metric', factor: 1e4, label: 'ha', name: 'Hectares',
      forms: ['ha', W('hectares', 'hectare')] },
    { id: 'sqft', cat: 'area', sys: 'imperial', factor: 0.09290304, label: 'ft²', name: 'Square feet',
      forms: [`${SQ}f(?:ee)?t`, 'sqft', 'ft²', 'ft2', W('square feet', 'square foot')] },
    { id: 'sqin', cat: 'area', sys: 'imperial', factor: 0.00064516, label: 'in²', name: 'Square inches',
      forms: [`${SQ}in(?:ch(?:es)?)?`, 'in²', W('square inches', 'square inch')] },
    { id: 'acre', cat: 'area', sys: 'imperial', factor: 4046.8564224, label: 'acre', plural: 'acres', name: 'Acres',
      forms: [W('acres', 'acre')] },

    // ---- Temperature (base: °C)
    { id: 'f', cat: 'temperature', sys: 'imperial', label: '°F', attach: true, name: 'Fahrenheit (°F)',
      toBase: (v) => ((v - 32) * 5) / 9, fromBase: (c) => (c * 9) / 5 + 32,
      forms: [String.raw`[°º˚]\s?F(?:ahrenheit)?`, '℉', String.raw`(?:[Dd]egrees?|DEGREES?)\s+(?:F|[Ff]ahrenheit)`,
        String.raw`[Dd]eg\.?\s?F`, W('fahrenheit'), 'F'] },
    { id: 'c', cat: 'temperature', sys: 'metric', label: '°C', attach: true, name: 'Celsius (°C)',
      toBase: (v) => v, fromBase: (c) => c,
      forms: [String.raw`[°º˚]\s?C(?:elsius|entigrade)?`, '℃',
        String.raw`(?:[Dd]egrees?|DEGREES?)\s+(?:C|[Cc]elsius|[Cc]entigrade)`, String.raw`[Dd]eg\.?\s?C`,
        W('celsius', 'centigrade'), 'C'] },
    // A bare "75°" or "75 degrees": resolved to °F/°C from the surrounding text, or skipped.
    { id: 'deg', cat: 'temperature', sys: null, ambiguous: true, label: '°', name: 'Degrees (unspecified)',
      forms: ['[°º˚]', W('degrees', 'degree')] },

    // ---- Volume (base: millilitre)
    // UK imperial measures. Must be written with a qualifier ("UK", "imperial", "imp.")
    // unless the page itself is detected as British (see `volumeStandard`).
    { id: 'ukfloz', cat: 'volume', sys: 'uk', factor: 28.4130625, label: 'fl oz', qualified: 'UK fl oz', name: 'Fluid ounces (UK)',
      forms: [String.raw`${UKP}(?:[Ff]l\.?\s?oz|FL\.?\s?OZ|[Ff]luid\s+ounces?)`] },
    { id: 'ukpt', cat: 'volume', sys: 'uk', factor: 568.26125, label: 'pt', qualified: 'UK pt', name: 'Pints (UK)',
      forms: [String.raw`${UKP}(?:[Pp]ints?|PINTS?|pts?)`] },
    { id: 'ukqt', cat: 'volume', sys: 'uk', factor: 1136.5225, label: 'qt', qualified: 'UK qt', name: 'Quarts (UK)',
      forms: [String.raw`${UKP}(?:[Qq]uarts?|QUARTS?|qts?)`] },
    { id: 'ukgal', cat: 'volume', sys: 'uk', factor: 4546.09, label: 'gal', qualified: 'UK gal', name: 'Gallons (UK)',
      forms: [String.raw`${UKP}(?:[Gg]allons?|GALLONS?|gals?)`] },
    // US customary. Unqualified fl oz / pt / qt / gal are US unless the page is British.
    { id: 'floz', cat: 'volume', sys: 'us', ukTwin: 'ukfloz', factor: 29.5735295625, label: 'fl oz', qualified: 'US fl oz',
      name: 'Fluid ounces (US)', forms: [`${USP}(?:[Ff]l\\.?\\s?oz|FL\\.?\\s?OZ|${W('fluid ounces', 'fluid ounce')})`] },
    { id: 'tbsp', cat: 'volume', sys: 'imperial', factor: 14.78676478125, label: 'tbsp', name: 'Tablespoons',
      forms: ['[Tt]bsps?', 'TBSPS?', '[Tt]bs', 'TBS', W('tablespoons', 'tablespoon')] },
    { id: 'tsp', cat: 'volume', sys: 'imperial', factor: 4.92892159375, label: 'tsp', name: 'Teaspoons',
      forms: ['[Tt]sps?', 'TSPS?', W('teaspoons', 'teaspoon')] },
    { id: 'cup', cat: 'volume', sys: 'imperial', factor: 236.5882365, label: 'cup', plural: 'cups', name: 'Cups (US)',
      forms: [W('cups', 'cup')] },
    { id: 'pt', cat: 'volume', sys: 'us', ukTwin: 'ukpt', factor: 473.176473, label: 'pt', qualified: 'US pt',
      name: 'Pints (US)', forms: [`${USP}(?:${W('pints', 'pint')})`, `${USP}pt`] },
    { id: 'qt', cat: 'volume', sys: 'us', ukTwin: 'ukqt', factor: 946.352946, label: 'qt', qualified: 'US qt',
      name: 'Quarts (US)', forms: [`${USP}(?:qts?|QTS?|${W('quarts', 'quart')})`] },
    { id: 'gal', cat: 'volume', sys: 'us', ukTwin: 'ukgal', factor: 3785.411784, label: 'gal', qualified: 'US gal',
      name: 'Gallons (US)', forms: [`${USP}(?:gals?|GALS?|${W('gallons', 'gallon')})`] },
    { id: 'ml', cat: 'volume', sys: 'metric', factor: 1, label: 'mL', name: 'Millilitres',
      forms: ['ml', 'mL', 'ML', W('milliliters', 'milliliter', 'millilitres', 'millilitre')] },
    { id: 'l', cat: 'volume', sys: 'metric', factor: 1000, label: 'L', name: 'Litres',
      forms: [W('liters', 'liter', 'litres', 'litre'), 'ltrs?', 'l', 'L'] },

    // ---- Weight (base: gram)
    { id: 'oz', cat: 'weight', sys: 'imperial', factor: 28.349523125, label: 'oz', name: 'Ounces',
      forms: ['ozs?', 'OZ', W('ounces', 'ounce')] },
    { id: 'lb', cat: 'weight', sys: 'imperial', factor: 453.59237, label: 'lb', name: 'Pounds',
      forms: ['lbs?', 'Lbs?', 'LBS?', W('pounds', 'pound')] },
    { id: 'st', cat: 'weight', sys: 'imperial', factor: 6350.29318, label: 'st', name: 'Stone (14 lb)',
      forms: [W('stone'), 'st'] },
    { id: 'mg', cat: 'weight', sys: 'metric', factor: 0.001, label: 'mg', name: 'Milligrams',
      forms: ['mg', W('milligrams', 'milligram')] },
    { id: 'kg', cat: 'weight', sys: 'metric', factor: 1000, label: 'kg', name: 'Kilograms',
      forms: ['kgs?', 'Kgs?', 'KGS?', W('kilograms', 'kilogram', 'kilogrammes', 'kilogramme', 'kilos', 'kilo')] },
    { id: 'g', cat: 'weight', sys: 'metric', factor: 1, label: 'g', name: 'Grams',
      forms: ['g', W('grams', 'gram', 'grammes', 'gramme')] },

    // ---- Length (base: metre)
    { id: 'mm', cat: 'length', sys: 'metric', factor: 0.001, label: 'mm', name: 'Millimetres',
      forms: ['mm', W('millimeters', 'millimeter', 'millimetres', 'millimetre')] },
    { id: 'cm', cat: 'length', sys: 'metric', factor: 0.01, label: 'cm', name: 'Centimetres',
      forms: ['cm', W('centimeters', 'centimeter', 'centimetres', 'centimetre')] },
    { id: 'km', cat: 'length', sys: 'metric', factor: 1000, label: 'km', name: 'Kilometres',
      forms: ['kms?', 'Kms?', 'KMS?', W('kilometers', 'kilometer', 'kilometres', 'kilometre')] },
    { id: 'm', cat: 'length', sys: 'metric', factor: 1, label: 'm', name: 'Metres',
      forms: [W('meters', 'meter', 'metres', 'metre'), 'm'] },
    { id: 'mi', cat: 'length', sys: 'imperial', factor: 1609.344, label: 'mi', name: 'Miles',
      forms: [W('miles', 'mile'), 'mi'] },
    { id: 'yd', cat: 'length', sys: 'imperial', factor: 0.9144, label: 'yd', name: 'Yards',
      forms: ['yds?', W('yards', 'yard')] },
    { id: 'ft', cat: 'length', sys: 'imperial', factor: 0.3048, label: 'ft', name: 'Feet',
      forms: ['ft', 'Ft', 'FT', W('feet', 'foot'), "['′’]"] },
    { id: 'in', cat: 'length', sys: 'imperial', factor: 0.0254, label: 'in', name: 'Inches',
      forms: [W('inches', 'inch'), 'in', '["″”]'] },
  ];

  const BY_ID = Object.create(null);
  for (const u of UNITS) {
    u.re = new RegExp(`^(?:${u.forms.join('|')})$`, 'u');
    BY_ID[u.id] = u;
  }

  // Auto ("best fit") target units, smallest first. A unit is chosen when the
  // value expressed in it is >= the given minimum; the largest such unit wins.
  const AUTO = {
    length: { metric: [['mm', 0], ['cm', 1], ['m', 1], ['km', 1]], imperial: [['in', 0], ['ft', 3], ['mi', 0.25]] },
    weight: { metric: [['mg', 0], ['g', 1], ['kg', 1]], imperial: [['oz', 0], ['lb', 1]] },
    volume: { metric: [['ml', 0], ['l', 1]], imperial: [['tsp', 0], ['tbsp', 1], ['floz', 2], ['qt', 1], ['gal', 1]],
      uk: [['tsp', 0], ['tbsp', 1], ['ukfloz', 2], ['ukpt', 1], ['ukgal', 1]] },
    temperature: { metric: [['c', 0]], imperial: [['f', 0]] },
    area: { metric: [['sqcm', 0], ['sqm', 1], ['ha', 0.1], ['sqkm', 1]],
      imperial: [['sqin', 0], ['sqft', 1], ['acre', 0.5], ['sqmi', 1]] },
  };
  // UK imperial shares every list with US customary except volume.
  for (const cat of Object.keys(AUTO)) if (!AUTO[cat].uk) AUTO[cat].uk = AUTO[cat].imperial;

  /** Does a unit of system `unitSys` already belong to the user's `system`? */
  function belongsTo(unitSys, system) {
    if (system === 'metric') return unitSys === 'metric';
    if (unitSys === 'imperial') return true; // shared by US and UK (ft, lb, °F, cups…)
    return system === 'uk' ? unitSys === 'uk' : unitSys === 'us';
  }

  /** The user-facing system a target unit implies. */
  function systemOfUnit(u) {
    return u.sys === 'uk' ? 'uk' : u.sys === 'metric' ? 'metric' : 'imperial';
  }

  // ---------------------------------------------------------------------------
  // Detection regex
  // ---------------------------------------------------------------------------

  const UF_MAP = {
    '½': 1 / 2, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 1 / 4, '¾': 3 / 4, '⅕': 1 / 5, '⅖': 2 / 5, '⅗': 3 / 5,
    '⅘': 4 / 5, '⅙': 1 / 6, '⅚': 5 / 6, '⅐': 1 / 7, '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8,
    '⅑': 1 / 9, '⅒': 1 / 10,
  };
  const UF_CHARS = Object.keys(UF_MAP).join('');
  const UF = `[${UF_CHARS}]`;
  const NUM = String.raw`(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)`;
  // mixed number "1 1/2" / "1-1/2" | "1½" | "3/4" | "½" | plain number
  const QTY = String.raw`(?:\d+(?:[  ]|-)\d+[\/⁄]\d+|\d+[  ]?${UF}|\d+[\/⁄]\d+|${UF}|${NUM})`;
  const INQ = String.raw`(?:\d{1,2}[  ]\d+[\/⁄]\d+|\d{1,2}(?:\.\d+)?(?:[  ]?${UF})?|${UF})`;
  const SEP = String.raw`\s*[-–—]\s*|\s+(?:to|through|thru)\s+`;
  const UNIT_ALT = UNITS.flatMap((u) => u.forms).join('|');

  // Feet + inches compounds: "5 ft 10 in", "5 feet 10 inches", "5'10\"", "6′2″", "6'2"
  const FI_WORDS = String.raw`(?<fiFt>\d+(?:\.\d+)?)\s?(?:[Ff]eet|[Ff]oot|ft\.?|Ft\.?|FT\.?)[\s,]{0,2}(?:and\s+)?(?<fiIn>${INQ})\s?(?:[Ii]nch(?:es)?|INCH(?:ES)?|in|["″”])`;
  const FI_SYMBOLS = String.raw`(?<fsFt>\d{1,2})\s?['′’]\s?(?<fsIn>${INQ})(?:\s?["″”])?`;
  // Stone + pounds (UK body weight): "11 st 4 lb", "11st 4lb", "11 stone 4 pounds"
  const ST_LB = String.raw`(?<stSt>\d{1,2})\s?(?:st|[Ss]tone|STONE)[\s,]{0,2}(?:and\s+)?(?<stLb>\d{1,2}(?:\.\d+)?)\s?(?:lbs?|LBS?|[Pp]ounds?)`;

  const MAIN_SRC =
    String.raw`(?<![\p{L}\p{N}_.,:\/⁄°º˚])` +
    `(?:${FI_WORDS}|${FI_SYMBOLS}|${ST_LB}|` +
    `(?<q1>[-−]?${QTY})(?:(?<sep>${SEP})(?<q2>[-−]?${QTY})|(?<dims>(?:\\s*[x×]\\s*${QTY}){1,2}))?` +
    String.raw`(?<gap>\s{0,2}|-)(?<unit>${UNIT_ALT}))` +
    String.raw`(?![\p{L}\p{N}_])`;

  const MAIN_RE = new RegExp(MAIN_SRC, 'gu');
  const QUICK_RE = new RegExp(`[\\d${UF_CHARS}]`);

  const APPROX = String.raw`(?:~|≈|about|approx\.?|ca\.?|circa)?`;
  // Text right after a match already holds a conversion: "10 miles (16 km)", "10 mi / 16 km"
  const AFTER_PAIR_RE = new RegExp(
    String.raw`^\s*[(\[\/]\s*${APPROX}\s*[-−]?${QTY}(?:\s*[-–—]\s*${QTY})?\s{0,2}-?(?:${UNIT_ALT})(?![\p{L}\p{N}])`, 'iu');
  // Text right before a match is "<number> <unit> (" — this match *is* the existing conversion.
  const BEFORE_PAIR_RE = new RegExp(
    String.raw`[\d${UF_CHARS}]\s{0,2}-?(?:${UNIT_ALT})\.?\s*[(\[\/]\s*${APPROX}\s*$`, 'u');

  const CURRENCY_BEFORE_RE = /[$€£¥₹₩₽¢₿]\s*$/;
  const MATH_BEFORE_RE = /(?:[*÷=^√]|[\d)]\s*[+−])\s*$/;
  const MATH_AFTER_RE = /^\s*(?:[*÷=^]|[+−-]\s*[\d(](?![\d.,/ ]*\s?[\p{L}°]))/u;
  const RATE_AFTER_RE = /^\s*(?:\/\s*\p{L}|per\b|an?\s+hour\b)/iu;
  const SYMBOL_UNITS = new Set(['"', '”', '″', "'", '’', '′']);
  const YEAR_SENSITIVE = new Set(['in', 'm', 'mi', 'l', 'L', 'g', 'pt', 'ha', 'st', 'F', 'C', ...SYMBOL_UNITS]);

  // ---- Temperature disambiguation ------------------------------------------
  // Words that make a bare "75F" / "20 C" / "75°" plausibly a temperature.
  const TEMP_CONTEXT_RE =
    /\b(?:temp(?:erature)?s?|weather|forecast|highs?|lows?|heat(?:wave)?|hot(?:ter|test)?|cold(?:er|est)?|warm(?:er|est|ing)?|cool(?:er|est|ing)?|chilly|freez\w*|frost\w*|thaw\w*|oven|bak(?:e|ed|ing)|roast\w*|preheat\w*|grill\w*|degrees?|deg|thermostat|thermometer|fever|climate|celsius|centigrade|fahrenheit|feels\s+like|humid\w*|sunny|cloudy|showers?|rain\w*|snow\w*|wind\s?chill|dew\s?point|boil\w*|simmer\w*|fridge|freezer|refrigerat\w*)\b|[°º˚℃℉]/i;
  // Words right before the number that make a bare letter a label, not a unit: "Apartment 3C", "size 4F".
  const LETTER_LABEL_BEFORE_RE =
    /\b(?:apartment|apt|flat|suite|unit|room|floor|level|seat|row|gate|platform|section|grade|class|size|type|vitamin|key|chord|model|version|rev|form|page|figure|fig|table|exhibit|cup|bra)\.?\s*#?\s*$/i;
  // Explicit °F/°C anywhere in the text tell us what a bare "75°" or "75 degrees" means.
  const TEMP_HINT_RE = /[°º˚]\s?([FC])(?![a-z])|([℉℃])|([Ff]ahrenheit|[Cc]elsius|[Cc]entigrade)|\d\s?([FC])\b/g;
  // A bare degree that is really an angle or a coordinate.
  const ANGLE_AFTER_RE = /^\s*(?:angle|north|south|east|west|[NSEW]\b|lat|long|latitude|longitude|rotation|turn|incline|slope|arc|tilt|pitch|bend|heading|bearing|field\s+of\s+view|fov|camber)/i;
  const ANGLE_BEFORE_RE = /(?:rotat\w*|turn\w*|angle[sd]?|tilt\w*|inclin\w*|slope[sd]?|bearing|heading|pitch|bend\w*|lean\w*|swivel\w*|spin\w*|arc|lat(?:itude)?|long(?:itude)?)\s*(?:by|of|to|at|is|=|:)?\s*(?:about|around|approx\.?|~)?\s*$/i;
  const PLAUSIBLE = { f: [-130, 1000], c: [-90, 550] };

  /** Finds the explicit F/C mention nearest to `pos` in `str` ('f' | 'c' | null). */
  function nearestTemperatureHint(str, pos) {
    let best = null;
    let bestDist = Infinity;
    for (const h of str.matchAll(TEMP_HINT_RE)) {
      const raw = h[1] || h[2] || h[3] || h[4];
      const isF = /^[F℉]|^[Ff]ahrenheit/.test(raw);
      const center = h.index + h[0].length / 2;
      const dist = Math.abs(center - pos);
      if (dist < bestDist) {
        bestDist = dist;
        best = isF ? 'f' : 'c';
      }
    }
    return best;
  }

  /**
   * Decides what an ambiguous temperature means.
   * - bare "F"/"C" ("75F", "20 C"): accepted only with temperature words around it.
   * - bare "75°" / "75 degrees": resolved from the nearest explicit °F/°C mention
   *   (same sentence first, then the surrounding element); angles are rejected.
   * Returns the resolved unit id, or null to skip the match.
   */
  function resolveTemperature(p, before, after, opts) {
    const ctx = () => (opts && typeof opts.getContext === 'function' ? opts.getContext() || '' : '');
    if (p.unit.ambiguous) {
      if (ANGLE_AFTER_RE.test(after) || ANGLE_BEFORE_RE.test(before)) return null;
      let hint = nearestTemperatureHint(`${before} ${after}`, before.length);
      if (!hint) {
        const c = ctx();
        if (c) hint = nearestTemperatureHint(c, c.length / 2);
      }
      return hint;
    }
    // Bare letter
    if (p.gap === '-' || LETTER_LABEL_BEFORE_RE.test(before)) return null;
    if (TEMP_CONTEXT_RE.test(before) || TEMP_CONTEXT_RE.test(after) || TEMP_CONTEXT_RE.test(ctx())) return p.unit.id;
    return null;
  }
  const IN_NEXT_OK_RE =
    /^\s+(?:tall|wide|long|deep|high|thick|across|diameter|dia\b|screen|display|monitor|tv\b|television|laptop|tablet|phone|pan|skillet|pot|wheels?|tires?|tyres?|rims?|pipe|blade|bar\b|board|square|round|x\b|by\b)/i;
  const MILLION_NEXT_RE =
    /^\s+(?:views|users|people|subscribers|followers|downloads|visitors|customers|members|players|copies|units|years|times|dollars|euros|pounds|deals?|records?|streams?|plays?|votes?|jobs|homes|cases)\b/i;
  const POINT_NEXT_RE = /^\s+(?:font|type|text|size|bold|italic|serif|sans|lead|leading|letter)/i;

  // ---------------------------------------------------------------------------
  // Parsing
  // ---------------------------------------------------------------------------

  function parseQty(raw) {
    if (raw == null) return NaN;
    let s = String(raw).trim();
    let sign = 1;
    if (s[0] === '-' || s[0] === '−') {
      sign = -1;
      s = s.slice(1);
    }
    let m;
    if ((m = s.match(/^(\d+)(?:[  ]|-)(\d+)[/⁄](\d+)$/))) {
      const n = +m[2];
      const d = +m[3];
      if (!d || n >= d) return NaN; // "5 10/12" is not a sensible mixed number
      return sign * (+m[1] + n / d);
    }
    if ((m = s.match(new RegExp(`^(\\d*)[ \\u00A0]?(${UF})$`)))) {
      return sign * ((m[1] ? +m[1] : 0) + UF_MAP[m[2]]);
    }
    if ((m = s.match(/^(\d+)[/⁄](\d+)$/))) {
      const d = +m[2];
      if (!d || d > 1000) return NaN;
      return sign * (+m[1] / d);
    }
    if (!/^(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)$/.test(s)) return NaN;
    return sign * parseFloat(s.replace(/,/g, ''));
  }

  function resolveUnit(str) {
    for (const u of UNITS) if (u.re.test(str)) return u;
    return null;
  }

  function parseMatch(m, opts) {
    const g = m.groups;
    if (g.fiFt !== undefined || g.fsFt !== undefined) {
      const ft = parseFloat(g.fiFt ?? g.fsFt);
      const inch = parseQty(g.fiIn ?? g.fsIn);
      if (!Number.isFinite(ft) || !Number.isFinite(inch) || inch >= 12) return null;
      return { kind: 'single', unit: BY_ID.ft, values: [ft + inch / 12], unitStr: 'ft', gap: '', q1: String(ft), compound: true };
    }
    if (g.stSt !== undefined) {
      const st = parseFloat(g.stSt);
      const lb = parseFloat(g.stLb);
      if (!(lb < 14)) return null;
      return { kind: 'single', unit: BY_ID.st, values: [st + lb / 14], unitStr: 'st', gap: '', q1: g.stSt, compound: true };
    }
    let unit = resolveUnit(g.unit);
    if (!unit) return null;
    // Unqualified gallon/pint/quart/fl oz on a British page means the UK measure.
    if (unit.ukTwin && opts && opts.volumeStandard === 'uk' && !/^U\.?S/.test(g.unit)) unit = BY_ID[unit.ukTwin];
    const values = [parseQty(g.q1)];
    let kind = 'single';
    if (g.q2 !== undefined) {
      kind = 'range';
      values.push(parseQty(g.q2));
    } else if (g.dims !== undefined) {
      kind = 'dims';
      for (const part of g.dims.split(/[x×]/).slice(1)) values.push(parseQty(part));
    }
    if (!values.every(Number.isFinite)) return null;
    return { kind, unit, values, unitStr: g.unit, gap: g.gap, q1: g.q1, compound: false };
  }

  // ---------------------------------------------------------------------------
  // Context validation (false-positive filters)
  // ---------------------------------------------------------------------------

  function validate(text, m, p, opts) {
    const start = m.index;
    const end = start + m[0].length;
    const before = text.slice(Math.max(0, start - 60), start);
    const after = text.slice(end, end + 60);
    const u = p.unitStr;

    if (CURRENCY_BEFORE_RE.test(before)) return false; // "$5m", "£3 g"…
    if (MATH_BEFORE_RE.test(before) || MATH_AFTER_RE.test(after)) return false; // "2 + 3 m", "x = 5 m"
    if (RATE_AFTER_RE.test(after)) return false; // "60 km/h", "5 lb per week"
    if (AFTER_PAIR_RE.test(after) || BEFORE_PAIR_RE.test(before)) return false; // already converted on page

    if (!p.compound) {
      // Years / dates followed by an ambiguous short unit: "2019 in review", "1990 m"
      if (p.kind === 'single' && YEAR_SENSITIVE.has(u) && /^(?:1[0-9]|20)\d{2}$/.test(p.q1)) return false;

      if (SYMBOL_UNITS.has(u)) {
        if (p.gap !== '') return false; // symbols must touch the number: 27" not 27 "
        if (/['‘’"“]$/.test(before)) return false; // '5' or "5"
        const head = text.slice(0, start);
        if (u === '"' && (head.split('"').length - 1) % 2 === 1) return false; // closing quote: "Top 10"
        if (u === '”' && head.lastIndexOf('“') > head.lastIndexOf('”')) return false;
        if (u === '’' && head.lastIndexOf('‘') > head.lastIndexOf('’')) return false;
      }
      if (u === 'in' && /^\s+[\p{L}\p{N}]/u.test(after) && !IN_NEXT_OK_RE.test(after)) return false; // "5 in the box"
      if (u === 'm' && p.gap === '' && MILLION_NEXT_RE.test(after)) return false; // "5m views"
      if (u === 'pt' && (!/^\s+$/.test(p.gap) || POINT_NEXT_RE.test(after))) return false; // "12pt font"
      if (u === 'st') {
        // "1st", "21st" are ordinals; "11st" / "11 st" is stone.
        if (p.gap === '-' || (p.gap === '' && /(?:^|[^1])1$/.test(p.q1))) return false;
        if (/^\s*[A-Z]/.test(after) || !p.values.every((v) => v > 0 && v <= 60)) return false; // "5 St Mary's"
      }

      // Temperatures written without an explicit °F/°C need their meaning worked out.
      if (p.unit.cat === 'temperature' && (p.unit.ambiguous || u === 'F' || u === 'C')) {
        const id = resolveTemperature(p, before, after, opts);
        if (!id) return false;
        p.unit = BY_ID[id];
        const [lo, hi] = PLAUSIBLE[id];
        if (!p.values.every((v) => v >= lo && v <= hi)) return false;
      }
    }
    // "40°F below zero" is really -40°F; an annotation inside that phrase would mislead.
    if (p.unit.cat === 'temperature' && /^\s*below\s+(?:zero|freezing)\b/i.test(after)) return false;
    // "10°F warmer", "rose by 5 °C": a temperature *difference* (no 32° offset).
    if (p.unit.cat === 'temperature' && (DELTA_AFTER_RE.test(after) || DELTA_BEFORE_RE.test(before))) p.delta = true;
    return true;
  }

  const DELTA_AFTER_RE =
    /^\s*(?:warmer|colder|cooler|hotter|higher|lower|(?:above|below)(?!\s+(?:zero|freezing))|more|less|of\s+(?:warming|cooling|difference|change)|difference|change|swing|rise|drop|increase|decrease)\b/i;
  const DELTA_BEFORE_RE =
    /\b(?:by|up|down|rise\s+of|drop\s+of|increase\s+of|decrease\s+of|change\s+of|swing\s+of|difference\s+of|warming\s+of|cooling\s+of|plus|minus)\s*(?:about|around|nearly|almost|roughly|another|an?\s+extra)?\s*$|[+±]\s*$/i;

  // ---------------------------------------------------------------------------
  // Conversion + formatting
  // ---------------------------------------------------------------------------

  function toBase(u, v) {
    return u.toBase ? u.toBase(v) : v * u.factor;
  }

  function fromBase(u, b) {
    return u.fromBase ? u.fromBase(b) : b / u.factor;
  }

  function pickAutoUnit(cat, sys, baseAbs) {
    const list = AUTO[cat][sys];
    let chosen = BY_ID[list[0][0]];
    for (const [id, min] of list) {
      const u = BY_ID[id];
      if (u.factor && baseAbs / u.factor >= min) chosen = u;
    }
    return chosen;
  }

  function resolveTarget(unit, baseValues, settings) {
    // 1. Advanced per-unit rule ("miles -> km") — applies even within the same system.
    if (settings.unitRulesEnabled && settings.unitTargets) {
      const rule = settings.unitTargets[unit.id];
      if (rule === 'off') return null;
      const ruled = rule && BY_ID[rule];
      if (ruled && ruled.cat === unit.cat && ruled !== unit) return ruled;
    }
    // 2. Category target, 3. global system.
    const pref = (settings.targets && settings.targets[unit.cat]) || 'auto';
    if (pref === 'off') return null;
    let target = pref !== 'auto' ? BY_ID[pref] : null;
    if (target && target.cat !== unit.cat) target = null;
    // Never convert within the same system (e.g. km -> m for a metric user).
    if (target) return belongsTo(unit.sys, systemOfUnit(target)) ? null : target;
    let system = SYSTEMS.includes(settings.system) ? settings.system : DEFAULT_SETTINGS.system;
    // The UK measures temperature in °C alongside miles, pints and stone.
    if (system === 'uk' && unit.cat === 'temperature') system = 'metric';
    if (belongsTo(unit.sys, system)) return null;
    // US <-> UK volume: keep the same kind of measure (gallon -> UK gallon).
    if (unit.ukTwin && system === 'uk') return BY_ID[unit.ukTwin];
    if (unit.sys === 'uk' && system === 'imperial') return UNITS.find((u) => u.ukTwin === unit.id) || null;
    const maxAbs = Math.max(...baseValues.map(Math.abs));
    return pickAutoUnit(unit.cat, system, maxAbs);
  }

  const formatterCache = new Map();
  function getFormatter(locale, opts) {
    const key = `${locale}|${JSON.stringify(opts)}`;
    let f = formatterCache.get(key);
    if (!f) {
      try {
        f = new Intl.NumberFormat(locale || 'en-US', opts);
      } catch (_) {
        f = new Intl.NumberFormat('en-US', opts);
      }
      formatterCache.set(key, f);
    }
    return f;
  }

  function formatNumber(v, precision, locale) {
    const p = Math.min(6, Math.max(0, Math.trunc(precision) || 0));
    const abs = Math.abs(v);
    let opts = { maximumFractionDigits: p };
    if (abs > 0 && abs < Math.pow(10, -p) / 2) opts = { maximumSignificantDigits: 2 };
    else if (Number(v.toFixed(p)) === 0) v = 0; // avoid "-0"
    return getFormatter(locale, opts).format(v);
  }

  function labelFor(u, formatted, source) {
    // US <-> UK volume conversions must say which gallon/pint is meant: "1 gal (0.83 UK gal)".
    if (u.qualified && (source.sys === 'us' || source.sys === 'uk')) return u.qualified;
    return u.plural && formatted !== '1' ? u.plural : u.label;
  }

  // Temperature differences scale without the 32° offset: Δ1 °F = Δ5/9 °C.
  const DELTA_FACTOR = { f: 5 / 9, c: 1 };

  function convertParsed(p, settings, locale) {
    const toB = (u, v) => (p.delta ? v * DELTA_FACTOR[u.id] : toBase(u, v));
    const fromB = (u, b) => (p.delta ? b / DELTA_FACTOR[u.id] : fromBase(u, b));
    const base = p.values.map((v) => toB(p.unit, v));
    const target = resolveTarget(p.unit, base, settings);
    if (!target) return null;
    const precision = p.unit.cat === 'temperature' ? Math.min(settings.precision, 1) : settings.precision;
    const nums = base.map((b) => formatNumber(fromB(target, b), precision, locale));
    const joiner = p.kind === 'range' ? '–' : p.kind === 'dims' ? ' × ' : '';
    const label = labelFor(target, nums[nums.length - 1], p.unit);
    return { target, text: nums.join(joiner) + (target.attach ? '' : ' ') + label };
  }

  /**
   * Finds every convertible measurement in `text`.
   * @returns {Array<{index:number,length:number,original:string,converted:string,category:string,from:string,to:string}>}
   */
  function findConversions(text, settings, options) {
    const out = [];
    if (!text || !QUICK_RE.test(text)) return out;
    const s = settings || DEFAULT_SETTINGS;
    const locale = (options && options.locale) || 'en-US';
    for (const m of text.matchAll(MAIN_RE)) {
      const parsed = parseMatch(m, options);
      if (!parsed || !validate(text, m, parsed, options)) continue;
      const conv = convertParsed(parsed, s, locale);
      if (!conv) continue;
      out.push({
        index: m.index,
        length: m[0].length,
        original: m[0],
        converted: conv.text,
        category: parsed.unit.cat,
        from: parsed.unit.id,
        to: conv.target.id,
      });
    }
    return out;
  }

  /** Converts a single value (used by the options page and tests). */
  function convertValue(value, fromId, toId) {
    const from = BY_ID[fromId];
    const to = BY_ID[toId];
    if (!from || !to || from.cat !== to.cat) return NaN;
    return fromBase(to, toBase(from, value));
  }

  // ---------------------------------------------------------------------------
  // Settings helpers
  // ---------------------------------------------------------------------------

  function normalizeSettings(raw) {
    const s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    if (!raw || typeof raw !== 'object') return s;
    if (typeof raw.enabled === 'boolean') s.enabled = raw.enabled;
    if (SYSTEMS.includes(raw.system)) s.system = raw.system;
    if (DISPLAY_MODES.includes(raw.displayMode)) s.displayMode = raw.displayMode;
    if (Number.isInteger(raw.precision) && raw.precision >= 0 && raw.precision <= 4) s.precision = raw.precision;
    if (typeof raw.highlight === 'boolean') s.highlight = raw.highlight;
    if (typeof raw.hoverOriginal === 'boolean') s.hoverOriginal = raw.hoverOriginal;
    if (VOLUME_SOURCES.includes(raw.volumeSource)) s.volumeSource = raw.volumeSource;
    if (typeof raw.unitRulesEnabled === 'boolean') s.unitRulesEnabled = raw.unitRulesEnabled;
    if (raw.unitTargets && typeof raw.unitTargets === 'object') {
      for (const [from, to] of Object.entries(raw.unitTargets)) {
        const src = BY_ID[from];
        if (!src || src.ambiguous) continue;
        const dst = BY_ID[to];
        if (to === 'off' || (dst && !dst.ambiguous && dst.cat === src.cat && dst !== src)) s.unitTargets[from] = to;
      }
    }
    if (raw.targets && typeof raw.targets === 'object') {
      for (const { id } of CATEGORIES) {
        const t = raw.targets[id];
        if (t === 'auto' || t === 'off' || (BY_ID[t] && BY_ID[t].cat === id && !BY_ID[t].ambiguous)) s.targets[id] = t;
      }
    }
    return s;
  }

  /**
   * Resolves the `volumeSource` setting to 'us' | 'uk' for one page.
   * 'auto' reads British pages (.uk / .ie / .gb domains, or lang="en-GB" / "en-IE") as UK.
   */
  function resolveVolumeStandard(setting, page) {
    if (setting === 'us' || setting === 'uk') return setting;
    const host = String((page && page.hostname) || '').toLowerCase();
    const lang = String((page && page.lang) || '');
    if (/\.(?:uk|gb|ie)$/.test(host) || /^en[-_](?:GB|UK|IE)\b/i.test(lang)) return 'uk';
    return 'us';
  }

  /** Storage wrapper: prefers storage.sync, falls back to storage.local. */
  function createSettingsStore(api) {
    const areas = [api.storage.sync, api.storage.local].filter(Boolean);
    return {
      async load() {
        for (const area of areas) {
          try {
            const r = await area.get(STORAGE_KEY);
            return normalizeSettings(r && r[STORAGE_KEY]);
          } catch (_) { /* try next area */ }
        }
        return normalizeSettings();
      },
      async save(settings) {
        const value = { [STORAGE_KEY]: normalizeSettings(settings) };
        for (const area of areas) {
          try {
            await area.set(value);
            return;
          } catch (_) { /* try next area */ }
        }
        throw new Error('UnitConv: unable to save settings');
      },
      onChange(callback) {
        api.storage.onChanged.addListener((changes) => {
          if (changes[STORAGE_KEY]) callback(normalizeSettings(changes[STORAGE_KEY].newValue));
        });
      },
    };
  }

  // ---------------------------------------------------------------------------
  // DOM helpers (only run in page contexts)
  // ---------------------------------------------------------------------------

  function createWrapper(doc, match, settings) {
    const mode = settings.displayMode;
    const span = doc.createElement('span');
    span.className = `uc-unit uc-mode-${mode}${settings.highlight ? ' uc-hl' : ''}`;
    // The text exactly as the page wrote it — used for the hover card and for reverting.
    span.dataset.ucOriginal = match.original;
    span.dataset.ucConverted = match.converted;
    // Tooltip mode always needs the hover card; other modes show it unless turned off.
    if (mode === 'tooltip' || settings.hoverOriginal !== false) span.dataset.ucTip = mode;
    if (mode === 'replace') {
      const changed = doc.createElement('span');
      changed.className = 'uc-changed';
      changed.textContent = match.converted;
      span.appendChild(changed);
    } else if (mode === 'tooltip') {
      span.textContent = match.original;
    } else {
      span.appendChild(doc.createTextNode(match.original));
      const note = doc.createElement('span');
      note.className = 'uc-annotation';
      note.appendChild(doc.createTextNode(' ('));
      const changed = doc.createElement('span');
      changed.className = 'uc-changed';
      changed.textContent = match.converted;
      note.appendChild(changed);
      note.appendChild(doc.createTextNode(')'));
      span.appendChild(note);
    }
    return span;
  }

  /** Builds a DocumentFragment for `text` with every match wrapped. */
  function renderMatches(doc, text, matches, settings) {
    const frag = doc.createDocumentFragment();
    let last = 0;
    for (const m of matches) {
      if (m.index > last) frag.appendChild(doc.createTextNode(text.slice(last, m.index)));
      frag.appendChild(createWrapper(doc, m, settings));
      last = m.index + m.length;
    }
    if (last < text.length) frag.appendChild(doc.createTextNode(text.slice(last)));
    return frag;
  }

  /** One shared, fixed-position tooltip driven by event delegation. */
  function createTooltipController(doc) {
    const win = doc.defaultView;
    let el = null;
    let current = null;
    let attached = false;

    function ensure() {
      if (!el || !el.isConnected) {
        el = doc.createElement('div');
        el.id = 'uc-tooltip-popup';
        el.setAttribute('role', 'tooltip');
        doc.documentElement.appendChild(el);
      }
      return el;
    }

    function position(tip, target) {
      const r = target.getBoundingClientRect();
      const w = tip.offsetWidth;
      const h = tip.offsetHeight;
      let top = r.top - h - 8;
      if (top < 4) top = r.bottom + 8;
      const left = Math.min(Math.max(4, r.left + r.width / 2 - w / 2), win.innerWidth - w - 4);
      tip.style.setProperty('top', `${Math.round(top)}px`, 'important');
      tip.style.setProperty('left', `${Math.round(Math.max(4, left))}px`, 'important');
    }

    function row(label, value, strong) {
      const r = doc.createElement('span');
      r.className = `uc-tip-row${strong ? ' uc-tip-strong' : ''}`;
      const l = doc.createElement('span');
      l.className = 'uc-tip-label';
      l.textContent = label;
      const v = doc.createElement('span');
      v.className = 'uc-tip-value';
      v.textContent = value;
      r.append(l, v);
      return r;
    }

    function show(target) {
      const mode = target.dataset.ucTip;
      const original = target.dataset.ucOriginal;
      const converted = target.dataset.ucConverted;
      if (!mode || original == null) return;
      const tip = ensure();
      // Lead with whatever is *not* visible on the page.
      const rows = [row('As written', original, mode !== 'tooltip'), row('Converted', converted, mode === 'tooltip')];
      if (mode === 'tooltip') rows.reverse();
      tip.replaceChildren(...rows);
      current = target;
      position(tip, target);
      tip.classList.add('uc-visible');
    }

    function hide() {
      current = null;
      if (el) el.classList.remove('uc-visible');
    }

    function onOver(e) {
      const t = e.target && e.target.closest ? e.target.closest('.uc-unit[data-uc-tip]') : null;
      if (t && t !== current) show(t);
    }

    function onOut(e) {
      if (!current) return;
      if (e.relatedTarget && current.contains(e.relatedTarget)) return;
      const from = e.target && e.target.closest ? e.target.closest('.uc-unit') : null;
      if (from === current) hide();
    }

    return {
      attach() {
        if (attached) return;
        attached = true;
        doc.addEventListener('mouseover', onOver, true);
        doc.addEventListener('mouseout', onOut, true);
        win.addEventListener('scroll', hide, { capture: true, passive: true });
        win.addEventListener('blur', hide);
      },
      detach() {
        if (!attached) return;
        attached = false;
        doc.removeEventListener('mouseover', onOver, true);
        doc.removeEventListener('mouseout', onOut, true);
        win.removeEventListener('scroll', hide, { capture: true });
        win.removeEventListener('blur', hide);
        hide();
        if (el) el.remove();
        el = null;
      },
    };
  }

  const UnitConv = {
    STORAGE_KEY,
    SYSTEMS,
    SYSTEM_NAMES,
    DISPLAY_MODES,
    VOLUME_SOURCES,
    resolveVolumeStandard,
    CATEGORIES,
    DEFAULT_SETTINGS,
    UNITS,
    UNIT_BY_ID: BY_ID,
    QUICK_RE,
    parseQty,
    findConversions,
    convertValue,
    normalizeSettings,
    createSettingsStore,
    renderMatches,
    createTooltipController,
  };

  global.UnitConv = UnitConv;
  if (typeof module !== 'undefined' && module.exports) module.exports = UnitConv;
})(typeof globalThis !== 'undefined' ? globalThis : this);
