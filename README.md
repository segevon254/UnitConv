# UnitConv: automatic unit converter (Chrome and Firefox, Manifest V3)

UnitConv finds measurements on any web page and converts them to the units you prefer.

```
The loop is 5-10 miles (8.05–16.09 km) long, climbs 1,200 ft (365.76 m), and it was 75°F (23.9°C).
Recipe: 1 1/2 cups (354.88 mL) flour, ½ cup (118.29 mL) sugar, 8 oz (226.8 g) butter.
```

## Features

| | |
|---|---|
| **Categories** | Length (in, ft, yd, mi, mm, cm, m, km), weight (oz, lb, stone, mg, g, kg), temperature (°F, °C), volume (tsp, tbsp, cups, US and UK fl oz/pt/qt/gal, mL, L), area (sq in, sq ft, acres, sq mi, cm², m², ha, km²) |
| **Systems** | Metric, US customary, or UK imperial. UK imperial uses British pints, quarts, gallons and fl oz, shares miles, feet and pounds with US customary, and keeps temperatures in °C. |
| **US vs UK volumes** | Units written with a qualifier are read as written (`5 US gallons`, `2 UK pints`, `10 imperial gallons`, `3 imp. gal`). Unqualified gallons, pints, quarts and fl oz are read as UK on British sites (`.uk`/`.ie` domains or `lang="en-GB"`) and as US elsewhere. You can force either in Settings. Converting between them names the standard: `1 gallon (0.83 UK gal)`. |
| **Stone** | `12 stone`, `13 st`, `11 st 4 lb`, `11st 4lb`. Ordinals (`1st`, `21st`) and street names (`5 St Mary`) are skipped. |
| **Temperature detection** | Explicit forms (`75°F`, `20 °C`, `℉`, `degrees Fahrenheit`) always convert. A bare `75F` or `20 C` converts only when temperature words appear nearby in the sentence or surrounding element (*forecast, high/low, oven, bake, weather, degrees*…). Labels like `Apartment 3C`, `size 4F` and `Vitamin C` are skipped. A bare `75°` or `75 degrees` takes its unit from the nearest explicit °F/°C mention, e.g. a widget headed *Weather (°F)*; angles and coordinates (`rotate 90°`, `40.7° N`) are skipped. Differences (`10 degrees warmer`, `rose by 5 °C`) convert without the 32° offset. |
| **Number formats** | Decimals and thousands separators (`1,200.5`), negative values (`-5°F`), ranges (`5-10 miles`, `5 to 10 mi`, `70–75°F`), fractions (`3/4`, `1 1/2`, `1-1/2`, `½`, `1½`), dimensions (`12 x 10 ft`), feet and inches (`5'10"`, `6 ft 2 in`, `6′2″`), hyphenated forms (`10-foot pole`) |
| **Unit spellings** | Abbreviations, full names, plurals, and UPPER/Title case (`mi`, `mile`, `Miles`, `MILES`; `°F`, `℉`, `degrees Fahrenheit`) |
| **False-positive guards** | Skips dates and years (`in 2020`, `2019 in review`), prepositions (`5 in the morning`), money (`$5m`), rates (`60 km/h`, `30 miles per hour`), math (`2 + 3 = 5 m`), typography (`12pt font`), quoted numbers (`"Top 10"`), version numbers (`1.2.3`), and values the page already converted (`10 miles (16 km)`) |
| **Display modes** | Inline annotation: `10 miles (16.09 km)`<br>Direct replacement: `16.09 km`<br>Hover tooltip: the text stays the same and hovering shows the conversion |
| **Per-unit rules (advanced)** | Choose what each unit converts to, one by one: *miles → km*, *feet → cm*, *km → m*, *pounds → ounces*, *°F → don't convert*… A rule beats the category and system settings (even within the same system). The whole set can be paused with one switch without losing it. |
| **Highlight & hover** | Changed text gets a soft marker highlight in every mode. Hovering any converted value shows a card with the original exactly as the page wrote it (*As written*) and the conversion. Both can be turned off. |
| **Preferences** | A global system (metric, US customary or UK imperial), plus a per-category target: *Auto* (best-fit unit), *Off*, or a fixed unit. Also decimal places (0–4) and highlighting. |
| **Performance** | TreeWalker scanning, a MutationObserver for SPAs and infinite scroll, and idle-time batching. In testing, 5,000 rows (about 10,000 conversions) took ~0.5 s with no long tasks over 50 ms. |
| **Safety** | Never touches `input`, `textarea`, `select`, `button`, `[contenteditable]`, `code`, `pre`, `kbd`, `script`, `style`, `svg`, `math`, KaTeX/MathJax, or code editors (CodeMirror, Monaco, Ace). Every change can be reverted. |

## File structure

```
UnitConv/
├── manifest.json      MV3 manifest (works in Chrome and Firefox)
├── converter.js       Shared engine: unit table, detection regex, conversion, formatting, settings
├── content.js         DOM scanning (TreeWalker), MutationObserver, idle-time batching, revert
├── styles.css         Styles injected into pages (annotations, highlight, tooltip)
├── popup.html / .js   Toolbar popup: master ON/OFF switch, page stats, Open Settings
├── options.html / .js Settings page with a live preview
├── ui.css             Styles for the popup and settings page only (never injected into sites)
├── icons/             16/32/48/128 px icons
└── tests/             Node test-suite for the engine (not needed at runtime)
```

`converter.js` does not touch the DOM. It is shared by the content script, the popup, and the options page, and the Node tests can load it directly. No background script or service worker is needed: settings live in `storage.sync`, and every open tab reacts to `storage.onChanged`. This also avoids the main MV3 difference between Chrome and Firefox (`background.service_worker` vs `background.scripts`).

## Installation

### Google Chrome (also Edge, Brave, Opera, and other Chromium browsers)

1. Download or clone this repository to a folder on your computer.
2. Open **`chrome://extensions`** (Edge: `edge://extensions`).
3. Turn on **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the `UnitConv` folder (the one that contains `manifest.json`).
5. Pin the extension: click the puzzle-piece icon in the toolbar, then the pin next to **UnitConv**.
6. Reload any tabs that were already open. Content scripts are only injected into pages loaded after installation.

After editing the code, click the ↻ reload icon on the extension's card, then reload your tabs.

### Mozilla Firefox (128 or newer)

**Temporary install (for development; removed when Firefox restarts):**

1. Open **`about:debugging#/runtime/this-firefox`**.
2. Click **Load Temporary Add-on…**.
3. Select the **`manifest.json`** file inside the `UnitConv` folder.
4. **Grant site access.** Firefox treats host permissions in MV3 as opt-in, so do one of these:
   - Click the UnitConv toolbar icon and press **Grant access to websites** in the popup, or
   - Go to `about:addons` → UnitConv → **Permissions** and turn on *Access your data for all websites*.
5. Reload the tabs you want converted.

**Permanent install:** Firefox release builds only install signed add-ons. Run `npm run build` to create a zip in `web-ext-artifacts/`, then upload it to [addons.mozilla.org](https://addons.mozilla.org/developers/) for signing (you can choose *unlisted* for private use). Firefox Developer Edition and Nightly can also install unsigned builds if you set `xpinstall.signatures.required` to `false` in `about:config`.

> Before publishing to AMO, change `browser_specific_settings.gecko.id` in `manifest.json` to an ID you own (e.g. `unitconv@yourdomain.com`).

## Using it

- **Popup:** use the master switch to turn UnitConv on or off everywhere (pages update immediately, with no reload). The popup also shows how many measurements were converted on the current tab, and has an **Open Settings** button.
- **Settings:**
  - *Preferred system:* Metric or Imperial (US).
  - *Display mode:* inline annotation, direct replacement, or hover tooltip.
  - *Decimal places* and *highlight converted values*.
  - *Target units per category:*
    - `Auto` picks the best-fitting unit, e.g. `5 in → 12.7 cm` but `10 mi → 16.09 km`.
    - `Don't convert` disables that category.
    - A fixed unit (e.g. always `cm`) always converts into that unit. A fixed unit from the other system reverses the direction for that category only (e.g. metric everywhere but temperatures in °F).
  - *Advanced: convert each unit individually:* turn on the switch, open a category, and pick a target (or *Don't convert*) for any unit. Units left on *Default* follow the settings above. *Clear all rules* resets them.
  - *Live preview:* type any text to see what will be detected.

Units that are already in your target system are normally left alone. For example, a metric user won't see `5 km` changed into `5000 m`, unless they add a per-unit rule for that.

Which setting decides: **per-unit rule** (if the advanced switch is on) → **category target** → **preferred system**.

## Development

```bash
npm test       # 99 engine tests (node:test, no dependencies)
npm run lint   # Mozilla web-ext lint (manifest + code checks)
npm run build  # zip for AMO / Chrome Web Store in web-ext-artifacts/
```

To exclude a part of your own page from conversion, add the `data-uc-ignore` attribute to it.

## Known limitations

- Cups, teaspoons and tablespoons are always US measures.
- Ambiguous short forms are matched conservatively. For example, `in` is only treated as inches when it isn't followed by another word (unless that word is something like *tall*, *wide*, *screen*, or *display*), and `pt` needs a space before it.
- A bare `75F` with no temperature words around it, or a bare `75°` with no °F/°C anywhere nearby, is left alone rather than guessed.
- Text inside closed shadow DOM, `<canvas>`, and images can't be read.
- Like every in-page translator, UnitConv splits text nodes. On framework-driven pages (e.g. React), a value that updates live *in the same text node* after conversion (like a ticking counter) can stay frozen at its converted value. Newly rendered content is still converted as normal. Toggling UnitConv off and on refreshes the page state.
