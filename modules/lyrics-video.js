function isVisualVideo(song) {
    return !!song && (song.type === 'yt' || song.type === 'freevideo');
}

function lyricsTextKey(value) {
    return normalizeSourceText(value)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function lyricsArtistName(song) {
    return normalizeSourceText(song?.artist || song?.channelTitle || '')
        .replace(/\b(official|music|channel|canal)\b/gi, ' ')
        .replace(/\s*[-|·–—]\s*(?:topic|official)\s*$/i, ' ')
        .replace(/(?:vevo|topic)$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
}
function lyricsTrackTitle(song) {
    let title = normalizeSourceText(song?.title || '')
        .replace(/\s*[([{]([^\])}]{0,120})[\])}]/g, (full, inner) => /\b(?:official|music|video|audio|lyrics?|lyric|visualizer|hd|hq|4k|vevo)\b/i.test(inner) ? ' ' : full)
        .replace(/\s+(?:official\s+)?(?:music\s+)?(?:video|audio|lyrics?|lyric|visualizer|hd|hq|4k)\s*$/i, ' ')
        .replace(/\s*[|·–—-]\s*(?:official|music|audio|video|lyrics?|lyric|visualizer|vevo)\b.*$/i, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const artist = lyricsTextKey(lyricsArtistName(song));
    const embedded = title.match(/^(.{2,100}?)\s+[-–—|·]\s+(.{2,160})$/);
    if (embedded) {
        const prefix = lyricsTextKey(embedded[1]);
        const compactPrefix = prefix.replace(/\s/g, '');
        const compactArtist = artist.replace(/\s/g, '');
        if (prefix === artist || (compactPrefix && compactPrefix === compactArtist)) title = embedded[2].trim();
    }
    return title;
}

function lyricsSongKey(song) {
    return `${lyricsTextKey(lyricsArtistName(song))}::${lyricsTextKey(lyricsTrackTitle(song))}`;
}

function lyricsEligibleSong(song) {
    if (!song || song.isPlaylist || !['yt', 'mp3'].includes(song.type)) return false;
    const artist = lyricsArtistName(song);
    const title = lyricsTrackTitle(song);
    if (!artist || !title || /^(youtube|canal|unknown|nowarfy)$/i.test(artist)) return false;
    if (song.type === 'yt' && typeof isNonMusicalVideo === 'function' && isNonMusicalVideo(song)) return false;
    const text = `${title} ${artist} ${song.description || ''}`.toLowerCase();
    if (/podcast|interview|entrevista|audiobook|audiolibro|spoken word|lecture|narration|chapter|news|noticias|tutorial|review|reaction/.test(text)) return false;
    return true;
}

function readLyricsCache() {
    try {
        const cache = JSON.parse(localStorage.getItem(LYRICS_CACHE_KEY) || '{}');
        return cache && typeof cache === 'object' ? cache : {};
    } catch (error) { return {}; }
}

function writeLyricsCache(key, value) {
    try {
        const cache = readLyricsCache();
        cache[key] = { ...value, savedAt: Date.now() };
        const entries = Object.entries(cache)
            .sort(([, a], [, b]) => Number(b?.savedAt || 0) - Number(a?.savedAt || 0))
            .slice(0, LYRICS_CACHE_MAX_ITEMS);
        localStorage.setItem(LYRICS_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch (error) {}
}

function readCachedLyrics(key) {
    const entry = readLyricsCache()[key];
    if (!entry || Date.now() - Number(entry.savedAt || 0) > LYRICS_CACHE_MAX_AGE_MS) return null;
    return entry.data?.found && entry.data?.verified ? entry.data : null;
}

function plainLyricsFromRecord(track) {
    if (track?.plainLyrics) return String(track.plainLyrics).trim();
    const synced = String(track?.syncedLyrics || '').trim();
    return synced.replace(/^\s*\[[^\]]+\]\s*/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

function resetLyricsPanel() {
    lyricsRequestToken += 1;
    lyricsLoadingKey = '';
    currentLyrics = null;
    lyricsZoom = 1;
    const button = document.getElementById('lyricsToggleBtn');
    const panel = document.getElementById('lyricsPanel');
    const content = document.getElementById('lyricsContent');
    const status = document.getElementById('lyricsToolbarStatus');
    const source = document.getElementById('lyricsSourceLabel');
    const zoomValue = document.getElementById('lyricsZoomValue');
    if (button) { button.hidden = true; button.setAttribute('aria-expanded', 'false'); button.innerHTML = '<i class="fas fa-music"></i> Ver letra'; }
    if (panel) panel.hidden = true;
    if (content) { content.textContent = ''; content.style.fontSize = ''; }
    if (status) status.textContent = 'Letra verificada';
    if (source) source.textContent = 'Coincidencia corroborada por metadatos disponibles y la fuente pública.';
    if (zoomValue) zoomValue.textContent = '100%';
}

function renderLyricsPanel(data, song) {
    const text = plainLyricsFromRecord(data?.track);
    if (!data?.found || !data?.verified || !text || currentQueueSong()?.url !== song?.url) return false;
    const button = document.getElementById('lyricsToggleBtn');
    const status = document.getElementById('lyricsToolbarStatus');
    const content = document.getElementById('lyricsContent');
    const source = document.getElementById('lyricsSourceLabel');
    const sourceLink = document.getElementById('lyricsSourceLink');
    if (!button || !status || !content || !source || !sourceLink) return false;
    currentLyrics = { ...data, resourceId: song.url };
    content.textContent = text;
    button.hidden = false;
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = '<i class="fas fa-music"></i> Ver letra';
    status.textContent = `Letra verificada · ${data.track.source || 'fuente pública'}`;
    source.textContent = 'Coincidencia corroborada por metadatos disponibles y la fuente pública.';
    sourceLink.href = data.track.sourceUrl || 'https://lrclib.net/';
    return true;
}

async function loadVerifiedLyrics(song) {
    if (!lyricsEligibleSong(song)) return;
    const key = lyricsSongKey(song);
    if (currentLyrics?.resourceId === song.url || lyricsLoadingKey === key) return;
    lyricsLoadingKey = key;
    const token = ++lyricsRequestToken;
    const cached = readCachedLyrics(key);
    if (cached) { renderLyricsPanel(cached, song); lyricsLoadingKey = ''; return; }
    const params = new URLSearchParams({ title: lyricsTrackTitle(song), artist: lyricsArtistName(song) });
    const duration = Number(song.duration);
    if (Number.isFinite(duration) && duration > 0) params.set('duration', String(Math.round(duration)));
    try {
        const response = await fetch(`/api/lyrics?${params.toString()}`, { headers: { Accept: 'application/json' } });
        const data = await response.json().catch(() => null);
        if (token !== lyricsRequestToken || currentQueueSong()?.url !== song?.url) return;
        if (!response.ok || !data?.found || !data?.verified) return;
        writeLyricsCache(key, { data });
        renderLyricsPanel(data, song);
    } catch (error) {}
    finally {
        if (lyricsLoadingKey === key) lyricsLoadingKey = '';
    }
}

function toggleLyricsPanel() {
    const button = document.getElementById('lyricsToggleBtn');
    const panel = document.getElementById('lyricsPanel');
    if (!button || button.hidden || !panel || !currentLyrics) return;
    const show = panel.hidden;
    panel.hidden = !show;
    button.setAttribute('aria-expanded', String(show));
    button.innerHTML = show ? '<i class="fas fa-eye-slash"></i> Ocultar letra' : '<i class="fas fa-music"></i> Ver letra';
    if (show) document.getElementById('lyricsScroll')?.focus?.({ preventScroll: true });
}

function applyLyricsZoom() {
    const content = document.getElementById('lyricsContent');
    const value = document.getElementById('lyricsZoomValue');
    if (content) content.style.fontSize = `${lyricsZoom}rem`;
    if (value) value.textContent = `${Math.round(lyricsZoom * 100)}%`;
}

function changeLyricsZoom(delta) {
    if (!currentLyrics) return;
    lyricsZoom = Math.min(1.6, Math.max(.75, Math.round((lyricsZoom + Number(delta || 0)) * 100) / 100));
    applyLyricsZoom();
}

function resetLyricsZoom() {
    lyricsZoom = 1;
    applyLyricsZoom();
}

function renderVideoStageDetails(song) {
    const meta = document.getElementById('videoStageMeta');
    const description = document.getElementById('videoStageDescription');
    const channelButton = document.getElementById('videoStageChannelBtn');
    if (!meta || !description || !channelButton) return;
    const duration = formatContentDuration(song?.duration);
    const isFreeVideo = song?.type === 'freevideo';
    const channel = isFreeVideo ? 'Wikimedia Commons' : (song?.channelTitle || song?.artist || 'Canal público de YouTube');
    const kind = isFreeVideo ? `Video libre${song?.license ? ` · ${song.license}` : ''}` : (song?.isPlaylist ? 'Lista de reproducción' : 'Video de YouTube');
    const entries = [
        { icon: 'fa-clock', label: duration === '—' ? 'Duración en el reproductor' : duration },
        { icon: song?.isPlaylist ? 'fa-list' : 'fa-clapperboard', label: kind },
        { icon: isFreeVideo ? 'fa-leaf' : 'fa-satellite-dish', label: channel }
    ];
    meta.innerHTML = entries.map(entry => `<span><i class="fas ${entry.icon}"></i>${escapeHtml(entry.label)}</span>`).join('');
    const cleanDescription = descriptionExcerpt(song?.description || '', 430);
    description.textContent = cleanDescription || (isFreeVideo ? 'Clip con licencia abierta alojado en Wikimedia Commons.' : 'No hay una descripción pública disponible para este video.');
    description.classList.toggle('is-empty', !cleanDescription);
    channelButton.hidden = !song?.channelId;
    void loadVerifiedLyrics(song);
}

function openVideoStageChannel() {
    const song = currentQueueSong();
    if (!song?.channelId) { showToast('No hay un canal disponible para abrir', 'fa-satellite-dish'); return; }
    browseChannel(song.channelId, song.channelTitle || song.artist || 'Canal de YouTube');
}

function updateVideoStageToggle(isVisible) {
    const button = document.getElementById('videoStageToggleBtn');
    if (!button) return;
    const song = currentQueueSong();
    const isVideo = isVisualVideo(song);
    const minimized = isVideo && Boolean(isPlaying) && !isVisible;
    const copy = button.querySelector('.video-stage-toggle-copy');
    const reason = videoStageAutoHiddenReason;
    button.hidden = !minimized;
    button.classList.toggle('video-minimized', minimized);
    if (minimized) {
        const automatic = reason === 'document-hidden' || reason === 'out-of-view' || reason === 'navigation';
        const smallText = automatic ? 'Ocultado para ahorrar carga' : 'El audio sigue activo';
        if (copy) copy.innerHTML = `<strong>Mostrar video</strong><small>${smallText}</small>`;
        button.title = automatic ? 'El video no estaba visible; volver a mostrarlo' : 'El video sigue activo · volver a mostrar';
        button.setAttribute('aria-label', automatic ? 'El video se ocultó automáticamente; volver a mostrar video' : 'El video sigue activo; volver a mostrar video');
    }
}

function setVideoStageMinimized(minimized, options = {}) {
    const stage = document.getElementById('videoStage');
    const song = currentQueueSong();
    if (!stage || !isVisualVideo(song)) return;
    videoStageMinimized = !!minimized;
    videoStageManualMinimized = videoStageMinimized && options.manual === true;
    if (videoStageMinimized) videoStageNeedsVisualRefresh = true;
    videoStageAutoHiddenReason = videoStageMinimized ? (options.autoReason || (options.manual ? '' : videoStageAutoHiddenReason)) : '';
    stage.classList.toggle('visible', !videoStageMinimized);
    if (videoStageMinimized) stage.classList.remove('is-error');
    if (song.type === 'yt' && ytPlayer?.setPlaybackQuality) {
        try { ytPlayer.setPlaybackQuality(videoStageMinimized ? 'small' : 'auto'); } catch (error) {}
    }
    updateVideoStageToggle(!videoStageMinimized);
    persistVideoResumeSession(true);
    if (!videoStageMinimized && options.focus) {
        window.requestAnimationFrame(() => stage.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
}

function clearYouTubeEmbedFallback() {
    const fallback = document.getElementById('videoEmbedFallback');
    const openButton = document.getElementById('videoEmbedOpenBtn');
    const popupButton = document.getElementById('videoEmbedPopupBtn');
    youtubeEmbedFallbackUrl = '';
    if (fallback) fallback.hidden = true;
    if (openButton) { openButton.href = '#'; openButton.removeAttribute('aria-disabled'); }
    if (popupButton) popupButton.disabled = false;
}

function showYouTubeEmbedFallback(song, errorCode = '') {
    const fallback = document.getElementById('videoEmbedFallback');
    const title = document.getElementById('videoEmbedFallbackTitle');
    const message = document.getElementById('videoEmbedFallbackMessage');
    const openButton = document.getElementById('videoEmbedOpenBtn');
    const popupButton = document.getElementById('videoEmbedPopupBtn');
    const stage = document.getElementById('videoStage');
    const url = getCurrentContentLink(song);
    if (!fallback || !title || !message || !openButton || !popupButton || !stage || !url) return;
    youtubeEmbedFallbackUrl = url;
    title.textContent = song?.title || 'Este video necesita YouTube';
    const reason = Number(errorCode) === 101 || Number(errorCode) === 150
        ? 'El creador no permite la reproducción dentro de otras páginas.'
        : 'YouTube no pudo reproducirlo dentro del reproductor integrado.';
    message.textContent = `${reason} Podés abrirlo en una ventana compacta oficial sin cerrar Nowarfy.`;
    openButton.href = url;
    openButton.setAttribute('aria-label', `Ver ${song?.title || 'este video'} en YouTube`);
    popupButton.disabled = false;
    fallback.hidden = false;
    stage.classList.add('is-error');
}

function openYouTubeCompactWindow() {
    const song = currentQueueSong();
    const url = youtubeEmbedFallbackUrl || getCurrentContentLink(song);
    if (!url || song?.type !== 'yt') return;
    const features = 'popup=yes,width=720,height=450,resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,status=no';
    let popup = null;
    try { popup = window.open(url, 'nowarfy-youtube-compact', features); } catch (error) { popup = null; }
    if (!popup) {
        showToast('Chrome bloqueó la ventana; permití ventanas emergentes para abrir YouTube en flotante', 'fa-up-right-and-down-left-from-center');
        return;
    }
    youtubeCompactWindow = popup;
    try { popup.focus(); } catch (error) {}
    showToast('YouTube se abrió en una ventana compacta; Nowarfy sigue abierto', 'fab fa-youtube');
}

function showVideoStage(song, options = {}) {
    const stage = document.getElementById('videoStage');
    const fallback = document.getElementById('videoEmbedFallback');
    const keepFallback = !!(fallback && !fallback.hidden && youtubeEmbedFallbackUrl && youtubeEmbedFallbackUrl === getCurrentContentLink(song));
    if (!keepFallback) {
        clearYouTubeEmbedFallback();
        stage.classList.remove('is-error');
    }
    setVideoFramePoster(song, false);
    const hiddenDocument = document.visibilityState === 'hidden';
    stage.classList.toggle('visible', !hiddenDocument);
    videoStageMinimized = hiddenDocument;
    videoStageManualMinimized = false;
    videoStageAutoHiddenReason = hiddenDocument ? 'document-hidden' : '';
    if (song.type === 'yt' && ytPlayer?.setPlaybackQuality) {
        try { ytPlayer.setPlaybackQuality(hiddenDocument ? 'small' : 'auto'); } catch (error) {}
    }
    document.getElementById('videoStageTitle').textContent = song.title || (song.type === 'freevideo' ? 'Video libre' : 'Video de YouTube');
    document.getElementById('videoStageArtist').textContent = song.type === 'freevideo' ? `${song.artist || 'Wikimedia Commons'} · ${song.license || 'licencia abierta'}` : (song.channelTitle || song.artist || '');
    const kicker = document.querySelector('.video-stage-kicker');
    const note = document.querySelector('.video-stage-note');
    if (kicker) kicker.textContent = song.type === 'freevideo' ? 'Reproduciendo video libre' : 'Reproduciendo desde YouTube';
    if (note) note.textContent = song.type === 'freevideo' ? 'Archivo público de Wikimedia Commons. Revisá la ficha de origen para atribución y licencia.' : 'Datos extraídos de la ficha pública del video. Algunos videos pueden estar restringidos por su creador, región o YouTube.';
    renderVideoStageDetails(song);
    renderVideoSuggestions(song);
    updateVideoStageToggle(!videoStageMinimized);
    if (options.restoreFrame && song.type === 'yt') refreshYouTubeVideoFrame('show');
    if (options.focus && !videoStageMinimized) window.requestAnimationFrame(() => stage.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

function hideVideoStage(pauseVideo = false, options = {}) {
    const song = currentQueueSong();
    if (!isVisualVideo(song)) {
        videoStageMinimized = false;
        document.getElementById('videoStage').classList.remove('visible', 'is-error');
        updateVideoStageToggle(true);
        return;
    }
    setVideoStageMinimized(true, options);
    if (pauseVideo && isPlaying) {
        if (song.type === 'yt' && ytPlayer) ytPlayer.pauseVideo();
        else if (song.type === 'freevideo') freeVideoEl.pause();
        isPlaying = false;
        if (song.type === 'yt') persistVideoResumeSession(true);
        updateIcon();
        updatePlaybackState();
    }
}

function setVideoFramePoster(song, restoring = false) {
    const poster = document.getElementById('videoFramePoster');
    if (!poster) return;
    const source = String(song?.img || '').trim();
    poster.onerror = () => { poster.hidden = true; poster.classList.remove('is-restoring'); };
    poster.src = source;
    poster.alt = source ? `Miniatura de ${song?.title || 'la pista actual'}` : '';
    poster.hidden = !source;
    poster.classList.toggle('is-restoring', restoring && !!source);
}

function finishVideoFrameRestore(expectedUrl) {
    const poster = document.getElementById('videoFramePoster');
    if (!poster || currentQueueSong()?.url !== expectedUrl) return;
    poster.classList.remove('is-restoring');
    window.setTimeout(() => {
        if (currentQueueSong()?.url === expectedUrl && poster) poster.hidden = true;
    }, 1250);
}

function reloadYouTubeVideoVisual(expectedUrl) {
    const song = currentQueueSong();
    if (!song || song.type !== 'yt' || String(song.url) !== expectedUrl || !ytPlayer) return false;
    if (videoFrameRestoreAwaitingPlayer === expectedUrl) return false;
    let state = null;
    let position = 0;
    try {
        state = ytPlayer.getPlayerState?.();
        position = Math.max(0, Number(ytPlayer.getCurrentTime?.() || 0));
    } catch (error) {}
    const shouldPlay = !!ytPlaybackIntent && !playbackStoppedByUser && (isPlaying || state === window.YT?.PlayerState?.PLAYING);
    try {
        if (isNativeYouTubePlaylistPlayback()) {
            if (!shouldPlay || !ytPlayer.playVideoAt || !ytPlayer.getPlaylistIndex) return false;
            const playlistIndex = Number(ytPlayer.getPlaylistIndex());
            if (!Number.isFinite(playlistIndex) || playlistIndex < 0) return false;
            ytPlayer.playVideoAt(playlistIndex);
            if (position > 1) window.setTimeout(() => { if (currentQueueSong()?.url === expectedUrl) ytPlayer.seekTo?.(position, true); }, 260);
        } else if (shouldPlay && ytPlayer.loadVideoById) {
            ytPlayer.loadVideoById({ videoId: expectedUrl, startSeconds: position, suggestedQuality: 'auto' });
        } else if (!shouldPlay && ytPlayer.cueVideoById) {
            ytPlayer.cueVideoById({ videoId: expectedUrl, startSeconds: position, suggestedQuality: 'auto' });
        } else return false;
    } catch (error) {
        return false;
    }
    videoFrameRestoreAwaitingPlayer = expectedUrl;
    window.setTimeout(() => {
        if (videoFrameRestoreAwaitingPlayer === expectedUrl) videoFrameRestoreAwaitingPlayer = '';
    }, 1600);
    return true;
}

function refreshYouTubeVideoFrame(reason = 'restore') {
    const song = currentQueueSong();
    const stage = document.getElementById('videoStage');
    const frame = document.querySelector('#yt-player-container iframe');
    const frameBox = document.querySelector('#videoStage .video-frame');
    if (!stage?.classList.contains('visible') || song?.type !== 'yt' || !ytPlayer || !frameBox) return;
    const expectedUrl = String(song.url);
    setVideoFramePoster(song, true);
    clearTimeout(videoFrameRefreshTimer);
    const reflow = () => {
        if (currentQueueSong()?.url !== expectedUrl || !stage.classList.contains('visible')) return;
        const rect = frameBox.getBoundingClientRect();
        const width = Math.max(1, Math.floor(rect.width || frameBox.clientWidth));
        const height = Math.max(1, Math.floor(rect.height || frameBox.clientHeight));
        try { ytPlayer.setSize?.(width, height); } catch (error) {}
        if (frame) {
            frame.style.display = 'block';
            frame.style.visibility = 'hidden';
            void frame.offsetHeight;
            frame.style.visibility = 'visible';
        }
        videoStageNeedsVisualRefresh = false;
    };
    window.requestAnimationFrame(() => {
        reflow();
        videoFrameRefreshTimer = window.setTimeout(() => {
            reloadYouTubeVideoVisual(expectedUrl);
            reflow();
            window.setTimeout(() => {
                reflow();
                let state = null;
                try { state = ytPlayer.getPlayerState?.(); } catch (error) {}
                if (ytPlaybackIntent && state !== window.YT?.PlayerState?.PLAYING) requestYouTubePlayback(`visual-${reason}`);
                finishVideoFrameRestore(expectedUrl);
            }, 320);
        }, 260);
    });
}

function toggleVideoStageVisibility() {
    const song = currentQueueSong();
    if (!isVisualVideo(song)) { showToast('No hay un video activo para mostrar', 'fa-clapperboard'); return; }
    const stage = document.getElementById('videoStage');
    if (stage.classList.contains('visible')) hideVideoStage(false, { manual: true });
    else {
        showVideoStage(song, { focus: true, restoreFrame: true });
        if (song.type === 'freevideo') { freeVideoEl.style.display = 'block'; }
    }
}

function setupVideoStageObserver() {
    const stage = document.getElementById('videoStage');
    if (!stage || !window.IntersectionObserver) return;
    videoStageObserver?.disconnect();
    videoStageObserver = new IntersectionObserver(entries => {
        const entry = entries[0];
        const song = currentQueueSong();
        if (!entry || !isVisualVideo(song)) return;
        const rect = entry.boundingClientRect;
        if (!videoStageMinimized && stage.classList.contains('visible')) {
            const scrolledOut = (rect.top < -15 || rect.bottom < 120 || entry.intersectionRatio < 0.85) && rect.height > 0;
            if (scrolledOut) {
                setVideoStageMinimized(true, { autoReason: 'out-of-view' });
            }
        } else if (videoStageMinimized && videoStageAutoHiddenReason === 'out-of-view') {
            const scrolledIn = rect.top >= -10 && rect.bottom > 200 && entry.intersectionRatio > 0.65;
            if (scrolledIn) {
                setVideoStageMinimized(false);
            }
        }
    }, { root: null, threshold: [0, 0.15, 0.5, 0.65, 0.75, 0.85, 1.0], rootMargin: '0px 0px 0px 0px' });
    videoStageObserver.observe(stage);
}

function setupVideoStageVisibilityAwareness() {
    document.addEventListener('visibilitychange', () => {
        const stage = document.getElementById('videoStage');
        const song = currentQueueSong();
        if (document.visibilityState === 'hidden' && stage?.classList.contains('visible') && isVisualVideo(song)) {
            setVideoStageMinimized(true, { autoReason: 'document-hidden' });
        }
    });
}

function initYTPlayer(resourceId, isPlaylist = false, resumeSession = null, deferAutoplay = false) {
    pendingVideoResumeSession = resumeSession || pendingVideoResumeSession;
    clearTimeout(ytStartupTimer);
    ytStartupTimer = null;
    document.getElementById('yt-player-container').innerHTML = '<div id="yt-player"></div>';
    const playerConfig = {
        host: 'https://www.youtube-nocookie.com',
        height: '100%',
        width: '100%',
        playerVars: { 'autoplay': deferAutoplay ? 0 : 1, 'controls': 1, 'playsinline': 1, 'enablejsapi': 1, 'rel': 0, 'modestbranding': 1, 'origin': window.location.origin },
        events: { 'onReady': onYTReady, 'onStateChange': onYTStateChange, 'onError': onYTError }
    };

    if (isPlaylist) {
        playerConfig.playerVars.listType = 'playlist';
        playerConfig.playerVars.list = resourceId;
    } else {
        playerConfig.videoId = resourceId;
    }

    ytPlaybackIntent = !deferAutoplay;
    ytPlayer = new YT.Player('yt-player', playerConfig);
}

function requestYouTubePlayback(reason = 'retry') {
    const song = currentQueueSong();
    if (externalAudioFocusInterrupted) return false;
    if (!ytPlayer || song?.type !== 'yt' || !ytPlaybackIntent || playbackStoppedByUser) return false;
    let state = null;
    try { state = ytPlayer.getPlayerState?.(); } catch (error) { state = null; }
    if (window.YT?.PlayerState?.PLAYING != null && state === YT.PlayerState.PLAYING) {
        startSilentLoop();
        return true;
    }
    const now = Date.now();
    if (now - ytPlayCommandAt < YT_PLAY_RETRY_THROTTLE_MS) return false;
    ytPlayCommandAt = now;
    try {
        ytPlayer.playVideo();
        startSilentLoop();
        return true;
    } catch (error) {
        return false;
    }
}

function armYouTubeStartupWatchdog(expectedUrl, attempt = 0) {
    clearTimeout(ytStartupTimer);
    ytStartupTimer = setTimeout(() => {
        if (currentQueueSong()?.url !== expectedUrl || playbackStoppedByUser || externalAudioFocusInterrupted || !ytPlaybackIntent || !ytPlayer?.getPlayerState) return;
        requestYouTubePlayback(`startup-timeout-retry-${attempt + 1}`);
        let state = null;
        try { state = ytPlayer.getPlayerState(); } catch (error) { return; }
        if (state === window.YT?.PlayerState?.PLAYING) return;
        if (attempt < 3 || String(externalAudioFocusLastState).startsWith('probable:')) {
            armYouTubeStartupWatchdog(expectedUrl, attempt < 3 ? attempt + 1 : 0);
            return;
        }
        setTrackLoading(false);
        document.getElementById('videoStage')?.classList.add('is-error');
        showToast('YouTube está tardando en responder; no cambiamos de pista todavía', 'fa-hourglass-half');
    }, 12000);
}

function onYTReady(event) {
    if (event?.target && event.target !== ytPlayer) return;
    const v = parseFloat(document.getElementById('volumeSlider').value);
    if (ytPlayer.setVolume) ytPlayer.setVolume(v * 100);
    const song = currentQueueSong();
    if (song?.type === 'yt' && ytPlayer.getDuration) {
        renderVideoStageDetails({ ...song, duration: song.duration || ytPlayer.getDuration() });
    }
    clearYouTubeEmbedFallback();
    const resume = pendingVideoResumeSession;
    pendingVideoResumeSession = null;
    if (resume && song?.type === 'yt' && String(resume.resourceId) === String(song.url)) {
        const position = Math.max(0, Number(resume.position) || 0);
        if (position > 1 && ytPlayer.seekTo) ytPlayer.seekTo(position, true);
        if (resume.wasPlaying === false && ytPlayer.pauseVideo) ytPlayer.pauseVideo();
        if (restoreVideoMinimizedAfterReady) {
            restoreVideoMinimizedAfterReady = false;
            window.setTimeout(() => setVideoStageMinimized(true), 0);
        }
    }
    if (song?.type === 'yt' && !externalAudioFocusInterrupted && !playbackStoppedByUser && !(resume?.wasPlaying === false) && ytPlayer.playVideo) {
        ytPlaybackIntent = true;
        requestYouTubePlayback('ready');
        armYouTubeStartupWatchdog(song.url);
    }
}
function onYTStateChange(event) {
    if (event?.target && event.target !== ytPlayer) return;
    if (event.data === YT.PlayerState.PLAYING) {
        if (externalAudioFocusInterrupted) {
            try { ytPlayer?.pauseVideo?.(); } catch (error) {}
            return;
        }
        externalAudioFocusLastState = '';
        if (isNativeYouTubePlaylistPlayback()) syncNativeYouTubePlaylistPosition();
        clearTimeout(ytStartupTimer);
        ytStartupTimer = null;
        playbackStoppedByUser = false;
        isPlaying = true;
        startSilentLoop();
        setTrackLoading(false);
        if (!progressInterval) startProgress(ytPlayer);
        if (nowarfyRemoteIsPlayer) void publishNowarfyRemoteState();
    } else if (event.data === YT.PlayerState.PAUSED) {
        const pageHasFocus = typeof document.hasFocus === 'function' ? document.hasFocus() : document.visibilityState !== 'hidden';
        if (document.visibilityState !== 'hidden' && pageHasFocus && !externalAudioFocusInterrupted && isPlaying) {
            ytPlaybackIntent = false;
            playbackStoppedByUser = true;
            stopSilentLoop();
            clearTimeout(ytStartupTimer);
            ytStartupTimer = null;
            isPlaying = false;
            persistVideoResumeSession(true);
            updateIcon();
            updatePlaybackState();
            if (nowarfyRemoteIsPlayer) void publishNowarfyRemoteState();
            return;
        }
        if ((document.visibilityState === 'hidden' || !pageHasFocus) && !NOWARFY_AUDIO_PRIORITY_MODE && ytPlaybackIntent && !playbackStoppedByUser && !externalAudioFocusInterrupted) {
            schedulePossibleExternalAudioYield('youtube-paused-out-of-focus');
            return;
        }
        const shouldKeepPlaying = ytPlaybackIntent && !playbackStoppedByUser;
        if (shouldKeepPlaying) {
            isPlaying = true;
            startSilentLoop();
            requestYouTubePlayback('background-paused');
        } else {
            stopSilentLoop();
            clearTimeout(ytStartupTimer);
            ytStartupTimer = null;
            isPlaying = false;
            persistVideoResumeSession(true);
        }
        if (nowarfyRemoteIsPlayer) void publishNowarfyRemoteState();
    } else if (event.data === YT.PlayerState.BUFFERING) {
        setTrackLoading(true, currentIndex);
    } else if (event.data === YT.PlayerState.ENDED) {
        ytPlaybackIntent = false;
        isPlaying = false;
        stopSilentLoop();
        clearVideoResumeSession();
        queueAutomaticAdvance('youtube-ended');
    }
    updateIcon();
    updatePlaybackState();
}
function onYTError(event) {
    if (event?.target && event.target !== ytPlayer) return;
    if (externalAudioFocusInterrupted) return;
    clearTimeout(ytStartupTimer);
    ytStartupTimer = null;
    ytPlaybackIntent = false;
    stopSilentLoop();
    setTrackLoading(false);
    isPlaying = false;
    const song = currentQueueSong();
    showYouTubeEmbedFallback(song, event?.data);
    showToast('YouTube no permite este video dentro del IFrame; podés abrirlo desde aquí', 'fab fa-youtube');
    updateIcon();
    updatePlaybackState();
}

function togglePlay() {
    if (nowarfyAuthUser && nowarfyRemoteSession && !nowarfyRemoteIsPlayer) { void sendNowarfyCommand('toggle', null, true); return; }
    if (externalAudioFocusInterrupted) { showToast('Nowarfy cedió el audio a otra aplicación', 'fa-volume-high'); return; }
    nowarfyAudioUnlocked = true;
    if (currentIndex === -1 || !queue[currentIndex]) return;
    if (!ytPlayer && !audioEl.src && !freeVideoEl.src) {
        const resume = pendingVideoResumeSession;
        const explicitResume = resume ? { ...resume, wasPlaying: true } : null;
        playQueueAt(currentIndex, explicitResume ? { resumeSession: explicitResume, restoreMinimized: !!explicitResume.minimized } : {});
        return;
    }
    const song = queue[currentIndex];
    if (isPlaying) {
        playbackStoppedByUser = true;
        clearAutomaticAdvance();
    } else {
        playbackStoppedByUser = false;
    }
    if (song.type === 'yt') {
        if (ytPlayer) {
            if (isPlaying) { ytPlaybackIntent = false; ytPlayer.pauseVideo(); stopSilentLoop(); }
            else { ytPlaybackIntent = true; ytPlayer.playVideo(); startSilentLoop(); }
            isPlaying = !isPlaying;
        }
    } else {
        if (crossfadeInProgress) cancelDirectCrossfade();
        if (isPlaying) {
            activeAudioEl.pause();
            stopSilentLoop();
            isPlaying = false;
        } else {
            const playAttempt = activeAudioEl.play();
            startSilentLoop();
            isPlaying = true;
            if (playAttempt?.catch) {
                playAttempt.catch(() => {
                    isPlaying = false;
                    stopSilentLoop();
                    setTrackLoading(false);
                    updateIcon();
                    updatePlaybackState();
                    showToast('El navegador bloqueó la reproducción; tocá Reproducir para habilitarla', 'fa-play');
                });
            }
        }
    }
    updateIcon();
    updatePlaybackState();
}

function nextSong(manual = false) {
    if (manual && nowarfyAuthUser && nowarfyRemoteSession && !nowarfyRemoteIsPlayer) { void sendNowarfyCommand('next'); return true; }
    if (queue.length === 0) return false;
    if (queuePlaybackMode === 'prebuilt_playlist') {
        const advanced = advancePrebuiltPlaylist(currentPlayingQid);
        if (advanced) return true;
        if (!manual) finishPrebuiltPlaylistPlayback('Terminó la playlist de YouTube');
        else showToast('Ya estás en el último video de esta playlist', 'fa-flag-checkered');
        return true;
    }
    if (manual && shuffleMode) {
        playQueueAt(Math.floor(Math.random() * queue.length));
        return true;
    }
    const current = queue[currentIndex];
    if (!manual && current?.type === 'yt') return continueVideoAutoplay();
    const idx = queue.findIndex(s => s._qid === currentPlayingQid);
    if (idx === -1) return false;
    if (!manual && queue.length === 1) return false;
    let next = idx + 1;
    if (next >= queue.length) {
        void recoverAutomaticQueue(currentPlayingQid);
        return true;
    }
    playQueueAt(next);
    return true;
}
function prevSong() {
    if (nowarfyAuthUser && nowarfyRemoteSession && !nowarfyRemoteIsPlayer) { void sendNowarfyCommand('prev'); return; }
    if (queue.length === 0) return;
    const idx = queue.findIndex(s => s._qid === currentPlayingQid);
    let prev = idx - 1;
    if (prev < 0) prev = queue.length - 1;
    playQueueAt(prev);
}
function stopAll(options = {}) {
    const preserveYouTubePlayer = options.preserveYouTubePlayer === true;
    clearAutomaticAdvance();
    clearTimeout(ytStartupTimer);
    ytStartupTimer = null;
    ytPlaybackIntent = false;
    ytPlayCommandAt = 0;
    if (ytPlayer && !preserveYouTubePlayer) { ytPlayer.stopVideo(); ytPlayer.destroy(); ytPlayer = null; }
    if (!preserveYouTubePlayer) pendingYTRequest = null;
    freeVideoEl.pause();
    freeVideoEl.currentTime = 0;
    freeVideoEl.removeAttribute('src');
    freeVideoEl.dataset.queueId = '';
    freeVideoEl.hidden = true;
    clearInterval(crossfadeTimer);
    crossfadeInProgress = false;
    [audioEl, nextAudioEl].forEach(audio => { audio.pause(); audio.currentTime = 0; audio.dataset.queueId = ''; });
    activeAudioEl = audioEl;
    if (progressInterval) clearInterval(progressInterval);
    progressInterval = null;
    isPlaying = false;
    updateIcon();
    updatePlaybackState();
    progFill.style.width = '0%';
    progThumb.style.left = '0%';
}

function startProgress(source) {
    if (progressInterval) clearInterval(progressInterval);
    nowarfyProgressSource = source;
    if (nowarfyPageHidden) { progressInterval = null; return; }
    progressInterval = setInterval(() => {
        if (nowarfyPageHidden || isSeeking) return;
        let curr, dur;
        if (source === ytPlayer) {
            curr = source.getCurrentTime();
            dur = source.getDuration();
        } else { curr = source.currentTime; dur = source.duration; }
        persistVideoResumeSession();
        if (dur) {
            const pct = (curr / dur) * 100;
            updateMediaPosition(dur, curr);
            progFill.style.width = `${pct}%`;
            progThumb.style.left = `${pct}%`;
            currTimeEl.innerText = format(curr);
            totalTimeEl.innerText = format(dur);
        }
    }, 500);
}

function updateProgress(curr, dur) {
    if (isSeeking) return;
    if (dur) {
        const pct = (curr / dur) * 100;
        progFill.style.width = `${pct}%`;
        progThumb.style.left = `${pct}%`;
        currTimeEl.innerText = format(curr);
        totalTimeEl.innerText = format(dur);
    }
}

function getDuration() {
    if (currentIndex === -1 || !queue[currentIndex]) return 0;
    const song = queue[currentIndex];
    if (song.type === 'yt' && ytPlayer && ytPlayer.getDuration) return ytPlayer.getDuration();
    if (song.type === 'mp3' || song.type === 'freevideo') return activeAudioEl.duration || 0;
    return 0;
}

function commitSeek(pct) {
    if (nowarfyAuthUser && nowarfyRemoteSession && !nowarfyRemoteIsPlayer) { void sendNowarfyCommand('seekPercent', Math.max(0, Math.min(1, Number(pct))) * 100, true); return; }
    if (currentIndex === -1 || !queue[currentIndex]) return;
    const song = queue[currentIndex];
    if (song.type === 'yt' && ytPlayer) { const d = ytPlayer.getDuration(); if (d) ytPlayer.seekTo(d * pct, true); }
    else if ((song.type === 'mp3' || song.type === 'freevideo') && activeAudioEl.duration) { activeAudioEl.currentTime = activeAudioEl.duration * pct; }
    persistVideoResumeSession(true);
}

function seekBy(deltaSeconds) {
    if (nowarfyAuthUser && nowarfyRemoteSession && !nowarfyRemoteIsPlayer) { void sendNowarfyCommand('seekDelta', Number(deltaSeconds) || 0); return; }
    if (currentIndex === -1 || !queue[currentIndex]) return;
    const song = queue[currentIndex];
    if (song.type === 'yt' && ytPlayer) {
        const t = Math.max(0, ytPlayer.getCurrentTime() + deltaSeconds);
        ytPlayer.seekTo(t, true);
    } else if (song.type === 'mp3' || song.type === 'freevideo') {
        activeAudioEl.currentTime = Math.max(0, Math.min(activeAudioEl.duration || 0, activeAudioEl.currentTime + deltaSeconds));
    }
    persistVideoResumeSession(true);
}

function setupProgressDrag() {
    function pctFromEvent(e) {
        const rect = progressTrack.getBoundingClientRect();
        let x = e.clientX - rect.left;
        x = Math.max(0, Math.min(x, rect.width));
        return rect.width ? x / rect.width : 0;
    }
    function preview(pct) {
        progFill.style.width = `${pct * 100}%`;
        progThumb.style.left = `${pct * 100}%`;
        const dur = getDuration();
        if (dur) currTimeEl.innerText = format(dur * pct);
    }
    let pendingPct = 0;
    function onMove(e) { pendingPct = pctFromEvent(e); preview(pendingPct); }
    function onUp() {
        isSeeking = false;
        progressTrack.classList.remove('dragging');
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        commitSeek(pendingPct);
    }
    progressTrack.addEventListener('pointerdown', (e) => {
        if (currentIndex === -1) return;
        isSeeking = true;
        progressTrack.classList.add('dragging');
        pendingPct = pctFromEvent(e);
        preview(pendingPct);
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
    });
}

