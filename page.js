// Injected into the captured tab (isolated world). Exposes helpers on
// globalThis.__webShot that background.js calls via chrome.scripting.
(() => {
  const state = {
    styleEl: null,
    scrollX: 0,
    scrollY: 0,
    // [{el, prop, value, priority}] — inline styles to restore afterwards
    overrides: [],
  };

  const scroller = () => document.scrollingElement || document.documentElement;

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function override(el, prop, value) {
    state.overrides.push({
      el,
      prop,
      value: el.style.getPropertyValue(prop),
      priority: el.style.getPropertyPriority(prop),
    });
    el.style.setProperty(prop, value, 'important');
  }

  function pageHeight() {
    const s = scroller();
    return Math.max(s.scrollHeight, document.body ? document.body.scrollHeight : 0);
  }

  function metrics() {
    return {
      viewportWidth: document.documentElement.clientWidth || innerWidth,
      viewportHeight: document.documentElement.clientHeight || innerHeight,
      pageHeight: pageHeight(),
      scrollY: scroller().scrollTop,
    };
  }

  function prepare() {
    state.scrollX = scrollX;
    state.scrollY = scrollY;
    state.overrides = [];

    const style = document.createElement('style');
    style.textContent = `
      html, body { scroll-behavior: auto !important; scrollbar-width: none !important; }
      ::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
    `;
    (document.head || document.documentElement).appendChild(style);
    state.styleEl = style;

    // Sticky elements would repeat in every frame; make them flow normally.
    // `static` keeps the same layout space as sticky, unlike `relative` + top.
    for (const el of document.querySelectorAll('body *')) {
      if (getComputedStyle(el).position === 'sticky') override(el, 'position', 'static');
    }
    return metrics();
  }

  // Fixed elements follow the viewport, so they would repeat in every frame.
  // Ones anchored near the top (headers) are shown only in the first frame,
  // the rest (banners, chat buttons, cookie bars) only in the last one.
  // Rescanned on every call because some appear only after scrolling.
  const fixedEls = new Map(); // el -> 'top' | 'bottom'

  function setFixedVisibility(showTop, showBottom) {
    const vh = document.documentElement.clientHeight || innerHeight;
    for (const el of document.querySelectorAll('body *')) {
      if (fixedEls.has(el) || getComputedStyle(el).position !== 'fixed') continue;
      const r = el.getBoundingClientRect();
      fixedEls.set(el, (r.top + r.bottom) / 2 < vh * 0.4 ? 'top' : 'bottom');
    }
    for (const [el, group] of fixedEls) {
      const show = group === 'top' ? showTop : showBottom;
      if (show && el.__webShotHidden) {
        const o = el.__webShotHidden;
        el.style.setProperty('visibility', o.value, o.priority);
        el.__webShotHidden = null;
      } else if (!show && !el.__webShotHidden) {
        el.__webShotHidden = {
          value: el.style.getPropertyValue('visibility'),
          priority: el.style.getPropertyPriority('visibility'),
        };
        el.style.setProperty('visibility', 'hidden', 'important');
      }
    }
  }

  async function settle(ms) {
    await nextFrame();
    await nextFrame();
    if (ms) await sleep(ms);
  }

  async function scrollToY(y) {
    window.scrollTo({ left: 0, top: y, behavior: 'instant' });
    await settle(150); // let lazy images and scroll-driven animations settle
    return metrics();
  }

  async function showFixed(showTop, showBottom) {
    setFixedVisibility(showTop, showBottom);
    await settle(0);
  }

  function restore() {
    setFixedVisibility(true, true);
    fixedEls.clear();
    for (const o of state.overrides.reverse()) o.el.style.setProperty(o.prop, o.value, o.priority);
    state.overrides = [];
    if (state.styleEl) state.styleEl.remove();
    state.styleEl = null;
    window.scrollTo({ left: state.scrollX, top: state.scrollY, behavior: 'instant' });
  }

  // Clipboard API requires a focused document; Chrome UI (toolbar, download
  // bubble) may hold focus for a moment, so wait for it briefly.
  function waitForFocus(ms) {
    if (document.hasFocus()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = (v) => {
        clearTimeout(timer);
        window.removeEventListener('focus', onFocus);
        resolve(v);
      };
      const onFocus = () => done(true);
      const timer = setTimeout(() => done(document.hasFocus()), ms);
      window.addEventListener('focus', onFocus);
    });
  }

  // Returns {ok, error} instead of throwing: rejections from injected
  // functions are not reliably propagated by chrome.scripting.
  async function copyImage(base64) {
    try {
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'image/png' });
      window.focus();
      if (!(await waitForFocus(15000))) {
        return { ok: false, error: chrome.i18n.getMessage('errNotFocused') };
      }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `${e.name}: ${e.message}` };
    }
  }

  globalThis.__webShot = { prepare, scrollToY, showFixed, restore, copyImage };
})();
