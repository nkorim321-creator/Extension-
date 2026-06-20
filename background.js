// background.js - MTurk Tab Manager service worker

const MTURK_HOST = 'https://worker.mturk.com/';
const TASKS_URL = 'https://worker.mturk.com/tasks';   
const SOUND_ENABLED = false;                          

let trackedTabs = new Map(); 
const blankTabTimers = new Map();                     

// ============ MEMORY AMNESIA FIX (MV3 SAFE) ============
// সার্ভিস ওয়ার্কার ঘুম থেকে ওঠার সাথে সাথে সেফলি ডাটাবেস লোড করবে
chrome.storage.local.get(['trackedTabsData']).then((result) => {
    if (result.trackedTabsData) {
        try {
            const parsedData = JSON.parse(result.trackedTabsData);
            trackedTabs = new Map(parsedData);
            console.log('[MTurk Mgr] Loaded tracked tabs from memory.');
        } catch (e) {
            console.warn('[MTurk Mgr] Failed to parse tracked tabs data', e);
        }
    }
}).catch(err => console.warn('[MTurk Mgr] Storage access error:', err));

function saveTrackedTabs() {
    chrome.storage.local.set({ 
        trackedTabsData: JSON.stringify(Array.from(trackedTabs.entries())) 
    }).catch(err => console.warn('[MTurk Mgr] Storage save error:', err));
}

// ============ UTILITIES ============
function normalizeUrl(url) {
    if (!url) return '';
    return url.split('?')[0].split('#')[0];
}

function isMturkUrl(url) {
    return typeof url === 'string' && url.startsWith(MTURK_HOST);
}

function isQueueUrl(url) {
    return typeof url === 'string' && url.startsWith(TASKS_URL);
}

// ============ DUPLICATE TAB AUTO-CLOSE (BACKGROUND-DRIVEN) ============
// Chrome background (hidden) ট্যাবে content script-এর setInterval/timer throttle হয়, তাই
// ওটার ভরসায় থাকলে duplicate ট্যাব click/focus না করা পর্যন্ত বন্ধ হয় না। তাই নির্দিষ্ট সময়
// পর background service worker নিজেই duplicate /tasks ট্যাব বন্ধ করে দেয় — focus না করলেও বন্ধ হবে।
const DUP_AUTO_CLOSE_SECONDS = 10;
const pendingDupCloses = new Map(); // tabId -> timeoutId

function scheduleDuplicateClose(tabId, delayMs) {
    if (pendingDupCloses.has(tabId)) return; // ইতিমধ্যে শিডিউল করা আছে
    const timer = setTimeout(async () => {
        pendingDupCloses.delete(tabId);
        try {
            const t = await chrome.tabs.get(tabId);
            if (!t || !isQueueUrl(t.url || t.pendingUrl || '')) return; // আর /tasks নেই / চলে গেছে
            const all = await chrome.tabs.query({});
            const queueTabs = all.filter(x => isQueueUrl(x.url || x.pendingUrl || ''));
            if (queueTabs.length > 1) {           // এখনো duplicate আছে → বন্ধ করি
                chrome.tabs.remove(tabId).catch(() => {});
                console.log('[MTurk Mgr] Duplicate /tasks tab auto-closed from background');
            }
        } catch (e) {}
    }, delayMs);
    pendingDupCloses.set(tabId, timer);
}

// ============ 3-HOUR EARNINGS TAB ============
chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create('openEarningsTab', { periodInMinutes: 180 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'openEarningsTab') {
        chrome.tabs.create({ url: 'https://worker.mturk.com/earnings', active: false }, (tab) => {
            if (tab && tab.id) {
                setTimeout(() => {
                    chrome.tabs.reload(tab.id).catch(() => {});
                }, 2000);
            }
        });
        console.log('[MTurk Mgr] Auto-opened earnings tab (3-hour interval)');
    }
});

// ============ OFFSCREEN AUDIO ============
async function playAudioSecretly() {
    try {
        await chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: ['AUDIO_PLAYBACK'],
            justification: 'Play warning audio in background'
        });
    } catch (e) {
        // Document already exists, ignore safely
    }
    chrome.runtime.sendMessage({ type: 'PLAY_AUDIO_OFFSCREEN' }).catch(() => {});
}

// ============ DUPLICATE TAB TRACKING ============
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !isMturkUrl(tab.url)) return;

    const normalizedUrl = normalizeUrl(tab.url);
    const existingTab = trackedTabs.get(tabId);
    
    // শুধুমাত্র নতুন ট্যাবেই টাইম সেট হবে, পুরনো ট্যাব সবসময় নিরাপদ (Idle) থাকবে
    if (!existingTab) {
        trackedTabs.set(tabId, {
            url: normalizedUrl,
            openedAt: Date.now()
        });
    } else {
        existingTab.url = normalizedUrl; 
        trackedTabs.set(tabId, existingTab);
    }
    saveTrackedTabs(); 

    // ডুপ্লিকেট ওয়ার্নিং শুধুমাত্র /tasks লিংকের জন্যই কাজ করবে
    if (isQueueUrl(normalizedUrl)) {
        try {
            const allTabs = await chrome.tabs.query({});
            const matchingTabs = allTabs.filter(t =>
                isQueueUrl(t.url) && normalizeUrl(t.url) === normalizedUrl
            );

            if (matchingTabs.length > 1) {
                matchingTabs.sort((a, b) => {
                    const aOpened = trackedTabs.get(a.id)?.openedAt || a.id;
                    const bOpened = trackedTabs.get(b.id)?.openedAt || b.id;
                    return aOpened - bOpened;
                });

                const originalTab = matchingTabs[0];
                const duplicateTabs = matchingTabs.slice(1);

                // FORCE BACKGROUND: ডুপ্লিকেট ট্যাব যদি focus কেড়ে নিয়ে থাকে, তাহলে আসল
                // queue ট্যাবে focus ফিরিয়ে দিই — ইউজারের কাজের ট্যাব নষ্ট হবে না, ডুপ্লিকেট
                // ব্যাকগ্রাউন্ডেই warning দেখিয়ে নিজে বন্ধ হবে।
                const stoleFocus = duplicateTabs.some(t => t.active);
                if (stoleFocus && originalTab && typeof originalTab.id === 'number') {
                    chrome.tabs.update(originalTab.id, { active: true }).catch(() => {});
                    if (typeof originalTab.windowId === 'number') {
                        chrome.windows.update(originalTab.windowId, { focused: true }).catch(() => {});
                    }
                }

                if (SOUND_ENABLED) playAudioSecretly();

                for (const dup of duplicateTabs) {
                    // ১০s warning UI দেখাই (ট্যাবটা সামনে থাকলে ইউজার দেখবে)
                    chrome.tabs.sendMessage(dup.id, {
                        type: 'SHOW_DUPLICATE_WARNING',
                        autoCloseSeconds: DUP_AUTO_CLOSE_SECONDS
                    }).catch(() => {});
                    // আসল বন্ধটা background থেকে — background ট্যাব হলেও ১০s পর বন্ধ হবে
                    scheduleDuplicateClose(dup.id, DUP_AUTO_CLOSE_SECONDS * 1000);
                }
            }
        } catch (err) {
            console.warn('[MTurk Mgr] Error checking duplicates:', err);
        }
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    if (trackedTabs.has(tabId)) {
        trackedTabs.delete(tabId);
        saveTrackedTabs();
    }
    const pending = blankTabTimers.get(tabId);
    if (pending) {
        clearTimeout(pending);
        blankTabTimers.delete(tabId);
    }
    const dupTimer = pendingDupCloses.get(tabId);
    if (dupTimer) {
        clearTimeout(dupTimer);
        pendingDupCloses.delete(tabId);
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'CLOSE_MY_TAB') {
        const tabId = sender.tab?.id;
        if (tabId) {
            chrome.tabs.remove(tabId).catch(() => {});
            sendResponse({ ok: true });
        }
        return true;
    }
});

// ============ ABOUT:BLANK AUTO-HANDLER ============
const BLANK_SETTLE_MS = 1500;     

function scheduleBlankCheck(tabId) {
    const existing = blankTabTimers.get(tabId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
        blankTabTimers.delete(tabId);
        handleAboutBlankTab(tabId).catch(() => {});
    }, BLANK_SETTLE_MS);

    blankTabTimers.set(tabId, timer);
}

async function handleAboutBlankTab(tabId) {
    try {
        const tab = await chrome.tabs.get(tabId);
        const currentUrl = tab.url || tab.pendingUrl || '';
        if (currentUrl !== 'about:blank') return;

        const allTabs = await chrome.tabs.query({});
        const hasQueueTab = allTabs.some(t => isQueueUrl(t.url || t.pendingUrl || ''));

        if (hasQueueTab) {
            chrome.tabs.remove(tabId).catch(() => {});
            console.log('[MTurk Mgr] Closed about:blank (queue already open)');
        } else {
            chrome.tabs.update(tabId, { url: TASKS_URL }).catch(() => {
                chrome.tabs.create({ url: TASKS_URL });
                chrome.tabs.remove(tabId).catch(() => {});
            });
            console.log('[MTurk Mgr] No queue open → opened Tasks in the blank tab');
        }
    } catch (e) {
        // ট্যাবটি চেক করার আগেই ইউজার ক্লোজ করে দিলে এরর যেন না আসে
    }
}

chrome.tabs.onCreated.addListener((tab) => {
    const url = tab.url || tab.pendingUrl || '';
    if (url === 'about:blank' && typeof tab.id === 'number') {
        scheduleBlankCheck(tab.id);
    }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tab.url === 'about:blank' &&
        (changeInfo.status === 'complete' || changeInfo.url === 'about:blank')) {
        scheduleBlankCheck(tabId);
    } else if (changeInfo.url && changeInfo.url !== 'about:blank') {
        const pending = blankTabTimers.get(tabId);
        if (pending) {
            clearTimeout(pending);
            blankTabTimers.delete(tabId);
        }
    }
});

// ============ HTTP 503 ERROR RECOVERY (NETWORK LEVEL & LOOP CONTROL) ============
const networkFilterUrls = ["https://worker.mturk.com/tasks*"];

chrome.webRequest.onCompleted.addListener(
    (details) => {
        if ((details.statusCode === 503 || details.statusCode === 500) && details.type === 'main_frame' && details.tabId >= 0) {
            console.log('[MTurk Mgr] 503/500 Error from Network! Retrying in 3 seconds...');
            setTimeout(() => {
                chrome.tabs.update(details.tabId, { url: details.url }).catch(() => {});
            }, 3000); 
        }
    },
    { urls: networkFilterUrls }
);

chrome.webRequest.onErrorOccurred.addListener(
    (details) => {
        // ERR_ABORTED মানে ইউজার/স্ক্রিপ্ট নিজেই navigate বা reload করেছে — এটা আসল network
        // drop নয়। এতে retry করলে ভুল করে loading ট্যাবকে আবার /tasks-এ টেনে আনে। তাই skip।
        if (details.error === 'net::ERR_ABORTED') return;
        if (details.type === 'main_frame' && details.tabId >= 0) {
            console.log('[MTurk Mgr] Network Drop detected! Retrying in 3 seconds...');
            setTimeout(() => {
                chrome.tabs.update(details.tabId, { url: details.url }).catch(() => {});
            }, 3000);
        }
    },
    { urls: networkFilterUrls }
);

console.log('[MTurk Mgr] Background service worker started (World-Class MVP Version)');