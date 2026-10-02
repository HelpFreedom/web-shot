# Web Shot

[Русский](README.md) | **English**

A Google Chrome extension that captures **the entire web page** with one click:
it scrolls the page, stitches the frames into a single PNG, saves the file to Downloads
and copies the image to the clipboard.

## Features

- Full-page screenshot by scrolling, at full screen resolution (respects HiDPI and page zoom).
- The file is silently saved to Downloads as `screenshot_<domain>_<date>_<time>.png`.
- The image is copied to the clipboard, ready to paste into a chat or an editor.
- Fixed elements are not repeated on every frame:
  - headers pinned to the top of the screen appear only at the beginning of the screenshot;
  - floating banners, chat buttons, cookie bars appear only at the end;
  - sticky blocks appear once, in their own place.
- Progress and result are shown on the icon badge: `%` → `OK` or `ERR`
  (the error text is in the icon tooltip).
- Triggered by clicking the icon or with the **Ctrl+Shift+S** shortcut (**⌘+Shift+S** on macOS).
- Russian and English UI (follows the browser language).

## Installation

### From a release

1. Download `web-shot-<version>.zip` from the Releases page and unzip it into a permanent folder.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the unzipped folder.
4. Pin the icon to the toolbar: puzzle icon → pin next to Web Shot.

### From source

```bash
git clone https://github.com/HelpFreedom/web-shot.git
```

Then follow steps 2–4 above, selecting the `web-shot` folder.

## Usage

Open the page and click the Web Shot icon or press **Ctrl+Shift+S**. Do not switch tabs or scroll while it is capturing.
When the badge shows `OK`, the file is already in Downloads and the image is on the clipboard.

The shortcut can be changed at `chrome://extensions/shortcuts`. If Ctrl+Shift+S is already
taken by another extension, Chrome will not assign it — set your own combination there.

To capture local files (`file://`), enable "Allow access to file URLs" on the extension's
card at `chrome://extensions`.

## How it works

1. A small script is injected into the page: it hides scrollbars, disables smooth scrolling
   and temporarily makes sticky elements static.
2. The page is scrolled one screen at a time; each screen is captured with
   `chrome.tabs.captureVisibleTab` (at most twice per second, a Chrome limit).
3. The frames are stitched on an `OffscreenCanvas` in the background service worker.
4. The PNG is copied to the clipboard via the Clipboard API and saved via `chrome.downloads`.
5. All page changes are reverted and the scroll position is restored.

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Access to the current tab only when the icon is clicked |
| `scripting` | Scrolling the page and hiding fixed elements during capture |
| `downloads` | Saving the PNG to Downloads |
| `clipboardWrite` | Copying the image to the clipboard |

**Privacy:** the extension collects no data, makes no network requests and sends nothing
anywhere. Screenshots stay on your computer.

## Limitations

- Chrome does not allow capturing internal pages (`chrome://…`), the Chrome Web Store or the built-in PDF viewer; these show `ERR`.
- If the page scrolls an inner container instead of the document (Gmail, some web apps), only the visible area is captured.
- Horizontal scrolling is not captured — only the window width.
- Very long pages are cut at 60,000 px; very large images are scaled down proportionally to fit canvas limits.
- Animated or infinitely loading content may not stitch perfectly.

## Building a release archive

```bash
./scripts/package.sh   # creates dist/web-shot-<version>.zip
```

## Authors

- **Black Triangle** ([@HelpFreedom](https://github.com/HelpFreedom)) — author and owner
- **Claude** (Anthropic) — code co-author

## License

[GNU General Public License v3.0](LICENSE)
