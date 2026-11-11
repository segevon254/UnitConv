/*
 * UnitConv — content script.
 *
 * Scans text nodes with a TreeWalker, converts measurements, and watches the
 * page with a MutationObserver so SPA / infinite-scroll content is handled.
 * Work is batched and run in idle time slices to keep the page responsive.
 */
(() => {
  'use strict';

  if (window.__unitConvLoaded) return;
  window.__unitConvLoaded = true;

  const api = globalThis.browser ?? globalThis.chrome;
  const UC = globalThis.UnitConv;
  if (!api || !UC) return;

  // Elements whose text must never be touched (subtree is skipped entirely).
  const EXCLUDED_TAGS = new Set([
    'script', 'style', 'noscript', 'template', 'head', 'title', 'textarea', 'input', 'select', 'option',
    'button', 'code', 'pre', 'kbd', 'samp', 'var', 'tt', 'svg', 'math', 'canvas', 'iframe', 'object',
    'embed', 'video', 'audio', 'mjx-container',
  ]);
  const EXCLUDED_SELECTOR = [
    ...EXCLUDED_TAGS,
    '[contenteditable]:not([contenteditable="false"])',
    '[role="textbox"]', '[role="code"]', '[role="math"]', '[role="combobox"]', '[role="searchbox"]',
    '.katex', '.MathJax', '.MathJax_Display', '.CodeMirror', '.monaco-editor', '.ace_editor',
    '[data-uc-ignore]', '.uc-unit', '#uc-tooltip-popup',
  ].join(',');
  const EXCLUDED_CLASS_SELECTOR =
    '.katex, .MathJax, .MathJax_Display, .CodeMirror, .monaco-editor, .ace_editor, [data-uc-ignore], ' +
    '[role="textbox"], [role="code"], [role="math"], [role="combobox"], [role="searchbox"], .uc-unit, #uc-tooltip-popup';

  const OBSERVER_OPTIONS = { childList: true, subtree: true, characterData: true };
  const SLICE_MS = 12;

  const store = UC.createSettingsStore(api);
  const tooltip = UC.createTooltipController(document);
  const locale = resolveLocale();

  let settings = UC.normalizeSettings();
  let volumeStandard = 'us';
  let active = false;
  let observer = null;
  const pendingRoots = new Set();
  let textQueue = [];
  let scheduledHandle = null;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function resolveLocale() {
    const candidates = [document.documentElement.lang, navigator.language, 'en-US'];
    for (const c of candidates) {
      if (!c) continue;
      try {
        if (Intl.NumberFormat.supportedLocalesOf(c).length) return c;
      } catch (_) { /* invalid tag */ }
    }
    return 'en-US';
  }

  function isExcludedElement(el) {
    return EXCLUDED_TAGS.has(el.localName) || el.isContentEditable || el.matches(EXCLUDED_CLASS_SELECTOR);
  }

  /** True when `el` or any ancestor is excluded. */
  function isInExcludedContext(el) {
    if (!el) return true;
    return !!el.closest(EXCLUDED_SELECTOR) || el.isContentEditable;
  }

  const walkerFilter = {
    acceptNode(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        return UC.QUICK_RE.test(node.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
      return isExcludedElement(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
    },
  };

  /** Collects candidate text nodes below `root` (read-only pass, no mutation). */
  function collectTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, walkerFilter);
    let node;
    while ((node = walker.nextNode())) textQueue.push(node);
  }

  // ---------------------------------------------------------------------------
  // Scheduling
  // ---------------------------------------------------------------------------

  const hasIdle = typeof window.requestIdleCallback === 'function';

  function schedule() {
    if (scheduledHandle !== null || !active) return;
    scheduledHandle = hasIdle
      ? window.requestIdleCallback(flush, { timeout: 400 })
      : window.setTimeout(() => flush(null), 50);
  }

  function cancelSchedule() {
    if (scheduledHandle === null) return;
    if (hasIdle) window.cancelIdleCallback(scheduledHandle);
    else window.clearTimeout(scheduledHandle);
    scheduledHandle = null;
  }

  function enqueue(node) {
    if (!node) return;
    pendingRoots.add(node);
    schedule();
  }

  function enqueueRecords(records) {
    for (const r of records) {
      if (r.type === 'characterData') {
        enqueue(r.target);
      } else {
        for (const n of r.addedNodes) {
          if (n.nodeType === Node.TEXT_NODE || n.nodeType === Node.ELEMENT_NODE) enqueue(n);
        }
      }
    }
  }

  function absorbPendingRoots() {
    for (const node of pendingRoots) {
      if (!node.isConnected) continue;
      if (node.nodeType === Node.TEXT_NODE) {
        if (UC.QUICK_RE.test(node.data) && !isInExcludedContext(node.parentElement)) textQueue.push(node);
      } else if (!isInExcludedContext(node)) {
        collectTextNodes(node);
      }
    }
    pendingRoots.clear();
  }

  /** Runs one time-boxed slice of work with the observer paused. */
  function flush(deadline) {
    scheduledHandle = null;
    if (!active) return;

    if (observer) {
      enqueueRecords(observer.takeRecords());
      observer.disconnect();
    }
    try {
      absorbPendingRoots();
      // Use the whole idle period the browser grants (<= 50 ms by spec); when the
      // callback fired because of its timeout, take only a short slice.
      const budget = !deadline ? SLICE_MS : deadline.didTimeout ? 8 : Math.max(deadline.timeRemaining(), 4);
      const until = performance.now() + budget;
      let i = 0;
      for (; i < textQueue.length; i++) {
        convertTextNode(textQueue[i]);
        if ((i & 15) === 15 && performance.now() > until) {
          i++;
          break;
        }
      }
      textQueue = i >= textQueue.length ? [] : textQueue.slice(i);
    } finally {
      if (active && observer) observer.observe(document.documentElement, OBSERVER_OPTIONS);
    }
    if (textQueue.length || pendingRoots.size) schedule();
  }

  // ---------------------------------------------------------------------------
  // Conversion
  // ---------------------------------------------------------------------------

  const CONTEXT_BLOCKS = 'p,li,td,th,dd,dt,h1,h2,h3,h4,h5,h6,blockquote,figcaption,caption,label,section,article,div';
  const MAX_CONTEXT_CHILDREN = 40;

  /**
   * Lazily returns the text around `node` (its nearest small block ancestor, up to
   * three levels up). Only used to decide whether a bare "75F" or "75°" is a
   * temperature, so it is computed at most once per node and only when needed.
   */
  function contextGetter(node) {
    let cached;
    return () => {
      if (cached !== undefined) return cached;
      cached = '';
      let el = node.parentElement;
      for (let depth = 0; el && depth < 3; depth++, el = el.parentElement) {
        if (el === document.body || el.childElementCount > MAX_CONTEXT_CHILDREN) break;
        if (el.matches(CONTEXT_BLOCKS) || depth === 2) {
          const t = el.textContent;
          if (t.length > node.data.length + 15) {
            cached = t.slice(0, 600);
            break;
          }
        }
      }
      return cached;
    };
  }

  function convertTextNode(node) {
    if (!node.isConnected) return;
    const parent = node.parentElement;
    if (!parent || parent.closest('.uc-unit')) return;
    const text = node.data;
    const matches = UC.findConversions(text, settings, { locale, volumeStandard, getContext: contextGetter(node) });
    if (!matches.length) return;
    node.replaceWith(UC.renderMatches(document, text, matches, settings));
  }

  function revertAll() {
    for (const el of document.querySelectorAll('span.uc-unit')) {
      const original = el.dataset.ucOriginal;
      el.replaceWith(document.createTextNode(original ?? el.textContent));
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  function start() {
    if (active) return;
    active = true;
    observer = new MutationObserver((records) => enqueueRecords(records));
    observer.observe(document.documentElement, OBSERVER_OPTIONS);
    if (settings.displayMode === 'tooltip' || settings.hoverOriginal) tooltip.attach();
    enqueue(document.body || document.documentElement);
  }

  function stop() {
    active = false;
    cancelSchedule();
    if (observer) observer.disconnect();
    observer = null;
    pendingRoots.clear();
    textQueue = [];
    tooltip.detach();
  }

  function apply(next) {
    settings = next;
    volumeStandard = UC.resolveVolumeStandard(settings.volumeSource, {
      hostname: location.hostname,
      lang: document.documentElement.lang,
    });
    stop();
    revertAll();
    if (settings.enabled) start();
  }

  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== 'unitconv:stats' || window !== window.top) return undefined;
    sendResponse({
      enabled: settings.enabled,
      count: document.querySelectorAll('span.uc-unit').length,
      volumeStandard,
      pending: textQueue.length + pendingRoots.size,
    });
    return undefined;
  });

  store.onChange(apply);
  store.load().then(apply, () => apply(UC.normalizeSettings()));
})();
