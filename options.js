/* UnitConv — options page: system, display mode, per-category targets, per-unit rules, live preview. */
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
    unitRulesEnabled: $('unitRulesEnabled'),
    rules: $('rules'),
    rulesSummary: $('rules-summary'),
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

  // ---- Build the per-unit rule selects (advanced) -----------------------------
  const SYSTEM_GROUPS = [
    ['metric', 'Metric'],
    ['imperial', 'Imperial (US & UK)'],
    ['us', 'US customary'],
    ['uk', 'UK imperial'],
  ];
  const ruleSelects = {};
  const ruleSections = {};

  for (const cat of UC.CATEGORIES) {
    // Metric first, then imperial / US / UK; smallest unit first within each system.
    const SYS_ORDER = { metric: 0, imperial: 1, us: 2, uk: 3 };
    const size = (u) => (u.factor !== undefined ? u.factor : 0);
    const units = UC.UNITS.filter((u) => u.cat === cat.id && !u.ambiguous)
      .sort((a, b) => SYS_ORDER[a.sys] - SYS_ORDER[b.sys] || size(a) - size(b));
    const details = document.createElement('details');
    details.className = 'rule-group';
    const summary = document.createElement('summary');
    const title = document.createElement('span');
    title.textContent = cat.name;
    const count = document.createElement('span');
    count.className = 'rule-count';
    summary.append(title, count);
    details.appendChild(summary);

    const table = document.createElement('table');
    table.className = 'targets';
    const tbody = document.createElement('tbody');
    for (const src of units) {
      const row = document.createElement('tr');
      const labelCell = document.createElement('td');
      const selectCell = document.createElement('td');
      const select = document.createElement('select');
      select.id = `rule-${src.id}`;
      const label = document.createElement('label');
      label.htmlFor = select.id;
      label.textContent = `${src.name} (${src.label})`;
      labelCell.appendChild(label);

      select.appendChild(new Option('Default — follow settings above', ''));
      select.appendChild(new Option('Don’t convert', 'off'));
      for (const [sys, groupName] of SYSTEM_GROUPS) {
        const targets = units.filter((u) => u.sys === sys && u !== src);
        if (!targets.length) continue;
        const group = document.createElement('optgroup');
        group.label = `→ ${groupName}`;
        for (const t of targets) group.appendChild(new Option(`→ ${t.name} (${t.qualified || t.label})`, t.id));
        select.appendChild(group);
      }
      ruleSelects[src.id] = select;
      selectCell.appendChild(select);
      row.append(labelCell, selectCell);
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    details.appendChild(table);
    ruleSections[cat.id] = { details, count, ids: units.map((u) => u.id) };
    form.rules.appendChild(details);
  }

  function renderRuleState() {
    const enabled = form.unitRulesEnabled.checked;
    form.rules.classList.toggle('rules-disabled', !enabled);
    let total = 0;
    for (const { details, count, ids } of Object.values(ruleSections)) {
      const n = ids.filter((id) => ruleSelects[id].value).length;
      total += n;
      count.textContent = n ? `${n} rule${n === 1 ? '' : 's'}` : '';
      if (n) details.open = true;
      for (const id of ids) ruleSelects[id].classList.toggle('rule-set', !!ruleSelects[id].value);
    }
    form.rulesSummary.textContent = total
      ? `${total} custom rule${total === 1 ? '' : 's'}${enabled ? '' : ' (paused — switch on to use them)'}`
      : 'No custom rules yet.';
  }

  // ---- Render / read --------------------------------------------------------
  function render() {
    form.enabled.checked = settings.enabled;
    form.highlight.checked = settings.highlight;
    form.hoverOriginal.checked = settings.hoverOriginal;
    form.volumeSource.value = settings.volumeSource;
    form.unitRulesEnabled.checked = settings.unitRulesEnabled;
    for (const [id, select] of Object.entries(ruleSelects)) select.value = settings.unitTargets[id] || '';
    renderRuleState();
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
    const unitTargets = {};
    for (const [id, select] of Object.entries(ruleSelects)) if (select.value) unitTargets[id] = select.value;
    return UC.normalizeSettings({
      enabled: form.enabled.checked,
      system: checked('system')?.value,
      displayMode: checked('displayMode')?.value,
      precision: Number(form.precision.value),
      highlight: form.highlight.checked,
      hoverOriginal: form.hoverOriginal.checked,
      volumeSource: form.volumeSource.value,
      unitRulesEnabled: form.unitRulesEnabled.checked,
      unitTargets,
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
    renderRuleState();
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

  $('clear-rules').addEventListener('click', () => {
    for (const select of Object.values(ruleSelects)) select.value = '';
    save();
  });

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
