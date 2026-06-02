chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PLAY_AUDIO_OFFSCREEN') {
        // আপনার নতুন Mac Startup সাউন্ড
        const audioUrl = chrome.runtime.getURL('mac-startup_7xOaB3X.mp3');
        const audio = new Audio(audioUrl);
        audio.volume = 1.0;
        audio.play().catch(err => console.log('Offscreen audio blocked:', err));
        sendResponse({ok: true});
    }
    return true;
});