# MTurk Tab Manager (Bangla Warning)

A Chrome extension that **fully automatically** closes MTurk timer tabs and warns about duplicate tabs with embedded Bangla audio. **No manual closing needed.**

## Why a Chrome extension instead of a userscript?

Userscripts run in a sandboxed environment and cannot close tabs the user opened manually — this is a hard browser security rule. Chrome extensions, however, get access to the `chrome.tabs.remove()` API which can close ANY tab. That's why this version actually works.

## What it does

1. **Duplicate tab detection** — when you open the same MTurk page in two tabs, a Bangla warning audio plays and the duplicate tab shows a red warning screen with a 10-second countdown, then auto-closes.

2. **Timer-based auto-redirect** — these tabs auto-redirect to `/tasks` after their timer expires:
   - Homepage (`/`) → 30 seconds
   - `/dashboard` → 60 seconds
   - `/earnings` → 30 seconds
   - `/qualifications/assigned` → 120 seconds (2 min)
   - `/projects` (list) → 30 seconds
   - `/status_details` → 60 seconds

3. **Tasks page auto-refresh** — the `/tasks` queue hard-reloads every 10 minutes to keep it fresh.

   **White/blank queue recovery** — sometimes the `/tasks` page loads but renders as a blank white screen (the tab title is correct but the body is empty). The extension detects this ~6 seconds after load and instantly reloads a fresh queue link (`/tasks?_=<timestamp>`). It retries up to 4 times to avoid a reload loop, and resets once the queue renders normally.

4. **Never closes the work tab** — `/tasks` and `/projects/...` (HIT pages) stay open and are never redirected.

5. **Auto-open earnings every 3 hours** — opens `/earnings` in the background on a 3-hour alarm.

6. **`about:blank` auto-handler** — whenever a stray `about:blank` tab appears, it is handled automatically:
   - If a queue tab (`worker.mturk.com/tasks`) is **already open**, the blank tab is simply **closed**.
   - If **no** queue tab is open, the blank tab is turned into the **Tasks queue** (`https://worker.mturk.com/tasks`) instead of being left blank — so you always have your queue running.
   - A short 1.5s grace period lets real navigations (popups that load a real page) settle first, so legitimate pages are never closed.

7. **Direct-deposit page block** — `/direct_deposit` is blocked and redirected to `/tasks` for safety.

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
- `background.js` — service worker: detects duplicates, closes tabs, runs the 3-hour alarm, and handles `about:blank` tabs
- `content.js` — injected into MTurk pages, plays audio, shows warnings, runs timers
- `offscreen.html` / `offscreen.js` — offscreen document that plays the warning audio in the background
- `mac-startup_7xOaB3X.mp3` — the Bangla warning audio file
- `icon16.png`, `icon48.png`, `icon128.png` — extension icons

## To customize

- **Change timer durations:** edit the `waitTime` values in `content.js` (in milliseconds: 30000 = 30 seconds)
- **Change warning audio:** replace `mac-startup_7xOaB3X.mp3` with any other MP3 file (keep the same filename, or update the references in `content.js` and `offscreen.js`)
- **Change duplicate countdown:** edit `autoCloseSeconds: 10` in `background.js`
- **Change the queue/Tasks URL** used by the `about:blank` handler: edit `TASKS_URL` in `background.js`
- **Tune the `about:blank` grace period:** edit `BLANK_SETTLE_MS` in `background.js` (default 1500 ms)

After any edit, go to `chrome://extensions/` and click the **reload icon** on the extension card.
