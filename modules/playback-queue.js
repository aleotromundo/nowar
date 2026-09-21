// --- CLAVE única de canción (para no repetir en la cola) ---
function songKey(song) { return `${(song.title || '').toLowerCase().trim()}|${(song.artist || '').toLowerCase().trim()}`; }
function withQid(song) { return { ...song, _qid: ++queueIdCounter }; }

function persistQueueMode() {
    try {
        localStorage.setItem(QUEUE_MODE_STORAGE_KEY, queuePlaybackMode);
        if (queuePlaybackMode === 'prebuilt_playlist' && queuePlaylistContext) {
            localStorage.setItem(QUEUE_PLAYLIST_STORAGE_KEY, JSON.stringify(queuePlaylistContext));
        } else {
            localStorage.removeItem(QUEUE_PLAYLIST_STORAGE_KEY);
        }
    } catch (error) {}
}

function setRadioQueueMode() {
    queuePlaybackMode = 'radio';
    queuePlaylistContext = null;
    persistQueueMode();
}

function isNativeYouTubePlaylistPlayback() {
    return queuePlaybackMode === 'prebuilt_playlist' && !!queuePlaylistContext?.nativePlayback && !!queuePlaylistContext?.playlistId;
}

function syncNativeYouTubePlaylistPosition() {
    if (!isNativeYouTubePlaylistPlayback() || !ytPlayer?.getPlaylistIndex) return false;
    let nativeIndex = -1;
    try { nativeIndex = Number(ytPlayer.getPlaylistIndex()); } catch (error) { return false; }
    if (!Number.isInteger(nativeIndex) || nativeIndex < 0) return false;
    if (nativeIndex >= queue.length && queuePlaylistContext?.nextPageToken) {
        void loadNextPrebuiltPlaylistPage(currentPlayingQid, { nativeOnly: true });
    }
    const nativeSong = queue[nativeIndex];
    if (!nativeSong) return false;
    if (currentPlayingQid !== nativeSong._qid) {
        currentIndex = nativeIndex;
        currentPlayingQid = nativeSong._qid;
        currentSourceIdx = nativeSong.sourceIndex ?? nativeIndex;
        updateNowPlaying(nativeSong);
        updateMediaSession(nativeSong);
        rememberPlay(nativeSong);
        persistQueue();
        renderQueue();
    } else {
        currentIndex = nativeIndex;
    }
    return true;
}

function appendPrebuiltPlaylistTracks(tracks) {
    const playable = (tracks || []).filter(track => track?.url);
    if (!playable.length) return 0;
    const playlistId = isNativeYouTubePlaylistPlayback() ? queuePlaylistContext.playlistId : '';
    const queuedTracks = playable.map(track => withQid(playlistId ? { ...track, youtubePlaylistId: playlistId } : track));
    queue.push(...queuedTracks);
    queuedTracks.forEach(track => queueSeenKeys.add(songKey(track)));
    return queuedTracks.length;
}

function finishPrebuiltPlaylistPlayback(message = 'Terminó la playlist') {
    clearAutomaticAdvance();
    isPlaying = false;
    stopSilentLoop();
    persistVideoResumeSession(true);
    updateIcon();
    updatePlaybackState();
    showToast(message, 'fa-circle-check');
}

async function loadNextPrebuiltPlaylistPage(targetQid, options = {}) {
    if (automaticQueueRecoveryInFlight || queuePlaybackMode !== 'prebuilt_playlist') return false;
    const context = queuePlaylistContext;
    const pageToken = String(context?.nextPageToken || '');
    if (!context?.playlistId || !pageToken) return false;
    automaticQueueRecoveryInFlight = true;
    context.nextPageToken = '';
    try {
        const response = await fetch(`/api/search?type=youtube&action=playlistItems&playlistId=${encodeURIComponent(context.playlistId)}&pageToken=${encodeURIComponent(pageToken)}&maxResults=24`);
        const data = await response.json();
        if (!response.ok) throw new Error('playlist_page_unavailable');
        const nextTracks = mapPlaylistVideoItems(data.items, {
            channelId: context.channelId || '', channelTitle: context.artist || '', img: context.img || '',
            collectionId: context.playlistId, collectionTitle: context.title, collectionImg: context.img || ''
        }, queue.length);
        if (!nextTracks.length) throw new Error('playlist_page_empty');
        appendPrebuiltPlaylistTracks(nextTracks);
        context.nextPageToken = data.nextPageToken || '';
        context.totalResults = Number(data.pageInfo?.totalResults || context.totalResults || queue.length);
        if (activePlaylistCatalog?.playlist?.url === context.playlistId) {
            activePlaylistCatalog.tracks = [...activePlaylistCatalog.tracks, ...nextTracks];
            activePlaylistCatalog.pageInfo = data.pageInfo || activePlaylistCatalog.pageInfo;
            activePlaylistCatalog.nextPageToken = context.nextPageToken;
        }
        void reserveDiscoveredCandidates(nextTracks, { context: 'playlist', queryContext: `playlist:${context.playlistId}` });
        persistQueueMode();
        persistQueue();
        renderQueue();
        if (activePlaylistCatalog?.playlist?.url === context.playlistId) renderOpenedPlaylist();
        if (options.nativeOnly) {
            syncNativeYouTubePlaylistPosition();
            persistQueue();
            renderQueue();
            return true;
        }
        if (currentPlayingQid !== targetQid) return false;
        const targetIndex = queue.findIndex(item => item._qid === targetQid);
        const nextIndex = targetIndex + 1;
        if (nextIndex >= 0 && nextIndex < queue.length) {
            playQueueAt(nextIndex);
            return true;
        }
        finishPrebuiltPlaylistPlayback('La playlist no tiene más videos reproducibles');
        return false;
    } catch (error) {
        context.nextPageToken = '';
        persistQueueMode();
        persistQueue();
        finishPrebuiltPlaylistPlayback('No pudimos cargar la siguiente página de esta playlist');
        return false;
    } finally {
        automaticQueueRecoveryInFlight = false;
    }
}

function advancePrebuiltPlaylist(targetQid) {
    if (queuePlaybackMode !== 'prebuilt_playlist' || !targetQid) return false;
    if (isNativeYouTubePlaylistPlayback() && ytPlayer) {
        syncNativeYouTubePlaylistPosition();
        const nativeIndex = queue.findIndex(item => item._qid === currentPlayingQid);
        const playlistIds = typeof ytPlayer.getPlaylist === 'function' ? ytPlayer.getPlaylist() : [];
        if (nativeIndex >= 0 && nativeIndex + 1 < queue.length && ytPlayer.playVideoAt) {
            ytPlayer.playVideoAt(nativeIndex + 1);
            return true;
        }
        if (Number.isInteger(nativeIndex) && nativeIndex >= 0 && nativeIndex + 1 < playlistIds.length && ytPlayer.nextVideo) {
            ytPlayer.nextVideo();
            return true;
        }
        if (queuePlaylistContext?.nextPageToken) {
            void loadNextPrebuiltPlaylistPage(targetQid, { nativeOnly: true });
            return true;
        }
        return false;
    }
    const index = queue.findIndex(item => item._qid === targetQid);
    if (index < 0) return false;
    const nextIndex = index + 1;
    if (nextIndex < queue.length) {
        playQueueAt(nextIndex);
        return true;
    }
    if (queuePlaylistContext?.nextPageToken) {
        void loadNextPrebuiltPlaylistPage(targetQid);
        return true;
    }
    return false;
}

async function selectSong(song, sourceIdx) {
    // Si estamos en modo control remoto (no somos el reproductor), enviar comando al dispositivo activo
    if (nowarfyAuthUser && nowarfyRemoteSession && !nowarfyRemoteIsPlayer) {
        await sendRemotePlaySongCommand(song, 0);
        return;
    }
    
    setRadioQueueMode();
    const q = withQid(song);
    queue = [q];
    queueSeenKeys = new Set([songKey(q)]);
    queueRound = 0;
    persistQueue();
    renderQueue();
    playQueueAt(0, { sourceIdx });
    void reserveDiscoveredCandidates([song], { context: 'radio', seed: song });
    growQueueIfNeeded(true);
}

async function resumeSongFromWelcome(song, sourceIdx = 0) {
    // Si estamos en modo control remoto, enviar al reproductor
    if (nowarfyAuthUser && nowarfyRemoteSession && !nowarfyRemoteIsPlayer) {
        await sendRemotePlaySongCommand(song, sourceIdx);
        return;
    }
    
    setRadioQueueMode();
    const resume = readVideoResumeSession();
    const matches = resume && String(resume.resourceId) === String(song?.url) && (!resume.type || resume.type === song?.type);
    if (!matches) { selectSong(song, sourceIdx); return; }
    const existingIndex = queue.findIndex(item => String(item.url) === String(song.url) && item.type === song.type);
    if (existingIndex >= 0) {
        playQueueAt(existingIndex, { sourceIdx, resumeSession: { ...resume, wasPlaying: true }, restoreMinimized: !!resume.minimized });
        return;
    }
    const q = withQid(song);
    queue = [q];
    queueSeenKeys = new Set([songKey(q)]);
    queueRound = 0;
    persistQueue();
    renderQueue();
    playQueueAt(0, { sourceIdx, resumeSession: { ...resume, wasPlaying: true }, restoreMinimized: !!resume.minimized });
    void reserveDiscoveredCandidates([song], { context: 'radio', seed: song });
    growQueueIfNeeded(true);
}

async function addToQueue(song) {
    const k = songKey(song);
    if (queueSeenKeys.has(k)) { showToast('Ya está en la Playlist', 'fa-circle-info'); return; }
    
    // Si estamos en modo control remoto, enviar al reproductor
    if (nowarfyAuthUser && nowarfyRemoteSession && !nowarfyRemoteIsPlayer) {
        await sendRemoteAddToQueueCommand(song);
        return;
    }
    
    const q = withQid(song);
    queueSeenKeys.add(k);
    queue.push(q);
    void reserveDiscoveredCandidates([song], { context: 'queue', seed: song, queryContext: 'queue' });
    persistQueue();
    renderQueue();
    showToast('Añadido a la cola', 'fa-list');
    if (currentPlayingQid == null) playQueueAt(queue.length - 1);
}

async function sendRemoteAddToQueueCommand(song) {
    // Enviar canción para agregar a la cola del reproductor
    const commandId = `${nowarfyRemoteDeviceId || 'device'}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const command = { type: 'addToQueue', song: { ...song, _qid: `remote-${Date.now()}` }, commandId };
    
    // Optimistic update: mostrar que se está enviando
    showToast(`Agregando "${song.title}" a la cola del reproductor...`, 'fa-list');
    
    // Enviar por BroadcastChannel primero
    if (nowarfyBroadcastChannelReady && nowarfyBroadcastChannel) {
        try { nowarfyBroadcastChannel.postMessage({ type: 'remote-command', senderDeviceId: nowarfyRemoteDeviceId, commandId, command }); } catch (_) {}
    }
    
    // Enviar por Supabase Realtime
    if (nowarfyRemoteBroadcastReady && nowarfyRemoteChannel) {
        try { await nowarfyRemoteChannel.send({ type: 'broadcast', event: 'remote-command', payload: { commandId, senderDeviceId: nowarfyRemoteDeviceId, command } }); } catch (_) {}
    }
    
    // Fallback a base de datos
    await nowarfySupabase.from('youtoo_remote_commands').insert({ session_id: nowarfyRemoteSession.id, user_id: nowarfyAuthUser.id, device_id: nowarfyRemoteDeviceId, command });
}

async function sendRemotePlaySongCommand(song, startIndex = 0) {
    // Enviar comando para reproducir una canción específica en el reproductor
    const commandId = `${nowarfyRemoteDeviceId || 'device'}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const command = { type: 'playSong', song: { ...song, _qid: `remote-${Date.now()}` }, startIndex, commandId };
    
    // Optimistic update: mostrar que se está enviando
    showToast(`Reproduciendo "${song.title}" en el reproductor...`, 'fa-play');
    
    // Enviar por BroadcastChannel primero para respuesta instantánea
    if (nowarfyBroadcastChannelReady && nowarfyBroadcastChannel) {
        try { nowarfyBroadcastChannel.postMessage({ type: 'remote-command', senderDeviceId: nowarfyRemoteDeviceId, commandId, command }); } catch (_) {}
    }
    
    // Enviar por Supabase Realtime
    if (nowarfyRemoteBroadcastReady && nowarfyRemoteChannel) {
        try { await nowarfyRemoteChannel.send({ type: 'broadcast', event: 'remote-command', payload: { commandId, senderDeviceId: nowarfyRemoteDeviceId, command } }); } catch (_) {}
    }
    
    // Fallback a base de datos
    await nowarfySupabase.from('youtoo_remote_commands').insert({ session_id: nowarfyRemoteSession.id, user_id: nowarfyAuthUser.id, device_id: nowarfyRemoteDeviceId, command });
}

function getCurrentContentLink(song) {
    if (!song?.url) return '';
    if (song.type === 'yt') {
        return song.isPlaylist
            ? `https://www.youtube.com/playlist?list=${encodeURIComponent(song.url)}`
            : `https://www.youtube.com/watch?v=${encodeURIComponent(song.url)}`;
    }
    return song.sourceUrl || song.url;
}

function currentQueueSong() {
    if (nowarfyAuthUser && nowarfyRemoteSession && !nowarfyRemoteIsPlayer && nowarfyRemoteShadowSong) return nowarfyRemoteShadowSong;
    return currentIndex >= 0 ? queue[currentIndex] || nowarfyRemoteShadowSong : nowarfyRemoteShadowSong;
}

function updateCurrentActionControls(song) {
    const hasLink = !!getCurrentContentLink(song);
    const canDownload = !!(song?.type === 'mp3' && song?.url && song?.license);
    document.getElementById('shareWhatsappBtn').disabled = !hasLink;
    document.getElementById('copyCurrentLinkBtn').disabled = !hasLink;
    const download = document.getElementById('downloadCurrentBtn');
    download.hidden = !canDownload;
    download.disabled = !canDownload;
    if (canDownload) download.title = `Descargar audio directo · ${song.license}${song.licenseVersion ? ` ${song.licenseVersion}` : ''}`;
}

function openCurrentArtist() {
    const song = currentQueueSong();
    if (!song?.artist) { showToast('No hay un artista disponible para abrir', 'fa-user-music'); return; }
    if (song.channelId) browseChannel(song.channelId, song.channelTitle || song.artist);
    else performSmartSearch(song.artist);
}

function openCurrentCollection() {
    const song = currentQueueSong();
    if (!song) { showToast('Elegí una pista primero', 'fa-compact-disc'); return; }
    if (song.collectionId) {
        openPlaylist({ url: song.collectionId, title: song.collectionTitle || 'Lista de reproducción', img: song.collectionImg || song.img || '', channelId: song.channelId || '', artist: song.channelTitle || song.artist || '' });
        return;
    }
    if (song.isPlaylist) { openPlaylist(song); return; }
    showToast('Este contenido no pertenece a una lista o álbum navegable', 'fa-compact-disc');
}

function updateNowPlaying(song) {
    setAmbientArtwork(song, true);
    const title = document.getElementById('currTitle');
    const artist = document.getElementById('currArtist');
    const cover = document.getElementById('playerCover');
    title.textContent = song.title || 'Selecciona una canción';
    artist.textContent = song.artist || '...';
    const img = document.getElementById('currentImg');
    if (song.img) { img.src = song.img; img.style.display = 'block'; cover.classList.add('has-art'); }
    else { img.src = ''; img.style.display = 'none'; cover.classList.remove('has-art'); }
    const collectionAvailable = !!(song.collectionId || song.isPlaylist);
    const artistAvailable = !!(song.channelId || song.artist);
    title.classList.toggle('is-link', collectionAvailable);
    artist.classList.toggle('is-link', artistAvailable);
    title.disabled = !collectionAvailable;
    artist.disabled = !artistAvailable;
    updateCurrentActionControls(song);
    updateFavButton(song);
}

async function copyTextToClipboard(text) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
    const input = document.createElement('textarea');
    input.value = text;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
}

function copyCurrentLink() {
    const song = currentQueueSong();
    const link = getCurrentContentLink(song);
    if (!link) { showToast('No hay un enlace disponible todavía', 'fa-link'); return; }
    copyTextToClipboard(link).then(() => showToast('Enlace copiado', 'fa-link')).catch(() => showToast('No pudimos copiar el enlace', 'fa-triangle-exclamation'));
}

function shareCurrentToWhatsApp() {
    const song = currentQueueSong();
    const link = getCurrentContentLink(song);
    if (!link) { showToast('No hay un enlace disponible todavía', 'fa-whatsapp'); return; }
    const label = `${song.title || 'Contenido'}${song.artist ? ` · ${song.artist}` : ''}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(`${label}\n${link}`)}`, '_blank', 'noopener,noreferrer');
}

function downloadCurrentTrack() {
    const song = currentQueueSong();
    if (!(song?.type === 'mp3' && song?.url && song?.license)) {
        showToast('La descarga solo está disponible para audio directo con licencia', 'fa-download');
        return;
    }
    const anchor = document.createElement('a');
    anchor.href = song.url;
    const extension = String(song.filetype || 'mp3').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'mp3';
    anchor.download = `${String(song.title || 'nowarfy-audio').replace(/[^a-z0-9áéíóúüñ _.-]/gi, '').trim() || 'nowarfy-audio'}.${extension}`;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    showToast(`Descarga iniciada · ${song.license}`, 'fa-download');
}

async function ensureInitialRadioQueue() {
    if (queue.length > 0) {
        if (currentPlayingQid == null) {
            currentIndex = 0;
            currentPlayingQid = queue[0]._qid;
            updateNowPlaying(queue[0]);
        }
        renderQueue();
        return;
    }
    const catalogCandidates = uniqueMediaByUrl([
        ...homeMusicVideos,
        ...homeMusic,
        ...homeVideos,
        ...homeRecommended,
        ...EMERGENCY_VIDEO_CATALOG
    ], 120).filter(song => song?.url && isRadioMusicTrack(song));
    if (!catalogCandidates.length) return;
    const initialSongs = [];
    const initialKeys = new Set();
    for (const song of catalogCandidates) {
        const key = songKey(song);
        if (initialKeys.has(key)) continue;
        initialKeys.add(key);
        initialSongs.push(withQid(song));
        if (initialSongs.length >= QUEUE_BATCH) break;
    }
    queue = initialSongs;
    queueSeenKeys = new Set(queue.map(songKey));
    queueRound = 0;
    currentIndex = 0;
    currentPlayingQid = queue[0]._qid;
    currentSourceIdx = queue[0].sourceIndex ?? null;
    updateNowPlaying(queue[0]);
    persistQueue();
    renderQueue();
}

function nextQueueIndex() {
    if (!queue.length) return -1;
    const idx = queue.findIndex(item => item._qid === currentPlayingQid);
    return idx >= 0 ? (idx + 1) % queue.length : 0;
}

function getStandbyAudioEl() { return activeAudioEl === audioEl ? nextAudioEl : audioEl; }

function prepareNextDirectAudio() {
    const nextIndex = nextQueueIndex();
    const next = queue[nextIndex];
    if (nextIndex === currentIndex || !next || next.type !== 'mp3' || !next.url) return;
    const standby = getStandbyAudioEl();
    if (standby.dataset.queueId === String(next._qid)) return;
    standby.pause();
    standby.src = next.url;
    standby.dataset.queueId = String(next._qid);
    standby.load();
}

function applyResumeSessionToMedia(media, song, resumeSession) {
    if (!media || !song || !resumeSession || String(resumeSession.resourceId) !== String(song.url)) return;
    const position = Math.max(0, Number(resumeSession.position) || 0);
    const apply = () => {
        if (currentQueueSong()?.url !== song.url || media !== activeAudioEl) return;
        const duration = Number(media.duration);
        media.currentTime = duration > 0 ? Math.min(position, Math.max(0, duration - 0.25)) : position;
    };
    if (media.readyState >= 1) apply();
    else media.addEventListener('loadedmetadata', apply, { once: true });
}
function bindDirectAudioEvents(audio) {
    audio.ontimeupdate = () => {
        if (audio !== activeAudioEl) return;
        updateProgress(audio.currentTime, audio.duration);
        updateMediaPosition(audio.duration, audio.currentTime);
        const current = queue[currentIndex];
        const next = queue[nextQueueIndex()];
        const remaining = Number(audio.duration) - Number(audio.currentTime);
        if (!crossfadeInProgress && current?.type === 'mp3' && next?.type === 'mp3' && Number.isFinite(remaining) && remaining > 0 && remaining <= CROSSFADE_SECONDS) beginDirectAudioCrossfade();
    };
    audio.onended = () => {
        if (audio === activeAudioEl && !crossfadeInProgress) {
            clearVideoResumeSession();
            queueAutomaticAdvance('direct-ended');
        }
    };
    audio.onpause = () => {
        if (mediaTransitionInProgress || audio !== activeAudioEl || audio.ended || crossfadeInProgress || String(audio.dataset.queueId || '') !== String(currentPlayingQid || '')) return;
        if ((document.visibilityState === 'hidden' || (typeof document.hasFocus === 'function' && !document.hasFocus())) && !NOWARFY_AUDIO_PRIORITY_MODE && !playbackStoppedByUser && !externalAudioFocusInterrupted && isPlaying) {
            schedulePossibleExternalAudioYield('direct-audio-paused');
            return;
        }
        if (NOWARFY_AUDIO_PRIORITY_MODE && !playbackStoppedByUser && !audio.ended) {
            isPlaying = true;
            startSilentLoop();
            const playAttempt = audio.play?.();
            if (playAttempt?.catch) playAttempt.catch(() => {});
            updateIcon();
            updatePlaybackState();
            return;
        }
        isPlaying = false;
        persistVideoResumeSession(true);
        updateIcon();
        updatePlaybackState();
        if (nowarfyRemoteIsPlayer) void publishNowarfyRemoteState();
    };
    audio.onwaiting = () => { if (audio === activeAudioEl) setTrackLoading(true, currentSourceIdx); };
    audio.onplaying = () => {
        if (audio !== activeAudioEl) return;
        if (externalAudioFocusInterrupted) { audio.pause(); return; }
        playbackStoppedByUser = false;
        isPlaying = true;
        updateIcon();
        updatePlaybackState();
        setTrackLoading(false);
        if (!progressInterval) startProgress(audio);
        prepareNextDirectAudio();
        if (nowarfyRemoteIsPlayer) void publishNowarfyRemoteState();
    };
    audio.onerror = () => {
        if (audio !== activeAudioEl) return;
        setTrackLoading(false);
        showToast('No se pudo reproducir esta pista; seguimos con la siguiente', 'fa-triangle-exclamation');
        queueAutomaticAdvance('direct-error');
    };
}

function cancelDirectCrossfade() {
    if (!crossfadeInProgress) return;
    clearInterval(crossfadeTimer);
    const standby = getStandbyAudioEl();
    standby.pause();
    standby.currentTime = 0;
    standby.dataset.queueId = '';
    activeAudioEl.volume = parseFloat(document.getElementById('volumeSlider').value) || 0;
    crossfadeInProgress = false;
}

function finishDirectCrossfade(nextIndex, outgoing, incoming) {
    clearInterval(crossfadeTimer);
    outgoing.pause();
    outgoing.currentTime = 0;
    outgoing.dataset.queueId = '';
    activeAudioEl = incoming;
    crossfadeInProgress = false;
    currentIndex = nextIndex;
    const song = queue[nextIndex];
    currentPlayingQid = song._qid;
    currentSourceIdx = null;
    updateNowPlaying(song);
    rememberPlay(song);
    updateMediaSession(song);
    persistQueue();
    renderQueue();
    startProgress(incoming);
    prepareNextDirectAudio();
}

function beginDirectAudioCrossfade() {
    if (!continuousPlayback || crossfadeInProgress) return;
    const nextIndex = nextQueueIndex();
    const next = queue[nextIndex];
    if (nextIndex === currentIndex || !next || next.type !== 'mp3' || !next.url) return;
    const outgoing = activeAudioEl;
    const incoming = getStandbyAudioEl();
    crossfadeInProgress = true;
    incoming.pause();
    incoming.src = next.url;
    incoming.currentTime = 0;
    incoming.dataset.queueId = String(next._qid);
    incoming.volume = 0;
    bindDirectAudioEvents(incoming);
    incoming.play().then(() => {
        const startedAt = performance.now();
        const tick = () => {
            const progress = Math.min(1, (performance.now() - startedAt) / (CROSSFADE_SECONDS * 1000));
            const baseVolume = parseFloat(document.getElementById('volumeSlider').value) || 0;
            outgoing.volume = baseVolume * (1 - progress);
            incoming.volume = baseVolume * progress;
            if (progress >= 1) finishDirectCrossfade(nextIndex, outgoing, incoming);
        };
        tick();
        crossfadeTimer = setInterval(tick, 50);
    }).catch(() => { crossfadeInProgress = false; queueAutomaticAdvance('crossfade-error'); });
}

function playQueueAt(idx, options = {}) {
    if (idx < 0 || idx >= queue.length) return;
    clearAutomaticAdvance();
    playbackStoppedByUser = false;
    const previousSong = currentQueueSong();
    currentIndex = idx;
    const song = queue[idx];
    const reuseYouTubePlayer = previousSong?.type === 'yt' && song?.type === 'yt' && ytPlayer?.loadVideoById && !options.forceNewYouTubePlayer;
    const resumeSession = ['yt', 'mp3', 'freevideo'].includes(song.type) && options.resumeSession && String(options.resumeSession.resourceId) === String(song.url) && (!options.resumeSession.type || options.resumeSession.type === song.type)
        ? options.resumeSession
        : null;
    currentPlayingQid = song._qid;
    currentSourceIdx = options.sourceIdx ?? null;
    resetLyricsPanel();
    ytPlayCommandAt = 0;
    pendingVideoResumeSession = resumeSession;
    restoreVideoMinimizedAfterReady = !!(resumeSession && song.type === 'yt' && options.restoreMinimized);
    if (!resumeSession) clearVideoResumeSession();
    updateNowPlaying(song);
    rememberPlay(song);
    void reserveMarkUsed(song);
    mediaTransitionInProgress = true;
    stopAll({ preserveYouTubePlayer: reuseYouTubePlayer });
    mediaTransitionInProgress = false;
    updateMediaSession(song);
    setTrackLoading(true, currentSourceIdx);
    persistQueue();
    renderQueue();

    if (song.type === 'yt') {
        const deferYTAutoplay = !!options.deferAutoplay || externalAudioFocusInterrupted;
        if (!deferYTAutoplay && resumeSession?.wasPlaying !== false) startSilentLoop();
        freeVideoEl.pause();
        freeVideoEl.removeAttribute('src');
        freeVideoEl.hidden = true;
        showVideoStage(song);
        if (reuseYouTubePlayer) {
            ytPlaybackIntent = !deferYTAutoplay && resumeSession?.wasPlaying !== false;
            const startSeconds = resumeSession && Number(resumeSession.position) > 0 ? Number(resumeSession.position) : 0;
            try {
                if (ytPlaybackIntent) ytPlayer.loadVideoById({ videoId: song.url, startSeconds });
                else ytPlayer.cueVideoById({ videoId: song.url, startSeconds });
                if (ytPlaybackIntent) {
                    startSilentLoop();
                    requestYouTubePlayback('reused-iframe');
                    armYouTubeStartupWatchdog(song.url);
                }
            } catch (error) {
                stopAll();
                initYTPlayer(song.url, song.isPlaylist, resumeSession, deferYTAutoplay);
            }
        } else if (ytApiReady && window.YT && window.YT.Player) {
            const nativePlaylistId = options.playlistId || (isNativeYouTubePlaylistPlayback() && queuePlaylistContext?.playlistId);
            initYTPlayer(nativePlaylistId || song.url, !!nativePlaylistId || song.isPlaylist, resumeSession, deferYTAutoplay);
        } else {
            pendingYTRequest = { resourceId: song.url, isPlaylist: song.isPlaylist, resumeSession, deferAutoplay: deferYTAutoplay };
            loadYouTubeAPI();
        }
    } else if (song.type === 'freevideo') {
        document.getElementById('yt-player-container').innerHTML = '';
        showVideoStage(song);
        freeVideoEl.hidden = false;
        activeAudioEl = freeVideoEl;
        freeVideoEl.src = song.url;
        freeVideoEl.dataset.queueId = String(song._qid);
        applyVolume(parseFloat(document.getElementById('volumeSlider').value));
        bindDirectAudioEvents(freeVideoEl);
        freeVideoEl.onloadedmetadata = () => {
            applyResumeSessionToMedia(freeVideoEl, song, resumeSession);
            if (freeVideoEl === activeAudioEl && currentQueueSong()?.type === 'freevideo') renderVideoStageDetails({ ...song, duration: freeVideoEl.duration || song.duration });
        };
        freeVideoEl.load();
        const shouldAutoplayFreeVideo = !options.deferAutoplay && !externalAudioFocusInterrupted && resumeSession?.wasPlaying !== false;
        if (shouldAutoplayFreeVideo) freeVideoEl.play().catch(e => { setTrackLoading(false); showToast('No se pudo reproducir este video libre', 'fa-triangle-exclamation'); });
        else setTrackLoading(false);
    } else {
        hideVideoStage(false);
        activeAudioEl = audioEl;
        nextAudioEl.pause();
        nextAudioEl.currentTime = 0;
        nextAudioEl.dataset.queueId = '';
        audioEl.src = song.url;
        audioEl.dataset.queueId = String(song._qid);
        applyVolume(parseFloat(document.getElementById('volumeSlider').value));
        bindDirectAudioEvents(audioEl);
        audioEl.onloadedmetadata = () => applyResumeSessionToMedia(audioEl, song, resumeSession);
        const shouldAutoplayAudio = !options.deferAutoplay && !externalAudioFocusInterrupted && resumeSession?.wasPlaying !== false;
        if (shouldAutoplayAudio) audioEl.play().catch(e => { setTrackLoading(false); showToast('No se pudo reproducir esta pista', 'fa-triangle-exclamation'); });
        else setTrackLoading(false);
    }
}

function getRadioStyle(seedSong) {
    const explicit = String(seedSong?.genre || '').trim().toLowerCase();
    if (explicit && explicit !== 'unknown') return explicit;
    const artistName = String(seedSong?.artist || '').trim().toLowerCase();
    const artistHint = typeof ARTIST_STYLE_HINTS !== 'undefined'
        ? Object.entries(ARTIST_STYLE_HINTS).find(([artist]) => artistName === artist || artistName.includes(artist))?.[1]
        : null;
    if (artistHint) return artistHint;
    const text = `${seedSong?.title || ''} ${seedSong?.description || ''} ${seedSong?.artist || ''} ${currentMood || ''}`.toLowerCase();
    const styles = ['heavy metal', 'metalcore', 'nu metal', 'hard rock', 'alternative rock', 'punk rock', 'grunge', 'industrial metal', 'rock', 'metal'];
    return styles.find(style => text.includes(style)) || (currentMood ? String(currentMood).toLowerCase() : 'rock metal');
}

async function fetchSameArtistTracks(seedSong, count) {
    if (!seedSong || seedSong.type !== 'yt' || !seedSong.artist) return [];
    const style = getRadioStyle(seedSong);
    let raw = [];
    if (seedSong.channelId) {
        raw = await fetchYouTubeSearch(seedSong.artist, 'video', { channelId: seedSong.channelId, maxResults: Math.min(count, 20), reserveContext: 'radio', seed: seedSong });
    }
    if (raw.length < count) {
        const extra = await fetchYouTubeSearch(`${seedSong.artist} ${style} official music`, 'video', { maxResults: count, reserveContext: 'radio', seed: seedSong });
        const artistLower = seedSong.artist.toLowerCase();
        const filtered = extra.filter(s => (s.artist || '').toLowerCase().includes(artistLower) || artistLower.includes((s.artist || '').toLowerCase()));
        raw = raw.concat(filtered);
    }
    return raw.slice(0, count);
}

async function fetchRockMetalTracks(count, style = 'rock metal', seedSong = null) {
    return fetchYouTubeSearch(`${style} official music`, 'video', { maxResults: Math.min(Math.max(count, 6), 20), reserveContext: 'radio', seed: seedSong });
}

async function fetchOpenverseGenreTracks(seedSong, count) {
    const style = getRadioStyle(seedSong);
    const query = `${style} music`;
    const queryVariants = [...new Set([`${style} music`, `${style} song`, `${style} instrumental music`])];
    let cached = [];
    try {
        const store = JSON.parse(localStorage.getItem(OPENVERSE_RADIO_CACHE_KEY) || '{}');
        const entry = store[query];
        if (entry && Date.now() - Number(entry.savedAt || 0) < OPENVERSE_RADIO_CACHE_MAX_AGE_MS) {
            cached = Array.isArray(entry.tracks) ? entry.tracks : [];
        }
    } catch (e) {}
    let fresh = [];
    try {
        const freshResults = await Promise.allSettled(queryVariants.map(variant =>
            fetchOpenverseTracks(variant, Math.min(Math.max(count, 10), 20), { radioOnly: true, reserveContext: 'radio', seed: seedSong })
        ));
        const freshKeys = new Set();
        freshResults.forEach(result => {
            if (result.status !== 'fulfilled') return;
            result.value.filter(isRadioMusicTrack).forEach(track => {
                const key = reserveCandidateKey(track) || songKey(track);
                if (!freshKeys.has(key)) { freshKeys.add(key); fresh.push(track); }
            });
        });
        if (fresh.length) {
            try {
                const store = JSON.parse(localStorage.getItem(OPENVERSE_RADIO_CACHE_KEY) || '{}');
                store[query] = { savedAt: Date.now(), tracks: fresh.slice(0, 40) };
                localStorage.setItem(OPENVERSE_RADIO_CACHE_KEY, JSON.stringify(store));
            } catch (e) {}
        }
    } catch (e) {}
    const reserved = await reserveGetCandidates({ styleKey: style, source: 'openverse', limit: Math.max(count, 20) });
    return [...fresh, ...cached, ...reserved, ...homeMusic].filter(isRadioMusicTrack);
}

async function fetchJamendoGenreTracks(seedSong, count) {
    const style = getRadioStyle(seedSong);
    const query = `${style} music`;
    try {
        const response = await fetch(`/api/search?type=jamendo&query=${encodeURIComponent(query)}&style=${encodeURIComponent(style)}&maxResults=${Math.min(Math.max(count, 10), 20)}`);
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.results)) return [];
        const tracks = data.results.map(track => ({
            ...track,
            type: 'mp3',
            source: 'jamendo',
            sourceId: String(track.sourceId || track.id || track.url),
            img: track.img || track.thumbnail || 'assets/nowarfy-icon-512.png',
            genre: track.genre || style,
            license: track.license || 'Jamendo catalog license',
            sourceUrl: track.sourceUrl || ''
        })).filter(isRadioMusicTrack);
        void reserveDiscoveredCandidates(tracks, { context: 'radio', seed: seedSong });
        return tracks;
    } catch (e) {
        return [];
    }
}

async function fetchSimilarArtistTracks(seedSong, count) {
    if (!seedSong || !seedSong.artist) return fetchRockMetalTracks(count, getRadioStyle(seedSong), seedSong);
    const artist = seedSong.artist;
    const style = getRadioStyle(seedSong);
    try {
        const [radio, related] = await Promise.all([
            fetchYouTubeSearch(`${artist} ${style} radio mix`, 'video', { maxResults: Math.max(6, Math.ceil(count * 0.7)), reserveContext: 'radio', seed: seedSong }),
            fetchYouTubeSearch(`${style} artists similar to ${artist}`, 'video', { maxResults: Math.max(6, Math.ceil(count * 0.6)), reserveContext: 'radio', seed: seedSong })
        ]);
        const artistLower = artist.toLowerCase();
        const merged = shuffleArray([...radio, ...related]).filter(s => (s.artist || '').toLowerCase() !== artistLower);
        return merged.slice(0, count);
    } catch (e) { return []; }
}

function isRadioMusicTrack(song) {
    if (!song?.url || !['yt', 'mp3'].includes(song.type)) return false;
    const text = `${song.title || ''} ${song.artist || ''} ${song.description || ''} ${song.genre || ''}`.toLowerCase();
    if (/audiobook|audio book|audiolibro|spoken word|narration|narrator|chapter|book reading|story|stories|lecture|podcast|interview|meditation|sleep music|children|bedtime|sound effect|foley|noise|ambient/.test(text)) return false;
    if (song.type === 'yt' && song.categoryId && String(song.categoryId) !== '10') return false;
    if (song.type === 'yt' && typeof isNonMusicalVideo === 'function' && isNonMusicalVideo(song)) return false;
    if (song.type === 'yt' && Number(song.duration) > 0 && Number(song.duration) < 60) return false;
    return true;
}

function appendUniqueSongs(candidates, target, limit) {
    for (const song of candidates || []) {
        if (target.length >= limit || !song?.url) break;
        if (!isRadioMusicTrack(song)) continue;
        const key = songKey(song);
        if (queueSeenKeys.has(key)) continue;
        queueSeenKeys.add(key);
        target.push(withQid(song));
    }
}

async function buildAutomaticBatch(seed) {
    const added = [];
    const style = getRadioStyle(seed);
    const remaining = () => QUEUE_BATCH - added.length;

    if (queueRound === 0) {
        appendUniqueSongs(await fetchSameArtistTracks(seed, remaining()), added, QUEUE_BATCH);
        if (remaining() > 0 && seed?.artist) {
            appendUniqueSongs(await reserveGetCandidates({ styleKey: style, artist: seed.artist, limit: remaining() }), added, QUEUE_BATCH);
        }
        queueRound = 1;
    }

    if (remaining() > 0) {
        appendUniqueSongs(await fetchSimilarArtistTracks(seed, remaining()), added, QUEUE_BATCH);
        if (remaining() > 0) {
            appendUniqueSongs(await reserveGetCandidates({ styleKey: style, limit: remaining() }), added, QUEUE_BATCH);
        }
    }

    if (remaining() > 0) {
        appendUniqueSongs(await fetchOpenverseGenreTracks(seed, remaining()), added, QUEUE_BATCH);
    }

    if (remaining() > 0) {
        appendUniqueSongs(await fetchJamendoGenreTracks(seed, remaining()), added, QUEUE_BATCH);
    }
    if (remaining() > 0) {
        appendUniqueSongs(await fetchRockMetalTracks(remaining(), getRadioStyle(seed), seed), added, QUEUE_BATCH);
    }

    return added;
}

async function growQueueIfNeeded(force = false) {
    if (queueFetching || queue.length === 0) return;
    const idx = queue.findIndex(s => s._qid === currentPlayingQid);
    const atPlaylistEnd = idx >= 0 && idx + 1 >= queue.length;
    if (!force && !atPlaylistEnd) return;
    const seed = queue[idx] || queue[queue.length - 1];
    if (!seed) return;
    queueFetching = true;
    toggleQueueLoadingHint(true);
    try {
        const added = await buildAutomaticBatch(seed);
        if (added.length) {
            queue = queue.concat(added);
            persistQueue();
            renderQueue();
        }
    } catch (e) {}
    finally { queueFetching = false; toggleQueueLoadingHint(false); }
}

function toggleQueueLoadingHint(show) {
    const hint = document.getElementById('queueLoadingHint');
    if (hint) hint.classList.toggle('show', show);
}

function clearVideoResumeSession() {
    try { localStorage.removeItem(VIDEO_RESUME_STORAGE_KEY); } catch (e) {}
    pendingVideoResumeSession = null;
    lastVideoResumeSaveAt = 0;
}

function getLocalPlaybackPosition(song = currentQueueSong()) {
    if (!song || !['yt', 'mp3', 'freevideo'].includes(song.type)) return null;
    if (nowarfyRemoteSession && !nowarfyRemoteIsPlayer) return null;
    if (song.type === 'yt') return ytPlayer?.getCurrentTime ? Number(ytPlayer.getCurrentTime()) || 0 : null;
    return activeAudioEl ? Number(activeAudioEl.currentTime) || 0 : null;
}
function persistVideoResumeSession(force = false) {
    const song = currentQueueSong();
    const position = getLocalPlaybackPosition(song);
    if (!song?.url || position === null) return;
    const now = Date.now();
    if (!force && now - lastVideoResumeSaveAt < 3000) return;
    try {
        localStorage.setItem(VIDEO_RESUME_STORAGE_KEY, JSON.stringify({
            qid: currentPlayingQid,
            resourceId: song.url,
            type: song.type,
            isPlaylist: !!song.isPlaylist,
            position: Math.max(0, position),
            wasPlaying: !!isPlaying,
            minimized: !!videoStageMinimized,
            savedAt: now
        }));
        lastVideoResumeSaveAt = now;
    } catch (e) {}
}

function readVideoResumeSession() {
    try {
        const saved = JSON.parse(localStorage.getItem(VIDEO_RESUME_STORAGE_KEY));
        if (!saved || !saved.resourceId || !Number.isFinite(Number(saved.position))) return null;
        if (!Number.isFinite(Number(saved.savedAt)) || Date.now() - Number(saved.savedAt) > VIDEO_RESUME_MAX_AGE_MS) return null;
        return saved;
    } catch (e) { return null; }
}

let nowarfyQueuePersistTimer = null;
function persistQueueNow() {
    try {
        localStorage.setItem('nowarfy_queue', JSON.stringify(queue));
        localStorage.setItem('nowarfy_queue_qid', currentPlayingQid == null ? '' : String(currentPlayingQid));
        localStorage.setItem('nowarfy_queue_round', String(queueRound));
        persistQueueMode();
    } catch (e) {}
}
function persistQueue() {
    clearTimeout(nowarfyQueuePersistTimer);
    nowarfyQueuePersistTimer = window.setTimeout(() => {
        nowarfyQueuePersistTimer = null;
        persistQueueNow();
    }, 350);
}
function flushNowarfyPersistence() {
    clearTimeout(nowarfyQueuePersistTimer);
    nowarfyQueuePersistTimer = null;
    persistQueueNow();
    persistVideoResumeSession(true);
    updatePlaybackState();
}

function restoreQueueFromStorage() {
    try {
        const savedQueue = JSON.parse(localStorage.getItem('nowarfy_queue'));
        if (!Array.isArray(savedQueue) || !savedQueue.length) return;
        const savedMode = localStorage.getItem(QUEUE_MODE_STORAGE_KEY);
        const savedContext = savedMode === 'prebuilt_playlist' ? JSON.parse(localStorage.getItem(QUEUE_PLAYLIST_STORAGE_KEY) || 'null') : null;
        queuePlaybackMode = savedMode === 'prebuilt_playlist' && savedContext?.playlistId ? 'prebuilt_playlist' : 'radio';
        queuePlaylistContext = queuePlaybackMode === 'prebuilt_playlist' ? savedContext : null;
        queue = queuePlaybackMode === 'prebuilt_playlist'
            ? savedQueue.filter(item => item?.type === 'yt' && item?.url)
            : savedQueue.filter(isRadioMusicTrack);
        if (!queue.length) return;
        queueSeenKeys = new Set(queue.map(songKey));
        queueIdCounter = queue.reduce((max, s) => Math.max(max, s._qid || 0), 0);
        queueRound = parseInt(localStorage.getItem('nowarfy_queue_round'), 10) || 0;
        const savedQid = localStorage.getItem('nowarfy_queue_qid');
        const qid = savedQid ? parseInt(savedQid, 10) : null;
        const idx = queue.findIndex(s => s._qid === qid);
        if (idx === -1) return;
        currentIndex = idx;
        currentPlayingQid = qid;
        const song = queue[idx];
        updateNowPlaying(song);

        const resume = readVideoResumeSession();
        if (['yt', 'mp3', 'freevideo'].includes(song.type) && resume && String(resume.resourceId) === String(song.url) && (!resume.type || resume.type === song.type) && (!resume.qid || Number(resume.qid) === Number(qid))) {
            pendingVideoResumeSession = resume;
        }
    } catch (e) {}
}

function toggleQueuePanel() {
    const panel = document.getElementById('queuePanel');
    const overlay = document.getElementById('queueOverlay');
    const open = panel.classList.toggle('open');
    overlay.classList.toggle('show', open);
    document.getElementById('queueToggleBtn').classList.toggle('active', open);
    if (open) renderQueue();
}
function closeQueuePanel() {
    document.getElementById('queuePanel').classList.remove('open');
    document.getElementById('queueOverlay').classList.remove('show');
    document.getElementById('queueToggleBtn').classList.remove('active');
}

function clearQueue() {
    if (queue.length === 0) return;
    const current = currentQueueSong() || queue[currentIndex];
    if (!current) return;
    queue = [current];
    queueSeenKeys = new Set([songKey(current)]);
    currentIndex = 0;
    currentPlayingQid = current._qid;
    currentSourceIdx = null;
    queueRound = 1;
    if (queuePlaybackMode === 'prebuilt_playlist' && queuePlaylistContext) queuePlaylistContext.nextPageToken = '';
    persistQueue();
    renderQueue();
    showToast(queuePlaybackMode === 'prebuilt_playlist'
        ? 'Se quitaron los videos siguientes; continúa la playlist actual'
        : 'Se quitaron las canciones siguientes; continúa la actual', 'fa-trash');
}

function removeFromQueue(qid) {
    const idx = queue.findIndex(s => s._qid === qid);
    if (idx === -1) return;
    queue.splice(idx, 1);
    persistQueue();
    renderQueue();
    showToast('Quitada de la cola', 'fa-xmark');
}

function reorderQueue(srcQid, targetQid, insertBefore) {
    const srcIdx = queue.findIndex(s => s._qid === srcQid);
    if (srcIdx === -1) return;
    const [item] = queue.splice(srcIdx, 1);
    let targetIdx = queue.findIndex(s => s._qid === targetQid);
    if (targetIdx === -1) targetIdx = queue.length;
    queue.splice(insertBefore ? targetIdx : targetIdx + 1, 0, item);
    persistQueue();
    renderQueue();
}

function setupQueueTrashDropzone() {
    const trash = document.getElementById('queueTrash');
    if (!trash) return;
    trash.addEventListener('dragover', (e) => { e.preventDefault(); trash.classList.add('drag-hover'); });
    trash.addEventListener('dragleave', () => trash.classList.remove('drag-hover'));
    trash.addEventListener('drop', (e) => {
        e.preventDefault();
        trash.classList.remove('drag-hover');
        if (dragSrcQid != null) removeFromQueue(dragSrcQid);
    });
}

function renderQueue() {
    renderContinuousPlaybackControls();
    currentIndex = queue.findIndex(s => s._qid === currentPlayingQid);
    const list = document.getElementById('queueList');
    const sub = document.getElementById('queueSub');
    const badge = document.getElementById('queueCountBadge');
    if (!list) return;

    if (badge) { badge.textContent = String(queue.length); badge.classList.toggle('show', queue.length > 0); }
    const queueModeLabel = queuePlaybackMode === 'prebuilt_playlist'
        ? `playlist de YouTube${queuePlaylistContext?.title ? ` · ${queuePlaylistContext.title}` : ''}`
        : 'radio automática';
    if (sub) sub.textContent = queue.length
        ? `${queue.length} canción${queue.length === 1 ? '' : 'es'} · ${queueModeLabel} · ${continuousPlayback ? 'reproducción continua' : 'se detiene al terminar'}`
        : `La Playlist está vacía · ${continuousPlayback ? 'continua lista' : 'una pista por vez'}`;

    list.innerHTML = '';
    if (queue.length === 0) {
        list.innerHTML = `<div class="queue-empty"><i class="fas fa-compact-disc"></i><p>Elegí una canción para armar tu Playlist automática: 20 del mismo artista y después más de artistas similares.</p></div>`;
        document.getElementById('queueTrash').classList.remove('show');
        return;
    }

    queue.forEach((song, idx) => {
        const row = document.createElement('div');
        const isPlayingRow = song._qid === currentPlayingQid;
        row.className = 'queue-row-item' + (isPlayingRow ? ' playing' : '');
        row.draggable = true;
        row.dataset.qid = String(song._qid);
        row.innerHTML = `
            <i class="fas fa-grip-lines queue-drag-handle" title="Arrastrar para reordenar o quitar"></i>
            <img src="${escapeHtml(song.img || '')}" class="queue-row-img" loading="lazy" alt="" onerror="this.closest('.queue-row').remove();">
            <div class="queue-row-info">
                <div class="queue-row-title">${escapeHtml(song.title)}</div>
                <div class="queue-row-artist">${escapeHtml(song.artist)}</div>
            </div>
            ${isPlayingRow ? '<i class="fas fa-volume-up queue-playing-icon" title="Sonando ahora"></i>' : ''}
            <button type="button" class="queue-row-remove" title="Quitar de Playlist" aria-label="Quitar de Playlist"><i class="fas fa-xmark"></i></button>`;

        row.addEventListener('click', (e) => {
            if (e.target.closest('.queue-row-remove') || e.target.closest('.queue-drag-handle')) return;
            playQueueAt(idx);
        });
        row.querySelector('.queue-row-remove').addEventListener('click', (e) => {
            e.stopPropagation();
            removeFromQueue(song._qid);
        });
        row.addEventListener('dragstart', (e) => {
            dragSrcQid = song._qid;
            row.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', String(song._qid)); } catch (err) {}
            document.getElementById('queueTrash').classList.add('show');
        });
        row.addEventListener('dragend', () => {
            row.classList.remove('dragging');
            document.querySelectorAll('.queue-row-item.drag-over-top, .queue-row-item.drag-over-bottom').forEach(r => r.classList.remove('drag-over-top', 'drag-over-bottom'));
            document.getElementById('queueTrash').classList.remove('show', 'drag-hover');
            dragSrcQid = null;
        });
        row.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (dragSrcQid == null || dragSrcQid === song._qid) return;
            const rect = row.getBoundingClientRect();
            const before = (e.clientY - rect.top) < rect.height / 2;
            row.classList.toggle('drag-over-top', before);
            row.classList.toggle('drag-over-bottom', !before);
        });
        row.addEventListener('dragleave', () => row.classList.remove('drag-over-top', 'drag-over-bottom'));
        row.addEventListener('drop', (e) => {
            e.preventDefault();
            row.classList.remove('drag-over-top', 'drag-over-bottom');
            if (dragSrcQid == null || dragSrcQid === song._qid) return;
            const rect = row.getBoundingClientRect();
            const before = (e.clientY - rect.top) < rect.height / 2;
            reorderQueue(dragSrcQid, song._qid, before);
        });

        list.appendChild(row);
    });
}

function getVideoSuggestions(song) {
    const currentId = String(song?.url || '');
    const candidates = [...currentList, ...homeVideos]
        .filter(item => item && (item.type === 'yt' || item.resourceKind === 'youtube#video'))
        .filter(item => String(item.url || '') && String(item.url || '') !== currentId);
    const seen = new Set();
    const unique = candidates.filter(item => {
        const id = String(item.url || '');
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
    });
    const sameChannel = song?.channelId ? unique.filter(item => item.channelId === song.channelId) : [];
    const otherVideos = unique.filter(item => !song?.channelId || item.channelId !== song.channelId);
    return [...sameChannel, ...otherVideos].slice(0, 8);
}

function renderContinuousPlaybackControls() {
    const playerButton = document.getElementById('continuousPlayerToggle');
    const queueButton = document.getElementById('continuousQueueToggle');
    [playerButton, queueButton].filter(Boolean).forEach(button => {
        button.classList.toggle('on', continuousPlayback);
        button.setAttribute('aria-pressed', String(continuousPlayback));
        button.title = continuousPlayback ? 'Reproducción continua activada' : 'Reproducción continua desactivada';
    });
    if (queueButton) queueButton.innerHTML = `<i class="fas fa-infinity"></i> ${continuousPlayback ? 'Continua' : 'Una pista'}`;
}

function toggleContinuousPlayback() {
    continuousPlayback = !continuousPlayback;
    localStorage.setItem(CONTINUOUS_PLAYBACK_STORAGE_KEY, String(continuousPlayback));
    if (!continuousPlayback) {
        clearAutomaticAdvance();
        cancelDirectCrossfade();
    }
    renderContinuousPlaybackControls();
    renderQueue();
    const detail = 'mediaSession' in navigator
        ? 'Los controles del sistema y auriculares siguen disponibles'
        : 'El navegador puede limitar controles de pantalla bloqueada';
    showToast(continuousPlayback ? `Reproducción continua activada · ${detail}` : 'Reproducción continua desactivada: la pista actual se detendrá al terminar', continuousPlayback ? 'fa-infinity' : 'fa-stop');
}

function renderVideoAutoplayToggle() {
    const button = document.getElementById('videoAutoplayToggle');
    if (!button) return;
    button.classList.toggle('on', videoAutoplay);
    button.setAttribute('aria-pressed', String(videoAutoplay));
    button.innerHTML = `<i class="fas fa-forward"></i> ${videoAutoplay ? 'Sugerencias auto' : 'Solo cola'}`;
}

function toggleVideoAutoplay() {
    videoAutoplay = !videoAutoplay;
    localStorage.setItem(VIDEO_AUTOPLAY_STORAGE_KEY, String(videoAutoplay));
    renderVideoAutoplayToggle();
    showToast(videoAutoplay ? 'Sugerencias automáticas activadas' : 'Sugerencias pausadas; la cola sigue sonando', 'fa-forward');
}

function renderVideoSuggestions(song) {
    const wrapper = document.getElementById('videoSuggestions');
    const list = document.getElementById('videoSuggestionsList');
    const context = document.getElementById('videoSuggestionsContext');
    if (song?.type === 'freevideo') {
        list.innerHTML = '';
        wrapper.classList.remove('visible');
        return;
    }
    const suggestions = getVideoSuggestions(song);
    list.innerHTML = '';
    if (!suggestions.length) {
        wrapper.classList.remove('visible');
        return;
    }
    const fromSameChannel = suggestions.filter(item => song?.channelId && item.channelId === song.channelId).length;
    context.textContent = fromSameChannel ? `Incluye ${fromSameChannel} del mismo canal` : 'Selección relacionada';
    suggestions.forEach(item => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'video-suggestion';
        button.innerHTML = `<span class="video-suggestion-thumb"><img src="${escapeHtml(item.img || '')}" alt="" loading="lazy" onerror="this.closest('button').remove();"><i class="fas fa-play"></i></span><span><span class="video-suggestion-title">${escapeHtml(item.title || 'Video')}</span><span class="video-suggestion-artist">${escapeHtml(item.channelTitle || item.artist || 'YouTube')}</span></span>`;
        button.onclick = () => selectSong(item, item.sourceIndex ?? 0);
        list.appendChild(button);
    });
    wrapper.classList.add('visible');
    renderVideoAutoplayToggle();
}

function continueVideoAutoplay() {
    const current = queue[currentIndex];
    if (!current || current.type !== 'yt') return false;
    const currentQueueIndex = queue.findIndex(item => item._qid === currentPlayingQid);
    if (currentQueueIndex >= 0 && currentQueueIndex + 1 < queue.length) {
        playQueueAt(currentQueueIndex + 1);
        return true;
    }
    return false;
}

function clearAutomaticAdvance() {
    if (automaticAdvanceTimer) window.clearTimeout(automaticAdvanceTimer);
    automaticAdvanceTimer = null;
    automaticAdvanceTargetQid = null;
}

function appendAutomaticFallback(song) {
    if (!song?.url) return false;
    const key = songKey(song);
    if (queueSeenKeys.has(key)) return false;
    const queued = withQid(song);
    queueSeenKeys.add(key);
    queue.push(queued);
    persistQueue();
    renderQueue();
    playQueueAt(queue.length - 1, { sourceIdx: song.sourceIndex ?? null });
    return true;
}

function findAutomaticFallback(current) {
    const currentId = String(current?.url || '');
    const candidates = [...currentList, ...homeMusic, ...homeMusicVideos, ...homeVideos]
        .filter(item => item?.url && String(item.url) !== currentId && isRadioMusicTrack(item));
    return candidates.find(item => !queueSeenKeys.has(songKey(item))) || null;
}

async function recoverAutomaticQueue(targetQid) {
    if (automaticQueueRecoveryInFlight || playbackStoppedByUser || currentPlayingQid !== targetQid) return false;
    automaticQueueRecoveryInFlight = true;
    try {
        const current = currentQueueSong();
        await growQueueIfNeeded();
        if (playbackStoppedByUser || currentPlayingQid !== targetQid) return false;
        const currentQueueIndex = queue.findIndex(item => item._qid === targetQid);
        if (currentQueueIndex >= 0 && currentQueueIndex + 1 < queue.length) {
            playQueueAt(currentQueueIndex + 1);
            return true;
        }
        const immediateFallback = findAutomaticFallback(current);
        return appendAutomaticFallback(immediateFallback);
    } catch (error) {
        return false;
    } finally {
        automaticQueueRecoveryInFlight = false;
    }
}

function queueAutomaticAdvance(reason = 'ended') {
    const targetQid = currentPlayingQid;
    if (!targetQid || playbackStoppedByUser || automaticAdvanceTargetQid === targetQid) return;
    if (!continuousPlayback) {
        isPlaying = false;
        clearAutomaticAdvance();
        updateIcon();
        updatePlaybackState();
        persistVideoResumeSession(true);
        stopSilentLoop();
        return;
    }
    automaticAdvanceTargetQid = targetQid;
    const advance = async () => {
        automaticAdvanceTimer = null;
        if (playbackStoppedByUser || currentPlayingQid !== targetQid) return;
        if (nextSong(false)) return;
        if (await recoverAutomaticQueue(targetQid)) return;
        isPlaying = false;
        stopSilentLoop();
        updateIcon();
        updatePlaybackState();
        if (reason.endsWith('error')) showToast('No encontramos otra pista reproducible en este momento', 'fa-triangle-exclamation');
    };
    if (document.visibilityState === 'hidden') Promise.resolve().then(advance);
    else automaticAdvanceTimer = window.setTimeout(advance, 180);
}

