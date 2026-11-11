/* UnitConv — toolbar popup: master ON/OFF switch, page stats and settings shortcut. */
(() => {
  'use strict';

  const api = globalThis.browser ?? globalThis.chrome;
  const UC = globalThis.UnitConv;
  const store = UC.createSettingsStore(api);

  const $ = (id) => document.getElementById(id);
  const enabledEl = $('enabled');
  const summaryEl = $('system-summary');
  const statsEl = $('stats');
  const ALL_SITES = { origins: ['<all_urls>'] };
  const MODE_NAMES = { annotate: 'inline annotation', replace: 'direct replacement', tooltip: 'hover tooltip' };

  let settings = UC.normalizeSettings();

  function render() {
    enabledEl.checked = settings.enabled;
    const system = settings.system === 'metric' ? 'Metric' : 'Imperial (US)';
    summaryEl.textContent = settings.enabled
      ? `${system} · ${MODE_NAMES[settings.displayMode]}`
      : 'Paused on all pages';
  }

  async function activeTabId() {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    return tab && tab.id;
  }

  async function refreshStats() {
    try {
      const tabId = await activeTabId();
      if (tabId == null) throw new Error('no tab');
      const res = await api.tabs.sendMessage(tabId, { type: 'unitconv:stats' }, { frameId: 0 });
      if (!res) throw new Error('no response');
      if (!res.enabled) statsEl.textContent = 'Conversions are turned off.';
      else if (res.count === 0) statsEl.textContent = res.pending ? 'Scanning this page…' : 'No convertible units on this page.';
      else statsEl.textContent = `${res.count} measurement${res.count === 1 ? '' : 's'} converted on this page.`;
    } catch (_) {
      // Browser-internal pages, the web store, or tabs opened before install.
      statsEl.textContent = 'UnitConv can’t run on this page (or it needs a reload).';
    }
  }

  async function checkPermissions() {
    if (!api.permissions || !api.permissions.contains) return;
    try {
      $('permission-banner').hidden = await api.permissions.contains(ALL_SITES);
    } catch (_) { /* ignore */ }
  }

  enabledEl.addEventListener('change', async () => {
    settings = { ...settings, enabled: enabledEl.checked };
    render();
    await store.save(settings);
    setTimeout(refreshStats, 400);
  });

  $('open-options').addEventListener('click', () => {
    api.runtime.openOptionsPage();
    window.close();
  });

  // Firefox MV3 treats host permissions as opt-in; offer a one-click grant.
  $('grant').addEventListener('click', async () => {
    try {
      const granted = await api.permissions.request(ALL_SITES);
      if (granted) $('permission-banner').hidden = true;
    } catch (_) { /* user dismissed */ }
  });

  store.onChange((next) => {
    settings = next;
    render();
  });

  (async () => {
    settings = await store.load();
    render();
    await Promise.all([refreshStats(), checkPermissions()]);
  })();
})();
