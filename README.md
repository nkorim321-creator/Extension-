# MTurk Tab Manager (Bangla Warning)

A Chrome extension that **fully automatically** closes MTurk timer tabs and warns about duplicate tabs with embedded Bangla audio. **No manual closing needed.**

## Why a Chrome extension instead of a userscript?

Userscripts run in a sandboxed environment and cannot close tabs the user opened manually — this is a hard browser security rule. Chrome extensions, however, get access to the `chrome.tabs.remove()` API which can close ANY tab. That's why this version actually works.

## What it does

1. **Duplicate tab detection** — when you open the same MTurk page in two tabs, the original tab plays a Bangla warning audio (`ভাই, সেকেন্ড পেজ টা ক্লোজ করেন`) and the duplicate tab shows a red warning screen with a 10-second countdown, then auto-closes.

2. **Timer-based auto-close** — these tabs auto-close after their timer expires:
   - Homepage (`/`) → 30 seconds
   - `/dashboard` → 60 seconds
   - `/earnings` → 30 seconds
   - `/qualifications/assigned` → 120 seconds (2 min)
   - `/projects` (list) → 30 seconds

3. **Never closes the work tab** — `/tasks` and `/projects/...` (HIT pages) stay open forever.

## Installation

1. Download or extract the `mturk-extension` folder somewhere permanent on your PC (e.g., `C:\mturk-extension\` or your Documents folder). **Don't delete this folder** — Chrome reads files from here every time.

2. Open Chrome and go to: `chrome://extensions/`

3. In the top-right corner, turn ON **"Developer mode"** (toggle switch).

4. Click the **"Load unpacked"** button (top-left).

5. Select the `mturk-extension` folder you extracted in step 1.

6. The extension is now installed and active.

7. Reload any open MTurk tabs and you're done.

## Verifying it works

- Open MTurk in two tabs at the same URL → original tab plays the Bangla warning, duplicate tab shows the red warning and auto-closes after 10 seconds.
- Open `https://worker.mturk.com/dashboard` → after 60 seconds, the tab closes automatically.

## Troubleshooting

- **Audio doesn't play:** Open `chrome://settings/content/sound`, click "Add" under "Allowed to play sound", enter `https://worker.mturk.com`. This grants permanent autoplay permission.
- **Duplicate is not detected:** Make sure both tabs finished loading. The extension only fires after page load completes.
- **Want to see what's happening:** Right-click the extension icon → Inspect popup, OR open `chrome://extensions/`, click "service worker" link under the extension to see background logs. Open DevTools (F12) on any MTurk page to see content script logs.

## Files in this folder

- `manifest.json` — extension configuration
- `background.js` — service worker that detects duplicates and closes tabs
- `content.js` — injected into MTurk pages, plays audio, shows warnings, runs timers
- `warning.mp3` — your Bangla audio file
- `icon16.png`, `icon48.png`, `icon128.png` — extension icons

## To customize

- **Change timer durations:** edit the `waitTime` values in `content.js` (in milliseconds: 30000 = 30 seconds)
- **Change warning audio:** replace `warning.mp3` with any other MP3 file (keep the same filename)
- **Change duplicate countdown:** edit `autoCloseSeconds: 10` in `background.js`

After any edit, go to `chrome://extensions/` and click the **reload icon** on the extension card.
