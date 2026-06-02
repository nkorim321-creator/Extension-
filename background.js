// background.js - MTurk Tab Manager service worker

const MTURK_HOST = 'https://worker.mturk.com/';
const trackedTabs = new Map();

function normalizeUrl(url) {
    if (!url) return '';
    return url.split('?')[0].split('#')[0];
}

function isMturkUrl(url) {
    return url && url.startsWith(MTURK_HOST);
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

        playAudioSecretly().catch(() => {});

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
});

console.log('[MTurk Mgr] Background service worker started (with offscreen audio & 3hr alarm)');