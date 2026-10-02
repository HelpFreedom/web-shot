// Full-page screenshot: scroll the tab viewport by viewport, capture each
// frame with captureVisibleTab, stitch on an OffscreenCanvas, then save the
// PNG to Downloads and copy it to the clipboard.

const CAPTURE_INTERVAL_MS = 550; // Chrome allows ~2 captureVisibleTab calls per second
const MAX_PAGE_HEIGHT = 60000; // CSS px; stop scrolling after this
const MAX_CANVAS_SIDE = 32000; // device px
const MAX_CANVAS_AREA = 250_000_000; // device px²

const busyTabs = new Set();
const t = (key, ...subs) => chrome.i18n.getMessage(key, subs);

chrome.action.onClicked.addListener(async (tab) => {
  if (busyTabs.has(tab.id)) return;
  busyTabs.add(tab.id);
  try {
    await setBadge(tab.id, '…', '#2563eb');
    await takeScreenshot(tab);
    await setBadge(tab.id, 'OK', '#16a34a', t('statusDone'));
  } catch (e) {
    console.error('Web Shot:', e);
    await setBadge(tab.id, 'ERR', '#dc2626', t('statusError', String(e.message || e)));
  } finally {
    busyTabs.delete(tab.id);
    setTimeout(() => setBadge(tab.id, '', null, null), 3000);
  }
});

async function setBadge(tabId, text, color, title) {
  try {
    await chrome.action.setBadgeText({ tabId, text });
    if (color) await chrome.action.setBadgeBackgroundColor({ tabId, color });
    if (title !== undefined) {
      await chrome.action.setTitle({ tabId, title: title || t('actionTitle') });
    }
  } catch {
    // tab may have been closed
  }
}

async function callPage(tabId, method, ...args) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (m, a) => globalThis.__webShot[m](...a),
    args: [method, args],
  });
  return res?.result;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastCaptureAt = 0;
// captureVisibleTab shoots whatever tab is active in the window, so make sure
// it is still ours. Returns the frame as a PNG blob.
async function captureVisible(tab) {
  for (let attempt = 0; ; attempt++) {
    const wait = lastCaptureAt + CAPTURE_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    const current = await chrome.tabs.get(tab.id);
    if (!current.active || current.windowId !== tab.windowId) throw new Error(t('errTabSwitched'));
    lastCaptureAt = Date.now();
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      return await (await fetch(dataUrl)).blob();
    } catch (e) {
      if (attempt < 3 && /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/.test(e.message)) continue;
      throw e;
    }
  }
}

async function takeScreenshot(tab) {
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['page.js'] });

  const frames = []; // {y, blob}
  let viewportHeight, viewportWidth;
  try {
    const m = await callPage(tab.id, 'prepare');
    if (!m) throw new Error(t('errNoResponse'));
    viewportHeight = m.viewportHeight;
    viewportWidth = m.viewportWidth;

    let target = 0;
    while (true) {
      const pos = await callPage(tab.id, 'scrollToY', target);
      if (!pos) throw new Error(t('errNoResponse'));
      const y = pos.scrollY;
      // Page refused to scroll further: the previous frame was actually the
      // last one, so retake it with bottom fixed elements visible.
      if (frames.length && y <= frames[frames.length - 1].y) {
        const prev = frames[frames.length - 1];
        await callPage(tab.id, 'scrollToY', prev.y);
        await callPage(tab.id, 'showFixed', frames.length === 1, true);
        prev.blob = await captureVisible(tab);
        break;
      }

      const bottom = y + viewportHeight;
      const isFirst = frames.length === 0;
      const isLast = bottom >= pos.pageHeight || bottom >= MAX_PAGE_HEIGHT;
      // Top-anchored fixed elements only in the first frame, others only in the last.
      await callPage(tab.id, 'showFixed', isFirst, isLast);

      frames.push({ y, blob: await captureVisible(tab) });

      const total = Math.min(pos.pageHeight, MAX_PAGE_HEIGHT);
      const pct = Math.min(99, Math.round((bottom / total) * 100));
      await setBadge(tab.id, `${pct}%`, '#2563eb');

      if (isLast) break;
      target = bottom;
    }
  } finally {
    await callPage(tab.id, 'restore').catch(() => {});
  }

  const png = await stitch(frames, viewportWidth, viewportHeight);
  const base64 = await blobToBase64(png);

  // Copy before downloading: the download bubble steals focus from the page,
  // and the Clipboard API only works in a focused document.
  await setBadge(tab.id, 'copy', '#2563eb');
  const copied = await callPage(tab.id, 'copyImage', base64).catch((e) => ({
    ok: false,
    error: e.message,
  }));

  await chrome.downloads.download({
    url: `data:image/png;base64,${base64}`,
    filename: makeFilename(tab.url),
    saveAs: false,
    conflictAction: 'uniquify',
  });

  if (!copied?.ok) {
    throw new Error(t('errNotCopied', copied?.error || t('errNoResponse')));
  }
}

async function stitch(frames, viewportWidth, viewportHeight) {
  const bitmaps = await Promise.all(frames.map((f) => createImageBitmap(f.blob)));
  try {
    // Device pixels per CSS pixel (accounts for DPR and page zoom).
    const ratio = bitmaps[0].width / viewportWidth;
    const last = frames[frames.length - 1];
    const cssHeight = Math.min(last.y + viewportHeight, MAX_PAGE_HEIGHT);

    let width = bitmaps[0].width;
    let height = Math.round(cssHeight * ratio);
    const scale = Math.min(
      1,
      MAX_CANVAS_SIDE / width,
      MAX_CANVAS_SIDE / height,
      Math.sqrt(MAX_CANVAS_AREA / (width * height)),
    );
    width = Math.floor(width * scale);
    height = Math.floor(height * scale);

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    frames.forEach((f, i) => {
      const bmp = bitmaps[i];
      const dy = Math.round(f.y * ratio * scale);
      ctx.drawImage(bmp, 0, dy, Math.round(bmp.width * scale), Math.round(bmp.height * scale));
    });
    return await canvas.convertToBlob({ type: 'image/png' });
  } finally {
    bitmaps.forEach((b) => b.close());
  }
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function makeFilename(url) {
  let host = 'page';
  try {
    host = new URL(url).hostname.replace(/^www\./, '') || 'page';
  } catch {}
  host = host.replace(/[^a-z0-9.-]/gi, '_');
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
  return `screenshot_${host}_${stamp}.png`;
}
