function updateIcon() {
    document.getElementById('playIcon').style.display = isPlaying ? 'none' : 'inline';
    document.getElementById('pauseIcon').style.display = isPlaying ? 'inline' : 'none';
    document.getElementById('playerCover')?.classList.toggle('is-spinning', !!isPlaying);
    updateVideoStageToggle(!videoStageMinimized);
}

function setTrackLoading(loading, idx) {
    document.getElementById('playBtn').classList.toggle('loading', loading);
    document.querySelectorAll('.card.is-loading, .song-row.is-loading').forEach(c => c.classList.remove('is-loading'));
    if (loading && idx != null && idx !== -1) {
        const item = document.querySelector(`.card[data-idx="${idx}"], .song-row[data-idx="${idx}"]`);
        if (item) item.classList.add('is-loading');
    }
}
function format(sec) { if (!sec || isNaN(sec)) return "0:00"; const m = Math.floor(sec / 60); const s = Math.floor(sec % 60); return `${m}:${s < 10 ? '0' + s : s}`; }

function isFavoriteSong(song) {
    return !!song && favorites.some(favorite => favorite.title === song.title && favorite.artist === song.artist);
}

function syncFavoriteControl(control, song) {
    if (!control) return;
    const active = isFavoriteSong(song);
    control.classList.toggle('active', active);
    control.title = active ? 'Quitar de favoritos' : 'Guardar en favoritos';
    control.setAttribute('aria-label', control.title);
    const icon = control.querySelector('i');
    if (icon) icon.className = `${active ? 'fas' : 'far'} fa-heart`;
}

function toggleFavoriteSong(song, control = null) {
    if (!song) return false;
    const idx = favorites.findIndex(favorite => favorite.title === song.title && favorite.artist === song.artist);
    if (idx >= 0) {
        favorites.splice(idx, 1);
        showToast('Quitado de favoritos', 'fa-heart-crack');
    } else {
        favorites.push(song);
        showToast('Añadido a favoritos', 'fa-heart');
    }
    localStorage.setItem('nowarfy_favs', JSON.stringify(favorites));
    if (window.nowarfyStorage) void window.nowarfyStorage.set('nowarfy_favs', favorites);
    scheduleNowarfyTasteSync();
    syncFavoriteControl(control, song);
    updateFavButton(currentQueueSong());
    return idx < 0;
}

function toggleFavorite() {
    const song = currentQueueSong();
    if (song) toggleFavoriteSong(song);
}

function updateFavButton(song) {
    const button = document.getElementById('favBtn');
    if (!button) return;
    const exists = isFavoriteSong(song);
    button.className = exists ? 'fas fa-heart fav-btn active' : 'far fa-heart fav-btn';
}
function toggleShuffle() { shuffleMode = !shuffleMode; const icon = document.getElementById('shuffleIcon'); icon.classList.toggle('on', shuffleMode); icon.style.opacity = shuffleMode ? '1' : '0.5'; }

function initVolume() {
    const saved = parseFloat(localStorage.getItem('nowarfy_vol'));
    const vol = isNaN(saved) ? 0.8 : saved;
    document.getElementById('volumeSlider').value = vol;
    applyVolume(vol);
}
function setVolume(v) {
    v = Math.max(0, Math.min(1, parseFloat(v)));
    lastVolume = v;
    if (nowarfyAuthUser && nowarfyRemoteSession && !nowarfyRemoteIsPlayer) {
        const slider = document.getElementById('volumeSlider');
        if (slider) { slider.value = v; slider.style.background = `linear-gradient(to right, var(--accent) ${v * 100}%, #535353 ${v * 100}%)`; }
        localStorage.setItem('nowarfy_vol', v);
        void sendNowarfyCommand('volume', Math.round(v * 100), true);
        return;
    }
    if (externalAudioFocusInterrupted) {
        const slider = document.getElementById('volumeSlider');
        if (slider) { slider.value = v; slider.style.background = `linear-gradient(to right, var(--accent) ${v * 100}%, #535353 ${v * 100}%)`; }
        externalAudioFocusVolume = v;
        localStorage.setItem('nowarfy_vol', v);
        return;
    }
    applyVolume(v);
    localStorage.setItem('nowarfy_vol', v);
}
function applyPlaybackVolume(v) {
    const safe = Math.max(0, Math.min(1, Number(v) || 0));
    audioEl.volume = safe;
    nextAudioEl.volume = safe;
    freeVideoEl.volume = safe;
    if (ytPlayer && ytPlayer.setVolume) ytPlayer.setVolume(safe * 100);
}
function applyVolume(v) {
    const safe = Math.max(0, Math.min(1, parseFloat(v)));
    applyPlaybackVolume(safe);
    const slider = document.getElementById('volumeSlider');
    slider.value = safe;
    slider.style.background = `linear-gradient(to right, var(--accent) ${safe * 100}%, #535353 ${safe * 100}%)`;
    const icon = document.getElementById('volIcon');
    icon.className = (safe == 0 ? 'fas fa-volume-mute' : safe < 0.5 ? 'fas fa-volume-down' : 'fas fa-volume-up') + ' btn-control';
}
function getCurrentPlaybackVolume(song = currentQueueSong()) {
    try {
        if (song?.type === 'yt' && ytPlayer?.getVolume) return Math.max(0, Math.min(1, Number(ytPlayer.getVolume()) / 100));
        if (activeAudioEl) return Math.max(0, Math.min(1, Number(activeAudioEl.volume)));
    } catch (error) {}
    return Math.max(0, Math.min(1, Number(lastVolume) || 0));
}
function fadeNowarfyVolume(target, duration = 280) {
    const safeTarget = Math.max(0, Math.min(1, Number(target) || 0));
    const start = getCurrentPlaybackVolume();
    clearInterval(externalAudioFocusFadeTimer);
    return new Promise(resolve => {
        const startedAt = performance.now();
        const tick = () => {
            const progress = Math.min(1, (performance.now() - startedAt) / duration);
            const eased = 1 - Math.pow(1 - progress, 3);
            const value = start + (safeTarget - start) * eased;
            applyPlaybackVolume(value);
            if (progress >= 1) {
                clearInterval(externalAudioFocusFadeTimer);
                externalAudioFocusFadeTimer = null;
                resolve();
            }
        };
        tick();
        externalAudioFocusFadeTimer = window.setInterval(tick, 32);
    });
}
function toggleMute() {
    const slider = document.getElementById('volumeSlider');
    const current = parseFloat(slider.value);
    if (current > 0) { lastVolume = current; setVolume(0); }
    else { setVolume(lastVolume || 0.8); }
}

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        const tag = document.activeElement.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        switch (e.code) {
            case 'Space': e.preventDefault(); togglePlay(); break;
            case 'ArrowRight': seekBy(5); break;
            case 'ArrowLeft': seekBy(-5); break;
            case 'ArrowUp': e.preventDefault(); adjustVolume(0.05); break;
            case 'ArrowDown': e.preventDefault(); adjustVolume(-0.05); break;
        }
    });
}
function adjustVolume(delta) {
    const slider = document.getElementById('volumeSlider');
    let v = Math.min(1, Math.max(0, parseFloat(slider.value) + delta));
    setVolume(v);
}

function setupBackgroundPlaybackSupport() {
    [audioEl, nextAudioEl, freeVideoEl, silentAudioLoop].forEach(media => {
        if (!media) return;
        media.setAttribute('preload', media === silentAudioLoop ? 'auto' : 'metadata');
        if (media !== audioEl && media !== nextAudioEl && media !== silentAudioLoop) media.setAttribute('playsinline', '');
        media.addEventListener('play', updatePlaybackState);
        media.addEventListener('pause', updatePlaybackState);
        media.addEventListener('ended', updatePlaybackState);
    });
    if ('mediaSession' in navigator) {
        try { navigator.mediaSession.playbackState = 'none'; } catch (e) {}
    }
    setupAudioSessionSupport();
}
function pauseNowarfyForExternalAudio() {
    if (NOWARFY_AUDIO_PRIORITY_MODE || externalAudioFocusInterrupted) return;
    const song = currentQueueSong();
    const wasIntendedToPlay = !playbackStoppedByUser && (isPlaying || (song?.type === 'yt' && ytPlaybackIntent));
    if (!wasIntendedToPlay) return;
    externalAudioFocusInterrupted = true;
    externalAudioFocusResumePending = true;
    const restoreVolume = getCurrentPlaybackVolume(song);
    externalAudioFocusVolume = Number.isFinite(restoreVolume) ? restoreVolume : Math.max(0, Math.min(1, Number(lastVolume) || 0));
    if (song?.type === 'yt') ytPlaybackIntent = false;
    stopSilentLoop();
    isPlaying = false;
    void fadeNowarfyVolume(0, 280).then(() => {
        if (!externalAudioFocusInterrupted || currentQueueSong()?.url !== song?.url) return;
        if (song?.type === 'yt') {
            try { ytPlayer?.pauseVideo?.(); } catch (error) {}
        } else {
            try { activeAudioEl?.pause?.(); } catch (error) {}
        }
    });
    persistVideoResumeSession(true);
    updateIcon();
    updatePlaybackState();
}

function scheduleExternalAudioResumeCheck(expectedQid, reason = 'resume-check') {
    clearTimeout(externalAudioFocusResumeCheckTimer);
    if (!externalAudioFocusInterrupted || !externalAudioFocusResumePending || playbackStoppedByUser) return;
    const delay = EXTERNAL_AUDIO_RESUME_RETRY_MS + (Math.min(externalAudioFocusRecoveryAttempts, 8) * 750);
    externalAudioFocusResumeCheckTimer = window.setTimeout(() => {
        externalAudioFocusResumeCheckTimer = null;
        if (currentPlayingQid !== expectedQid || playbackStoppedByUser || !externalAudioFocusInterrupted) return;
        if (navigator.audioSession?.state === 'interrupted') {
            scheduleExternalAudioResumeCheck(expectedQid, 'audio-session-still-interrupted');
            return;
        }
        resumeNowarfyAfterExternalAudio(reason);
    }, delay);
}

function resumeNowarfyAfterExternalAudio(reason = 'external-audio-ended') {
    if (NOWARFY_AUDIO_PRIORITY_MODE || !externalAudioFocusInterrupted || externalAudioFocusResumeAttempting) return;
    if (navigator.audioSession?.state === 'interrupted') return;
    clearTimeout(externalAudioFocusRecoveryTimer);
    externalAudioFocusRecoveryTimer = null;
    const shouldResume = externalAudioFocusResumePending && !playbackStoppedByUser && !!currentPlayingQid;
    if (!shouldResume) {
        externalAudioFocusInterrupted = false;
        externalAudioFocusResumePending = false;
        externalAudioFocusLastState = '';
        clearTimeout(externalAudioFocusResumeCheckTimer);
        externalAudioFocusResumeCheckTimer = null;
        updatePlaybackState();
        return;
    }
    const song = currentQueueSong();
    if (!song) return;
    const expectedQid = currentPlayingQid;
    const restoreVolume = Number.isFinite(externalAudioFocusVolume) ? externalAudioFocusVolume : Math.max(0, Math.min(1, Number(lastVolume) || 0));
    externalAudioFocusRecoveryAttempts += 1;
    externalAudioFocusResumeAttempting = true;
    externalAudioFocusInterrupted = false;
    externalAudioFocusResumePending = false;
    externalAudioFocusLastState = '';
    externalAudioFocusVolume = null;
    isPlaying = false;
    let playStarted = false;
    if (song.type === 'yt' && ytPlayer?.playVideo) {
        ytPlaybackIntent = true;
        playStarted = requestYouTubePlayback(reason);
        startSilentLoop();
        void fadeNowarfyVolume(restoreVolume, 360);
    } else if (activeAudioEl?.play) {
        const playAttempt = activeAudioEl.play();
        playStarted = true;
        if (playAttempt?.catch) playAttempt.catch(() => { playStarted = false; isPlaying = false; updateIcon(); });
        void fadeNowarfyVolume(restoreVolume, 360);
    }
    if (playStarted) isPlaying = true;
    updateIcon();
    updatePlaybackState();
    window.setTimeout(() => {
        externalAudioFocusResumeAttempting = false;
        const current = currentQueueSong();
        if (currentPlayingQid !== expectedQid || playbackStoppedByUser) return;
        let playing = false;
        if (current?.type === 'yt') {
            try { playing = ytPlayer?.getPlayerState?.() === window.YT?.PlayerState?.PLAYING; } catch (error) { playing = false; }
        } else playing = !!(activeAudioEl && !activeAudioEl.paused);
        if (playing) {
            externalAudioFocusRecoveryAttempts = 0;
            return;
        }
        externalAudioFocusInterrupted = true;
        externalAudioFocusResumePending = true;
        externalAudioFocusLastState = `probable:resume-rejected:${reason}`;
        isPlaying = false;
        stopSilentLoop();
        persistVideoResumeSession(true);
        updateIcon();
        updatePlaybackState();
        scheduleExternalAudioResumeCheck(expectedQid, 'resume-rejected');
    }, 1100);
}

function schedulePossibleExternalAudioYield(reason = 'unexpected-pause') {
    if (NOWARFY_AUDIO_PRIORITY_MODE || externalAudioFocusInterrupted || playbackStoppedByUser || !currentPlayingQid) return;
    const song = currentQueueSong();
    const wasIntendedToPlay = isPlaying || (song?.type === 'yt' && ytPlaybackIntent);
    if (!wasIntendedToPlay) return;
    externalAudioFocusInterrupted = true;
    externalAudioFocusResumePending = true;
    externalAudioFocusLastState = `probable:${reason}`;
    const restoreVolume = getCurrentPlaybackVolume(song);
    externalAudioFocusVolume = Number.isFinite(restoreVolume) ? restoreVolume : Math.max(0, Math.min(1, Number(lastVolume) || 0));
    if (song?.type === 'yt') ytPlaybackIntent = false;
    stopSilentLoop();
    isPlaying = false;
    void fadeNowarfyVolume(0, 280).then(() => {
        if (!externalAudioFocusInterrupted || currentQueueSong()?.url !== song?.url) return;
        if (song?.type === 'yt') {
            try { ytPlayer?.pauseVideo?.(); } catch (error) {}
        } else {
            try { activeAudioEl?.pause?.(); } catch (error) {}
        }
    });
    persistVideoResumeSession(true);
    updateIcon();
    updatePlaybackState();
    clearTimeout(externalAudioFocusRecoveryTimer);
    externalAudioFocusRecoveryTimer = null;
}

function scheduleExternalAudioResume(reason = 'focus-return') {
    if (NOWARFY_AUDIO_PRIORITY_MODE || !externalAudioFocusInterrupted || navigator.audioSession?.state === 'interrupted') return;
    clearTimeout(externalAudioFocusRecoveryTimer);
    externalAudioFocusRecoveryTimer = window.setTimeout(() => {
        externalAudioFocusRecoveryTimer = null;
        resumeNowarfyAfterExternalAudio();
    }, EXTERNAL_AUDIO_RESUME_DELAY_MS);
}

function handleAudioSessionStateChange() {
    const state = String(navigator.audioSession?.state || '');
    externalAudioFocusLastState = state;
    if (state === 'interrupted') pauseNowarfyForExternalAudio();
    else if (!NOWARFY_AUDIO_PRIORITY_MODE && state !== 'interrupted' && externalAudioFocusInterrupted) resumeNowarfyAfterExternalAudio();
}

function setupAudioSessionSupport() {
    const session = navigator.audioSession;
    if (!session?.addEventListener) return;
    try { session.type = 'playback'; } catch (error) {}
    session.addEventListener('statechange', handleAudioSessionStateChange);
    handleAudioSessionStateChange();
}

function startSilentLoop() {
    if (!silentAudioLoop || externalAudioFocusInterrupted) return;
    if (silentAudioLoop.ended) silentAudioLoop.currentTime = 0;
    const playAttempt = silentAudioLoop.play();
    if (playAttempt?.catch) playAttempt.catch(() => {});
}
function stopSilentLoop() {
    if (!silentAudioLoop) return;
    silentAudioLoop.pause();
}
function updateMediaSession(song) {
    if (!('mediaSession' in navigator) || !song) return;
    try {
        const nextSongKey = `${song.type || ''}:${song.url || ''}`;
        navigator.mediaSession.metadata = new MediaMetadata({
            title: song.title || 'Nowarfy YouToo',
            artist: song.artist || song.channelTitle || 'Nowarfy',
            album: 'Nowarfy YouToo',
            artwork: song.img ? [{ src: song.img, sizes: '512x512', type: 'image/png' }] : []
        });
        if (!mediaSessionHandlersReady || mediaSessionSongKey !== nextSongKey) {
            const registerAction = (action, handler) => {
                try { navigator.mediaSession.setActionHandler(action, handler); } catch (e) {}
            };
            registerAction('play', () => { if (!isPlaying) togglePlay(); });
            registerAction('pause', () => { if (isPlaying) togglePlay(); });
            registerAction('stop', () => { if (isPlaying) togglePlay(); });
            registerAction('previoustrack', prevSong);
            registerAction('nexttrack', () => nextSong(true));
            registerAction('seekbackward', (d) => seekBy(-(d.seekOffset || 10)));
            registerAction('seekforward', (d) => seekBy(d.seekOffset || 10));
            registerAction('seekto', (d) => {
                const duration = getDuration();
                if (duration && Number.isFinite(d.seekTime)) commitSeek(d.seekTime / duration);
            });
            mediaSessionHandlersReady = true;
            mediaSessionSongKey = nextSongKey;
        }
    } catch (e) {}
}
function updateMediaPosition(duration, position) {
    if (!('mediaSession' in navigator) || !('setPositionState' in navigator.mediaSession)) return;
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position)) return;
    const safePosition = Math.min(Math.max(position, 0), duration);
    try { navigator.mediaSession.setPositionState({ duration, position: safePosition, playbackRate: 1 }); } catch (e) {}
}
function updatePlaybackState() {
    if (!('mediaSession' in navigator)) return;
    try { navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'; } catch (e) {}
}
function setupPlaybackContinuity() {
    const inspectCurrentPlayback = () => {
        if (externalAudioFocusInterrupted || playbackStoppedByUser || !currentPlayingQid) return;
        const current = currentQueueSong();
        if (!current) return;
        if (current.type === 'mp3' && isPlaying && activeAudioEl?.ended) {
            queueAutomaticAdvance('direct-ended-fallback');
            return;
        }
        if (current.type === 'mp3' && NOWARFY_AUDIO_PRIORITY_MODE && !playbackStoppedByUser && activeAudioEl?.paused && !activeAudioEl?.ended) {
            const playAttempt = activeAudioEl.play?.();
            if (playAttempt?.catch) playAttempt.catch(() => {});
            return;
        }
        if (current.type !== 'yt' || !ytPlayer?.getPlayerState || !window.YT) return;
        let state = null;
        let position = 0;
        let duration = 0;
        try {
            state = ytPlayer.getPlayerState();
            position = Number(ytPlayer.getCurrentTime?.() || 0);
            duration = Number(ytPlayer.getDuration?.() || 0);
        } catch (error) { return; }
        if (state === YT.PlayerState.ENDED || (duration > 0 && position >= Math.max(0, duration - YT_END_EARLY_TOLERANCE_SECONDS) && ytPlaybackIntent)) {
            queueAutomaticAdvance('youtube-timed-ended-fallback');
            return;
        }
        if (state === YT.PlayerState.BUFFERING || state === YT.PlayerState.PLAYING) return;
        if (ytPlaybackIntent && !playbackStoppedByUser && (state === YT.PlayerState.PAUSED || state === YT.PlayerState.UNSTARTED || state === YT.PlayerState.CUED)) {
            if (!isPlaying) {
                isPlaying = true;
                updateIcon();
                updatePlaybackState();
            }
            startSilentLoop();
            requestYouTubePlayback(`heartbeat-${state}`);
        }
    };
    automaticAdvanceTimer = null;
    window.setInterval(inspectCurrentPlayback, PLAYBACK_CONTINUITY_CHECK_MS);
    silentAudioLoop?.addEventListener('timeupdate', inspectCurrentPlayback);
    silentAudioLoop?.addEventListener('playing', inspectCurrentPlayback);
    silentAudioLoop?.addEventListener('pause', () => {
        if (mediaTransitionInProgress || NOWARFY_AUDIO_PRIORITY_MODE || externalAudioFocusInterrupted || playbackStoppedByUser || (document.visibilityState !== 'hidden' && (typeof document.hasFocus !== 'function' || document.hasFocus()))) return;
        schedulePossibleExternalAudioYield('anchor-paused-out-of-focus');
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && externalAudioFocusInterrupted) scheduleExternalAudioResume('visibility-return');
        inspectCurrentPlayback();
    });
    window.addEventListener('focus', () => {
        if (externalAudioFocusInterrupted) scheduleExternalAudioResume('focus-return');
        inspectCurrentPlayback();
    });
}

function handleNowarfyVisibilityChange() {
    nowarfyPageHidden = document.visibilityState === 'hidden';
    syncVideoClassificationReviewTimer();
    syncNowarfyRemoteTimers();
    updateRemoteShadowTimer();
    if (nowarfyPageHidden) {
        if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
        if (ambientArtworkRotationTimer) { clearInterval(ambientArtworkRotationTimer); ambientArtworkRotationTimer = null; }
        persistVideoResumeSession(true);
    } else {
        refreshAmbientArtworkFromCatalog();
        if (nowarfyProgressSource && isPlaying) startProgress(nowarfyProgressSource);
        updateRemoteShadowProgress();
    }
}

function setupBackgroundPersistence() {
    const save = () => { flushNowarfyPersistence(); if (nowarfyRemoteIsPlayer) void publishNowarfyRemoteState(); };
    document.addEventListener('visibilitychange', () => {
        handleNowarfyVisibilityChange();
        if (nowarfyPageHidden) save();
    });
    window.addEventListener('pagehide', save);
    window.addEventListener('freeze', save);
}

let deferredInstallPrompt = null;

function isStandaloneApp() {
    return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
}

async function requestPwaInstall() {
    const installButton = document.getElementById('pwaInstallBtn');
    if (!deferredInstallPrompt) {
        const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
        showToast(isIOS ? 'En Safari: Compartir → Agregar a pantalla de inicio' : 'La instalación estará disponible cuando el navegador termine de preparar la aplicación', 'fa-mobile-screen-button');
        return;
    }
    deferredInstallPrompt.prompt();
    const result = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installButton.hidden = true;
    showToast(result.outcome === 'accepted' ? 'Nowarfy se instaló en este dispositivo' : 'Instalación cancelada', result.outcome === 'accepted' ? 'fa-circle-check' : 'fa-circle-xmark');
}

let nowarfyHardResetInFlight = false;
async function hardResetNowarfy(event) {
    event?.preventDefault?.();
    if (nowarfyHardResetInFlight) return;
    nowarfyHardResetInFlight = true;
    const button = event?.currentTarget?.closest?.('.brand-youtoo') || document.querySelector('.brand-youtoo');
    button?.setAttribute('aria-busy', 'true');
    try {
        if ('caches' in window) {
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.filter(name => /^nowarfy(?:-|$)/i.test(name)).map(name => caches.delete(name)));
        }
        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.map(registration => registration.update().catch(() => null)));
        }
        const freshUrl = new URL(window.location.href);
        freshUrl.searchParams.set('_nowarfy_reload', String(Date.now()));
        window.location.replace(freshUrl.toString());
    } catch (error) {
        window.location.reload();
    }
}

function setupInstallableApp() {
    const installButton = document.getElementById('pwaInstallBtn');
    if (installButton) installButton.addEventListener('click', requestPwaInstall);
    window.addEventListener('beforeinstallprompt', event => {
        event.preventDefault();
        deferredInstallPrompt = event;
        if (installButton && !isStandaloneApp()) installButton.hidden = false;
    });
    window.addEventListener('appinstalled', () => {
        deferredInstallPrompt = null;
        if (installButton) installButton.hidden = true;
        showToast('Nowarfy ya está instalada', 'fa-circle-check');
    });
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (installButton && isIOS && !isStandaloneApp()) installButton.hidden = false;
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
    }, { once: true });
}

let nowarfyQrPreviousFocus = null;
function openNowarfyQr() {
    const modal = document.getElementById('nowarfyQrModal');
    if (!modal) return;
    nowarfyQrPreviousFocus = document.activeElement;
    modal.hidden = false;
    document.body.classList.add('qr-modal-open');
    modal.querySelector('.nowarfy-qr-close')?.focus();
}
function closeNowarfyQr() {
    const modal = document.getElementById('nowarfyQrModal');
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.body.classList.remove('qr-modal-open');
    nowarfyQrPreviousFocus?.focus?.();
}
window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeNowarfyQr();
});

// --- MODO FLOTANTE (ARRASTRE + RETORNO) ---
let isFloating = false;

function toggleFloatingMode() {
    isFloating = !isFloating;

    if (isFloating) {
        playerBar.classList.add('floating');
        pipBtn.classList.add('active');
        pipBtn.classList.remove('fa-compress-arrows-alt');
        pipBtn.classList.add('fa-expand-arrows-alt');
        makeDraggable(playerBar);
        showToast('Reproductor flotante activado', 'fa-up-right-and-down-left-from-center');
    } else {
        playerBar.classList.remove('floating');
        pipBtn.classList.remove('active');
        pipBtn.classList.remove('fa-expand-arrows-alt');
        pipBtn.classList.add('fa-compress-arrows-alt');
        playerBar.onmousedown = null;
        playerBar.style.top = '';
        playerBar.style.left = '';
        playerBar.style.right = '';
    }
}

function makeDraggable(element) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

    element.onmousedown = dragMouseDown;

    function dragMouseDown(e) {
        e = e || window.event;
        if (e.target.closest('button, .fav-btn, input, .volume-slider, .progress-track, .floating-restore-btn')) return;
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        const rect = element.getBoundingClientRect();
        element.style.top = rect.top + 'px';
        element.style.left = rect.left + 'px';
        element.style.right = 'auto';
        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
        e = e || window.event;
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;

        let newTop = element.offsetTop - pos2;
        let newLeft = element.offsetLeft - pos1;

        const maxTop = window.innerHeight - element.offsetHeight - 8;
        const maxLeft = window.innerWidth - element.offsetWidth - 8;
        newTop = Math.min(Math.max(8, newTop), Math.max(8, maxTop));
        newLeft = Math.min(Math.max(8, newLeft), Math.max(8, maxLeft));

        element.style.top = newTop + "px";
        element.style.left = newLeft + "px";
    }

    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;
    }
}

handleNowarfyPairingLink();
void initNowarfyAuth();
setTimeout(() => {
    initTouchSwipeGestures();
    initScrollAssemblyEngine();
}, 100);
