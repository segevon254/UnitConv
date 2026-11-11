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
  const SYSTEMS = ['metric', 'imperial'];
  const DISPLAY_MODES = ['annotate', 'replace', 'tooltip'];

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
        String.raw`[Dd]eg\.?\s?F`, W('fahrenheit')] },
    { id: 'c', cat: 'temperature', sys: 'metric', label: '°C', attach: true, name: 'Celsius (°C)',
      toBase: (v) => v, fromBase: (c) => c,
      forms: [String.raw`[°º˚]\s?C(?:elsius|entigrade)?`, '℃',
        String.raw`(?:[Dd]egrees?|DEGREES?)\s+(?:C|[Cc]elsius|[Cc]entigrade)`, String.raw`[Dd]eg\.?\s?C`,
        W('celsius', 'centigrade')] },

    // ---- Volume (base: millilitre). Imperial = US customary.
    { id: 'floz', cat: 'volume', sys: 'imperial', factor: 29.5735295625, label: 'fl oz', name: 'Fluid ounces (US)',
      forms: [String.raw`[Ff]l\.?\s?oz`, String.raw`FL\.?\s?OZ`, W('fluid ounces', 'fluid ounce')] },
    { id: 'tbsp', cat: 'volume', sys: 'imperial', factor: 14.78676478125, label: 'tbsp', name: 'Tablespoons (US)',
      forms: ['[Tt]bsps?', 'TBSPS?', '[Tt]bs', 'TBS', W('tablespoons', 'tablespoon')] },
    { id: 'tsp', cat: 'volume', sys: 'imperial', factor: 4.92892159375, label: 'tsp', name: 'Teaspoons (US)',
      forms: ['[Tt]sps?', 'TSPS?', W('teaspoons', 'teaspoon')] },
    { id: 'cup', cat: 'volume', sys: 'imperial', factor: 236.5882365, label: 'cup', plural: 'cups', name: 'Cups (US)',
      forms: [W('cups', 'cup')] },
    { id: 'pt', cat: 'volume', sys: 'imperial', factor: 473.176473, label: 'pt', name: 'Pints (US)',
      forms: [W('pints', 'pint'), 'pt'] },
    { id: 'qt', cat: 'volume', sys: 'imperial', factor: 946.352946, label: 'qt', name: 'Quarts (US)',
      forms: ['qts?', 'QTS?', W('quarts', 'quart')] },
    { id: 'gal', cat: 'volume', sys: 'imperial', factor: 3785.411784, label: 'gal', name: 'Gallons (US)',
      forms: ['gals?', 'GALS?', W('gallons', 'gallon')] },
    { id: 'ml', cat: 'volume', sys: 'metric', factor: 1, label: 'mL', name: 'Millilitres',
      forms: ['ml', 'mL', 'ML', W('milliliters', 'milliliter', 'millilitres', 'millilitre')] },
    { id: 'l', cat: 'volume', sys: 'metric', factor: 1000, label: 'L', name: 'Litres',
      forms: [W('liters', 'liter', 'litres', 'litre'), 'ltrs?', 'l', 'L'] },

    // ---- Weight (base: gram)
    { id: 'oz', cat: 'weight', sys: 'imperial', factor: 28.349523125, label: 'oz', name: 'Ounces',
      forms: ['ozs?', 'OZ', W('ounces', 'ounce')] },
    { id: 'lb', cat: 'weight', sys: 'imperial', factor: 453.59237, label: 'lb', name: 'Pounds',
      forms: ['lbs?', 'Lbs?', 'LBS?', W('pounds', 'pound')] },
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
    volume: { metric: [['ml', 0], ['l', 1]], imperial: [['tsp', 0], ['tbsp', 1], ['floz', 2], ['qt', 1], ['gal', 1]] },
    temperature: { metric: [['c', 0]], imperial: [['f', 0]] },
    area: { metric: [['sqcm', 0], ['sqm', 1], ['ha', 0.1], ['sqkm', 1]],
      imperial: [['sqin', 0], ['sqft', 1], ['acre', 0.5], ['sqmi', 1]] },
  };

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

  const MAIN_SRC =
    String.raw`(?<![\p{L}\p{N}_.,:\/⁄])` +
    `(?:${FI_WORDS}|${FI_SYMBOLS}|` +
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
  const YEAR_SENSITIVE = new Set(['in', 'm', 'mi', 'l', 'L', 'g', 'pt', 'ha', ...SYMBOL_UNITS]);
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

  function parseMatch(m) {
    const g = m.groups;
    if (g.fiFt !== undefined || g.fsFt !== undefined) {
      const ft = parseFloat(g.fiFt ?? g.fsFt);
      const inch = parseQty(g.fiIn ?? g.fsIn);
      if (!Number.isFinite(ft) || !Number.isFinite(inch) || inch >= 12) return null;
      return { kind: 'single', unit: BY_ID.ft, values: [ft + inch / 12], unitStr: 'ft', gap: '', q1: String(ft), compound: true };
    }
    const unit = resolveUnit(g.unit);
    if (!unit) return null;
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

  function validate(text, m, p) {
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
    }
    return true;
  }

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
    const pref = (settings.targets && settings.targets[unit.cat]) || 'auto';
    if (pref === 'off') return null;
    let target = pref !== 'auto' ? BY_ID[pref] : null;
    if (target && target.cat !== unit.cat) target = null;
    if (target) return target.sys === unit.sys ? null : target; // never convert within the same system
    const system = SYSTEMS.includes(settings.system) ? settings.system : DEFAULT_SETTINGS.system;
    if (unit.sys === system) return null;
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

  function labelFor(u, formatted) {
    return u.plural && formatted !== '1' ? u.plural : u.label;
  }

  function convertParsed(p, settings, locale) {
    const base = p.values.map((v) => toBase(p.unit, v));
    const target = resolveTarget(p.unit, base, settings);
    if (!target) return null;
    const precision = p.unit.cat === 'temperature' ? Math.min(settings.precision, 1) : settings.precision;
    const nums = base.map((b) => formatNumber(fromBase(target, b), precision, locale));
    const joiner = p.kind === 'range' ? '–' : p.kind === 'dims' ? ' × ' : '';
    const label = labelFor(target, nums[nums.length - 1]);
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
      const parsed = parseMatch(m);
      if (!parsed || !validate(text, m, parsed)) continue;
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
    if (raw.targets && typeof raw.targets === 'object') {
      for (const { id } of CATEGORIES) {
        const t = raw.targets[id];
        if (t === 'auto' || t === 'off' || (BY_ID[t] && BY_ID[t].cat === id)) s.targets[id] = t;
      }
    }
    return s;
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
    span.dataset.ucOriginal = match.original;
    if (mode === 'replace') {
      span.textContent = match.converted;
      span.dataset.ucTip = `Original: ${match.original}`;
    } else if (mode === 'tooltip') {
      span.textContent = match.original;
      span.dataset.ucTip = match.converted;
    } else {
      span.appendChild(doc.createTextNode(match.original));
      const note = doc.createElement('span');
      note.className = 'uc-annotation';
      note.textContent = ` (${match.converted})`;
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

    function show(target) {
      const text = target.dataset.ucTip;
      if (!text) return;
      const tip = ensure();
      tip.textContent = text;
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
    DISPLAY_MODES,
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
