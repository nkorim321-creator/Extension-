// background.js - MTurk Tab Manager service worker

const MTURK_HOST = 'https://worker.mturk.com/';
const TASKS_URL = 'https://worker.mturk.com/tasks';   // আপনার queue / কাজের পেজ
const SOUND_ENABLED = false;                          // duplicate warning sound: false = বন্ধ, true = চালু
const trackedTabs = new Map();
const blankTabTimers = new Map();                     // about:blank handler-এর pending timer

function normalizeUrl(url) {
    if (!url) return '';
    return url.split('?')[0].split('#')[0];
}

function isMturkUrl(url) {
    return url && url.startsWith(MTURK_HOST);
}

// queue/Tasks পেজ চেনার জন্য — /tasks এবং /tasks?_=... দুটোই ধরবে
function isQueueUrl(url) {
    return typeof url === 'string' && url.startsWith(TASKS_URL);
}

// ৬ ঘণ্টার বদলে এখন ৩ ঘণ্টা (১৮০ মিনিট) পর পর অ্যালার্ম বাজবে
chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create('openEarningsTab', { periodInMinutes: 180 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'openEarningsTab') {
        chrome.tabs.create({ url: 'https://worker.mturk.com/earnings', active: false }, (tab) => {
            // পেজ সাদা হয়ে আটকে থাকা রোধ করতে ২ সেকেন্ড পর ব্যাকগ্রাউন্ড থেকে জোর করে রিলোড দেওয়া হলো
            setTimeout(() => {
                if (tab && tab.id) {
                    chrome.tabs.reload(tab.id).catch(() => {});
                }
            }, 2000);
        });
        console.log('[MTurk Mgr] Auto-opened earnings tab (3-hour interval)');
    }
});

// --- OFFSCREEN AUDIO SETUP ---
async function playAudioSecretly() {
    try {
        await chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: ['AUDIO_PLAYBACK'],
            justification: 'Play warning audio in background'
        });
    } catch (e) {
        // Document already exists, ignore error
    }
    // Tell the offscreen document to play the sound
    chrome.runtime.sendMessage({ type: 'PLAY_AUDIO_OFFSCREEN' });
}
// ----------------------------

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !isMturkUrl(tab.url)) return;

    const normalizedUrl = normalizeUrl(tab.url);

    trackedTabs.set(tabId, {
        url: normalizedUrl,
        openedAt: Date.now()
    });

    const allTabs = await chrome.tabs.query({});
    const matchingTabs = allTabs.filter(t =>
        isMturkUrl(t.url) && normalizeUrl(t.url) === normalizedUrl
    );

    if (matchingTabs.length > 1) {
        matchingTabs.sort((a, b) => {
            const aOpened = trackedTabs.get(a.id)?.openedAt || a.id;
            const bOpened = trackedTabs.get(b.id)?.openedAt || b.id;
            return aOpened - bOpened;
        });

        const duplicateTabs = matchingTabs.slice(1);

        if (SOUND_ENABLED) playAudioSecretly().catch(() => {});

        for (const dup of duplicateTabs) {
            chrome.tabs.sendMessage(dup.id, {
                type: 'SHOW_DUPLICATE_WARNING',
                autoCloseSeconds: 10
            }).catch(() => {});
        }
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'CLOSE_MY_TAB') {
        const tabId = sender.tab?.id;
        if (tabId) {
            chrome.tabs.remove(tabId).catch(err => console.warn(err));
            sendResponse({ ok: true });
        }
        return true;
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    trackedTabs.delete(tabId);
    const pending = blankTabTimers.get(tabId);
    if (pending) {
        clearTimeout(pending);
        blankTabTimers.delete(tabId);
    }
});

// ============ ABOUT:BLANK AUTO-HANDLER ============
// নিয়ম:
//  - কোনো about:blank ট্যাব দেখলে সেটা auto বন্ধ/হ্যান্ডেল হবে।
//  - যদি কোনো queue (worker.mturk.com/tasks) ট্যাব খোলা না থাকে → blank ট্যাবটিকেই
//    Tasks queue বানিয়ে দেওয়া হবে (লিংকটা রান হবে), ফলে blank আর থাকবে না।
//  - যদি queue ট্যাব আগে থেকেই খোলা থাকে → শুধু about:blank ট্যাবটা বন্ধ করে দেওয়া হবে।

const BLANK_SETTLE_MS = 1500;     // আসল navigation শেষ হওয়ার জন্য একটু সময় দিই

function scheduleBlankCheck(tabId) {
    // একই ট্যাবের জন্য আগের timer থাকলে রিসেট করি (debounce)
    const existing = blankTabTimers.get(tabId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
        blankTabTimers.delete(tabId);
        handleAboutBlankTab(tabId).catch(() => {});
    }, BLANK_SETTLE_MS);

    blankTabTimers.set(tabId, timer);
}

async function handleAboutBlankTab(tabId) {
    let tab;
    try {
        tab = await chrome.tabs.get(tabId);
    } catch (e) {
        return; // ট্যাব ইতিমধ্যে বন্ধ হয়ে গেছে
    }

    // আবার যাচাই: ট্যাবটা এখনো সত্যিই about:blank তো? (এর মধ্যে কোথাও navigate করলে হাত দেব না)
    const currentUrl = tab.url || tab.pendingUrl || '';
    if (currentUrl !== 'about:blank') return;

    // কোথাও queue/Tasks ট্যাব খোলা আছে কিনা দেখি
    const allTabs = await chrome.tabs.query({});
    const hasQueueTab = allTabs.some(t => isQueueUrl(t.url || t.pendingUrl || ''));

    if (hasQueueTab) {
        // queue আগে থেকেই খোলা → অপ্রয়োজনীয় blank ট্যাবটা বন্ধ করে দিই
        chrome.tabs.remove(tabId).catch(() => {});
        console.log('[MTurk Mgr] Closed about:blank (queue already open)');
    } else {
        // queue খোলা নেই → এই blank ট্যাবটাকেই Tasks queue বানিয়ে দিই
        chrome.tabs.update(tabId, { url: TASKS_URL }).catch(() => {
            // আপডেট না হলে fallback: নতুন Tasks ট্যাব খুলে blank-টা বন্ধ করি
            chrome.tabs.create({ url: TASKS_URL });
            chrome.tabs.remove(tabId).catch(() => {});
        });
        console.log('[MTurk Mgr] No queue open → opened Tasks in the blank tab');
    }
}

// নতুন ট্যাব about:blank হিসেবে জন্ম নিলে
chrome.tabs.onCreated.addListener((tab) => {
    const url = tab.url || tab.pendingUrl || '';
    if (url === 'about:blank' && typeof tab.id === 'number') {
        scheduleBlankCheck(tab.id);
    }
});

// কোনো ট্যাব about:blank-এ থিতু হলে, অথবা blank থেকে অন্য কোথাও গেলে
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tab.url === 'about:blank' &&
        (changeInfo.status === 'complete' || changeInfo.url === 'about:blank')) {
        scheduleBlankCheck(tabId);
    } else if (changeInfo.url && changeInfo.url !== 'about:blank') {
        // blank থেকে আসল পেজে চলে গেছে → পেন্ডিং বন্ধের কাজ বাতিল করি
        const pending = blankTabTimers.get(tabId);
        if (pending) {
            clearTimeout(pending);
            blankTabTimers.delete(tabId);
        }
    }
});

console.log('[MTurk Mgr] Background service worker started (offscreen audio, 3hr alarm, about:blank handler)');