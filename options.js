/* UnitConv — options page: global system, display mode, per-category targets, live preview. */
(() => {
  'use strict';

  const api = globalThis.browser ?? globalThis.chrome;
  const UC = globalThis.UnitConv;
  const store = UC.createSettingsStore(api);
  const tooltip = UC.createTooltipController(document);

  const $ = (id) => document.getElementById(id);
  const form = {
    enabled: $('enabled'),
    precision: $('precision'),
    highlight: $('highlight'),
    hoverOriginal: $('hoverOriginal'),
    volumeSource: $('volumeSource'),
    targets: $('targets'),
    sample: $('sample'),
    preview: $('preview'),
    status: $('status'),
  };

  let settings = UC.normalizeSettings();
  let statusTimer = null;

  // ---- Build the per-category target selects -------------------------------
  const selects = {};
  for (const cat of UC.CATEGORIES) {
    const row = document.createElement('tr');
    const labelCell = document.createElement('td');
    const selectCell = document.createElement('td');
    const select = document.createElement('select');
    select.id = `target-${cat.id}`;
    select.dataset.category = cat.id;

    const label = document.createElement('label');
    label.htmlFor = select.id;
    label.textContent = cat.name;
    labelCell.appendChild(label);

    select.appendChild(new Option('Auto — follow preferred system', 'auto'));
    select.appendChild(new Option('Don’t convert this category', 'off'));
    const GROUPS = [
      ['metric', 'Always convert to (metric)'],
      ['imperial', 'Always convert to (imperial — US & UK)'],
      ['us', 'Always convert to (US customary)'],
      ['uk', 'Always convert to (UK imperial)'],
    ];
    for (const [sys, title] of GROUPS) {
      const units = UC.UNITS.filter((u) => u.cat === cat.id && u.sys === sys && !u.ambiguous);
      if (!units.length) continue;
      const group = document.createElement('optgroup');
      group.label = title;
      for (const u of units) group.appendChild(new Option(`${u.name} — ${u.label}`, u.id));
      select.appendChild(group);
    }
    selects[cat.id] = select;
    selectCell.appendChild(select);
    row.append(labelCell, selectCell);
    form.targets.appendChild(row);
  }

  // ---- Render / read --------------------------------------------------------
  function render() {
    form.enabled.checked = settings.enabled;
    form.highlight.checked = settings.highlight;
    form.hoverOriginal.checked = settings.hoverOriginal;
    form.volumeSource.value = settings.volumeSource;
    form.precision.value = String(settings.precision);
    for (const el of document.querySelectorAll('input[name="system"]')) el.checked = el.value === settings.system;
    for (const el of document.querySelectorAll('input[name="displayMode"]')) el.checked = el.value === settings.displayMode;
    for (const [cat, select] of Object.entries(selects)) select.value = settings.targets[cat];
    renderPreview();
  }

  function readForm() {
    const checked = (name) => document.querySelector(`input[name="${name}"]:checked`);
    const targets = {};
    for (const [cat, select] of Object.entries(selects)) targets[cat] = select.value;
    return UC.normalizeSettings({
      enabled: form.enabled.checked,
      system: checked('system')?.value,
      displayMode: checked('displayMode')?.value,
      precision: Number(form.precision.value),
      highlight: form.highlight.checked,
      hoverOriginal: form.hoverOriginal.checked,
      volumeSource: form.volumeSource.value,
      targets,
    });
  }

  function renderPreview() {
    const text = form.sample.value;
    const previewSettings = { ...settings, enabled: true };
    const frag = document.createDocumentFragment();
    let total = 0;
    const volumeStandard = UC.resolveVolumeStandard(settings.volumeSource, { lang: navigator.language });
    text.split('\n').forEach((line, i) => {
      if (i) frag.appendChild(document.createTextNode('\n'));
      const matches = UC.findConversions(line, previewSettings, {
        locale: navigator.language,
        volumeStandard,
        getContext: () => text,
      });
      total += matches.length;
      frag.appendChild(UC.renderMatches(document, line, matches, previewSettings));
    });
    form.preview.replaceChildren(frag);
    form.preview.title = `${total} conversion${total === 1 ? '' : 's'}`;
    if (settings.displayMode === 'tooltip' || settings.hoverOriginal) tooltip.attach();
    else tooltip.detach();
  }

  function flashStatus(message) {
    form.status.textContent = message;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { form.status.textContent = ''; }, 1800);
  }

  async function save() {
    settings = readForm();
    renderPreview();
    try {
      await store.save(settings);
      flashStatus('Saved ✓');
    } catch (err) {
      flashStatus('Could not save settings.');
      console.error(err);
    }
  }

  // ---- Events -----------------------------------------------------------------
  document.querySelector('main').addEventListener('change', (e) => {
    if (e.target !== form.sample) save();
  });
  form.sample.addEventListener('input', renderPreview);

  $('reset').addEventListener('click', async () => {
    settings = UC.normalizeSettings();
    render();
    await store.save(settings);
    flashStatus('Defaults restored ✓');
  });

  // Keep in sync if the popup (or another options tab) changes something.
  store.onChange((next) => {
    if (JSON.stringify(next) === JSON.stringify(settings)) return;
    settings = next;
    render();
  });

  store.load().then((loaded) => {
    settings = loaded;
    render();
  });
})();
