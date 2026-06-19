// content.js - runs on every worker.mturk.com page
(function() {
    'use strict';

    const fullUrl = window.location.href;

    // ============ SECURITY BLOCKER (BANK/DIRECT DEPOSIT) ============
    // শুধুমাত্র direct_deposit পেজে গেলে সাথে সাথে ব্লক করে দেবে
    if (fullUrl.includes("/direct_deposit")) {
        document.documentElement.innerHTML = `
            <div style="background-color:#c0392b; color:white; width:100vw; height:100vh; position:fixed; top:0; left:0; z-index:9999999; display:flex; flex-direction:column; justify-content:center; align-items:center; font-family:sans-serif; text-align:center;">
                <h1 style="font-size: 60px; margin-bottom: 20px;">🚫 Access Denied!</h1>
                <h2 style="font-size: 30px;">Security Alert: You are not allowed to view this page.</h2>
            </div>
        `;
        window.location.href = "https://worker.mturk.com/tasks";
        return; 
    }

    let isDuplicateTab = false;
    let warningShown = false;
    let lastAudioAt = 0;
    const SOUND_ENABLED = false; 

    // ============ MESSAGE HANDLER FROM BACKGROUND ============
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'PLAY_WARNING_AUDIO') {
            playWarningOnce();
            sendResponse({ ok: true });
        } else if (message.type === 'SHOW_DUPLICATE_WARNING') {
            if (!warningShown) {
                isDuplicateTab = true;
                warningShown = true;
                showDuplicateWarning(message.autoCloseSeconds || 10);
            }
            sendResponse({ ok: true });
        }
        return true;
    });

    // ============ AUDIO PLAYBACK ============
    function playWarningOnce() {
        if (!SOUND_ENABLED) return;
        const now = Date.now();
        if (now - lastAudioAt < 8000) return;
        lastAudioAt = now;

        try {
            const audioUrl = chrome.runtime.getURL('mac-startup_7xOaB3X.mp3');
            const audio = new Audio(audioUrl);
            audio.volume = 1.0;
            audio.onplay = () => console.log('[MTurk Mgr] Audio playing on:', isDuplicateTab ? 'DUPLICATE' : 'ORIGINAL');
            const p = audio.play();
            if (p !== undefined) {
                p.catch(err => {
                    console.warn('[MTurk Mgr] Audio blocked:', err.message);
                    lastAudioAt = 0;
                });
            }
        } catch (e) {
            console.warn('[MTurk Mgr] Audio error:', e);
        }
    }

    // ============ TAB CLOSE (via background) ============
    function requestSelfClose() {
        try {
            chrome.runtime.sendMessage({ type: 'CLOSE_MY_TAB' });
        } catch (e) {
            console.warn('[MTurk Mgr] Close request failed:', e);
        }
    }

    // ============ DUPLICATE WARNING UI (TOP-CLASS FIX) ============
    function showDuplicateWarning(autoCloseSeconds) {
        const warnHTML = `
            <div id="mturk-mgr-dup-warn" style="background-color:#e65c5c; color:white; width:100vw; height:100vh; position:fixed; top:0; left:0; z-index:2147483647; display:flex; flex-direction:column; justify-content:center; align-items:center; font-family:sans-serif; text-align:center; padding: 20px; box-sizing: border-box;">
                <h1 style="font-size: 50px; font-weight: bold; margin-bottom: 20px; text-shadow: 1px 1px 2px rgba(0,0,0,0.2);">⚠️ সতর্কবাণী!</h1>
                <h2 style="font-size: 35px; text-shadow: 1px 1px 2px rgba(0,0,0,0.2);">আপনি এই একই পেজ অন্য আরেকটি ট্যাবে ওপেন করে রেখেছেন।</h2>
                <p style="font-size: 25px; margin-top: 30px; font-weight:bold; background:rgba(0,0,0,0.6); padding:15px 30px; border-radius:10px;">দয়া করে এই পেজটি (2nd page) এখনি ক্লোজ করুন!</p>
                <p style="font-size: 22px; margin-top: 30px; background:rgba(0,0,0,0.4); padding:10px 25px; border-radius:8px;">
                    Auto-closing in <span id="mturk-mgr-countdown" style="font-weight:bold; font-size:28px;">${autoCloseSeconds}</span>s
                </p>
                <button id="mturk-mgr-close-now" style="margin-top:25px; font-size:18px; padding:12px 30px; background:#fff; color:#c0392b; border:none; border-radius:8px; cursor:pointer; font-weight:bold;">
                    Close Now
                </button>
            </div>
        `;

        // FIX: পেজ বডি রেডি না থাকলেও জোর করে ওয়ার্নিং দেখাবে, স্কিপ করবে না!
        if (document.body) {
            document.body.innerHTML = warnHTML;
        } else {
            document.documentElement.innerHTML = `<head><title>⚠️ Duplicate Tab!</title></head><body style="margin:0;">${warnHTML}</body>`;
        }
        
        document.title = "⚠️ Duplicate Tab!";

        setTimeout(playWarningOnce, 300);

        // UI রেন্ডার হওয়ার পর বাটন কানেক্ট করা
        setTimeout(() => {
            const btn = document.getElementById('mturk-mgr-close-now');
            if (btn) btn.addEventListener('click', requestSelfClose);
        }, 50);

        let secondsLeft = autoCloseSeconds;
        const interval = setInterval(() => {
            secondsLeft--;
            const countdownEl = document.getElementById('mturk-mgr-countdown');
            if (countdownEl) countdownEl.textContent = secondsLeft;
            if (secondsLeft <= 0) {
                clearInterval(interval);
                requestSelfClose();
            }
        }, 1000);

        const triggerEvents = ['mousemove', 'click', 'keydown', 'scroll', 'touchstart'];
        const forceAudio = () => {
            playWarningOnce();
            triggerEvents.forEach(evt => window.removeEventListener(evt, forceAudio));
        };
        triggerEvents.forEach(evt => window.addEventListener(evt, forceAudio));
    }

    // ============ BLANK/WHITE TASKS PAGE RECOVERY ============
    const POST_LOAD_GRACE_MS = 6000;
    const HARD_DEADLINE_MS = 13000;
    const QUEUE_RELOAD_MS = 150000;   // queue পেজ প্রতি ১৫০ সেকেন্ডে (২.৫ মিনিট) plain reload
    const POLL_INTERVAL_MS = 1000;
    const BLANK_RETRY_KEY = 'mturkBlankRetries';
    const FAST_RETRIES = 4;
    const BACKOFF_MS = 30000;

    function tasksPageRendered() {
        const body = document.body;
        if (!body) return false;
        const text = (body.innerText || '').trim();
        return /Your HITs Queue|HITs Queue|Sign Out|Browse all available HITs|Worker ID|Qualifications|Dashboard/i.test(text);
    }

    function plainReload() {
        try { window.location.reload(); }
        catch (e) {
            try { window.location.href = 'https://worker.mturk.com/tasks'; } catch (e2) {}
        }
    }

    function escHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function renderFallbackQueue(tasks, total) {
        const count = (total != null ? total : tasks.length);
        const rows = tasks.map(function (t) {
            const p = t.project || {};
            let url = t.task_url || '';
            if (!url && p.hit_set_id && t.task_id) {
                url = '/projects/' + p.hit_set_id + '/tasks/' + t.task_id +
                      (t.assignment_id ? '?assignment_id=' + t.assignment_id : '');
            }
            if (url && url.charAt(0) === '/') url = 'https://worker.mturk.com' + url;
            const reward = p.monetary_reward && p.monetary_reward.amount_in_dollars;
            const mins = Math.max(0, Math.round((t.time_to_deadline_in_seconds || 0) / 60));
            return '<tr style="border-bottom:1px solid #ddd">' +
                '<td style="padding:10px 8px">' + escHtml(p.requester_name) + '</td>' +
                '<td style="padding:10px 8px">' + escHtml(p.title) + '</td>' +
                '<td style="padding:10px 8px">' + (reward != null ? '$' + escHtml(reward) : '') + '</td>' +
                '<td style="padding:10px 8px">' + mins + ' min</td>' +
                '<td style="padding:10px 8px">' + (url ? '<a href="' + escHtml(url) + '" style="background:#e47911;color:#fff;padding:6px 18px;border-radius:3px;text-decoration:none;font-weight:bold">Work</a>' : '') + '</td>' +
                '</tr>';
        }).join('');
        document.body.innerHTML =
            '<div style="font-family:Arial,sans-serif;max-width:1100px;margin:0 auto;padding:16px">' +
            '<div style="background:#fff3cd;border:1px solid #ffc107;border-radius:6px;padding:10px 14px;margin-bottom:14px;font-size:13px;line-height:1.5">' +
            '⚠️ MTurk-এর আসল পেজ সাদা (white) হয়ে গিয়েছিল, তাই MTurk Tab Manager queue-টা সরাসরি ডেটা থেকে এঁকে দিয়েছে। ' +
            'কিছুক্ষণের মধ্যে আসল পেজ আবার নিজে নিজেই চেষ্টা হবে — অথবা ' +
            '<a href="https://worker.mturk.com/tasks">আসল queue পেজ এখনই খুলুন</a>।</div>' +
            '<h1 style="color:#e47911;font-size:26px;margin:6px 0 14px">Your HITs Queue (' + count + ')</h1>' +
            (tasks.length
                ? '<table style="width:100%;border-collapse:collapse;font-size:14px;background:#fff">' +
                  '<thead><tr style="background:#f3f3f3;text-align:left">' +
                  '<th style="padding:8px">Requester</th><th style="padding:8px">Title</th>' +
                  '<th style="padding:8px">Reward</th><th style="padding:8px">Time Remaining</th>' +
                  '<th style="padding:8px">Actions</th></tr></thead><tbody>' + rows + '</tbody></table>'
                : '<p style="font-size:15px">You don\'t currently have any HITs accepted. ' +
                  '<a href="https://worker.mturk.com/projects">Browse all available HITs</a>.</p>') +
            '</div>';
        document.title = 'Your HITs Queue (' + count + ')';
    }

    function tryJsonQueueFallback(onFail) {
        try {
            document.body.innerHTML =
                '<div style="font-family:Arial,sans-serif;padding:30px;font-size:15px;line-height:1.7;max-width:900px;margin:0 auto">' +
                '<h2 style="color:#e47911;margin:0 0 10px">MTurk Tab Manager</h2>' +
                'সাদা (white) queue পেজ ধরা পড়েছে — MTurk-এর render fail করেছে, তাই queue-এর ডেটা ' +
                'সরাসরি আনা হচ্ছে, কয়েক সেকেন্ড অপেক্ষা করুন… </div>';
        } catch (e) {}
        fetch('https://worker.mturk.com/tasks?format=json', {
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { 'Accept': 'application/json' }
        }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        }).then(function (json) {
            const tasks = (json && Array.isArray(json.tasks)) ? json.tasks : null;
            if (!tasks) throw new Error('unexpected JSON shape');
            renderFallbackQueue(tasks, json.total_num_results);
            try { sessionStorage.removeItem(BLANK_RETRY_KEY); } catch (e) {}
            console.warn('[MTurk Mgr] White page → queue rendered from JSON');
        }).catch(function (err) {
            console.warn('[MTurk Mgr] JSON fallback failed:', err);
            onFail();
        });
    }

    function recordRetryAndRecover() {
        let arr = [];
        try { arr = JSON.parse(sessionStorage.getItem(BLANK_RETRY_KEY) || '[]'); } catch (e) {}
        if (!Array.isArray(arr)) arr = [];
        const t0 = Date.now();
        arr = arr.filter(t => t0 - t < 180000);
        arr.push(t0);
        try { sessionStorage.setItem(BLANK_RETRY_KEY, JSON.stringify(arr)); } catch (e) {}

        if (arr.length <= FAST_RETRIES) {
            console.warn('[MTurk Mgr] White queue → plain reload');
            plainReload();
        } else {
            console.warn('[MTurk Mgr] Still white → drawing queue from JSON');
            tryJsonQueueFallback(function () {
                setTimeout(plainReload, BACKOFF_MS);
            });
        }
    }

    function setupTasksBlankRecovery() {
        const startedAt = Date.now();
        let finished = false;
        let loadCompleteAt = (document.readyState === 'complete') ? Date.now() : 0;
        window.addEventListener('load', () => { if (!loadCompleteAt) loadCompleteAt = Date.now(); });

        const poll = () => {
            if (finished) return;
            if (isDuplicateTab) { finished = true; return; }

            if (tasksPageRendered()) {
                finished = true;
                try { sessionStorage.removeItem(BLANK_RETRY_KEY); } catch (e) {}
                return;
            }

            const now = Date.now();
            const stuckAfterLoad = loadCompleteAt && (now - loadCompleteAt >= POST_LOAD_GRACE_MS);
            const hardTimeout = (now - startedAt >= HARD_DEADLINE_MS);

            if (stuckAfterLoad || hardTimeout) {
                const text = (document.body && document.body.innerText || '').trim();
                if (text.length < 120) {
                    finished = true;
                    recordRetryAndRecover();
                    return;
                }
                finished = true;
                try { sessionStorage.removeItem(BLANK_RETRY_KEY); } catch (e) {}
                return;
            }
            setTimeout(poll, POLL_INTERVAL_MS);
        };
        setTimeout(poll, 1500);
    }

    // ============ TIMER-BASED AUTO-REDIRECT & RELOAD ============

    if (fullUrl === "https://worker.mturk.com/tasks" || fullUrl.includes("/tasks?")) {
        setupTasksBlankRecovery();
        setTimeout(() => {
            if (!isDuplicateTab) {
                console.log('[MTurk Mgr] 150s tick - plain reload');
                plainReload();
            }
        }, QUEUE_RELOAD_MS);
        return; 
    }

    if (fullUrl.includes("/projects/")) return; 

    let waitTime = null;
    
    // আপনার দেওয়া ৫টি লিংক এবং টাইমার এখানে একদম নিখুঁতভাবে বসানো আছে
    if (fullUrl === "https://worker.mturk.com/" || fullUrl === "https://worker.mturk.com") {
        waitTime = 30000;
    } else if (fullUrl.includes("/qualifications/assigned")) {
        waitTime = 120000;
    } else if (fullUrl.includes("/qualifications/pending")) {
        waitTime = 60000; 
    } else if (fullUrl.includes("/earnings")) {
        waitTime = 30000;
    } else if (fullUrl.includes("/dashboard")) {
        waitTime = 60000;
    } else if (fullUrl.endsWith("/projects") || fullUrl.includes("/projects?")) {
        waitTime = 30000;
    } else if (fullUrl.includes("/status_details")) {
        waitTime = 60000;
    }

    if (waitTime !== null) {
        setTimeout(() => {
            if (!isDuplicateTab) {
                console.log('[MTurk Mgr] Timer expired - Redirecting to Tasks link');
                window.location.href = "https://worker.mturk.com/tasks";
            }
        }, waitTime);
    }

    console.log('[MTurk Mgr] Content script loaded on', fullUrl);
})();