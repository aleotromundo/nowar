// --- RESERVA LOCAL DE CANDIDATOS (IndexedDB + fallback localStorage) ---
const RESERVE_DB_NAME = 'nowarfy_reserve_v1';
const RESERVE_DB_VERSION = 1;
const RESERVE_CANDIDATES_STORE = 'candidates';
const RESERVE_QUERIES_STORE = 'queries';
const RESERVE_META_STORE = 'reserveMeta';
const RESERVE_FALLBACK_KEY = 'nowarfy_discovery_reserve_v1';
const RESERVE_MAX_CANDIDATES = 1000;
const GLOBAL_RESERVE_ENDPOINT = '/api/reserve';
let reserveDbPromise = null;
let globalReserveSyncInFlight = false;
let globalReservePendingEntries = [];

function reserveCandidateKey(song) {
    if (!song?.url) return '';
    if (song.type === 'yt') return `yt:${String(song.url).trim()}`;
    if (song.type === 'mp3') return `${song.source || 'openverse'}:${String(song.sourceUrl || song.url).trim()}`;
    return `${song.type || 'media'}:${String(song.sourceUrl || song.url).trim()}`;
}
function reserveStyleKey(song, seed = null) {
    const explicit = String(song?.genre || '').trim().toLowerCase();
    if (explicit && explicit !== 'unknown') return explicit;
    return typeof getRadioStyle === 'function' ? getRadioStyle(seed || song) : 'rock metal';
}
function normalizeReserveCandidate(song, { context = 'manual', seed = null, queryContext = '' } = {}) {
    if (!song?.url || !['yt', 'mp3', 'freevideo'].includes(song.type)) return null;
    const candidateKey = reserveCandidateKey(song);
    if (!candidateKey) return null;
    const styleKey = reserveStyleKey(song, seed);
    return {
        ...song,
        candidateKey,
        source: song.source || (song.type === 'yt' ? 'youtube' : song.type === 'freevideo' ? 'commons' : 'openverse'),
        sourceId: String(song.sourceId || song.url),
        styleKey,
        radioEligible: (song.type === 'mp3' || song.resourceKind === 'youtube#video') && typeof isRadioMusicTrack === 'function' ? isRadioMusicTrack(song) : false,
        contentGroup: song.type === 'yt' ? (isNonMusicalVideo(song) ? 'non_music_video' : 'music_video') : (song.type === 'freevideo' ? 'free_video' : 'music_audio'),
        context,
        queryContext: String(song.queryContext || queryContext || '').trim(),
        metadata: {
            resourceKind: song.resourceKind || '',
            isPlaylist: Boolean(song.isPlaylist),
            itemCount: song.itemCount ?? null,
            channelId: song.channelId || '',
            channelTitle: song.channelTitle || '',
            publishedAt: song.publishedAt || '',
            viewCount: song.viewCount || '',
            likeCount: song.likeCount || '',
            commentCount: song.commentCount || '',
            definition: song.definition || '',
            captionsAvailable: Boolean(song.captionsAvailable),
            contentGroup: song.type === 'yt' ? (isNonMusicalVideo(song) ? 'non_music_video' : 'music_video') : (song.type === 'freevideo' ? 'free_video' : 'music_audio')
        },
        discoveredAt: Number(song.discoveredAt || Date.now()),
        lastSeenAt: Date.now(),
        lastUsedAt: song.lastUsedAt || null,
        useCount: Number(song.useCount || 0),
        status: song.status || 'available',
        expiresAt: Number(song.expiresAt || (Date.now() + (song.type === 'yt' ? 30 : 14) * 24 * 60 * 60 * 1000))
    };
}
function openReserveDb() {
    if (reserveDbPromise) return reserveDbPromise;
    if (!window.indexedDB) return Promise.resolve(null);
    reserveDbPromise = new Promise(resolve => {
        try {
            const request = indexedDB.open(RESERVE_DB_NAME, RESERVE_DB_VERSION);
            request.onupgradeneeded = event => {
                const db = event.target.result;
                const candidates = db.objectStoreNames.contains(RESERVE_CANDIDATES_STORE)
                    ? event.target.transaction.objectStore(RESERVE_CANDIDATES_STORE)
                    : db.createObjectStore(RESERVE_CANDIDATES_STORE, { keyPath: 'candidateKey' });
                if (!candidates.indexNames.contains('styleKey')) candidates.createIndex('styleKey', 'styleKey', { unique: false });
                if (!candidates.indexNames.contains('radioEligible')) candidates.createIndex('radioEligible', 'radioEligible', { unique: false });
                if (!candidates.indexNames.contains('lastUsedAt')) candidates.createIndex('lastUsedAt', 'lastUsedAt', { unique: false });
                if (!candidates.indexNames.contains('source')) candidates.createIndex('source', 'source', { unique: false });
                if (!candidates.indexNames.contains('status')) candidates.createIndex('status', 'status', { unique: false });
                if (!db.objectStoreNames.contains(RESERVE_QUERIES_STORE)) db.createObjectStore(RESERVE_QUERIES_STORE, { keyPath: 'queryKey' });
                if (!db.objectStoreNames.contains(RESERVE_META_STORE)) db.createObjectStore(RESERVE_META_STORE, { keyPath: 'id' });
            };
            request.onsuccess = event => resolve(event.target.result);
            request.onerror = () => resolve(null);
        } catch (error) { resolve(null); }
    });
    return reserveDbPromise;
}
function readReserveFallback() {
    try {
        const value = JSON.parse(localStorage.getItem(RESERVE_FALLBACK_KEY) || '[]');
        return Array.isArray(value) ? value : [];
    } catch (error) { return []; }
}
async function readLocalReserveCandidates(limit = 120) {
    const localFallback = readReserveFallback();
    const db = await openReserveDb();
    if (!db) return localFallback.slice(0, limit);
    const localItems = await new Promise(resolve => {
        try {
            const request = db.transaction(RESERVE_CANDIDATES_STORE, 'readonly').objectStore(RESERVE_CANDIDATES_STORE).getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => resolve([]);
        } catch (error) { resolve([]); }
    });
    return [...localItems, ...localFallback]
        .filter(item => item?.url && item.status !== 'invalid' && item.status !== 'expired' && (!item.expiresAt || Number(item.expiresAt) > Date.now()))
        .sort((a, b) => Number(a.lastUsedAt || 0) - Number(b.lastUsedAt || 0))
        .slice(0, limit);
}
function writeReserveFallback(items) {
    try {
        localStorage.setItem(RESERVE_FALLBACK_KEY, JSON.stringify(items.slice(-200)));
    } catch (error) {}
}
async function globalReserveRequest(url = GLOBAL_RESERVE_ENDPOINT, options = {}) {
    try {
        const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
        const data = await response.json().catch(() => ({}));
        return response.ok ? data : null;
    } catch (error) { return null; }
}
function flushReserveGlobal() {
    if (globalReserveSyncInFlight || !globalReservePendingEntries.length) return;
    const batch = globalReservePendingEntries.splice(0, 100);
    globalReserveSyncInFlight = true;
    void globalReserveRequest(GLOBAL_RESERVE_ENDPOINT, {
        method: 'POST',
        body: JSON.stringify({ action: 'upsert', entries: batch, discoveredBy: nowarfyAuthUser?.id || nowarfyAnonymousId })
    }).finally(() => {
        globalReserveSyncInFlight = false;
        flushReserveGlobal();
    });
}
function reserveSyncGlobal(entries) {
    if (!Array.isArray(entries) || !entries.length) return;
    const merged = new Map(globalReservePendingEntries.map(item => [item.candidateKey, item]));
    entries.forEach(entry => merged.set(entry.candidateKey, { ...merged.get(entry.candidateKey), ...entry }));
    globalReservePendingEntries = [...merged.values()];
    flushReserveGlobal();
}
function reserveQueryKey(source, query, styleKey = '', resourceTypes = '', channelId = '') {
    return [source, resourceTypes || 'all', channelId || 'all', styleKey || 'rock metal', query].map(value => String(value || '').trim().toLowerCase()).join(':').slice(0, 512);
}
async function reserveGetQueryState({ source = 'youtube', query = '', styleKey = '', queryKey = '' } = {}) {
    const params = new URLSearchParams({ action: 'query', source, query, styleKey });
    if (queryKey) params.set('queryKey', queryKey);
    const data = await globalReserveRequest(`${GLOBAL_RESERVE_ENDPOINT}?${params.toString()}`);
    return data?.query || null;
}
function reserveSaveQueryState(payload) {
    if (!payload?.source || !payload?.query) return;
    void globalReserveRequest(GLOBAL_RESERVE_ENDPOINT, {
        method: 'POST',
        body: JSON.stringify({ action: 'query-upsert', ...payload, discoveredBy: nowarfyAuthUser?.id || nowarfyAnonymousId })
    });
}
async function reserveGetGlobalCandidates({ styleKey = '', artist = '', source = '', query = '', scope = 'radio', kind = '', limit = 20, offset = 0, discoveredBy = '' } = {}) {
    const params = new URLSearchParams({ action: 'search', styleKey, artist, source, query, scope, kind, limit: String(Math.min(Math.max(Number(limit) || 20, 1), 50)) });
    if (Number(offset) > 0) params.set('offset', String(Math.max(0, Number(offset) || 0)));
    if (discoveredBy) params.set('discoveredBy', String(discoveredBy));
    const data = await globalReserveRequest(`${GLOBAL_RESERVE_ENDPOINT}?${params.toString()}`);
    const results = Array.isArray(data?.results) ? data.results : [];
    results.total = Number.isFinite(Number(data?.total)) ? Number(data.total) : null;
    return results;
}
async function reserveDiscoveredCandidates(songs, options = {}) {
    const entries = (songs || []).map(song => normalizeReserveCandidate(song, options)).filter(Boolean);
    if (!entries.length) return;
    reserveSyncGlobal(entries);
    const db = await openReserveDb();
    if (!db) {
        const merged = new Map(readReserveFallback().map(item => [item.candidateKey, item]));
        entries.forEach(entry => merged.set(entry.candidateKey, { ...merged.get(entry.candidateKey), ...entry }));
        writeReserveFallback([...merged.values()].slice(-200));
        return;
    }
    await new Promise(resolve => {
        try {
            const transaction = db.transaction(RESERVE_CANDIDATES_STORE, 'readwrite');
            const store = transaction.objectStore(RESERVE_CANDIDATES_STORE);
            entries.forEach(entry => {
                const getRequest = store.get(entry.candidateKey);
                getRequest.onsuccess = () => {
                    const previous = getRequest.result || {};
                    store.put({
                        ...previous,
                        ...entry,
                        radioEligible: Boolean(previous.radioEligible || entry.radioEligible),
                        discoveredAt: previous.discoveredAt || entry.discoveredAt,
                        useCount: Number(previous.useCount || entry.useCount || 0),
                        lastUsedAt: previous.lastUsedAt || entry.lastUsedAt || null
                    });
                };
            });
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => resolve();
            transaction.onabort = () => resolve();
        } catch (error) { resolve(); }
    });
    void reserveTrim();
}
async function reserveGetLocalCandidates({ kind = '' } = {}) {
    const db = await openReserveDb();
    let items = [];
    if (db) {
        items = await new Promise(resolve => {
            try {
                const request = db.transaction(RESERVE_CANDIDATES_STORE, 'readonly').objectStore(RESERVE_CANDIDATES_STORE).getAll();
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => resolve([]);
            } catch (error) { resolve([]); }
        });
    }
    items = [...items, ...readReserveFallback()];
    items = [...new Map(items.map(item => [item.candidateKey || reserveCandidateKey(item), item])).values()];
    return items.filter(item => {
        if (item.status === 'invalid' || item.status === 'expired') return false;
        if (!kind) return true;
        if (kind === 'playlist') return item.resourceKind === 'youtube#playlist' || item.type === 'playlist' || item.isPlaylist;
        if (kind === 'channel') return item.resourceKind === 'youtube#channel';
        if (kind === 'video') return item.resourceKind === 'youtube#video';
        return item.type === kind;
    });
}
async function reserveGetCandidates({ styleKey = '', artist = '', source = '', limit = 20 } = {}) {
    const db = await openReserveDb();
    let items = await reserveGetGlobalCandidates({ styleKey, artist, source, limit });
    if (db) {
        const localItems = await new Promise(resolve => {
            try {
                const request = db.transaction(RESERVE_CANDIDATES_STORE, 'readonly').objectStore(RESERVE_CANDIDATES_STORE).getAll();
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => resolve([]);
            } catch (error) { resolve([]); }
        });
        items = [...items, ...localItems];
    }
    items = [...items, ...readReserveFallback()];
    items = [...new Map(items.map(item => [item.candidateKey || reserveCandidateKey(item), item])).values()];
    const style = String(styleKey || '').toLowerCase();
    const targetArtist = String(artist || '').toLowerCase();
    return items
        .filter(item => item.radioEligible && item.status !== 'invalid' && item.status !== 'expired')
        .filter(item => !source || item.source === source)
        .filter(item => !style || String(item.styleKey || '').toLowerCase() === style || String(item.styleKey || '').toLowerCase().includes(style))
        .filter(item => !targetArtist || String(item.artist || '').toLowerCase().includes(targetArtist))
        .filter(item => !item.expiresAt || Number(item.expiresAt) > Date.now())
        .sort((a, b) => Number(a.lastUsedAt || 0) - Number(b.lastUsedAt || 0) || Number(b.lastSeenAt || 0) - Number(a.lastSeenAt || 0))
        .slice(0, limit);
}
const ARTIST_STYLE_HINTS = {
    'mana': 'latin rock',
    'maná': 'latin rock',
    'soda stereo': 'latin rock',
    'caifanes': 'latin rock',
    'heroes del silencio': 'latin rock',
    'héroes del silencio': 'latin rock',
    'los enanitos verdes': 'latin rock',
    'enanitos verdes': 'latin rock',
    'los fabulosos cadillacs': 'latin rock',
    'la renga': 'latin rock',
    'rata blanca': 'latin metal',
    'metallica': 'heavy metal',
    'iron maiden': 'heavy metal',
    'black sabbath': 'heavy metal',
    'slipknot': 'nu metal',
    'linkin park': 'nu metal',
    'nirvana': 'grunge',
    'foo fighters': 'alternative rock'
};
function inferArtistStyle(query, candidates = []) {
    const normalized = String(query || '').trim().toLowerCase();
    const known = Object.entries(ARTIST_STYLE_HINTS).find(([artist]) => normalized.includes(artist));
    if (known) return known[1];
    const fromCandidate = candidates.find(candidate => candidate?.genre && candidate.genre !== 'unknown')?.genre;
    if (fromCandidate) return String(fromCandidate).toLowerCase();
    const text = candidates.map(candidate => `${candidate.title || ''} ${candidate.artist || ''} ${candidate.description || ''}`).join(' ').toLowerCase();
    return ['latin rock', 'alternative rock', 'grunge', 'punk rock', 'hard rock', 'heavy metal', 'metal'].find(style => text.includes(style)) || 'rock';
}
async function reserveSearchCandidates(query, { styleKey = '', limit = 20, kind = '', offset = 0, discoveredBy = '' } = {}) {
    const db = await openReserveDb();
    let items = await reserveGetGlobalCandidates({ styleKey, query, scope: 'search', kind, limit, offset, discoveredBy });
    if (db) {
        const localItems = await new Promise(resolve => {
            try {
                const request = db.transaction(RESERVE_CANDIDATES_STORE, 'readonly').objectStore(RESERVE_CANDIDATES_STORE).getAll();
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => resolve([]);
            } catch (error) { resolve([]); }
        });
        items = [...items, ...localItems];
    }
    items = [...items, ...readReserveFallback()];
    items = [...new Map(items.map(item => [item.candidateKey || reserveCandidateKey(item), item])).values()];
    const needle = String(query || '').toLowerCase().trim();
    const style = String(styleKey || '').toLowerCase().trim();
    return items.filter(item => {
        if (item.status === 'invalid' || item.status === 'expired') return false;
        if (item.expiresAt && Number(item.expiresAt) <= Date.now()) return false;
        const text = `${item.title || ''} ${item.artist || ''} ${item.description || ''}`.toLowerCase();
        const matchesQuery = !needle || text.includes(needle);
        const matchesStyle = !style || String(item.styleKey || '').toLowerCase().includes(style);
        return matchesQuery && matchesStyle;
    }).sort((a, b) => Number(a.lastUsedAt || 0) - Number(b.lastUsedAt || 0)).slice(0, limit);
}

async function reserveMarkUsed(song) {
    const key = reserveCandidateKey(song);
    if (!key) return;
    const db = await openReserveDb();
    if (!db) return;
    try {
        const transaction = db.transaction(RESERVE_CANDIDATES_STORE, 'readwrite');
        const store = transaction.objectStore(RESERVE_CANDIDATES_STORE);
        const request = store.get(key);
        request.onsuccess = () => {
            if (request.result) store.put({ ...request.result, status: 'played', lastUsedAt: Date.now(), useCount: Number(request.result.useCount || 0) + 1 });
        };
    } catch (error) {}
    void globalReserveRequest(GLOBAL_RESERVE_ENDPOINT, {
        method: 'POST',
        body: JSON.stringify({ action: 'mark-used', candidateKey: key })
    });
}
async function reserveTrim() {
    const db = await openReserveDb();
    if (!db) return;
    try {
        const transaction = db.transaction(RESERVE_CANDIDATES_STORE, 'readwrite');
        const store = transaction.objectStore(RESERVE_CANDIDATES_STORE);
        const request = store.getAll();
        request.onsuccess = () => {
            const items = request.result || [];
            const expired = items.filter(item => item.status === 'invalid' || (item.expiresAt && Number(item.expiresAt) < Date.now()));
            expired.forEach(item => store.delete(item.candidateKey));
            if (items.length > RESERVE_MAX_CANDIDATES) {
                items.sort((a, b) => Number(a.lastUsedAt || 0) - Number(b.lastUsedAt || 0));
                items.slice(0, items.length - RESERVE_MAX_CANDIDATES).forEach(item => store.delete(item.candidateKey));
            }
        };
    } catch (error) {}
}

