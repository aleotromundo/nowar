// --- COLA DE REPRODUCCIÓN PERSISTENTE (radio automática) ---
const QUEUE_BATCH = 20;
let queue = [];
let queueSeenKeys = new Set();
let queueIdCounter = 0;
let currentPlayingQid = null;
let currentSourceIdx = null;
let queueRound = 0;
let queueFetching = false;
let dragSrcQid = null;
let searchQuery = "";
let currentMood = null;
let searchTimeout = null;
let activeSearchPagination = null;
let searchMoreObserver = null;
let activeSearchController = null;
let activeSearchRequestId = 0;
let knowledgeMoreObserver = null;
let ytPlayer = null;
let ytStartupTimer = null;
let ytPlaybackIntent = false;
let ytPlayCommandAt = 0;
let ytApiReady = false;
let pendingYTRequest = null;
let progressInterval = null;
let youtubeQuotaBlockedUntil = 0;
let youtubeQuotaNoticeShown = false;
let shuffleMode = false;
let isSeeking = false;
let lastVolume = 0.8;
const VIDEO_AUTOPLAY_STORAGE_KEY = 'youtoo_video_autoplay_v1';
const CONTINUOUS_PLAYBACK_STORAGE_KEY = 'nowarfy_continuous_playback_v1';
const QUEUE_MODE_STORAGE_KEY = 'nowarfy_queue_mode_v1';
const QUEUE_PLAYLIST_STORAGE_KEY = 'nowarfy_queue_playlist_v1';
const VIDEO_RESUME_STORAGE_KEY = 'nowarfy_video_resume_v1';
const VIDEO_RESUME_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
let videoAutoplay = localStorage.getItem(VIDEO_AUTOPLAY_STORAGE_KEY) !== 'false';
let continuousPlayback = localStorage.getItem(CONTINUOUS_PLAYBACK_STORAGE_KEY) !== 'false';
let queuePlaybackMode = localStorage.getItem(QUEUE_MODE_STORAGE_KEY) === 'prebuilt_playlist' ? 'prebuilt_playlist' : 'radio';
let queuePlaylistContext = null;
let videoStageObserver = null;
let videoStageMinimized = false;
let pendingVideoResumeSession = null;
let restoreVideoMinimizedAfterReady = false;
let lastVideoResumeSaveAt = 0;
let playbackStoppedByUser = false;
let externalAudioFocusInterrupted = false;
let externalAudioFocusResumePending = false;
let externalAudioFocusLastState = '';
let externalAudioFocusRecoveryTimer = null;
let externalAudioFocusResumeCheckTimer = null;
let externalAudioFocusResumeAttempting = false;
let externalAudioFocusRecoveryAttempts = 0;
let externalAudioFocusFadeTimer = null;
let externalAudioFocusVolume = null;
let videoStageManualMinimized = false;
let videoStageNeedsVisualRefresh = false;
let videoFrameRefreshTimer = null;
let videoFrameRestoreAwaitingPlayer = '';
let youtubeCompactWindow = null;
let youtubeEmbedFallbackUrl = '';
let mediaTransitionInProgress = false;
let automaticAdvanceTimer = null;
let automaticAdvanceTargetQid = null;
let automaticQueueRecoveryInFlight = false;
const PLAYBACK_CONTINUITY_CHECK_MS = 9000;
const EXTERNAL_AUDIO_RESUME_DELAY_MS = 900;
const EXTERNAL_AUDIO_RESUME_RETRY_MS = 2500;
const NOWARFY_AUDIO_PRIORITY_MODE = true;
const YT_PLAY_RETRY_THROTTLE_MS = 750;
const YT_END_EARLY_TOLERANCE_SECONDS = 1.5;
let channelFilter = null;
let activeBrowseMode = 'home';
let globalPlaylistCatalogState = null;
let globalChannelCatalogState = null;
let globalCatalogMineOnly = false;
let homeFeedLoaded = false;
let homeFeedLoading = false;
let initialRadioQueueReady = false;
const FEATURED_ROTATION_STORAGE_KEY = 'nowarfy_featured_rotation_v1';
const FEATURED_EDITION_SIZE = 5;
const FEATURED_THEMES = ['violet', 'aqua', 'ember', 'electric'];
let homeVideos = [];
let homeMusicVideos = [];
let homeChannels = [];
let homePlaylists = [];
let homeMusic = [];
let homeRecommended = [];
let ambientArtworkIndex = 0;
let ambientArtworkRotationTimer = null;
let ambientArtworkLockedToCurrent = false;
let activeChannelCatalog = null;
let activePlaylistCatalog = null;
let nowarfyRestoringHistory = false;
let nowarfyLastHistoryState = null;
let knowledgeBaseState = null;
let knowledgeBaseSearchTimer = null;
const LYRICS_CACHE_KEY = 'nowarfy_verified_lyrics_v1';
const LYRICS_CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const LYRICS_CACHE_MAX_ITEMS = 80;
let lyricsRequestToken = 0;
let lyricsZoom = 1;
let currentLyrics = null;
let lyricsLoadingKey = '';
let videoStageAutoHiddenReason = '';

const audioEl = document.getElementById('audio-element');
const nextAudioEl = document.getElementById('audio-element-next');
const freeVideoEl = document.getElementById('freeVideoPlayer');
let activeAudioEl = audioEl;
let mediaSessionHandlersReady = false;
let mediaSessionSongKey = '';
let crossfadeInProgress = false;
let crossfadeTimer = null;
const CROSSFADE_SECONDS = 3;
const playerBar = document.getElementById('playerBar');
const pipBtn = document.getElementById('pipBtn');
const progressTrack = document.getElementById('progressTrack');
const progFill = document.getElementById('progFill');
const progThumb = document.getElementById('progThumb');
const currTimeEl = document.getElementById('currTime');
const totalTimeEl = document.getElementById('totalTime');
const searchInput = document.getElementById('searchInput');
const searchClearBtn = document.getElementById('searchClear');
const silentAudioLoop = document.getElementById('silent-audio-loop');

initVolume();
initNowarfyHistory();
setTimeout(resetView, 0);
loadYouTubeAPI();
setupProgressDrag();
setupBackgroundPlaybackSupport();
setupKeyboardShortcuts();
restoreQueueFromStorage();
setupQueueTrashDropzone();
setupVideoStageObserver();
setupVideoStageVisibilityAwareness();
setupBackgroundPersistence();
setupPlaybackContinuity();
setupInstallableApp();
renderQueue();

window.onerror = function(msg, url, lineNo, columnNo, error) {
    if (msg && msg.includes('postMessage') && msg.includes('youtube')) return true;
    if (msg && msg.includes('Slow network')) return true;
    return false;
};

function normalizeSourceText(value) {
    let text = value == null ? '' : String(value);
    const decoder = document.createElement('textarea');
    for (let pass = 0; pass < 2; pass += 1) {
        decoder.innerHTML = text;
        const decoded = decoder.value;
        if (decoded === text) break;
        text = decoded;
    }
    return text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function descriptionExcerpt(value, maxLength = 118) {
    const clean = normalizeSourceText(value);
    if (!clean) return '';
    return clean.length > maxLength ? `${clean.slice(0, maxLength).trimEnd()}…` : clean;
}

function hasUsablePlaylistItems(item) {
    if (!(item?.resourceKind === 'youtube#playlist' || item?.type === 'playlist' || item?.isPlaylist)) return true;
    if (item.itemCount === null || item.itemCount === undefined || item.itemCount === '') return true;
    const count = Number(item.itemCount);
    return Number.isFinite(count) ? count > 0 : true;
}

function videoStatsLabel(item) {
    if (!(item?.resourceKind === 'youtube#video' || item?.type === 'yt')) return '';
    const parts = [];
    const views = Number(item.viewCount);
    const likes = Number(item.likeCount);
    const comments = Number(item.commentCount);
    if (Number.isFinite(views)) parts.push(`${formatCompactNumber(views)} vistas`);
    if (Number.isFinite(likes)) parts.push(`${formatCompactNumber(likes)} likes`);
    if (Number.isFinite(comments)) parts.push(`${formatCompactNumber(comments)} comentarios`);
    if (item.definition) parts.push(String(item.definition).toUpperCase());
    return parts.join(' · ');
}

function contentMetaLabel(item) {
    if (item?.resourceKind === 'youtube#playlist') {
        const count = Number(item.itemCount);
        return Number.isFinite(count) && count > 0 ? `${count} videos · Lista de reproducción` : 'Lista de reproducción';
    }
    if (item?.resourceKind === 'youtube#channel') return 'Canal de YouTube';
    if (item?.resourceKind === 'youtube#video' || item?.type === 'yt') {
        const duration = formatContentDuration(item.duration);
        return duration === '—' ? 'Video de YouTube' : `Video · ${duration}`;
    }
    if (item?.type === 'freevideo' || item?.resourceKind === 'commons#video') {
        const duration = formatContentDuration(item.duration);
        const source = item.license ? `Video libre · ${item.license}` : 'Video libre';
        return duration === '—' ? source : `${source} · ${duration}`;
    }
    return item?.license ? `Audio libre · ${item.license}` : 'Audio';
}

// Escapa texto para usarlo tanto en nodos de texto como dentro de atributos entre comillas.
// (textContent->innerHTML no escapa " ni ', lo que permitia salirse de un atributo.)
function escapeHtml(str) {
    return normalizeSourceText(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function hasValidArtwork(item) {
    const source = String(item?.img || item?.thumbnail || '').trim();
    if (!source) return false;
    if (/^(?:\/?assets\/|\/favicon\.ico$)/i.test(source)) return true;
    if (!/^https:\/\//i.test(source)) return false;
    try {
        const parsed = new URL(source);
        return !!parsed.hostname && !/^(?:data|blob):/i.test(parsed.protocol);
    } catch (e) {
        return false;
    }
}

function itemsWithArtwork(items) {
    return (items || []).filter(hasValidArtwork);
}

function removeCardForMissingArtwork(image) {
    const card = image?.closest?.('.card');
    if (!card) return;
    const parent = card.parentElement;
    card.remove();
    if (!parent?.querySelector?.('.card')) {
        const librarySection = parent.closest?.('.library-rail-section');
        if (librarySection) librarySection.remove();
        else parent.parentElement?.remove();
    }
}

const TASTE_STORAGE_KEY = 'youtoo_taste_v1';
const NOWARFY_TASTE_TABLE = 'nowarfy_user_taste';
let nowarfyTasteSyncTimer = null;
let nowarfyTasteSyncInFlight = false;

const EMPTY_TASTE = Object.freeze({ version: 3, personalization: true, searches: [], plays: [], channels: [], playlists: [] });

function readTaste() {
    try {
        const saved = JSON.parse(localStorage.getItem(TASTE_STORAGE_KEY));
        return {
            version: 3,
            personalization: saved?.personalization !== false,
            searches: Array.isArray(saved?.searches) ? saved.searches.filter(item => typeof item === 'string') : [],
            plays: Array.isArray(saved?.plays) ? saved.plays.filter(item => item && typeof item.title === 'string') : [],
            channels: Array.isArray(saved?.channels) ? saved.channels.filter(item => item && typeof item.id === 'string') : [],
            playlists: Array.isArray(saved?.playlists) ? saved.playlists.filter(item => item && typeof item.id === 'string') : []
        };
    } catch { return { ...EMPTY_TASTE, searches: [], plays: [], channels: [], playlists: [] }; }
}

function writeTaste(taste) {
    localStorage.setItem(TASTE_STORAGE_KEY, JSON.stringify({ ...taste, version: 3, updatedAt: Date.now() }));
    scheduleNowarfyTasteSync();
}

function scheduleNowarfyTasteSync() {
    if (!nowarfySupabase || !nowarfyAuthUser) return;
    clearTimeout(nowarfyTasteSyncTimer);
    nowarfyTasteSyncTimer = setTimeout(() => {
        void syncNowarfyTaste();
    }, 800);
}

async function syncNowarfyTaste() {
    if (nowarfyTasteSyncInFlight || !nowarfySupabase || !nowarfyAuthUser) return;
    nowarfyTasteSyncInFlight = true;
    try {
        const taste = readTaste();
        const { error } = await nowarfySupabase
            .from(NOWARFY_TASTE_TABLE)
            .upsert({
                user_id: nowarfyAuthUser.id,
                plays: taste.plays || [],
                searches: taste.searches || [],
                channels: taste.channels || [],
                playlists: taste.playlists || [],
                favorites: favorites || [],
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id' });
        if (error) console.error('Error sincronizando historial:', error);
    } finally {
        nowarfyTasteSyncInFlight = false;
    }
}

async function loadNowarfyTaste() {
    if (!nowarfySupabase || !nowarfyAuthUser) return;
    try {
        const { data, error } = await nowarfySupabase
            .from(NOWARFY_TASTE_TABLE)
            .select('plays, searches, channels, playlists, favorites')
            .eq('user_id', nowarfyAuthUser.id)
            .maybeSingle();

        if (error) {
            console.error('Error cargando historial:', error);
            return;
        }

        if (!data) {
            await syncNowarfyTaste();
            return;
        }

        const localTaste = readTaste();
        const mergedPlays = [...(localTaste.plays || []), ...(data.plays || [])];
        const uniquePlays = Array.from(new Map(mergedPlays.map(item => [item.url || `${item.title}|${item.artist}`, item])).values());

        const mergedTaste = {
            ...localTaste,
            plays: uniquePlays,
            searches: Array.from(new Set([...(localTaste.searches || []), ...(data.searches || [])])).slice(0, 12),
            channels: Array.from(new Map([...(localTaste.channels || []), ...(data.channels || [])].map(item => [item.id, item])).values()),
            playlists: Array.from(new Map([...(localTaste.playlists || []), ...(data.playlists || [])].map(item => [item.id, item])).values())
        };

        const mergedFavorites = Array.from(new Map([...(favorites || []), ...(data.favorites || [])].map(item => [item.url || `${item.title}|${item.artist}`, item])).values());

        favorites = mergedFavorites;
        localStorage.setItem('nowarfy_favs', JSON.stringify(favorites));
        if (typeof updateFavButton === 'function' && typeof currentQueueSong === 'function') {
            try { updateFavButton(currentQueueSong()); } catch (e) {}
        }

        writeTaste(mergedTaste);
        await syncNowarfyTaste();

        if (activeBrowseMode && typeof showSection === 'function') {
            if (activeBrowseMode === 'home') {
                if (typeof renderHomeFeed === 'function') renderHomeFeed();
            } else if (['favorites', 'history', 'taste', 'playlists', 'channels'].includes(activeBrowseMode)) {
                showSection(activeBrowseMode, { silent: true });
            }
        }
    } catch (error) {
        console.error('Error cargando historial:', error);
    }
}

function rememberUnique(list, entry, getKey, max = Infinity) {
    const key = getKey(entry);
    const merged = [entry, ...list.filter(item => getKey(item) !== key)];
    return Number.isFinite(max) ? merged.slice(0, max) : merged;
}

function rememberSearch(query) {
    const normalized = String(query || '').trim();
    if (!normalized) return;
    const taste = readTaste();
    if (!taste.personalization) return;
    taste.searches = [normalized, ...taste.searches.filter(item => item.toLowerCase() !== normalized.toLowerCase())].slice(0, 12);
    writeTaste(taste);
    renderTasteChips(searchQuery || normalized);
}

function rememberPlay(song) {
    if (!song?.title) return;
    const taste = readTaste();
    const entry = {
        title: song.title,
        artist: song.artist || '',
        channelId: song.channelId || '',
        channelTitle: song.channelTitle || song.artist || '',
        url: song.url || '',
        type: song.type || '',
        img: song.img || '',
        duration: song.duration || null,
        resourceKind: song.resourceKind || '',
        isPlaylist: !!song.isPlaylist,
        at: Date.now()
    };
    taste.plays = rememberUnique(taste.plays, entry, item => item.url || `${item.title}|${item.artist}`);
    writeTaste(taste);
    renderTasteChips(searchQuery);
}

function rememberChannel(channelId, title, details = {}) {
    if (!channelId) return;
    const taste = readTaste();
    const entry = {
        id: String(channelId), title: String(title || 'Canal de YouTube'),
        img: details.img || details.thumbnails?.medium?.url || details.thumbnails?.default?.url || '',
        description: details.description || '',
        at: Date.now()
    };
    taste.channels = rememberUnique(taste.channels, entry, item => item.id);
    writeTaste(taste);
    renderTasteChips(searchQuery);
}

function rememberPlaylist(playlist) {
    if (!playlist?.url) return;
    const taste = readTaste();
    const entry = {
        id: String(playlist.url), title: String(playlist.title || 'Lista de reproducción'),
        artist: String(playlist.artist || playlist.channelTitle || 'YouTube'), img: playlist.img || '',
        description: playlist.description || '', channelId: playlist.channelId || '', itemCount: playlist.itemCount ?? null, at: Date.now()
    };
    taste.playlists = rememberUnique(taste.playlists, entry, item => item.id);
    writeTaste(taste);
}

function getTasteSeed() {
    const taste = readTaste();
    if (!taste.personalization) return '';
    return taste.searches[0] || taste.plays[0]?.artist || taste.channels[0]?.title || taste.plays[0]?.title || '';
}

function getTasteTopics() {
    const taste = readTaste();
    const topics = [{ label: 'Todo', query: '', kind: 'home' }];
    const seen = new Set(['todo']);
    const add = (label, query, personalized = true) => {
        const cleanLabel = String(label || '').trim();
        const cleanQuery = String(query || '').trim();
        const key = cleanQuery.toLocaleLowerCase();
        if (!cleanLabel || !cleanQuery || seen.has(key)) return;
        seen.add(key);
        topics.push({ label: cleanLabel.slice(0, 34), query: cleanQuery.slice(0, 80), personalized });
    };
    if (taste.personalization) {
        taste.searches.forEach(value => add(value, value));
        taste.plays.forEach(item => add(item.artist || item.title, item.artist || item.title));
        taste.channels.forEach(item => add(item.title, item.title));
    }
    [
        ['Música', 'música'],
        ['Álbumes', 'álbum completo'],
        ['Videos en vivo', 'música en vivo'],
        ['Punk argentino', 'punk argentino'],
        ['Rock latino', 'rock latino']
    ].forEach(([label, query]) => add(label, query, false));
    return topics.slice(0, 10);
}

function renderTasteChips(activeQuery = '') {
    const container = document.getElementById('tasteChips');
    if (!container) return;
    const normalizedActive = String(activeQuery || '').trim().toLocaleLowerCase();
    container.innerHTML = '';
    getTasteTopics().forEach(topic => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `taste-chip${(topic.kind === 'home' && !normalizedActive) || topic.query.toLocaleLowerCase() === normalizedActive ? ' active' : ''}`;
        button.innerHTML = `${topic.personalized ? '<i class="fas fa-sparkles"></i>' : ''}${escapeHtml(topic.label)}`;
        button.onclick = () => selectTasteTopic(topic);
        container.appendChild(button);
    });
    setTimeout(initRailDragScroll, 20);
}

function selectTasteTopic(topic) {
    if (topic.kind === 'home') { resetView(); return; }
    searchInput.value = topic.query;
    searchClearBtn.classList.add('show');
    performSmartSearch(topic.query);
}

function renderPersonalizedNote() {}

function setPersonalization(enabled) {
    const taste = readTaste();
    taste.personalization = !!enabled;
    writeTaste(taste);
    homeFeedLoaded = false;
    renderTasteChips();
    renderPersonalizedNote();
    if (activeBrowseMode === 'home') resetView(); else renderTasteData();
    showToast(enabled ? 'Personalización local activada' : 'Personalización local pausada', 'fa-shield-halved');
}

function clearTasteData() {
    localStorage.removeItem(TASTE_STORAGE_KEY);
    homeFeedLoaded = false;
    renderTasteChips();
    renderPersonalizedNote();
    renderTasteData();
    showToast('Se borraron tus datos locales de descubrimiento', 'fa-trash');
}

function renderTasteData() {
    const taste = readTaste();
    navigateWithTransition(() => {
        const container = document.getElementById('dynamicSections');
        currentList = [];
        document.getElementById('loader').style.display = 'none';
        container.innerHTML = `
            <section class="taste-data-panel" aria-label="Datos de descubrimiento">
                <h2>Tus datos de descubrimiento</h2>
                <p>Tu historial, favoritos y personalización se conservan localmente en este dispositivo. En paralelo, las URLs y metadatos descubiertos alimentan una base global compartida; podés auditarla desde el botón de abajo sin borrar tu actividad personal.</p>
                <div class="taste-data-status">
                    <div><strong>${taste.personalization ? 'Personalización local activada' : 'Personalización local pausada'}</strong><span>${taste.personalization ? 'La portada y las categorías pueden usar tus señales guardadas.' : 'Se conserva el historial, pero no se usa ni se agregan nuevas señales.'}</span></div>
                    <button class="taste-action primary" type="button" id="tasteToggle">${taste.personalization ? 'Pausar' : 'Activar'}</button>
                </div>
                <div class="taste-stats">
                    <div class="taste-stat"><b>${taste.searches.length}</b><span>Búsquedas guardadas</span></div>
                    <div class="taste-stat"><b>${taste.plays.length}</b><span>Reproducciones recordadas</span></div>
                    <div class="taste-stat"><b>${taste.channels.length + taste.playlists.length}</b><span>Canales y listas abiertas</span></div>
                </div>
                <div class="taste-actions">
                    <button class="taste-action" type="button" id="knowledgeBaseBtn"><i class="fas fa-database"></i> Base de conocimiento global</button>
                    <button class="taste-action danger" type="button" id="tasteClear"><i class="fas fa-trash"></i> Borrar datos locales</button>
                </div>
            </section>`;
        document.getElementById('tasteToggle').onclick = () => setPersonalization(!taste.personalization);
        document.getElementById('tasteClear').onclick = clearTasteData;
        document.getElementById('knowledgeBaseBtn').onclick = renderKnowledgeBase;
    });
}

