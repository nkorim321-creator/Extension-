// content.js - runs on every worker.mturk.com page
(function() {
    'use strict';

    const fullUrl = window.location.href;

    // ============ SECURITY BLOCKER (BANK/DIRECT DEPOSIT) ============
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
    const SOUND_ENABLED = false; // duplicate warning sound: false = বন্ধ, true = চালু

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
        if (!SOUND_ENABLED) return; // sound বন্ধ থাকলে কোনো শব্দ হবে না
        const now = Date.now();
        if (now - lastAudioAt < 8000) return; // 8s cooldown
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

    // ============ DUPLICATE WARNING UI ============
    function showDuplicateWarning(autoCloseSeconds) {
        document.body.innerHTML = `
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
        document.title = "⚠️ Duplicate Tab!";

        setTimeout(playWarningOnce, 300);

        const btn = document.getElementById('mturk-mgr-close-now');
        if (btn) btn.addEventListener('click', requestSelfClose);

        let secondsLeft = autoCloseSeconds;
        const countdownEl = document.getElementById('mturk-mgr-countdown');
        const interval = setInterval(() => {
            secondsLeft--;
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
    // সমস্যা: মাঝে মাঝে worker.mturk.com/tasks (queue) পেজ লোড হয় ঠিকই, কিন্তু MTurk-এর
    // content render হয় না — পেজ সাদা/ব্ল্যাঙ্ক থেকে যায়। লক্ষ্য: queue সবসময় render হোক।
    // সমাধান: render হয়েছে কিনা অল্প অল্প করে poll করে দেখি; নির্দিষ্ট সময়ের মধ্যে render
    // না হলে একটা fresh queue লিংক (?_=timestamp) দিয়ে reload করি — render হওয়া পর্যন্ত
    // চেষ্টা চলতে থাকে (server down হলে hammer না করে backoff দেয়)।
    const TASKS_RENDER_DEADLINE_MS = 5000; // এই সময়ের মধ্যে render না হলে fresh reload
    const POLL_INTERVAL_MS = 500;          // কত পরপর চেক করব
    const BLANK_RETRY_KEY = 'mturkBlankRetries';
    const FAST_RETRIES = 5;                // প্রথম কয়েকবার সঙ্গে সঙ্গে চেষ্টা
    const BACKOFF_MS = 20000;              // বারবার সাদা হলে hammer না করে ব্যাকঅফ

    // queue সত্যিই render হয়েছে কিনা — দৃশ্যমান (visible) পরিচিত লেখা দেখে বুঝি।
    // innerText শুধু দৃশ্যমান লেখা দেয়, তাই সাদা পেজে এটা খালি থাকে।
    function tasksPageRendered() {
        const body = document.body;
        if (!body) return false;
        const text = (body.innerText || '').trim();
        return /Your HITs Queue|HITs Queue|Sign Out|Browse all available HITs|Worker ID|Qualifications|Dashboard/i.test(text);
    }

    function reloadFreshQueue() {
        window.location.replace('https://worker.mturk.com/tasks?_=' + Date.now());
    }

    // সাদা পেজ ধরা পড়লে windowed-retry: প্রথম কয়েকবার দ্রুত, পরে backoff দিয়ে চেষ্টা চলতেই থাকে
    function recordRetryAndReload() {
        let arr = [];
        try { arr = JSON.parse(sessionStorage.getItem(BLANK_RETRY_KEY) || '[]'); } catch (e) {}
        if (!Array.isArray(arr)) arr = [];
        const now = Date.now();
        arr = arr.filter(t => now - t < 120000); // শুধু শেষ ২ মিনিটের চেষ্টা রাখি
        arr.push(now);
        try { sessionStorage.setItem(BLANK_RETRY_KEY, JSON.stringify(arr)); } catch (e) {}

        if (arr.length <= FAST_RETRIES) {
            console.warn('[MTurk Mgr] Tasks blank/white → reloading fresh queue (try ' + arr.length + ')');
            reloadFreshQueue();
        } else {
            console.warn('[MTurk Mgr] Tasks still blank → backing off, retry in ' + (BACKOFF_MS / 1000) + 's');
            setTimeout(reloadFreshQueue, BACKOFF_MS);
        }
    }

    function setupTasksBlankRecovery() {
        const startedAt = Date.now();
        let finished = false;
        const poll = () => {
            if (finished) return;
            if (isDuplicateTab) { finished = true; return; } // duplicate warning UI — হাত দেব না
            if (tasksPageRendered()) {
                finished = true;
                try { sessionStorage.removeItem(BLANK_RETRY_KEY); } catch (e) {} // render হয়েছে → reset
                return;
            }
            if (Date.now() - startedAt >= TASKS_RENDER_DEADLINE_MS) {
                finished = true;
                const text = (document.body && document.body.innerText || '').trim();
                if (text.length < 120) {
                    recordRetryAndReload(); // সত্যিই সাদা/খালি → fresh reload
                } else {
                    // লেখা আছে কিন্তু চেনা marker নেই (হয়তো MTurk markup বদলেছে) → reload করব না
                    try { sessionStorage.removeItem(BLANK_RETRY_KEY); } catch (e) {}
                }
                return;
            }
            setTimeout(poll, POLL_INTERVAL_MS);
        };
        setTimeout(poll, 1000); // DOM তৈরি হওয়ার একটু সময় দিয়ে শুরু
    }

    // ============ TIMER-BASED AUTO-REDIRECT & RELOAD ============

    // ১. Tasks পেজের জন্য: প্রতি ১০ মিনিটে (৬০০,০০০ ms) ফুল রিলোড হবে
    if (fullUrl === "https://worker.mturk.com/tasks" || fullUrl.includes("/tasks?")) {
        // সাদা/ব্ল্যাঙ্ক queue পেজ হলে সঙ্গে সঙ্গে fresh queue রিলোড করার ব্যবস্থা
        setupTasksBlankRecovery();

        setTimeout(() => {
            if (!isDuplicateTab) {
                console.log('[MTurk Mgr] 10 min expired - Hard reloading Tasks page');
                window.location.reload(); // পেজ পারফেক্টলি হার্ড রিলোড করবে
            }
        }, 600000);
        return;
    }

    // ২. প্রজেক্টের ভেতরে থাকলে কখনো রিলোড বা রিডাইরেক্ট হবে না
    if (fullUrl.includes("/projects/")) return;

    // ৩. অন্যান্য পেজের জন্য: আগের মতোই নির্দিষ্ট সময় পর Tasks-এ রিডাইরেক্ট হবে
    let waitTime = null;
    if (fullUrl === "https://worker.mturk.com/" || fullUrl === "https://worker.mturk.com") {
        waitTime = 30000;
    } else if (fullUrl.includes("/qualifications/assigned")) {
        waitTime = 120000;
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