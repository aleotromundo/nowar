const KNOWLEDGE_SOURCE_LABELS = { youtube: 'YouTube', openverse: 'Openverse', commons: 'Commons', jamendo: 'Jamendo' };
const KNOWLEDGE_HEALTH_LABELS = { unverified: 'Sin verificar', healthy: 'Saludable', suspect: 'Sospechoso', invalid: 'Inválido' };
const KNOWLEDGE_KIND_LABELS = { 'youtube#video': 'Video', 'youtube#playlist': 'Lista', 'youtube#channel': 'Canal', 'commons#video': 'Video libre' };

function knowledgeSourceLabel(source) {
    return KNOWLEDGE_SOURCE_LABELS[String(source || '').toLowerCase()] || 'Otra fuente';
}
function knowledgeHealthLabel(status) {
    return KNOWLEDGE_HEALTH_LABELS[String(status || 'unverified').toLowerCase()] || 'Sin verificar';
}
function knowledgeKindLabel(item) {
    return KNOWLEDGE_KIND_LABELS[item?.resourceKind] || (item?.type === 'mp3' ? 'Audio' : item?.type === 'freevideo' ? 'Video libre' : 'Recurso');
}
function knowledgeCandidateAction(item) {
    if (!item) return;
    if (item.resourceKind === 'youtube#channel') {
        browseChannel(item.sourceId || item.channelId || item.url, item.title || item.artist || 'Canal de YouTube');
    } else if (item.resourceKind === 'youtube#playlist' || item.isPlaylist) {
        void openPlaylist(item);
    } else {
        selectSong(item);
    }
}
function knowledgeCandidateCard(item, index) {
    const source = String(item?.source || 'unknown').toLowerCase();
    const health = String(item?.healthStatus || 'unverified').toLowerCase();
    const image = escapeHtml(item?.img || 'assets/nowarfy-icon-512.png');
    const title = escapeHtml(item?.title || 'Sin título');
    const artist = escapeHtml(item?.artist || 'Artista no informado');
    const key = escapeHtml(item?.candidateKey || 'sin-clave');
    const sourceLabel = escapeHtml(knowledgeSourceLabel(source));
    const healthLabel = escapeHtml(knowledgeHealthLabel(health));
    const kindLabel = escapeHtml(knowledgeKindLabel(item));
    const favorite = isFavoriteSong(item);
    return `<article class="knowledge-candidate-card" data-knowledge-index="${index}" tabindex="0" aria-label="${title} · ${artist}">
        <div class="knowledge-candidate-art"><img src="${image}" alt="" loading="lazy" data-knowledge-image><div class="knowledge-candidate-badges"><span class="knowledge-candidate-badge source-${escapeHtml(source)}">${sourceLabel}</span><span class="knowledge-candidate-badge health-${escapeHtml(health)}">${healthLabel}</span></div></div>
        <button type="button" class="knowledge-candidate-fav${favorite ? ' active' : ''}" data-knowledge-favorite="${index}" aria-label="${favorite ? 'Quitar de favoritos' : 'Guardar en favoritos'}" title="${favorite ? 'Quitar de favoritos' : 'Guardar en favoritos'}"><i class="${favorite ? 'fas' : 'far'} fa-heart"></i></button>
        <div class="knowledge-candidate-body"><strong class="knowledge-candidate-title">${title}</strong><span class="knowledge-candidate-artist">${artist}</span><div class="knowledge-candidate-meta"><span>${kindLabel}</span>${item?.duration ? `<span>${format(item.duration)}</span>` : ''}${item?.useCount ? `<span>${Number(item.useCount)} usos</span>` : ''}</div><div class="knowledge-candidate-key">${key}</div></div>
    </article>`;
}
function renderKnowledgeCatalog() {
    const state = knowledgeBaseState;
    const grid = document.getElementById('knowledgeCatalogGrid');
    const status = document.getElementById('knowledgePanelStatus');
    const more = document.getElementById('knowledgeMoreWrap');
    if (!state || !grid || !status || !more) return;
    const totalLabel = Number.isFinite(state.total) ? ` de ${formatCompactNumber(state.total)}` : '';
    const scopeLabel = state.filters.mine ? ' · Solo tus descubrimientos' : ' · Catálogo global';
    status.innerHTML = state.loading
        ? `<span>Mostrando <strong>${state.items.length}</strong>${totalLabel}${escapeHtml(scopeLabel)}</span><span><i class="fas fa-spinner fa-spin"></i> Cargando...</span>`
        : `<span>Mostrando <strong>${state.items.length}</strong>${totalLabel}${escapeHtml(scopeLabel)}</span><span>${state.done ? 'Catálogo completo para estos filtros' : 'Desplazate para cargar más'}</span>`;
    grid.innerHTML = state.items.length ? state.items.map(knowledgeCandidateCard).join('') : (state.loading ? '' : '<div class="knowledge-panel-empty">No hay candidatos que coincidan con estos filtros.</div>');
    more.innerHTML = state.done ? '' : '<button type="button" class="catalog-more" id="knowledgeMoreButton"><i class="fas fa-plus"></i> Cargar más candidatos</button>';
    document.querySelectorAll('#knowledgeCatalogGrid .knowledge-candidate-card').forEach(card => {
        const index = Number(card.dataset.knowledgeIndex);
        const item = state.items[index];
        card.addEventListener('click', event => { if (!event.target.closest('[data-knowledge-favorite]')) knowledgeCandidateAction(item); });
        card.addEventListener('keydown', event => { if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('[data-knowledge-favorite]')) { event.preventDefault(); knowledgeCandidateAction(item); } });
        const favoriteButton = card.querySelector('[data-knowledge-favorite]');
        favoriteButton?.addEventListener('click', event => { event.stopPropagation(); toggleFavoriteSong(item, favoriteButton); });
        card.querySelector('[data-knowledge-image]')?.addEventListener('error', event => { event.currentTarget.src = 'assets/nowarfy-icon-512.png'; event.currentTarget.removeAttribute('data-knowledge-image'); });
    });
    const moreButton = document.getElementById('knowledgeMoreButton');
    moreButton?.addEventListener('click', () => void loadKnowledgeBasePage());
    if ('IntersectionObserver' in window && moreButton) {
        knowledgeMoreObserver?.disconnect();
        knowledgeMoreObserver = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) void loadKnowledgeBasePage();
        }, { rootMargin: '500px 0px' });
        knowledgeMoreObserver.observe(moreButton);
    }
}
async function loadKnowledgeBasePage({ reset = false } = {}) {
    const state = knowledgeBaseState;
    if (!state || state.loading || (state.done && !reset)) return;
    if (reset) { state.offset = 0; state.items = []; state.done = false; state.total = null; state.requestId += 1; }
    const requestId = state.requestId;
    state.loading = true;
    renderKnowledgeCatalog();
    try {
        const params = new URLSearchParams({ action: 'search', scope: 'search', includeAll: 'true', limit: String(state.limit), offset: String(state.offset) });
        if (state.filters.artist) params.set('artist', state.filters.artist);
        if (state.filters.source) params.set('source', state.filters.source);
        if (state.filters.health) params.set('healthStatus', state.filters.health);
        if (state.filters.kind) params.set('kind', state.filters.kind);
        if (state.filters.mine && nowarfyAuthUser?.id) params.set('discoveredBy', nowarfyAuthUser.id);
        const data = await globalReserveRequest(`${GLOBAL_RESERVE_ENDPOINT}?${params.toString()}`);
        if (requestId !== state.requestId || !data) return;
        const next = Array.isArray(data.results) ? data.results : [];
        const seen = new Set(state.items.map(item => item.candidateKey || reserveCandidateKey(item)));
        next.forEach(item => { const key = item.candidateKey || reserveCandidateKey(item); if (key && !seen.has(key)) { seen.add(key); state.items.push(item); } });
        state.offset += next.length;
        state.total = Number.isFinite(Number(data.total)) ? Number(data.total) : state.total;
        state.done = next.length < state.limit || (Number.isFinite(state.total) && state.offset >= state.total);
    } catch (error) {
        if (requestId === state.requestId) { state.done = true; showToast('No se pudo cargar la reserva global', 'fa-triangle-exclamation'); }
    } finally {
        if (requestId === state.requestId) { state.loading = false; renderKnowledgeCatalog(); }
    }
}
function setupKnowledgeBaseFilters() {
    const artistInput = document.getElementById('knowledgeArtistFilter');
    const sourceSelect = document.getElementById('knowledgeSourceFilter');
    const healthSelect = document.getElementById('knowledgeHealthFilter');
    const kindSelect = document.getElementById('knowledgeKindFilter');
    const mineToggle = document.getElementById('knowledgeMineToggle');
    const apply = () => {
        const mine = Boolean(mineToggle?.checked && nowarfyAuthUser?.id);
        globalCatalogMineOnly = mine;
        knowledgeBaseState.filters = { artist: artistInput?.value.trim() || '', source: sourceSelect?.value || '', health: healthSelect?.value || '', kind: kindSelect?.value || '', mine };
        clearTimeout(knowledgeBaseSearchTimer);
        knowledgeBaseSearchTimer = setTimeout(() => void loadKnowledgeBasePage({ reset: true }), 250);
    };
    artistInput?.addEventListener('input', apply);
    sourceSelect?.addEventListener('change', apply);
    healthSelect?.addEventListener('change', apply);
    kindSelect?.addEventListener('change', apply);
    mineToggle?.addEventListener('change', apply);
    document.getElementById('knowledgeRefresh')?.addEventListener('click', () => void loadKnowledgeBasePage({ reset: true }));
}
async function renderKnowledgeBase() {
    minimizeActiveVideoForNavigation();
    const container = document.getElementById('dynamicSections');
    const loader = document.getElementById('loader');
    container.innerHTML = '';
    loader.style.display = 'flex';
    try {
        const data = await globalReserveRequest(`${GLOBAL_RESERVE_ENDPOINT}?action=stats`);
        if (!data) throw new Error('stats_unavailable');
        const counts = data.sourceCounts || {};
        const kinds = data.kindCounts || {};
        const mineToggle = nowarfyAuthUser
            ? `<label class="knowledge-scope-toggle"><input type="checkbox" id="knowledgeMineToggle" ${globalCatalogMineOnly ? 'checked' : ''}> <span>Solo mis descubrimientos</span></label>`
            : '';
        const scopeNote = nowarfyAuthUser
            ? 'La vista global está activa. El interruptor filtra únicamente los recursos atribuidos a tu cuenta registrada.'
            : 'Modo anónimo: se muestra el total global recuperado por todas las sesiones. Para filtrar tus propios descubrimientos, iniciá sesión.';
        container.innerHTML = `
            <section class="taste-data-panel knowledge-panel" aria-label="Base de conocimiento global">
                <div class="section-header-back"><button type="button" class="video-stage-close" onclick="renderTasteData()"><i class="fas fa-arrow-left"></i> Volver a Tus datos</button></div>
                <h2>Base de conocimiento de Nowarfy</h2>
                <p>Catálogo colectivo de URLs y metadatos descubiertos por todos los usuarios. Esta vista muestra la base completa; tus gustos solo cambian el orden y los filtros de las secciones personalizadas.</p>
                <div class="taste-stats knowledge-summary">
                    <div class="taste-stat"><b>${formatCompactNumber(data.totalCandidates)}</b><span>Total de recursos globales</span></div>
                    <div class="taste-stat"><b>${formatCompactNumber(kinds.videos || 0)}</b><span>Videos YouTube</span></div>
                    <div class="taste-stat"><b>${formatCompactNumber(kinds.playlists || 0)}</b><span>Listas de reproducción</span></div>
                    <div class="taste-stat"><b>${formatCompactNumber(kinds.channels || 0)}</b><span>Canales</span></div>
                    <div class="taste-stat"><b>${formatCompactNumber(kinds.audio || 0)}</b><span>Audio libre y fuentes directas</span></div>
                </div>
                <div class="knowledge-toolbar" aria-label="Filtros de la base global">
                    <input class="knowledge-filter" id="knowledgeArtistFilter" type="search" placeholder="Filtrar por artista o canal…" autocomplete="off">
                    <select class="knowledge-filter" id="knowledgeSourceFilter" aria-label="Filtrar por fuente"><option value="">Todas las fuentes</option><option value="youtube">YouTube</option><option value="openverse">Openverse</option><option value="commons">Commons</option><option value="jamendo">Jamendo</option></select>
                    <select class="knowledge-filter" id="knowledgeKindFilter" aria-label="Filtrar por tipo"><option value="">Todos los tipos</option><option value="video">Videos</option><option value="playlist">Listas de reproducción</option><option value="channel">Canales</option><option value="audio">Audio directo</option><option value="freevideo">Videos libres</option></select>
                    <select class="knowledge-filter" id="knowledgeHealthFilter" aria-label="Filtrar por salud"><option value="">Todos los estados</option><option value="unverified">Sin verificar</option><option value="healthy">Saludable</option><option value="suspect">Sospechoso</option><option value="invalid">Inválido</option></select>
                    ${mineToggle}
                    <button type="button" class="taste-action" id="knowledgeRefresh"><i class="fas fa-rotate"></i> Actualizar</button>
                </div>
                <p class="knowledge-scope-note">${scopeNote}</p>
                <div class="knowledge-panel-status" id="knowledgePanelStatus"></div>
                <div class="knowledge-catalog-grid" id="knowledgeCatalogGrid"></div>
                <div class="catalog-more-wrap" id="knowledgeMoreWrap"></div>
                <div class="taste-actions"><a href="${GLOBAL_RESERVE_ENDPOINT}?action=export" class="taste-action primary" target="_blank" rel="noopener noreferrer"><i class="fas fa-download"></i> Exportar CSV completo</a></div>
            </section>`;
        knowledgeBaseState = { offset: 0, limit: 24, loading: false, done: false, total: null, items: [], filters: { artist: '', source: '', health: '', kind: '', mine: Boolean(globalCatalogMineOnly && nowarfyAuthUser?.id) }, requestId: 0 };
        setupKnowledgeBaseFilters();
        await loadKnowledgeBasePage();
    } catch (error) {
        renderEmptyState('No pudimos cargar la base global', 'La reserva global puede estar temporalmente fuera de servicio.');
    } finally {
        loader.style.display = 'none';
    }
}
function deriveChannels(videos) {
    const seen = new Set();
    return videos.filter(video => {
        if (!video.channelId || seen.has(video.channelId)) return false;
        seen.add(video.channelId);
        return true;
    }).map(video => ({ title: video.channelTitle || video.artist, artist: 'Canal de YouTube', img: video.img, url: video.channelId, type: 'yt', resourceKind: 'youtube#channel', isPlaylist: false, channelId: video.channelId, channelTitle: video.channelTitle || video.artist }));
}

function showToast(msg, icon) {
    icon = icon || 'fa-circle-check';
    const container = document.getElementById('toastContainer');
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<i class="fas ${icon}"></i><span>${escapeHtml(msg)}</span>`;
    container.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
        t.classList.remove('show');
        setTimeout(() => t.remove(), 300);
    }, 3200);
}

function handleSearchInput() {
    clearTimeout(searchTimeout);
    searchClearBtn.classList.toggle('show', searchInput.value.trim().length > 0);
}
function handleSearchKeydown(event) {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    const query = searchInput.value.trim();
    if (!query) { resetView(); return; }
    channelFilter = null;
    performSmartSearch(query);
}
function handleSearchDebounced() { handleSearchInput(); }

function clearSearch() {
    searchInput.value = '';
    searchClearBtn.classList.remove('show');
    channelFilter = null;
    resetView();
    searchInput.focus();
}

function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function parseYouTubeDuration(value) {
    if (!value) return null;
    const match = String(value).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return null;
    return (Number(match[1] || 0) * 3600) + (Number(match[2] || 0) * 60) + Number(match[3] || 0);
}

function formatContentDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '—';
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return hours ? `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}` : `${mins}:${String(secs).padStart(2, '0')}`;
}

function mapYouTubeItems(items) {
    return items
        .filter(item => item.id && (item.id.kind === 'youtube#video' || item.id.kind === 'youtube#playlist' || item.id.kind === 'youtube#channel'))
        .map(item => {
            const isChannel = item.id.kind === 'youtube#channel';
            const thumb = item.snippet.thumbnails && (item.snippet.thumbnails.medium || item.snippet.thumbnails.default || item.snippet.thumbnails.high);
            return {
                title: normalizeSourceText(item.snippet.title),
                artist: normalizeSourceText(isChannel ? 'Canal de YouTube' : item.snippet.channelTitle),
                description: normalizeSourceText(item.snippet.description),
                img: thumb ? thumb.url : '',
                url: item.id.videoId || item.id.playlistId || item.id.channelId,
                type: 'yt',
                resourceKind: item.id.kind,
                isPlaylist: item.id.kind === 'youtube#playlist',
                itemCount: item.contentDetails?.itemCount ?? null,
                duration: parseYouTubeDuration(item.contentDetails && item.contentDetails.duration),
                publishedAt: item.videoSnippet?.publishedAt || item.snippet.publishedAt || '',
                viewCount: item.statistics?.viewCount || '',
                likeCount: item.statistics?.likeCount || '',
                commentCount: item.statistics?.commentCount || '',
                definition: item.contentDetails?.definition || '',
                captionsAvailable: item.contentDetails?.caption === 'true',
                liveBroadcastContent: item.videoSnippet?.liveBroadcastContent || item.snippet.liveBroadcastContent || 'none',
                categoryId: item.videoSnippet?.categoryId || '',
                tags: Array.isArray(item.videoSnippet?.tags) ? item.videoSnippet.tags : [],
                channelId: item.snippet.channelId,
                channelTitle: item.snippet.channelTitle
            };
        });
}

function formatCompactNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return new Intl.NumberFormat('es-UY', { notation: 'compact', maximumFractionDigits: 1 }).format(number);
}

function mapPlaylistApiItems(items, fallback = {}) {
    return (items || []).map((item, index) => {
        const thumb = item.snippet?.thumbnails?.medium || item.snippet?.thumbnails?.high || item.snippet?.thumbnails?.default;
        return {
            title: normalizeSourceText(item.snippet?.title || 'Lista sin título'),
            artist: normalizeSourceText(item.snippet?.channelTitle || fallback.channelTitle || 'Lista de YouTube'),
            description: normalizeSourceText(item.snippet?.description),
            img: thumb?.url || fallback.img || '',
            url: item.id,
            type: 'yt',
            resourceKind: 'youtube#playlist',
            isPlaylist: true,
            itemCount: item.contentDetails?.itemCount,
            sourceIndex: index,
            channelId: item.snippet?.channelId || fallback.channelId || '',
            channelTitle: item.snippet?.channelTitle || fallback.channelTitle || ''
        };
    }).filter(item => item.url);
}

function mapPlaylistVideoItems(items, fallback = {}, offset = 0) {
    return (items || []).map((item, index) => {
        const thumb = item.snippet?.thumbnails?.medium || item.snippet?.thumbnails?.high || item.snippet?.thumbnails?.default;
        return {
            title: normalizeSourceText(item.snippet?.title || 'Video sin título'),
            artist: normalizeSourceText(item.snippet?.channelTitle || fallback.channelTitle || 'YouTube'),
            description: normalizeSourceText(item.snippet?.description),
            img: thumb?.url || fallback.img || '',
            url: item.contentDetails?.videoId,
            type: 'yt',
            resourceKind: 'youtube#video',
            isPlaylist: false,
            sourceIndex: offset + index,
            duration: parseYouTubeDuration(item.contentDetails?.duration),
            channelId: item.snippet?.channelId || fallback.channelId || '',
            channelTitle: item.snippet?.channelTitle || fallback.channelTitle || '',
            collectionId: fallback.collectionId || '',
            collectionTitle: fallback.collectionTitle || '',
            collectionImg: fallback.collectionImg || ''
        };
    }).filter(item => item.url);
}

function addCatalogMore(container, label, handler) {
    const wrap = document.createElement('div');
    wrap.className = 'catalog-more-wrap';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'catalog-more';
    button.innerHTML = `<i class="fas fa-plus"></i> ${escapeHtml(label)}`;
    button.onclick = async () => {
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cargando...';
        try { await handler(); }
        finally { if (button.isConnected) { button.disabled = false; button.innerHTML = `<i class="fas fa-plus"></i> ${escapeHtml(label)}`; } }
    };
    wrap.appendChild(button);
    container.appendChild(wrap);
}

function renderChannelCatalog() {
    const state = activeChannelCatalog;
    if (!state?.channel) return;
    navigateWithTransition(() => {
        const container = document.getElementById('dynamicSections');
        const channel = state.channel;
        const thumb = channel.snippet?.thumbnails?.medium || channel.snippet?.thumbnails?.high || channel.snippet?.thumbnails?.default;
        const channelTitle = channel.snippet?.title || state.title || 'Canal de YouTube';
        const customUrl = channel.snippet?.customUrl || '';
        const description = String(channel.snippet?.description || '').trim();
        const uploadsTotal = state.uploads?.pageInfo?.totalResults ?? channel.statistics?.videoCount;
        container.innerHTML = `
            <section class="channel-profile" aria-label="Perfil del canal ${escapeHtml(channelTitle)}">
                <img class="channel-profile-avatar" src="${escapeHtml(thumb?.url || '')}" alt="" onerror="this.style.visibility='hidden'">
                <div class="channel-profile-content">
                    <p class="channel-profile-kicker"><i class="fab fa-youtube"></i> Canal público de YouTube</p>
                    <h2>${escapeHtml(channelTitle)}</h2>
                    ${customUrl ? `<p class="channel-profile-handle">${escapeHtml(customUrl)}</p>` : ''}
                    ${description ? `<p class="channel-profile-description">${escapeHtml(description.slice(0, 420))}${description.length > 420 ? '…' : ''}</p>` : ''}
                    <div class="channel-profile-stats"><span><b>${formatCompactNumber(channel.statistics?.subscriberCount)}</b> suscriptores</span><span><b>${formatCompactNumber(channel.statistics?.viewCount)}</b> visualizaciones</span><span><b>${formatCompactNumber(uploadsTotal)}</b> videos públicos</span></div>
                    <div class="channel-profile-actions"><button type="button" class="channel-profile-action" id="channelProfileBack"><i class="fas fa-arrow-left"></i> Inicio</button><a class="channel-profile-action" href="https://www.youtube.com/channel/${encodeURIComponent(channel.id)}" target="_blank" rel="noopener noreferrer"><i class="fas fa-arrow-up-right-from-square"></i> Ver en YouTube</a></div>
                </div>
            </section>`;
        document.getElementById('channelProfileBack').onclick = resetView;

        const playlists = state.playlists?.items || [];
        const uploads = state.uploads?.items || [];
        currentList = uploads;
        if (playlists.length) renderPlaylistGrid(playlists, `Listas y álbumes · ${state.playlists?.pageInfo?.totalResults ?? playlists.length}`);
        if (state.playlists?.nextPageToken) addCatalogMore(container, 'Cargar más listas', () => loadMoreChannelPlaylists(state.playlists.nextPageToken));
        if (uploads.length) {
            renderGrid(uploads, `Videos del canal · ${uploadsTotal || uploads.length}`, "<i class='fas fa-clapperboard'></i>");
        } else {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.innerHTML = '<i class="fas fa-video-slash"></i><strong>Este canal no tiene videos públicos reproducibles disponibles</strong><span>Puede tener restricciones de privacidad, región o reproducción embebida.</span>';
            container.appendChild(empty);
        }
        if (state.uploads?.nextPageToken) addCatalogMore(container, 'Cargar más videos', () => loadMoreChannelUploads(state.uploads.nextPageToken));
    });
}

async function loadChannelProfile(channelReference, channelTitle = '') {
    minimizeActiveVideoForNavigation();
    const loader = document.getElementById('loader');
    const container = document.getElementById('dynamicSections');
    activeBrowseMode = 'channel';
    channelFilter = null;
    loader.style.display = 'flex';
    container.innerHTML = '';
    try {
        const response = await fetch(`/api/search?type=youtube&action=channelOverview&channelRef=${encodeURIComponent(channelReference)}&maxResults=24`);
        const data = await response.json();
        if (!response.ok || !data?.channel) throw new Error(data?.error?.message || 'channel_unavailable');
        const fallback = { channelId: data.channel.id, channelTitle: data.channel.snippet?.title || channelTitle, img: data.channel.snippet?.thumbnails?.medium?.url || '' };
        activeChannelCatalog = {
            channel: data.channel,
            title: channelTitle,
            uploadsPlaylistId: data.channel.contentDetails?.relatedPlaylists?.uploads || '',
            playlists: { ...data.playlists, items: mapPlaylistApiItems(data.playlists?.items, fallback) },
            uploads: { ...data.uploads, items: mapPlaylistVideoItems(data.uploads?.items, fallback) }
        };
        void reserveDiscoveredCandidates(activeChannelCatalog.playlists.items, { context: 'channel', queryContext: `channel:${data.channel.id}:playlists` });
        void reserveDiscoveredCandidates(activeChannelCatalog.uploads.items, { context: 'channel', queryContext: `channel:${data.channel.id}:uploads` });
        searchInput.value = data.channel.snippet?.title || channelTitle;
        searchClearBtn.classList.add('show');
        rememberChannel(data.channel.id, data.channel.snippet?.title || channelTitle, {
            img: data.channel.snippet?.thumbnails?.medium?.url || data.channel.snippet?.thumbnails?.default?.url || '',
            description: data.channel.snippet?.description || ''
        });
        renderChannelCatalog();
    } catch (error) {
        renderEmptyState('No pudimos abrir este canal', 'El enlace puede no corresponder a un canal público, o YouTube puede estar temporalmente no disponible.');
    } finally {
        loader.style.display = 'none';
    }
}

async function loadMoreChannelPlaylists(pageToken) {
    const state = activeChannelCatalog;
    if (!state?.channel?.id || !pageToken) return;
    const response = await fetch(`/api/search?type=youtube&action=channelPlaylists&channelId=${encodeURIComponent(state.channel.id)}&pageToken=${encodeURIComponent(pageToken)}&maxResults=24`);
    const data = await response.json();
    if (!response.ok) throw new Error('more_playlists_unavailable');
    const fallback = { channelId: state.channel.id, channelTitle: state.channel.snippet?.title || '', img: state.channel.snippet?.thumbnails?.medium?.url || '' };
    const nextPlaylists = mapPlaylistApiItems(data.items, fallback);
    state.playlists = { ...data, items: [...(state.playlists.items || []), ...nextPlaylists] };
    void reserveDiscoveredCandidates(nextPlaylists, { context: 'channel', queryContext: `channel:${state.channel.id}:playlists` });
    renderChannelCatalog();
}

async function loadMoreChannelUploads(pageToken) {
    const state = activeChannelCatalog;
    if (!state?.uploadsPlaylistId || !pageToken) return;
    const response = await fetch(`/api/search?type=youtube&action=channelUploads&uploadsPlaylistId=${encodeURIComponent(state.uploadsPlaylistId)}&pageToken=${encodeURIComponent(pageToken)}&maxResults=24`);
    const data = await response.json();
    if (!response.ok) throw new Error('more_uploads_unavailable');
    const fallback = { channelId: state.channel.id, channelTitle: state.channel.snippet?.title || '', img: state.channel.snippet?.thumbnails?.medium?.url || '' };
    const nextItems = mapPlaylistVideoItems(data.items, fallback, state.uploads.items.length);
    state.uploads = { ...data, items: [...(state.uploads.items || []), ...nextItems] };
    void reserveDiscoveredCandidates(nextItems, { context: 'channel', queryContext: `channel:${state.channel.id}:uploads` });
    renderChannelCatalog();
}

function markYouTubeQuotaUnavailable() {
    youtubeQuotaBlockedUntil = Date.now() + (60 * 60 * 1000);
    if (!youtubeQuotaNoticeShown) {
        youtubeQuotaNoticeShown = true;
        showToast('YouTube alcanzó su cuota temporalmente; mostramos resultados Libres', 'fa-circle-info');
    }
}

async function fetchYouTubeSearch(query, resourceTypes, opts = {}) {
    if (Date.now() < youtubeQuotaBlockedUntil) return [];
    const channelParam = opts.channelId ? `&channelId=${encodeURIComponent(opts.channelId)}` : '';
    const maxResults = opts.maxResults || 20;
    const styleKey = opts.styleKey || inferArtistStyle(query, []);
    const pageToken = String(opts.pageToken || '').trim();
    const queryKey = reserveQueryKey('youtube', query, styleKey, resourceTypes, opts.channelId || '');
    const cacheKey = catalogCacheKey('youtube', { query: String(query || '').trim().toLowerCase(), resourceTypes, channelId: opts.channelId || '', maxResults, pageToken });
    const cached = readRemoteCatalogCache(cacheKey, CATALOG_CACHE_TTL_MS.youtube);
    if (cached && Array.isArray(cached.items)) {
        const restored = cached.items.slice();
        restored.nextPageToken = String(cached.nextPageToken || '');
        restored.pageInfo = cached.pageInfo || null;
        return restored;
    }
    try {
        const previous = await reserveGetQueryState({ source: 'youtube', query, styleKey, queryKey });
        const retryAt = previous?.retry_after ? Date.parse(previous.retry_after) : 0;
        if (previous?.status === 'quota' && retryAt > Date.now()) return [];
        let response;
        if (YOUTUBE_API_KEY) {
            const videoFilters = resourceTypes === 'video' ? '&videoEmbeddable=true&videoSyndicated=true' : '';
            const pageParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
            const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=${resourceTypes}&maxResults=${maxResults}&q=${encodeURIComponent(query)}${channelParam}${videoFilters}${pageParam}&key=${YOUTUBE_API_KEY}`;
            response = await fetch(url, opts.signal ? { signal: opts.signal } : undefined);
        } else {
            const pageParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
            response = await fetch(`/api/search?query=${encodeURIComponent(query)}&type=youtube&resourceTypes=${resourceTypes}${channelParam}&maxResults=${maxResults}${pageParam}`, opts.signal ? { signal: opts.signal } : undefined);
        }

        const data = await response.json();
        if (!response.ok) {
            const reason = data?.error?.reason || data?.error?.status || '';
            const quota = response.status === 429 || /quota|rate.?limit/i.test(reason);
            if (quota) markYouTubeQuotaUnavailable();
            reserveSaveQueryState({ queryKey, source: 'youtube', query, styleKey, seedKey: opts.seed?.artist || null, pagesConsumed: Number(previous?.pages_consumed || 0), status: quota ? 'quota' : 'error', retryAfter: new Date(Date.now() + (quota ? 30 : 5) * 60 * 1000).toISOString(), resultCount: 0, metadata: { resourceTypes, channelId: opts.channelId || null, pageToken: pageToken || null, errorReason: reason || null } });
            return [];
        }
        const mapped = data.items && data.items.length ? mapYouTubeItems(data.items) : [];
        const nextPageToken = String(data.nextPageToken || '').trim();
        reserveSaveQueryState({ queryKey, source: 'youtube', query, styleKey, seedKey: opts.seed?.artist || null, nextPageToken, pagesConsumed: Number(previous?.pages_consumed || 0) + 1, status: 'ok', retryAfter: null, resultCount: Number(data.pageInfo?.totalResults || mapped.length || 0), metadata: { resourceTypes, channelId: opts.channelId || null, pageToken: pageToken || null, nextPageToken, resultsReturned: mapped.length, pageInfo: data.pageInfo || null } });
        void reserveDiscoveredCandidates(mapped, { context: opts.reserveContext || 'manual', seed: opts.seed || null, queryContext: `${query} ${resourceTypes}`.trim().toLowerCase() });
        mapped.nextPageToken = nextPageToken;
        mapped.pageInfo = data.pageInfo || null;
        writeRemoteCatalogCache(cacheKey, { items: mapped, nextPageToken, pageInfo: data.pageInfo || null });
        return mapped;
    } catch (e) {
        if (e?.name === 'AbortError') return [];
        reserveSaveQueryState({ queryKey, source: 'youtube', query, styleKey, seedKey: opts.seed?.artist || null, status: 'error', retryAfter: new Date(Date.now() + 5 * 60 * 1000).toISOString(), metadata: { resourceTypes, channelId: opts.channelId || null, pageToken: pageToken || null, error: String(e?.message || e) } });
        return [];
    }
}

async function fetchYouTubeLegacy(query, maxResults = 20) {
    try {
        const response = await fetch(`/api/search?query=${encodeURIComponent(query)}&type=youtube`);
        if (!response.ok) return [];
        const data = await response.json();
        if (!data.items || !data.items.length) return [];
        return data.items
            .filter(item => item && item.id && item.id.videoId && item.snippet)
            .slice(0, maxResults)
            .map(item => {
                const thumb = item.snippet.thumbnails && (item.snippet.thumbnails.medium || item.snippet.thumbnails.default || item.snippet.thumbnails.high);
                return {
                    title: normalizeSourceText(item.snippet.title),
                    artist: normalizeSourceText(item.snippet.channelTitle),
                    description: normalizeSourceText(item.snippet.description),
                    img: thumb ? thumb.url : '',
                    url: item.id.videoId,
                    type: 'yt',
                    resourceKind: 'youtube#video',
                    isPlaylist: false,
                    channelId: item.snippet.channelId,
                    channelTitle: item.snippet.channelTitle
                };
            });
    } catch (e) { return []; }
}

const ROCK_METAL_DISCOVERY_QUERY = 'rock metal official music';
const CONTENT_CATALOG_CACHE_KEY = 'nowarfy_catalog_cache_v1';
const CONTENT_CATALOG_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const REMOTE_CATALOG_CACHE_KEY = 'nowarfy_remote_catalog_cache_v1';
const REMOTE_CATALOG_CACHE_MAX_ITEMS = 80;
const CATALOG_CACHE_TTL_MS = Object.freeze({
    youtube: 5 * 60 * 1000,
    openverse: 15 * 60 * 1000,
    commons: 30 * 60 * 1000
});
const OPENVERSE_RADIO_CACHE_KEY = 'nowarfy_openverse_radio_cache_v1';
const OPENVERSE_RADIO_CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const EMERGENCY_VIDEO_CATALOG = [
    { title: 'Metallica: Nothing Else Matters (Official Music Video)', artist: 'Metallica', channelTitle: 'Metallica', url: 'tAGnKpE4NCI', img: 'https://i.ytimg.com/vi/tAGnKpE4NCI/hqdefault.jpg', type: 'yt', resourceKind: 'youtube#video', description: 'Videoclip oficial de Metallica.' },
    { title: 'Nirvana - Smells Like Teen Spirit (Official Music Video)', artist: 'NirvanaVEVO', channelTitle: 'NirvanaVEVO', url: 'hTWKbfoikeg', img: 'https://i.ytimg.com/vi/hTWKbfoikeg/hqdefault.jpg', type: 'yt', resourceKind: 'youtube#video', description: 'Videoclip oficial de Nirvana.' },
    { title: 'System Of A Down - Chop Suey! (Official HD Video)', artist: 'systemofadownVEVO', channelTitle: 'systemofadownVEVO', url: 'CSvFpBOe8eY', img: 'https://i.ytimg.com/vi/CSvFpBOe8eY/hqdefault.jpg', type: 'yt', resourceKind: 'youtube#video', description: 'Videoclip oficial de System Of A Down.' },
    { title: 'System Of A Down - Lonely Day (Official HD Video)', artist: 'systemofadownVEVO', channelTitle: 'systemofadownVEVO', url: 'DnGdoEa1tPg', img: 'https://i.ytimg.com/vi/DnGdoEa1tPg/hqdefault.jpg', type: 'yt', resourceKind: 'youtube#video', description: 'Videoclip oficial de System Of A Down.' },
    { title: 'Numb (Official Music Video)', artist: 'Linkin Park', channelTitle: 'Linkin Park', url: 'kXYiU_JCYtU', img: 'https://i.ytimg.com/vi/kXYiU_JCYtU/hqdefault.jpg', type: 'yt', resourceKind: 'youtube#video', description: 'Videoclip oficial de Linkin Park.' },
    { title: 'Foo Fighters - The Pretender', artist: 'foofightersVEVO', channelTitle: 'foofightersVEVO', url: 'SBjQ9tuuTJQ', img: 'https://i.ytimg.com/vi/SBjQ9tuuTJQ/hqdefault.jpg', type: 'yt', resourceKind: 'youtube#video', description: 'Videoclip oficial de Foo Fighters.' },
    { title: 'MANOWAR - Warriors Of The World United (Live)', artist: 'MANOWAR', channelTitle: 'MANOWAR', url: 'G1G9D8A4Fiw', img: 'https://i.ytimg.com/vi/G1G9D8A4Fiw/hqdefault.jpg', type: 'yt', resourceKind: 'youtube#video', description: 'Video oficial en vivo de MANOWAR.' },
    { title: 'Slipknot - Psychosocial (Live from Day Of The Gusano)', artist: 'Slipknot', channelTitle: 'Slipknot', url: 'AQ0ktXH3LfI', img: 'https://i.ytimg.com/vi/AQ0ktXH3LfI/hqdefault.jpg', type: 'yt', resourceKind: 'youtube#video', description: 'Presentación en vivo de Slipknot.' },
    { title: 'ALL FOR METAL - Gods Of Metal (Official Music Video)', artist: 'Reigning Phoenix Music', channelTitle: 'Reigning Phoenix Music', url: '5A04DZNtH-w', img: 'https://i.ytimg.com/vi/5A04DZNtH-w/hqdefault.jpg', type: 'yt', resourceKind: 'youtube#video', description: 'Videoclip oficial de ALL FOR METAL.' }
];
const EMERGENCY_PLAYLISTS = [];
const GENRE_CHANNEL_LISTS = [
    { title: 'Rock', icon: 'fa-guitar', query: 'rock official music channels', styleKey: 'rock', description: 'Rock clásico, alternativo y contemporáneo.' },
    { title: 'Metal', icon: 'fa-hand-fist', query: 'metal official music channels', styleKey: 'metal', description: 'Metal clásico, extremo y moderno.' },
    { title: 'Hardcore', icon: 'fa-bolt', query: 'hardcore punk official music channels', styleKey: 'hardcore', description: 'Hardcore, punk pesado y escenas afines.' },
    { title: 'Punk', icon: 'fa-skull', query: 'punk rock official music channels', styleKey: 'punk', description: 'Punk, post-punk y espíritu independiente.' },
    { title: 'Grunge', icon: 'fa-cloud', query: 'grunge alternative rock official channels', styleKey: 'grunge', description: 'Grunge, alternativo y los noventa.' },
    { title: 'Stoner y Doom', icon: 'fa-mountain-sun', query: 'stoner doom metal official channels', styleKey: 'stoner', description: 'Riffs lentos, fuzz y peso atmosférico.' },
    { title: 'Rock latino', icon: 'fa-earth-americas', query: 'rock latino official music channels', styleKey: 'latin rock', description: 'Rock en español y escenas latinoamericanas.' }
];
const EXPLORE_COLLECTIONS = [
    { title: 'Conciertos y sesiones', icon: 'fa-tower-broadcast', query: 'rock metal live concert session', description: 'Shows en vivo, sesiones y escenarios.' },
    { title: 'Videoclips oficiales', icon: 'fa-film', query: 'rock metal official music video', description: 'Estrenos y videoclips de artistas.' },
    { title: 'Clásicos y rarezas', icon: 'fa-compact-disc', query: 'rock metal classic rare live', description: 'Archivo, tomas en vivo y joyas conocidas.' },
    { title: 'Nuevas voces', icon: 'fa-sparkles', query: 'new rock metal bands official', description: 'Bandas y lanzamientos para descubrir.' },
    { title: 'Covers y tributos', icon: 'fa-microphone-lines', query: 'rock metal cover tribute live', description: 'Interpretaciones y homenajes destacados.' },
    { title: 'Sellos y medios', icon: 'fa-satellite-dish', query: 'rock metal record label music channel', description: 'Canales de sellos, festivales y medios.' }
];
const FREE_MUSIC_COLLECTIONS = [
    { title: 'Rock libre', icon: 'fa-guitar', query: 'rock music', description: 'Pistas con licencia abierta, carátula y autor identificado.' },
    { title: 'Metal instrumental libre', icon: 'fa-bolt', query: 'metal instrumental music', description: 'Instrumentales de metal que pasan el filtro de calidad.' },
    { title: 'Punk y hardcore libre', icon: 'fa-hand-fist', query: 'punk hardcore music', description: 'Escenas libres de punk y hardcore, sin efectos ni bucles.' },
    { title: 'Sesiones y guitarras libres', icon: 'fa-record-vinyl', query: 'live guitar music', description: 'Grabaciones musicales y sesiones con licencia abierta.' }
];
const FREE_VIDEO_COLLECTIONS = [
    { title: 'Conciertos libres', icon: 'fa-tower-broadcast', query: 'music concert', description: 'Presentaciones audiovisuales con licencia abierta.' },
    { title: 'Archivo musical libre', icon: 'fa-film', query: 'rock music', description: 'Documentos y clips musicales de dominio público o Creative Commons.' }
];
const directCollectionCache = new Map();
const remoteCatalogCache = new Map();
function catalogCacheKey(source, params = {}) {
    return `${source}:${JSON.stringify(params, Object.keys(params).sort())}`;
}
function readRemoteCatalogCache(key, ttl) {
    const now = Date.now();
    const memoryEntry = remoteCatalogCache.get(key);
    if (memoryEntry && now - memoryEntry.savedAt <= ttl) return memoryEntry.data;
    try {
        const store = JSON.parse(localStorage.getItem(REMOTE_CATALOG_CACHE_KEY) || '{}');
        const entry = store[key];
        if (!entry || now - Number(entry.savedAt || 0) > ttl) return null;
        remoteCatalogCache.set(key, entry);
        return entry.data;
    } catch (_) { return null; }
}
function writeRemoteCatalogCache(key, data) {
    const entry = { savedAt: Date.now(), data };
    remoteCatalogCache.set(key, entry);
    try {
        const store = JSON.parse(localStorage.getItem(REMOTE_CATALOG_CACHE_KEY) || '{}');
        store[key] = entry;
        const freshEntries = Object.entries(store)
            .sort(([, a], [, b]) => Number(b?.savedAt || 0) - Number(a?.savedAt || 0))
            .slice(0, REMOTE_CATALOG_CACHE_MAX_ITEMS);
        localStorage.setItem(REMOTE_CATALOG_CACHE_KEY, JSON.stringify(Object.fromEntries(freshEntries)));
    } catch (_) {}
}

async function recoverWithRockMetal() {
    const recovery = await fetchYouTubeSearch(ROCK_METAL_DISCOVERY_QUERY, 'video,playlist,channel', { maxResults: 20 });
    if (recovery.length) {
        renderYouTubeSearchResults(recovery, 'Sugerencias de rock y metal');
        showToast('Sin coincidencias asociadas: te mostramos rock y metal', 'fa-guitar');
        return true;
    }
    try {
        await searchOpenverse('rock metal');
        showToast('Sin coincidencias asociadas: te mostramos rock y metal', 'fa-guitar');
        return true;
    } catch (error) {
        return false;
    }
}

function mergeSearchResults(items) {
    const seen = new Set();
    return (items || []).filter(item => {
        const key = `${item?.resourceKind || item?.type || ''}:${item?.url || ''}`;
        if (!item?.url || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
function renderSearchResultsPage() {
    const state = activeSearchPagination;
    if (!state || state.query !== searchQuery) return;
    navigateWithTransition(() => {
        renderYouTubeSearchResults(state.youtubeResults, state.query);
        if (state.openverseResults.length) renderOpenverseSearchResults(state.openverseResults, state.query);
        renderSearchMoreControl();
    });
}
function renderSearchMoreControl() {
    const state = activeSearchPagination;
    const container = document.getElementById('dynamicSections');
    if (!container || !state || state.query !== searchQuery) return;
    searchMoreObserver?.disconnect();
    container.querySelector('#searchMoreWrap')?.remove();
    if (!state.youtubeNextPageToken && !state.openverseHasMore) return;
    const wrap = document.createElement('div');
    wrap.id = 'searchMoreWrap';
    wrap.className = 'catalog-more-wrap';
    wrap.innerHTML = '<button type="button" class="catalog-more" id="searchMoreButton"><i class="fas fa-plus"></i> Seguir cargando resultados</button>';
    container.appendChild(wrap);
    const button = wrap.querySelector('#searchMoreButton');
    button.onclick = () => loadMoreSearchResults();
    if ('IntersectionObserver' in window) {
        searchMoreObserver = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) void loadMoreSearchResults();
        }, { rootMargin: '500px 0px' });
        searchMoreObserver.observe(wrap);
    }
}
async function loadMoreSearchResults() {
    const state = activeSearchPagination;
    if (!state || state.loading || state.query !== searchQuery || state.requestId !== activeSearchRequestId) return;
    if (!state.youtubeNextPageToken && !state.openverseHasMore) return;
    state.loading = true;
    const button = document.getElementById('searchMoreButton');
    if (button) { button.disabled = true; button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cargando más resultados...'; }
    try {
        const [youtubeResult, openverseResult] = await Promise.allSettled([
            state.youtubeNextPageToken
                ? fetchYouTubeSearch(state.query, channelFilter ? 'video,playlist' : 'video,playlist,channel', { channelId: channelFilter?.id, maxResults: 50, pageToken: state.youtubeNextPageToken, reserveContext: 'manual', signal: activeSearchController?.signal })
                : Promise.resolve([]),
            state.openverseHasMore
                ? fetchOpenverseTracks(state.openverseQuery, 20, { page: state.openversePage + 1, reserveContext: 'manual', seed: { artist: state.query, title: state.query }, signal: activeSearchController?.signal })
                : Promise.resolve([])
        ]);
        if (state.query !== searchQuery || activeSearchPagination !== state || state.requestId !== activeSearchRequestId) return;
        const nextYouTube = youtubeResult.status === 'fulfilled' ? youtubeResult.value || [] : [];
        const nextOpenverse = openverseResult.status === 'fulfilled' ? openverseResult.value || [] : [];
        state.youtubeResults = mergeSearchResults([...state.youtubeResults, ...nextYouTube]);
        state.openverseResults = mergeSearchResults([...state.openverseResults, ...nextOpenverse]);
        state.youtubeNextPageToken = String(nextYouTube.nextPageToken || '').trim();
        state.openversePage += 1;
        state.openverseHasMore = Boolean(nextOpenverse.nextPage || nextOpenverse.length >= 20);
        renderSearchResultsPage();
    } finally {
        state.loading = false;
        const nextButton = document.getElementById('searchMoreButton');
        if (nextButton) { nextButton.disabled = false; nextButton.innerHTML = '<i class="fas fa-plus"></i> Seguir cargando resultados'; }
    }
}
async function performSmartSearch(query, options = {}) {
    activeSearchController?.abort();
    activeSearchController = new AbortController();
    const requestId = ++activeSearchRequestId;
    pushNowarfyHistory('search', {
        query: String(query || ''),
        channelId: channelFilter?.id || '',
        channelTitle: channelFilter?.title || ''
    });
    minimizeActiveVideoForNavigation();
    searchQuery = query;
    renderTasteChips(query);
    if (!channelFilter) rememberSearch(query);
    activeBrowseMode = 'search';
    searchMoreObserver?.disconnect();
    activeSearchPagination = { requestId, query, youtubeResults: [], youtubeNextPageToken: '', openverseResults: [], openverseQuery: channelFilter ? query : `${query} music`, openversePage: 1, openverseHasMore: false, loading: false };
    currentMood = null;
    document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('active'));

    const loader = document.getElementById('loader');
    const container = document.getElementById('dynamicSections');
    loader.style.display = 'flex';
    container.innerHTML = '';

    try {
        const localCandidates = await reserveSearchCandidates(query, { limit: 20 });
        if (requestId !== activeSearchRequestId) return;
        const knownPool = [...(queue || []), ...(currentList || []), ...(homeVideos || []), ...(homeMusicVideos || []), ...(homeMusic || [])];
        const queryNeedle = String(query || '').toLowerCase().trim();
        const sessionCandidates = knownPool.filter(song => {
            if (!song?.url || !isRadioMusicTrack(song)) return false;
            const text = `${song.title || ''} ${song.artist || ''} ${song.description || ''}`.toLowerCase();
            return text.includes(queryNeedle);
        });
        const localSongs = [...localCandidates.map(candidate => ({ ...candidate, _fromReserve: true })), ...sessionCandidates].filter((song, index, all) => {
            const key = songKey(song);
            return all.findIndex(other => songKey(other) === key) === index;
        });
        const openverseQuery = channelFilter ? query : `${query} music`;
        const cachedSearchIsSufficient = !channelFilter && localSongs.length >= 3;
        const [youtubeResult, openverseResult] = await Promise.allSettled([
            cachedSearchIsSufficient
                ? Promise.resolve([])
                : (channelFilter
                    ? fetchYouTubeSearch(query, 'video,playlist', { channelId: channelFilter.id, maxResults: 50, signal: activeSearchController.signal })
                    : fetchYouTubeSearch(query, 'video,playlist,channel', { maxResults: 50, signal: activeSearchController.signal })),
            fetchOpenverseTracks(openverseQuery, 20, { page: 1, reserveContext: 'manual', seed: { artist: query, title: query }, signal: activeSearchController.signal })
        ]);
        if (requestId !== activeSearchRequestId) return;
        const fresh = youtubeResult.status === 'fulfilled' ? youtubeResult.value || [] : [];
        const openverseTracks = openverseResult.status === 'fulfilled' ? openverseResult.value || [] : [];
        const merged = mergeSearchResults([...localSongs, ...fresh]);
        activeSearchPagination.youtubeResults = merged;
        activeSearchPagination.youtubeNextPageToken = String(fresh.nextPageToken || '').trim();
        activeSearchPagination.openverseResults = mergeSearchResults(openverseTracks);
        activeSearchPagination.openverseHasMore = Boolean(openverseTracks.nextPage || openverseTracks.length >= 20);

        if (merged.length > 0) renderYouTubeSearchResults(merged, query);
        if (openverseTracks.length > 0) renderOpenverseSearchResults(openverseTracks, query);
        renderSearchMoreControl();
        if (!channelFilter && localSongs.length > 0 && fresh.length === 0) {
            showToast(cachedSearchIsSufficient ? `Resultados guardados reutilizados para "${query}"` : `YouTube sin resultados nuevos: usando candidatos guardados de ${inferArtistStyle(query, localSongs)}`, 'fa-database');
        }
        if (!merged.length && !openverseTracks.length) {
            if (channelFilter) renderEmptyState(`Sin resultados para "${query}" en este canal`);
            else if (!(await recoverWithRockMetal())) renderEmptyState(`Sin resultados para "${query}"`, 'No encontramos coincidencias ni propuestas musicales disponibles ahora.');
        }
    } catch (e) {
        if (e?.name === 'AbortError' || requestId !== activeSearchRequestId) return;
        console.warn('No se pudo completar la búsqueda solicitada', e);
        if (channelFilter || !(await recoverWithRockMetal())) {
            renderEmptyState(`Sin resultados para "${query}"`, 'No encontramos coincidencias ni propuestas de rock y metal disponibles ahora.');
        }
    } finally {
        if (requestId === activeSearchRequestId && loader.style.display === 'flex') loader.style.display = 'none';
    }
}

function browseChannel(channelId, channelTitle) {
    if (!channelId) return;
    void reserveDiscoveredCandidates([{
        url: String(channelId), type: 'yt', resourceKind: 'youtube#channel',
        title: String(channelTitle || 'Canal de YouTube'), artist: 'Canal de YouTube',
        channelId: String(channelId), channelTitle: String(channelTitle || 'Canal de YouTube')
    }], { context: 'channel_open', queryContext: `channel:${channelId}` });
    pushNowarfyHistory('channel', { channelId: String(channelId), channelTitle: String(channelTitle || '') });
    loadChannelProfile(channelId, channelTitle);
}

function clearChannelFilter() {
    const q = searchQuery;
    channelFilter = null;
    if (q) performSmartSearch(q); else resetView();
}

async function fetchOpenverseTracks(query, limit = 20, options = {}) {
    const page = Math.max(1, Number(options.page || 1));
    const boundedLimit = Math.min(Math.max(limit, 1), 20);
    const cacheKey = catalogCacheKey('openverse', { query: String(query || '').trim().toLowerCase(), page, limit: boundedLimit, radioOnly: Boolean(options.radioOnly) });
    const cached = readRemoteCatalogCache(cacheKey, CATALOG_CACHE_TTL_MS.openverse);
    if (cached && Array.isArray(cached.items)) {
        const restored = cached.items.slice();
        restored.nextPage = cached.nextPage || null;
        restored.page = page;
        return restored;
    }
    const response = await fetch(`/api/search?type=openverse&query=${encodeURIComponent(query)}&page=${page}&maxResults=${boundedLimit}`, options.signal ? { signal: options.signal } : undefined);
    const data = await response.json();
    if (!response.ok || !data.results?.length) return [];
    const allowedAudioTypes = new Set(['mp3', 'mp32', 'ogg', 'opus', 'm4a', 'aac', 'wav', 'flac']);
    const unwantedAudioTerms = /\b(sound effect|sound-effect|sfx|foley|ambient|ambience|ambiente|noise|ruido|whoosh|impact|explosion|sample|sampling|loop|drum loop|drum circle|water|sonar|test tone|tone generator|field recording|field-recording|white noise|pink noise|audiobook|audio book|audiolibro|spoken word|narration|narrator|chapter|book reading|story|stories|lecture|podcast|interview|meditation|sleep music|children|bedtime)\b/i;
    const mappedTracks = data.results
        .filter(track => allowedAudioTypes.has(String(track.filetype || '').toLowerCase()))
        .filter(track => String(track.url || '').trim())
        .filter(track => String(track.title || '').trim() && String(track.creator || '').trim())
        .filter(track => !options.radioOnly || !/sound_effect|audiobook|audio_book|spoken|podcast|lecture/i.test(String(track.category || '')))
        .filter(track => !options.radioOnly || Number(track.duration) >= 60000)
        .filter(track => {
            if (!options.radioOnly) return true;
            const tags = Array.isArray(track.tags)
                ? track.tags.map(tag => typeof tag === 'object' ? tag.name || '' : tag).join(' ')
                : String(track.tags || '');
            const searchable = `${track.title || ''} ${track.creator || ''} ${track.category || ''} ${tags}`;
            return !unwantedAudioTerms.test(searchable);
        })
        .map(track => ({
            title: track.title, artist: track.creator,
            img: track.thumbnail || 'assets/nowarfy-icon-512.png', url: track.url, type: 'mp3',
            duration: track.duration ? Math.round(track.duration / 1000) : null,
            genre: (track.genres && track.genres[0]) || 'unknown',
            license: track.license || '',
            licenseVersion: track.license_version || '',
            filetype: track.filetype || '',
            sourceUrl: track.foreign_landing_url || track.detail_url || ''
        }))
        .sort((a, b) => (b.img ? 1 : 0) - (a.img ? 1 : 0));
    void reserveDiscoveredCandidates(mappedTracks, { context: options.reserveContext || 'manual', seed: options.seed || null, queryContext: `${query} openverse`.trim().toLowerCase() });
    mappedTracks.nextPage = data.pagination?.next || null;
    mappedTracks.page = page;
    writeRemoteCatalogCache(cacheKey, { items: mappedTracks, nextPage: mappedTracks.nextPage });
    return mappedTracks;
}

async function fetchCommonsVideos(query, limit = 12) {
    const boundedLimit = Math.min(Math.max(limit, 1), 20);
    const cacheKey = catalogCacheKey('commons', { query: String(query || '').trim().toLowerCase(), limit: boundedLimit });
    const cached = readRemoteCatalogCache(cacheKey, CATALOG_CACHE_TTL_MS.commons);
    if (Array.isArray(cached)) return cached.slice();
    const response = await fetch(`/api/search?type=commonsVideo&query=${encodeURIComponent(query)}&maxResults=${boundedLimit}`);
    const data = await response.json();
    if (!response.ok || !Array.isArray(data.results)) return [];
    const mapped = data.results
        .filter(item => item?.url && item?.thumbnail && item?.license)
        .map(item => ({
            title: normalizeSourceText(item.title || 'Video libre'), artist: normalizeSourceText(item.creator || 'Wikimedia Commons'),
            img: item.thumbnail, url: item.url, type: 'freevideo', resourceKind: 'commons#video',
            duration: Number(item.duration) || null, license: normalizeSourceText(item.license), mime: item.mime || '',
            sourceUrl: item.sourceUrl || '', description: normalizeSourceText(item.description || ''),
            channelTitle: 'Wikimedia Commons'
        }));
    writeRemoteCatalogCache(cacheKey, mapped);
    return mapped;
}

async function fetchFreeMusicCollection(collection) {
    const tracks = await fetchOpenverseTracks(collection.query, 20, { radioOnly: true, reserveContext: 'radio' });
    return tracks;
}

function renderOpenverseSearchResults(tracks, query) {
    if (!Array.isArray(tracks) || !tracks.length) return;
    renderLibraryRail(tracks.slice(0, 20), `Openverse · música de "${query}"`, "<i class='fas fa-headphones'></i>", false, {
        hint: 'Fuente abierta · resultados visibles siempre',
        showControls: true,
        className: 'free-music-rail openverse-search-rail'
    });
}
async function searchOpenverse(query) {
    const mappedResults = await fetchOpenverseTracks(query, 20);
    if (!mappedResults.length) throw new Error('No results');
    currentList = mappedResults;
    renderGrid(mappedResults, `Música: "${query}"`, "<i class='fas fa-headphones'></i>");
}

function setMood(mood) {
    currentMood = mood; searchQuery = ""; channelFilter = null;
    searchInput.value = ""; searchClearBtn.classList.remove('show');
    document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('active'));
    event.currentTarget.classList.add('active');
    performSmartSearch(mood);
}

function loadYouTubeAPI() {
    if (window.YT && window.YT.Player) { ytApiReady = true; return; }
    if (document.querySelector('script[data-youtoo-iframe-api]')) return;
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.dataset.youtooIframeApi = 'true';
    document.getElementsByTagName('script')[0].parentNode.insertBefore(tag, document.getElementsByTagName('script')[0]);
    window.onYouTubeIframeAPIReady = () => {
        ytApiReady = true;
        const pending = pendingYTRequest;
        pendingYTRequest = null;
        if (pending) initYTPlayer(pending.resourceId, pending.isPlaylist, pending.resumeSession || null, !!pending.deferAutoplay);
    };
}

function uniqueMediaByUrl(items, maxItems) {
    const seen = new Set();
    return items.filter(item => {
        const key = String(item?.url || '');
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    }).slice(0, maxItems);
}

let videoClassificationReviewTimer = null;
function videoSearchText(item) {
    const tags = Array.isArray(item?.tags) ? item.tags.map(tag => typeof tag === 'object' ? tag.name || '' : tag).join(' ') : String(item?.tags || item?.metadata?.tags || '');
    return `${item?.title || ''} ${item?.artist || ''} ${item?.channelTitle || ''} ${item?.description || ''} ${item?.genre || ''} ${tags}`.toLowerCase();
}
function isNonMusicalVideo(item) {
    if (!item?.url || !['yt', 'freevideo'].includes(item.type)) return false;
    if (item.type === 'freevideo') return true;
    const text = videoSearchText(item);
    const categoryId = String(item.categoryId || item.videoSnippet?.categoryId || '');
    const hasStrongMusicSignal = /official music video|music video|video musical|videoclip|official audio|lyric video|lyrics?|letra|band version|full album|álbum completo|album completo|full concert|live performance|presentación en vivo|canción|cancion|single|remix|cover|acoustic|instrumental|karaoke|song|track|concert|concierto|music video/.test(text);
    if (categoryId === '10' || hasStrongMusicSignal) return false;
    return /tutorial|how to|documentary|documental|vlog|podcast|interview|entrevista|news|noticias|review|reseña|reaction|reacción|gameplay|gaming|trailer|teaser|lecture|clase|curso|comedy|comedia|short film|cortometraje|live stream|streaming|sports|deportes|travel|viaje|cooking|cocina|technology|tecnología|unboxing|audiobook|audiolibro|lesson|tutorial/.test(text);
}
function musicalVideoPool(items, limit = 120) {
    return uniqueMediaByUrl((items || []).filter(item => item?.type === 'yt' && !isNonMusicalVideo(item)), limit);
}
function nonMusicalVideoPool(items, limit = 120) {
    return uniqueMediaByUrl((items || []).filter(isNonMusicalVideo), limit);
}
function reviewVideoClassification() {
    const pool = uniqueMediaByUrl([...(homeVideos || []), ...(homeMusicVideos || [])], 200);
    pool.forEach(item => {
        if (item?.type !== 'yt') return;
        const group = isNonMusicalVideo(item) ? 'non_music_video' : 'music_video';
        item.contentGroup = group;
        item.metadata = { ...(item.metadata || {}), contentGroup: group };
    });
}
function scheduleVideoClassificationReview() { syncVideoClassificationReviewTimer(); }
function syncVideoClassificationReviewTimer() {
    if (videoClassificationReviewTimer) clearInterval(videoClassificationReviewTimer);
    videoClassificationReviewTimer = nowarfyPageHidden ? null : window.setInterval(reviewVideoClassification, 5 * 60 * 1000);
}

function normalizeTasteTrack(item) {
    if (!item?.url || !item?.type) return null;
    return {
        ...item,
        resourceKind: item.resourceKind || (item.type === 'yt' ? 'youtube#video' : ''),
        artist: item.artist || item.channelTitle || 'Nowarfy',
        channelTitle: item.channelTitle || item.artist || ''
    };
}

function restoreCatalogCache() {
    try {
        const cached = JSON.parse(localStorage.getItem(CONTENT_CATALOG_CACHE_KEY));
        if (!cached || Date.now() - Number(cached.savedAt || 0) > CONTENT_CATALOG_CACHE_MAX_AGE_MS) return false;
        homeVideos = uniqueMediaByUrl(cached.videos || [], 24);
        homeMusicVideos = uniqueMediaByUrl(musicalVideoPool(cached.musicVideos || cached.videos || []), 24);
        homePlaylists = uniqueMediaByUrl(cached.playlists || [], 20);
        homeMusic = uniqueMediaByUrl(cached.music || [], 24);
        return homeVideos.length + homeMusicVideos.length + homePlaylists.length + homeMusic.length > 0;
    } catch (e) { return false; }
}

function persistCatalogCache() {
    try {
        localStorage.setItem(CONTENT_CATALOG_CACHE_KEY, JSON.stringify({
            savedAt: Date.now(), videos: homeVideos, musicVideos: homeMusicVideos, playlists: homePlaylists, music: homeMusic
        }));
    } catch (e) {}
}

function buildHomeRecommendations() {
    const taste = readTaste();
    const localActivity = [...taste.plays, ...favorites].map(normalizeTasteTrack).filter(Boolean);
    homeRecommended = uniqueMediaByUrl([...localActivity, ...homeMusicVideos, ...homeVideos, ...EMERGENCY_VIDEO_CATALOG], 24);
}

async function loadHomeCatalogSources() {
    const fromCache = restoreCatalogCache();
    if (!fromCache) {
        const localReserve = await readLocalReserveCandidates(120);
        const reservedVideos = localReserve.filter(item => item.type === 'yt' || item.resourceKind === 'youtube#video');
        const reservedAudio = localReserve.filter(item => item.type === 'mp3');
        const catalogVideos = uniqueMediaByUrl([...reservedVideos, ...EMERGENCY_VIDEO_CATALOG], 48);
        homeVideos = catalogVideos.slice(0, 24);
        homeMusicVideos = uniqueMediaByUrl(musicalVideoPool(catalogVideos), 24);
        homePlaylists = [];
        homeMusic = uniqueMediaByUrl(reservedAudio, 24);
        persistCatalogCache();
    }
    if (!homeVideos.length) homeVideos = uniqueMediaByUrl(EMERGENCY_VIDEO_CATALOG, 24);
    if (!homeMusicVideos.length) homeMusicVideos = uniqueMediaByUrl(musicalVideoPool([...homeVideos, ...EMERGENCY_VIDEO_CATALOG]), 24);
    if (!homePlaylists.length) homePlaylists = uniqueMediaByUrl(EMERGENCY_PLAYLISTS, 20);
    homeChannels = deriveChannels(uniqueMediaByUrl([...homeVideos, ...homeMusicVideos], 24));
    buildHomeRecommendations();
    refreshAmbientArtworkFromCatalog();
    return homeVideos.length + homeMusicVideos.length + homePlaylists.length + homeMusic.length + homeRecommended.length > 0;
}

async function resetView(options = {}) {
    activeSearchController?.abort();
    activeSearchController = null;
    activeSearchRequestId += 1;
    activeSearchPagination = null;
    pushNowarfyHistory('home');
    closeNowarfyMobileNav();
    minimizeActiveVideoForNavigation();
    searchQuery = ""; currentMood = null; channelFilter = null; activeBrowseMode = 'home';
    renderTasteChips();
    searchInput.value = ""; searchClearBtn.classList.remove('show');
    document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.nav-links li').forEach(l => l.classList.remove('active'));
    document.querySelector('.nav-links li:first-child').classList.add('active');

    if (homeFeedLoaded) {
        renderHomeFeed();
        if (!initialRadioQueueReady) {
            await ensureInitialRadioQueue();
            initialRadioQueueReady = true;
        }
        return;
    }
    if (homeFeedLoading) return;
    homeFeedLoading = true;
    const loader = document.getElementById('loader');
    const container = document.getElementById('dynamicSections');
    loader.style.display = 'flex';
    container.innerHTML = '';
    try {
        const hasContent = await loadHomeCatalogSources();
        homeFeedLoaded = hasContent;
        if (hasContent) {
            renderHomeFeed();
            if (!initialRadioQueueReady) {
                await ensureInitialRadioQueue();
                initialRadioQueueReady = true;
            }
        } else renderEmptyState('No pudimos cargar propuestas ahora', 'Probá recargar dentro de unos segundos o buscá un artista.');
    } finally {
        homeFeedLoading = false;
        loader.style.display = 'none';
    }
}

function featuredHash(value) {
    return Array.from(String(value)).reduce((total, char) => ((total << 5) - total + char.charCodeAt(0)) | 0, 0);
}

function getFeaturedEdition(videos) {
    const source = uniqueMediaByUrl(videos || [], (videos || []).length);
    if (!source.length) return { items: [], edition: 1, theme: FEATURED_THEMES[0] };
    const signature = source.map(item => String(item.url || '')).join('|');
    let previous = null;
    try { previous = JSON.parse(localStorage.getItem(FEATURED_ROTATION_STORAGE_KEY)); } catch (e) {}
    const seed = Math.abs(featuredHash(signature));
    const offset = previous?.signature === signature
        ? (Number(previous.offset || 0) + FEATURED_EDITION_SIZE) % source.length
        : seed % source.length;
    const edition = Math.floor(offset / FEATURED_EDITION_SIZE) + 1;
    const theme = FEATURED_THEMES[edition % FEATURED_THEMES.length];
    try { localStorage.setItem(FEATURED_ROTATION_STORAGE_KEY, JSON.stringify({ signature, offset, edition, at: Date.now() })); } catch (e) {}
    return { items: source.slice(offset).concat(source.slice(0, offset)), edition, theme };
}

function diversityKey(item) {
    return String(item?.url || item?.id || item?.videoId || '').trim();
}
function takeNovelItems(items, used, limit = 12) {
    const result = [];
    for (const item of uniqueMediaByUrl(items || [], (items || []).length)) {
        const key = diversityKey(item);
        if (!key || used.has(key)) continue;
        used.add(key);
        result.push(item);
        if (result.length >= limit) break;
    }
    return result;
}
function renderHomeWelcome(lastViewed) {
    const container = document.getElementById('dynamicSections');
    const welcome = document.createElement('button');
    welcome.type = 'button';
    welcome.className = 'home-welcome';
    if (lastViewed?.title) {
        welcome.innerHTML = `<span class="home-welcome-copy"><span class="home-welcome-brandline"><span class="home-welcome-logo"><img class="brand-lockup-mark" src="assets/nowarfy-logo-red-solid.png" alt=""><span class="brand-lockup-text"><strong>Nowarfy</strong><span>YouToo</span><sup class="brand-registered">®</sup></span></span><span class="home-welcome-kicker">Bienvenido de nuevo</span></span><h1>Seguimos desde donde quedaste</h1><p>Lo último que viste fue <strong>${escapeHtml(lastViewed.title)}</strong>${lastViewed.artist ? ` · ${escapeHtml(lastViewed.artist)}` : ''}. El reproductor empieza detenido: tocá esta tarjeta o el botón de reproducir cuando quieras continuar.</p></span>${lastViewed.img ? `<img class="home-welcome-art" src="${escapeHtml(lastViewed.img)}" alt="" loading="lazy">` : ''}`;
        welcome.addEventListener('click', () => resumeSongFromWelcome(lastViewed, 0));
    } else {
        welcome.innerHTML = `<span class="home-welcome-copy"><span class="home-welcome-brandline"><span class="home-welcome-logo"><img class="brand-lockup-mark" src="assets/nowarfy-logo-red-solid.png" alt=""><span class="brand-lockup-text"><strong>Nowarfy</strong><span>YouToo</span><sup class="brand-registered">®</sup></span></span><span class="home-welcome-kicker">Bienvenido a Nowarfy · YouToo</span></span><h1>Descubrí música real, sin límites</h1><p>Explorá artistas, canales y fuentes musicales. El reproductor empieza detenido para que vos elijas cuándo comenzar.</p></span>`;
    }
    container.appendChild(welcome);
}

function renderHomeQuickActions() {
    const container = document.getElementById('dynamicSections');
    const actions = document.createElement('div');
    actions.className = 'home-quick-actions';
    actions.innerHTML = `<button type="button" class="home-quick-action" onclick="searchInput.focus()"><i class="fas fa-magnifying-glass"></i><span><strong>Buscar música</strong><small>Encontrá un artista o canción</small></span></button>
        <button type="button" class="home-quick-action" onclick="openQueueFromSidebar()"><i class="fas fa-list-music"></i><span><strong>Ver playlist</strong><small>Revisá lo que sigue</small></span></button>
        <button type="button" class="home-quick-action" onclick="openNowarfyQr()"><i class="fas fa-qrcode"></i><span><strong>Vincular dispositivo</strong><small>Usá el pairing QR</small></span></button>`;
    container.appendChild(actions);
}

function renderDeferredHomeRail(list, title, icon, isPlaylist = false, options = {}) {
    const items = (list || []).filter(item => itemsWithArtwork([item]).length && (!isPlaylist || hasUsablePlaylistItems(item)));
    if (!items.length) return;
    const container = document.getElementById('dynamicSections');
    const placeholder = document.createElement('section');
    placeholder.className = `library-rail-section home-deferred-rail ${options.className || ''}`.trim();
    placeholder.setAttribute('aria-busy', 'true');
    placeholder.innerHTML = `<div class="library-rail-title">${icon} <span>${escapeHtml(title)}</span><span class="library-rail-hint">Preparando contenido…</span></div>`;
    container.appendChild(placeholder);

    let loaded = false;
    let observer = null;
    const load = () => {
        if (loaded || !placeholder.isConnected) return;
        loaded = true;
        observer?.disconnect();
        renderLibraryRail(items, title, icon, isPlaylist, { ...options, mountBefore: placeholder });
        placeholder.remove();
    };
    if (!window.IntersectionObserver) {
        load();
        return;
    }
    observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) load();
    }, { rootMargin: '320px 0px' });
    observer.observe(placeholder);
}

function renderHomeFeed() {
    const taste = readTaste();
    navigateWithTransition(() => {
        const container = document.getElementById('dynamicSections');
        container.innerHTML = '';
        currentList = [];
        const used = new Set();
        const lastViewed = normalizeTasteTrack(taste.plays[0]);
        renderHomeWelcome(lastViewed);
        renderHomeQuickActions();
        if (lastViewed) used.add(songKey(lastViewed));

        const recommended = takeNovelItems(homeRecommended.filter(item => !isNonMusicalVideo(item)), used, 8);
        if (recommended.length) renderLibraryRail(recommended, taste.personalization && getTasteSeed() ? 'Recomendado para vos' : 'Para empezar ahora', "<i class='fas fa-wand-magic-sparkles'></i>", false, { hint: taste.personalization && getTasteSeed() ? 'Según tu actividad local · selección nueva' : 'Selección inicial · contenido no repetido', showControls: true, className: 'home-recommended-rail' });
        const edition = getFeaturedEdition(musicalVideoPool(homeVideos));
        const featured = takeNovelItems(edition.items, used, 8);
        if (featured.length >= 3) {
            renderLibraryRail(featured, 'Videos destacados', "<i class='fas fa-clapperboard'></i>", false, {
                className: `featured-rail featured-rail--${edition.theme}`,
                eyebrow: `Edición ${edition.edition}`,
                hint: 'Selección rotativa · sin repetir Inicio',
                showControls: true
            });
        }
        const recentArtists = [...new Set(taste.plays.map(item => String(item.artist || '').trim()).filter(Boolean))].slice(0, 10);
        if (recentArtists.length) {
            const artistItems = recentArtists.map(artist => {
                const lastPlay = taste.plays.find(p => String(p.artist || '').trim() === artist);
                return { title: artist, artist: 'Artista escuchado recientemente', img: lastPlay?.img || 'assets/nowarfy-icon-512.png', url: artist, type: 'search_trigger', query: artist };
            });
            renderDeferredHomeRail(artistItems, 'Tus artistas recientes', "<i class='fas fa-microphone-lines'></i>", false, { hint: 'Basado en tu historial · tocá para buscar más', showControls: true, className: 'home-artists-rail' });
        }

        const recentVideos = uniqueMediaByUrl(taste.plays.map(normalizeTasteTrack).filter(item => item && (item.type === 'yt' || item.type === 'freevideo')), 3);
        if (recentVideos.length) renderDeferredHomeRail(recentVideos, 'Últimos videos reproducidos', "<i class='fas fa-clock-rotate-left'></i>", false, { hint: 'Búsquedas y playlists · los 3 más recientes', showControls: true, className: 'home-mobile-recent-rail' });
        const resume = takeNovelItems(taste.plays.map(normalizeTasteTrack).filter(Boolean), used, 8);
        if (resume.length) renderDeferredHomeRail(resume, 'Seguí desde donde quedaste', "<i class='fas fa-clock-rotate-left'></i>", false, { hint: 'Tu actividad reciente · sin repetir en otras sesiones', showControls: true, className: 'home-resume-rail' });
        const musicVideos = takeNovelItems(musicalVideoPool(homeMusicVideos), used, 8);
        if (musicVideos.length >= 3) renderDeferredHomeRail(musicVideos, 'Música para escuchar', "<i class='fab fa-youtube'></i>", false, { hint: 'Videoclips nuevos · sin repetir las sesiones anteriores', showControls: true });
        const playlists = takeNovelItems(homePlaylists.filter(hasUsablePlaylistItems), used, 12);
        if (playlists.length >= 2) renderDeferredHomeRail(playlists, 'Listas y álbumes', "<i class='fas fa-layer-group'></i>", true, { hint: 'Colecciones diferentes para seguir explorando', showControls: true });
        const freeMusic = takeNovelItems(homeMusic, used, 12);
        if (freeMusic.length >= 2) renderDeferredHomeRail(freeMusic, 'Música libre disponible', "<i class='fas fa-headphones'></i>", false, { hint: 'Audio con carátula y licencia · sin repetir videos', showControls: true });
        if (!resume.length && !recommended.length && !featured.length && !musicVideos.length && !playlists.length && !freeMusic.length) renderEmptyState('No hay opciones disponibles ahora', 'Probá recargar dentro de unos segundos o buscá un artista.');
        setTimeout(() => { initScrollAssemblyEngine(); observeScrollAssembly(); }, 40);
    });
}

function initNowarfyHistory() {
    const root = { nowarfy: true, view: 'home', root: true };
    const guard = { nowarfy: true, view: 'home', guard: true };
    history.replaceState(root, '', window.location.href);
    history.pushState(guard, '', window.location.href);
    nowarfyLastHistoryState = guard;
}

function pushNowarfyHistory(view, data = {}) {
    if (nowarfyRestoringHistory) return;
    const next = { nowarfy: true, view, ...data };
    const current = history.state;
    const sameRoute = current?.nowarfy && current.view === next.view &&
        (current.query || '') === (next.query || '') &&
        (current.section || '') === (next.section || '') &&
        (current.channelId || '') === (next.channelId || '') &&
        (current.playlistId || '') === (next.playlistId || '');
    nowarfyLastHistoryState = next;
    if (!sameRoute) history.pushState(next, '', window.location.href);
}

function closeNowarfyBackOverlays() {
    let closed = false;
    const sidebar = document.querySelector('.sidebar');
    if (sidebar?.classList.contains('mobile-nav-open')) { closeNowarfyMobileNav(); closed = true; }
    const authModal = document.getElementById('nowarfyAuthModal');
    if (authModal && !authModal.hidden) { closeNowarfyAuth(); closed = true; }
    const qrModal = document.getElementById('nowarfyQrModal');
    if (qrModal && !qrModal.hidden) { closeNowarfyQr(); closed = true; }
    const devicePicker = document.getElementById('nowarfyDevicePicker');
    if (devicePicker && !devicePicker.hidden) { devicePicker.hidden = true; closed = true; }
    const queuePanel = document.getElementById('queuePanel');
    if (queuePanel?.classList.contains('open')) { queuePanel.classList.remove('open'); closed = true; }
    const videoStage = document.getElementById('videoStage');
    if (videoStage?.classList.contains('visible') && isVisualVideo(currentQueueSong?.())) {
        setVideoStageMinimized(true);
        closed = true;
    }
    return closed;
}

async function restoreNowarfyHistory(state) {
    if (!state?.nowarfy || nowarfyRestoringHistory) return;
    nowarfyRestoringHistory = true;
    nowarfyLastHistoryState = state;
    try {
        if (state.view === 'home') await resetView({ fromHistory: true });
        else if (state.view === 'section') await showSection(state.section || 'home', { fromHistory: true });
        else if (state.view === 'search') {
            searchInput.value = state.query || '';
            searchClearBtn.classList.toggle('show', !!state.query);
            channelFilter = state.channelId ? { id: state.channelId, title: state.channelTitle || '' } : null;
            await performSmartSearch(state.query || '', { fromHistory: true });
        } else if (state.view === 'channel') {
            await loadChannelProfile(state.channelId, state.channelTitle || '');
        } else if (state.view === 'playlist') {
            await openPlaylist(state.playlist, { fromHistory: true });
        } else if (state.view === 'queue') openQueueFromSidebar({ fromHistory: true });
        else if (state.view === 'player') showFloatingPlayer({ fromHistory: true });
        else await resetView({ fromHistory: true });
    } finally {
        nowarfyRestoringHistory = false;
    }
}

window.addEventListener('popstate', event => {
    if (closeNowarfyBackOverlays()) {
        history.pushState(nowarfyLastHistoryState || { nowarfy: true, view: 'home' }, '', window.location.href);
        return;
    }
    if (event.state?.nowarfy) void restoreNowarfyHistory(event.state);
});

function activateNavigation(section) {
    closeNowarfyMobileNav();
    document.querySelectorAll('.nav-links li').forEach(item => item.classList.remove('active'));
    const primarySection = ['favorites', 'history', 'taste', 'playlists', 'queue'].includes(section) ? 'library' : section;
    document.querySelector(`[data-nav="${primarySection}"]`)?.classList.add('active');
}

async function ensureHomeCatalog() {
    if (homeFeedLoaded) return true;
    if (homeFeedLoading) return false;
    homeFeedLoading = true;
    const loader = document.getElementById('loader');
    const container = document.getElementById('dynamicSections');
    loader.style.display = 'flex';
    container.innerHTML = '';
    try {
        const hasContent = await loadHomeCatalogSources();
        homeFeedLoaded = hasContent;
        if (!hasContent) renderEmptyState('No pudimos cargar el catálogo', 'Probá buscar un artista o recargá dentro de unos segundos.');
        return hasContent;
    } finally {
        homeFeedLoading = false;
        loader.style.display = 'none';
    }
}

function openDiscoveryCollection(collection) {
    minimizeActiveVideoForNavigation();
    searchInput.value = collection.query;
    searchClearBtn.classList.add('show');
    channelFilter = null;
    performSmartSearch(collection.query);
}

function renderDiscoveryCards(title, intro, collections) {
    const container = document.getElementById('dynamicSections');
    container.innerHTML = '';
    currentList = [];
    const heading = document.createElement('div');
    heading.innerHTML = `<div class="section-title"><i class="fas fa-compass"></i> ${escapeHtml(title)}</div><p class="discovery-intro">${escapeHtml(intro)}</p>`;
    const grid = document.createElement('div');
    grid.className = 'discovery-grid';
    collections.forEach(collection => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'discovery-card';
        card.innerHTML = `<span class="discovery-card-icon"><i class="fas ${escapeHtml(collection.icon)}"></i></span><h3>${escapeHtml(collection.title)}</h3><p>${escapeHtml(collection.description)}</p>`;
        card.onclick = () => openDiscoveryCollection(collection);
        grid.appendChild(card);
    });
    container.appendChild(heading);
    container.appendChild(grid);
}

function channelEntityFromTaste(channel) {
    return {
        ...channel,
        url: channel.id,
        type: 'yt',
        resourceKind: 'youtube#channel',
        channelId: channel.id,
        channelTitle: channel.title,
        artist: 'Canal de YouTube'
    };
}
function channelStableKey(channel) {
    return String(channel?.channelId || channel?.id || channel?.url || '').trim();
}
function renderChannelHistoryRail() {
    const history = readTaste().channels
        .slice()
        .sort((a, b) => Number(b.at || 0) - Number(a.at || 0))
        .map(channelEntityFromTaste);
    const channels = itemsWithArtwork(uniqueMediaByUrl(history, 30));
    if (!channels.length) return false;
    const container = document.getElementById('dynamicSections');
    const section = document.createElement('section');
    section.className = 'library-rail-section channel-history-rail';
    section.innerHTML = `<div class="library-rail-title"><i class="fas fa-clock-rotate-left"></i><span>Últimos canales abiertos</span><span class="library-rail-hint">Historial · desplazá hacia la izquierda</span></div>`;
    const rail = document.createElement('div');
    rail.className = 'library-rail';
    channels.forEach((channel, index) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'card playlist-card library-card';
        card.innerHTML = `<div class="card-img-wrap"><span class="playlist-source-badge"><i class="fas fa-satellite-dish"></i> Canal</span><img src="${escapeHtml(channel.img || '')}" class="card-img loaded" loading="lazy" alt="" onerror="removeCardForMissingArtwork(this)"></div><div class="playlist-open"><i class="fas fa-arrow-up-right-from-square"></i> Abrir canal</div><div class="card-title">${escapeHtml(channel.title)}</div>${descriptionExcerpt(channel.description) ? `<p class="card-summary">${escapeHtml(descriptionExcerpt(channel.description))}</p>` : ''}`;
        card.style.animationDelay = `${Math.min(index * 0.03, 0.5)}s`;
        card.onclick = () => browseChannel(channel.id, channel.title);
        rail.appendChild(card);
    });
    section.appendChild(rail);
    container.appendChild(section);
    return true;
}
async function renderGlobalChannelRail(title, hint, { styleKey = '', limit = 24, seen = null } = {}) {
    const channels = await reserveGetGlobalCandidates({ source: 'youtube', kind: 'youtube#channel', styleKey, scope: 'search', limit });
    const visible = itemsWithArtwork(uniqueMediaByUrl(channels, limit)).filter(channel => {
        const key = channelStableKey(channel);
        if (!seen || !key) return true;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    if (!visible.length) return 0;
    renderChannelRow(visible, title, hint);
    return visible.length;
}
async function renderGenreChannels() {
    const container = document.getElementById('dynamicSections');
    const loader = document.getElementById('loader');
    container.innerHTML = '';
    currentList = [];
    loader.style.display = 'flex';
    try {
        const heading = document.createElement('div');
        heading.innerHTML = `<div class="section-title"><i class="fas fa-satellite-dish"></i> Canales</div><p class="discovery-intro">Canales reales organizados por historial, escucha actual y escenas musicales. Abrí uno para ver su descripción, estadísticas, listas y videos publicados.</p>`;
        container.appendChild(heading);
        const hasHistory = renderChannelHistoryRail();
        const globalChannels = await loadGlobalChannelCatalog({ reset: true });
        renderGlobalChannelLibrary();
        const renderedChannelKeys = new Set([
            ...readTaste().channels.map(channelStableKey),
            ...(globalChannels?.items || []).map(channelStableKey)
        ].filter(Boolean));
        const seed = currentList[0] || queue.find(item => item?._qid === currentPlayingQid) || homeVideos[0] || homeMusicVideos[0] || { title: getTasteSeed(), artist: getTasteSeed(), genre: currentMood || 'rock metal' };
        const relatedStyle = getRadioStyle(seed);
        let rendered = hasHistory ? 1 : 0;
        rendered += globalChannels?.items?.length || 0;
        rendered += await renderGlobalChannelRail(`Canales relacionados · ${relatedStyle}`, 'Según tu escucha actual y la reserva global', { styleKey: relatedStyle, limit: 24, seen: renderedChannelKeys });
        const settled = await Promise.allSettled(GENRE_CHANNEL_LISTS.map(async collection => {
            const saved = await reserveGetGlobalCandidates({ source: 'youtube', kind: 'youtube#channel', styleKey: collection.styleKey, scope: 'search', limit: 24 });
            if (saved.length >= 6) return saved;
            const fresh = await fetchYouTubeSearch(collection.query, 'channel', { maxResults: 8, reserveContext: 'channels' });
            return uniqueMediaByUrl([...saved, ...fresh.filter(item => item?.resourceKind === 'youtube#channel')], 24);
        }));
        settled.forEach((result, index) => {
            const channels = result.status === 'fulfilled' ? itemsWithArtwork(uniqueMediaByUrl(result.value, 24)).filter(channel => {
                const key = channelStableKey(channel);
                if (!key || renderedChannelKeys.has(key)) return false;
                renderedChannelKeys.add(key);
                return true;
            }) : [];
            if (!channels.length) return;
            rendered += channels.length;
            renderChannelRow(channels, GENRE_CHANNEL_LISTS[index].title, GENRE_CHANNEL_LISTS[index].description);
        });
        if (!rendered) renderEmptyState('No hay canales disponibles ahora', 'Probá volver a intentarlo cuando YouTube vuelva a responder o buscá un canal por nombre.');
    } finally {
        loader.style.display = 'none';
    }
}

async function loadGlobalPlaylistCatalog({ reset = false } = {}) {
    if (reset || !globalPlaylistCatalogState) {
        globalPlaylistCatalogState = { offset: 0, limit: 24, items: [], total: null, loading: false, done: false };
    }
    const state = globalPlaylistCatalogState;
    if (state.loading || state.done) return state;
    state.loading = true;
    try {
        const page = await reserveGetGlobalCandidates({ kind: 'playlist', scope: 'search', limit: state.limit, offset: state.offset });
        const localPage = state.offset === 0 ? await reserveGetLocalCandidates({ kind: 'playlist' }) : [];
        const combinedPage = [...page, ...localPage];
        const seen = new Set(state.items.map(item => reserveCandidateKey(item) || item.url));
        combinedPage.forEach(item => {
            const key = reserveCandidateKey(item) || item.url;
            if (!key || seen.has(key) || !hasUsablePlaylistItems(item)) return;
            seen.add(key);
            state.items.push({ ...item, type: 'yt', resourceKind: 'youtube#playlist', isPlaylist: true });
        });
        state.offset += page.length;
        const globalTotal = Number.isFinite(Number(page.total)) ? Number(page.total) : null;
        state.total = globalTotal === null ? Math.max(state.items.length, 0) : Math.max(globalTotal, state.items.length);
        state.done = page.length < state.limit || (globalTotal !== null && state.offset >= globalTotal);
    } catch (_) {
        state.done = true;
    } finally {
        state.loading = false;
    }
    return state;
}

function renderGlobalPlaylistLibrary() {
    const container = document.getElementById('dynamicSections');
    const state = globalPlaylistCatalogState;
    if (!container || !state) return;
    container.querySelector('[data-global-playlists]')?.remove();
    const playlists = itemsWithArtwork(uniqueMediaByUrl(state.items, 140)).filter(hasUsablePlaylistItems);
    if (!playlists.length) return;
    const section = document.createElement('section');
    section.dataset.globalPlaylists = 'true';
    section.className = 'global-playlists-section';
    const total = Number.isFinite(state.total) ? ` · ${formatCompactNumber(state.total)} recuperadas` : '';
    section.innerHTML = `<div class="section-title"><i class="fas fa-layer-group"></i> Listas de reproducción globales${escapeHtml(total)} <span class="library-rail-hint">Catálogo compartido · se alimenta con cada búsqueda e interacción</span></div>`;
    const grid = document.createElement('div');
    grid.className = 'grid';
    playlists.forEach((playlist, index) => grid.appendChild(buildPlaylistCard(playlist, index)));
    section.appendChild(grid);
    if (!state.done) {
        const wrap = document.createElement('div');
        wrap.className = 'catalog-more-wrap';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'catalog-more';
        button.innerHTML = '<i class="fas fa-plus"></i> Cargar más listas globales';
        button.onclick = async () => {
            button.disabled = true;
            button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cargando listas...';
            await loadGlobalPlaylistCatalog();
            renderGlobalPlaylistLibrary();
        };
        wrap.appendChild(button);
        section.appendChild(wrap);
    }
    container.appendChild(section);
}

async function loadGlobalChannelCatalog({ reset = false } = {}) {
    if (reset || !globalChannelCatalogState) {
        globalChannelCatalogState = { offset: 0, limit: 24, items: [], total: null, loading: false, done: false };
    }
    const state = globalChannelCatalogState;
    if (state.loading || state.done) return state;
    state.loading = true;
    try {
        const page = await reserveGetGlobalCandidates({ kind: 'channel', scope: 'search', limit: state.limit, offset: state.offset });
        const localPage = state.offset === 0 ? await reserveGetLocalCandidates({ kind: 'channel' }) : [];
        const combinedPage = [...page, ...localPage];
        const seen = new Set(state.items.map(item => reserveCandidateKey(item) || item.url));
        combinedPage.forEach(item => {
            const key = reserveCandidateKey(item) || item.url;
            if (!key || seen.has(key)) return;
            seen.add(key);
            state.items.push({ ...item, type: 'yt', resourceKind: 'youtube#channel', channelId: item.channelId || item.sourceId || item.url, channelTitle: item.channelTitle || item.title });
        });
        state.offset += page.length;
        const globalTotal = Number.isFinite(Number(page.total)) ? Number(page.total) : null;
        state.total = globalTotal === null ? Math.max(state.items.length, 0) : Math.max(globalTotal, state.items.length);
        state.done = page.length < state.limit || (globalTotal !== null && state.offset >= globalTotal);
    } catch (_) {
        state.done = true;
    } finally {
        state.loading = false;
    }
    return state;
}

function renderGlobalChannelLibrary() {
    const container = document.getElementById('dynamicSections');
    const state = globalChannelCatalogState;
    if (!container || !state) return;
    const oldSection = container.querySelector('[data-global-channels]');
    const nextSibling = oldSection?.nextSibling || null;
    oldSection?.remove();
    const channels = itemsWithArtwork(uniqueMediaByUrl(state.items, 140));
    if (!channels.length) return;
    const previousCount = container.children.length;
    renderChannelRow(channels, 'Canales globales recuperados', 'Catálogo compartido · se alimenta con cada búsqueda e interacción');
    const section = container.children[previousCount];
    if (!section) return;
    if (nextSibling?.parentNode === container) container.insertBefore(section, nextSibling);
    section.dataset.globalChannels = 'true';
    const total = Number.isFinite(state.total) ? ` · ${formatCompactNumber(state.total)} recuperados` : '';
    const title = section.querySelector('.section-title');
    if (title) title.innerHTML = `<i class="fas fa-satellite-dish"></i> Canales globales${escapeHtml(total)} <span class="library-rail-hint">Catálogo compartido · se alimenta con cada búsqueda e interacción</span>`;
    if (!state.done) {
        const wrap = document.createElement('div');
        wrap.className = 'catalog-more-wrap';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'catalog-more';
        button.innerHTML = '<i class="fas fa-plus"></i> Cargar más canales globales';
        button.onclick = async () => {
            button.disabled = true;
            button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cargando canales...';
            await loadGlobalChannelCatalog();
            renderGlobalChannelLibrary();
        };
        wrap.appendChild(button);
        section.appendChild(wrap);
    }
}

function renderExploreCollections() {
    navigateWithTransition(() => {
        renderDiscoveryCards('Explorar', 'Elegí una colección para ejecutar una búsqueda real y ver resultados nuevos, sin reciclar los mismos videos de Inicio.', EXPLORE_COLLECTIONS);
        const container = document.getElementById('dynamicSections');
        const filters = document.createElement('div');
        filters.className = 'section-filter-row';
        filters.innerHTML = `<span class="section-filter-label">Ver también</span>
            <button type="button" class="section-filter-btn is-active" onclick="showSection('explore')"><i class="fas fa-compass"></i> Todo</button>
            <button type="button" class="section-filter-btn" onclick="showSection('music')"><i class="fas fa-headphones"></i> Música</button>
            <button type="button" class="section-filter-btn" onclick="showSection('videos')"><i class="fas fa-clapperboard"></i> Videos</button>
            <button type="button" class="section-filter-btn" onclick="showSection('channels')"><i class="fas fa-satellite-dish"></i> Canales</button>
            <button type="button" class="section-filter-btn" onclick="showSection('playlists')"><i class="fas fa-list-ul"></i> Listas</button>`;
        container.insertBefore(filters, container.children[1] || null);
    });
}

function renderLibraryHub() {
    navigateWithTransition(() => {
        const container = document.getElementById('dynamicSections');
        container.innerHTML = `<div class="section-title"><i class="fas fa-book-open"></i> Biblioteca</div>
            <p class="discovery-intro">Todo lo que guardaste, escuchaste o estás preparando, en un solo lugar.</p>
            <div class="library-hub-grid">
                <button type="button" class="library-hub-card" data-library-target="favorites"><i class="fas fa-heart"></i><strong>Favoritos</strong><span>Tus canciones guardadas</span></button>
                <button type="button" class="library-hub-card" data-library-target="history"><i class="fas fa-clock-rotate-left"></i><strong>Historial</strong><span>Volvé a lo que escuchaste</span></button>
                <button type="button" class="library-hub-card" data-library-target="playlists"><i class="fas fa-list-ul"></i><strong>Listas</strong><span>Álbumes y playlists</span></button>
                <button type="button" class="library-hub-card" data-library-target="queue"><i class="fas fa-list-music"></i><strong>Playlist actual</strong><span>Lo que sigue reproduciéndose</span></button>
                <button type="button" class="library-hub-card" data-library-target="taste"><i class="fas fa-shield-halved"></i><strong>Tus datos</strong><span>Privacidad y personalización</span></button>
            </div>`;
        container.querySelectorAll('[data-library-target]').forEach(card => {
            card.addEventListener('click', () => card.dataset.libraryTarget === 'queue' ? openQueueFromSidebar() : showSection(card.dataset.libraryTarget));
        });
    });
}

async function appendFreeMusicCollections() {
    const settled = await Promise.allSettled(FREE_MUSIC_COLLECTIONS.map(collection => fetchFreeMusicCollection(collection)));
    const rows = settled.map((result, index) => ({ collection: FREE_MUSIC_COLLECTIONS[index], tracks: result.status === 'fulfilled' ? result.value : [] }))
        .filter(row => row.tracks.length);
    rows.forEach(({ collection, tracks }) => {
        renderLibraryRail(tracks, collection.title, `<i class="fas ${collection.icon}"></i>`, false, {
            hint: `${collection.description} · Openverse · 5 visibles`, showControls: true, className: 'free-music-rail'
        });
    });
    return rows.flatMap(row => row.tracks);
}

async function appendFreeVideoCollections() {
    const settled = await Promise.allSettled(FREE_VIDEO_COLLECTIONS.map(collection => fetchCommonsVideos(collection.query, 12)));
    const rows = settled.map((result, index) => ({ collection: FREE_VIDEO_COLLECTIONS[index], videos: result.status === 'fulfilled' ? result.value : [] }))
        .filter(row => row.videos.length);
    rows.forEach(({ collection, videos }) => {
        renderLibraryRail(videos, collection.title, `<i class="fas ${collection.icon}"></i>`, false, {
            hint: `${collection.description} · Wikimedia Commons · 5 visibles`, showControls: true, className: 'free-video-rail'
        });
    });
    return rows.flatMap(row => row.videos);
}

async function renderVideosSection({ silent = false } = {}) {
    const ready = await ensureHomeCatalog();
    reviewVideoClassification();
    if (!ready) return;
    const container = document.getElementById('dynamicSections');
    container.innerHTML = '';
    document.getElementById('loader').style.display = 'none';
    const allYouTubeVideos = uniqueMediaByUrl([...(homeVideos || []), ...(homeMusicVideos || [])], 160);
    const musicalVideos = musicalVideoPool(allYouTubeVideos, 120);
    const nonMusicalVideos = nonMusicalVideoPool(allYouTubeVideos, 120);
    currentList = [...musicalVideos, ...nonMusicalVideos];
    if (musicalVideos.length) renderGrid(musicalVideos, 'Videos musicales', "<i class='fab fa-youtube'></i>");
    if (nonMusicalVideos.length) renderGrid(nonMusicalVideos, 'Videos no musicales · descubrimientos', "<i class='fas fa-clapperboard'></i>");
    const freeVideos = await appendFreeVideoCollections();
    currentList = uniqueMediaByUrl([...currentList, ...freeVideos], 160);
    if (!musicalVideos.length && !nonMusicalVideos.length && !freeVideos.length) renderEmptyState('No hay videos disponibles ahora', 'Probá buscar un artista o tema.');
    if (!silent && nonMusicalVideos.length) showToast(`${nonMusicalVideos.length} videos quedaron en "No musicales"`, 'fa-filter');
}

scheduleVideoClassificationReview();

function renderPlaybackHistory() {
    const taste = readTaste();
    const playable = taste.plays.filter(item => item?.url && item?.type);
    navigateWithTransition(() => {
        const container = document.getElementById('dynamicSections');
        container.innerHTML = '';
        document.getElementById('loader').style.display = 'none';
        if (!taste.plays.length) {
            renderEmptyState('Todavía no hay reproducciones guardadas', 'Lo que escuches o mires desde ahora aparecerá acá, solo en este dispositivo.');
            return;
        }
        if (playable.length) {
            currentList = playable;
            renderGrid(playable, 'Historial de reproducción', "<i class='fas fa-clock-rotate-left'></i>");
        } else {
            renderEmptyState('Tu historial ya está guardado', 'Las nuevas reproducciones conservarán también su enlace para poder volver a abrirlas desde acá.');
        }
    });
}

function openQueueFromSidebar(options = {}) {
    pushNowarfyHistory('queue');
    minimizeActiveVideoForNavigation();
    activeBrowseMode = 'queue';
    activateNavigation('queue');
    const panel = document.getElementById('queuePanel');
    if (!panel.classList.contains('open')) toggleQueuePanel();
    else renderQueue();
}

function showFloatingPlayer(options = {}) {
    pushNowarfyHistory('player');
    minimizeActiveVideoForNavigation();
    activeBrowseMode = 'player';
    activateNavigation('player');
    if (!isFloating) toggleFloatingMode();
    document.getElementById('playerBar').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function minimizeActiveVideoForNavigation() {
    const song = currentQueueSong();
    if (isVisualVideo(song)) setVideoStageMinimized(true, { autoReason: 'navigation' });
}

async function showSection(section, options = {}) {
    pushNowarfyHistory('section', { section });
    minimizeActiveVideoForNavigation();
    activeBrowseMode = section;
    activateNavigation(section);
    
    if (section === 'library') { renderLibraryHub(); return; }
    if (section === 'favorites') {
        navigateWithTransition(() => {
            document.getElementById('dynamicSections').innerHTML = '';
            document.getElementById('loader').style.display = 'none';
            currentList = favorites;
            if (favorites.length === 0) renderEmptyState('Todavía no tenés favoritos', 'Tocá el corazón de una canción para guardarla acá.');
            else renderGrid(favorites, 'Tus Favoritos', "<i class='fas fa-heart'></i>");
        });
        return;
    }
    if (section === 'history') { renderPlaybackHistory(); return; }
    if (section === 'taste') { renderTasteData(); return; }

    if (section === 'explore') { renderExploreCollections(); return; }
    if (section === 'channels') { await renderGenreChannels(); return; }
    const ready = await ensureHomeCatalog();
    if (!ready) return;
    const container = document.getElementById('dynamicSections');
    container.innerHTML = '';
    if (section === 'playlists') {
        currentList = [];
        const savedPlaylists = readTaste().playlists.map(item => ({
            url: item.id, title: item.title, artist: item.artist || 'YouTube', img: item.img || '',
            description: item.description || '', channelId: item.channelId || '', type: 'playlist', resourceKind: 'youtube#playlist', isPlaylist: true, itemCount: item.itemCount ?? null
        }));
        await loadGlobalPlaylistCatalog({ reset: true });
        navigateWithTransition(() => {
            renderGlobalPlaylistLibrary();
            if (savedPlaylists.length) renderPlaylistGrid(savedPlaylists, 'Listas abiertas anteriormente');
            if (homePlaylists.length) renderPlaylistGrid(homePlaylists, savedPlaylists.length ? 'Listas sugeridas para explorar' : 'Listas destacadas');
            if (!globalPlaylistCatalogState?.items.length && !savedPlaylists.length && !homePlaylists.length) renderEmptyState('No hay listas disponibles ahora', 'Probá buscar el nombre de un artista o álbum.');
        });
        return;
    }
    if (section === 'videos') {
        await renderVideosSection();
        return;
    }
    if (section === 'music') {
        const expandedFreeMusic = await appendFreeMusicCollections();
        navigateWithTransition(() => {
            currentList = [...homeMusicVideos, ...homeMusic];
            if (homeMusicVideos.length) renderGrid(homeMusicVideos, 'Música de YouTube', "<i class='fab fa-youtube'></i>");
            if (homeMusic.length) renderGrid(homeMusic, 'Música libre complementaria', "<i class='fas fa-headphones'></i>");
            currentList = uniqueMediaByUrl([...homeMusicVideos, ...homeMusic, ...expandedFreeMusic], 140);
            if (!homeMusicVideos.length && !homeMusic.length && !expandedFreeMusic.length) renderEmptyState('No hay música disponible ahora', 'Probá buscar un artista o tema.');
        });
    }
}

function renderEmptyState(title, subtitle) {
    const container = document.getElementById('dynamicSections');
    container.innerHTML = `<div class="empty-state">
        <i class="fas fa-record-vinyl"></i>
        <strong>${escapeHtml(title)}</strong>
        ${subtitle ? `<span>${escapeHtml(subtitle)}</span>` : ''}
    </div>`;
}

function renderYouTubeSearchResults(list, query) {
    const channels = list.filter(result => result.resourceKind === 'youtube#channel');
    const playlists = list.filter(result => result.resourceKind === 'youtube#playlist' && hasUsablePlaylistItems(result)).map((item, index) => ({ ...item, sourceIndex: index }));
    const videos = list.filter(result => result.resourceKind === 'youtube#video').map((item, index) => ({ ...item, sourceIndex: index }));

    if (!channels.length && !playlists.length && !videos.length) {
        renderEmptyState(`Sin resultados para "${query}"`);
        return;
    }

    currentList = videos;
    const container = document.getElementById('dynamicSections');
    container.innerHTML = '';

    if (channelFilter) {
        const chip = document.createElement('div');
        chip.innerHTML = `<div class="channel-filter-chip">
            <i class="fas fa-satellite-dish"></i>
            <span>Viendo canal: ${escapeHtml(channelFilter.title)}</span>
            <button type="button" onclick="clearChannelFilter()" aria-label="Quitar filtro de canal"><i class="fas fa-xmark"></i></button>
        </div>`;
        container.appendChild(chip);
    }

    if (channels.length) renderChannelRow(channels, channelFilter ? 'Canales relacionados' : `Canales: "${query}"`);
    if (playlists.length) renderPlaylistGrid(playlists, channelFilter ? 'Listas de reproducción del canal' : `Listas y álbumes: "${query}"`);
    if (videos.length) renderGrid(videos, channelFilter ? 'Videos y música del canal' : `Videos individuales: "${query}"`, "<i class='fas fa-clapperboard'></i>");
}

function renderChannelRow(channels, title, hint = 'Canales encontrados en YouTube') {
    const visibleChannels = itemsWithArtwork(channels);
    if (!visibleChannels.length) return;
    const container = document.getElementById('dynamicSections');
    const section = document.createElement('div');
    section.innerHTML = `<div class="section-title"><i class="fas fa-satellite-dish"></i> ${escapeHtml(title)} <span class="library-rail-hint">${escapeHtml(hint)}</span></div>`;
    const scroll = document.createElement('div');
    scroll.className = 'channel-scroll';

    visibleChannels.forEach(ch => {
        const chip = document.createElement('div');
        chip.className = 'channel-chip';
        chip.innerHTML = `
            <div class="channel-avatar-wrap">
                <img src="${escapeHtml(ch.img || '')}" alt="" loading="lazy" onerror="this.closest('.channel-chip').remove();">
                <span class="channel-badge"><i class="fas fa-play"></i></span>
            </div>
            <span class="channel-chip-title">${escapeHtml(ch.title)}</span>
            <span class="channel-chip-desc">Canal</span>`;
        chip.onclick = () => browseChannel(ch.url, ch.title);
        scroll.appendChild(chip);
    });

    section.appendChild(scroll);
    container.appendChild(section);
}

function renderSongList(list, title, icon, options = {}) {
    const visibleSongs = itemsWithArtwork(list);
    if (!visibleSongs.length) return;
    const container = document.getElementById('dynamicSections');
    const section = document.createElement('div');
    if (!options.skipTitle) {
        section.innerHTML = `<div class="section-title">${icon} ${escapeHtml(title)}</div>`;
    }
    const songList = document.createElement('div');
    songList.className = 'song-list';

    visibleSongs.forEach((song, idx) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'song-row';
        row.dataset.idx = song.sourceIndex ?? idx;
        const artistClickable = !!song.channelId;
        row.innerHTML = `
            <span class="song-row-number">${idx + 1}</span>
            <img src="${escapeHtml(song.img || '')}" class="song-row-img" loading="lazy" alt="" onerror="this.closest('.song-row').remove();">
            <span class="song-row-details">
                <span class="song-row-title" title="${escapeHtml(song.title)}">${escapeHtml(song.title)}</span>
                <span class="song-row-artist${artistClickable ? ' artist-link' : ''}">${escapeHtml(song.artist)}</span>
                ${descriptionExcerpt(song.description, 92) ? `<span class="song-row-summary" title="${escapeHtml(song.description)}">${escapeHtml(descriptionExcerpt(song.description, 92))}</span>` : ''}
            </span>
            <span class="song-row-actions">
                <span class="song-row-duration">${formatContentDuration(song.duration)}</span>
                <button type="button" class="song-row-addq song-row-favorite${isFavoriteSong(song) ? ' active' : ''}" title="Guardar en favoritos" aria-label="Guardar en favoritos"><i class="${isFavoriteSong(song) ? 'fas' : 'far'} fa-heart"></i></button>
                <button type="button" class="song-row-addq" title="Agregar a Playlist" aria-label="Agregar a Playlist"><i class="fas fa-list"></i></button>
                <i class="fas fa-play song-row-play" aria-hidden="true"></i>
            </span>`;
        row.onclick = () => selectSong(song, song.sourceIndex ?? idx);
        row.querySelector('.song-row-favorite').onclick = (e) => {
            e.stopPropagation();
            toggleFavoriteSong(song, e.currentTarget);
        };
        row.querySelector('.song-row-addq:not(.song-row-favorite)').onclick = (e) => {
            e.stopPropagation();
            addToQueue(song);
        };
        if (artistClickable) {
            row.querySelector('.song-row-artist').onclick = (e) => {
                e.stopPropagation();
                browseChannel(song.channelId, song.channelTitle || song.artist);
            };
        }
        songList.appendChild(row);
    });

    section.appendChild(songList);
    container.appendChild(section);
}

function renderPlaylistGrid(list, title) {
    const visiblePlaylists = itemsWithArtwork(list).filter(hasUsablePlaylistItems);
    if (!visiblePlaylists.length) return;
    const container = document.getElementById('dynamicSections');
    const section = document.createElement('div');
    section.innerHTML = `<div class="section-title"><i class="fas fa-layer-group"></i> ${escapeHtml(title)}</div>`;
    const grid = document.createElement('div');
    grid.className = 'grid';
    visiblePlaylists.forEach((playlist, idx) => grid.appendChild(buildPlaylistCard(playlist, idx)));
    section.appendChild(grid);
    container.appendChild(section);
}

function returnFromPlaylist() {
    const state = activePlaylistCatalog;
    activePlaylistCatalog = null;
    if (state?.returnMode === 'channel' && activeChannelCatalog?.channel) {
        activeBrowseMode = 'channel';
        renderChannelCatalog();
        return;
    }
    if (state?.returnMode === 'home') { resetView(); return; }
    performSmartSearch(state?.returnQuery || searchQuery || state?.playlist?.title || ROCK_METAL_DISCOVERY_QUERY);
}

function renderOpenedPlaylist() {
    const state = activePlaylistCatalog;
    if (!state) return;
    navigateWithTransition(() => {
        const container = document.getElementById('dynamicSections');
        container.innerHTML = '';
        currentList = state.tracks;

        const hero = document.createElement('div');
        hero.className = 'playlist-hero';
        const total = Number(state.pageInfo?.totalResults || state.tracks.length);
        const countLabel = Number.isFinite(total) && total > 0 ? `${new Intl.NumberFormat('es-UY').format(total)} videos` : 'Lista de reproducción';
        
        hero.innerHTML = `
            <div class="playlist-hero-top">
                <img src="${escapeHtml(state.playlist.img || '')}" class="playlist-hero-img" alt="" onerror="this.src='https://www.gstatic.com/youtube/src/web/htdocs/img/no_thumbnail.jpg'">
                <div class="playlist-hero-info">
                    <span class="playlist-hero-eyebrow">Lista de reproducción</span>
                    <h1 class="playlist-hero-title" title="${escapeHtml(state.playlist.title)}">${escapeHtml(state.playlist.title)}</h1>
                    <div class="playlist-hero-meta">
                        <span class="playlist-hero-artist">${escapeHtml(state.playlist.artist || 'YouTube')}</span>
                        <span class="playlist-hero-sep">·</span>
                        <span>${countLabel}</span>
                    </div>
                </div>
            </div>
            <div class="playlist-hero-actions">
                <button type="button" class="playlist-hero-play" title="Reproducir toda la lista" aria-label="Reproducir toda la lista">
                    <i class="fas fa-play"></i>
                </button>
                <button type="button" class="video-stage-close" style="margin:0; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1);">
                    <i class="fas fa-arrow-left"></i> Volver
                </button>
            </div>`;

        hero.querySelector('.playlist-hero-play').onclick = () => {
            startPrebuiltPlaylistPlayback(state.playlist, state.tracks, state.pageInfo || {}, state.nextPageToken || '');
        };
        hero.querySelector('.video-stage-close').onclick = returnFromPlaylist;
        if (state.playlist.channelId) {
            hero.querySelector('.playlist-hero-artist').onclick = () => browseChannel(state.playlist.channelId, state.playlist.artist);
        }

        container.appendChild(hero);
        renderSongList(state.tracks, `Contenido de la lista`, "<i class='fas fa-list-music'></i>", { skipTitle: true });
        if (state.nextPageToken) addCatalogMore(container, 'Cargar más de esta lista', () => loadMoreOpenPlaylist(state.nextPageToken));
    });
}

function startPrebuiltPlaylistPlayback(playlist, tracks, pageInfo = {}, nextPageToken = '') {
    if (!playlist?.url || !tracks?.length) return false;
    queuePlaybackMode = 'prebuilt_playlist';
    queuePlaylistContext = {
        playlistId: String(playlist.url), title: String(playlist.title || 'Lista de reproducción'),
        artist: String(playlist.artist || playlist.channelTitle || 'YouTube'), img: playlist.img || '',
        channelId: playlist.channelId || '', totalResults: Number(pageInfo.totalResults || tracks.length),
        nextPageToken: String(nextPageToken || ''), nativePlayback: true
    };
    continuousPlayback = true;
    localStorage.setItem(CONTINUOUS_PLAYBACK_STORAGE_KEY, 'true');
    queue = [];
    queueSeenKeys = new Set();
    queueRound = 0;
    appendPrebuiltPlaylistTracks(tracks);
    persistQueueMode();
    persistQueue();
    renderContinuousPlaybackControls();
    renderQueue();
    playQueueAt(0, { sourceIdx: tracks[0].sourceIndex ?? 0, playlistId: String(playlist.url), forceNewYouTubePlayer: true });
    showToast(`Reproduciendo playlist · ${queue.length} videos en orden`, 'fa-list-music');
    return true;
}

async function openPlaylist(playlist, options = {}) {
    minimizeActiveVideoForNavigation();
    if (playlist?.url) {
        void reserveDiscoveredCandidates([{ ...playlist, type: 'yt', resourceKind: 'youtube#playlist', isPlaylist: true }], {
            context: 'playlist_open',
            queryContext: `playlist:${playlist.url}`
        });
    }
    pushNowarfyHistory('playlist', {
        playlistId: String(playlist?.url || ''),
        playlist: {
            url: String(playlist?.url || ''), title: String(playlist?.title || 'Lista de reproducción'),
            artist: String(playlist?.artist || playlist?.channelTitle || 'YouTube'), img: playlist?.img || '',
            description: playlist?.description || '', channelId: playlist?.channelId || ''
        }
    });
    rememberPlaylist(playlist);
    const loader = document.getElementById('loader');
    const container = document.getElementById('dynamicSections');
    loader.style.display = 'flex';
    container.innerHTML = '';
    try {
        const response = await fetch(`/api/search?type=youtube&action=playlistItems&playlistId=${encodeURIComponent(playlist.url)}&maxResults=24`);
        const data = await response.json();
        if (!response.ok || !data.items?.length) throw new Error('playlist_unavailable');
        const tracks = mapPlaylistVideoItems(data.items, { channelId: playlist.channelId || '', channelTitle: playlist.artist || '', img: playlist.img || '', collectionId: playlist.url, collectionTitle: playlist.title, collectionImg: playlist.img || '' });
        if (!tracks.length) throw new Error('playlist_empty');
        const totalResults = Number(data.pageInfo?.totalResults);
        const hydratedPlaylist = Number.isFinite(totalResults) && totalResults > 0 ? { ...playlist, itemCount: totalResults } : playlist;
        void reserveDiscoveredCandidates(tracks, { context: 'playlist', queryContext: `playlist:${playlist.url}` });
        activePlaylistCatalog = {
            playlist: hydratedPlaylist,
            tracks,
            pageInfo: data.pageInfo || {},
            nextPageToken: data.nextPageToken || '',
            returnMode: activeBrowseMode,
            returnQuery: searchQuery
        };
        if (hydratedPlaylist !== playlist) rememberPlaylist(hydratedPlaylist);
        renderOpenedPlaylist();
        if (options.playNow) startPrebuiltPlaylistPlayback(hydratedPlaylist, tracks, data.pageInfo || {}, data.nextPageToken || '');
    } catch (error) {
        activePlaylistCatalog = null;
        renderEmptyState('No pudimos abrir esta lista', 'La lista puede ser privada, estar vacía o no permitir reproducción. No mostramos videos de otra colección como reemplazo.');
    } finally {
        loader.style.display = 'none';
    }
}

async function loadMoreOpenPlaylist(pageToken) {
    const state = activePlaylistCatalog;
    if (!state?.playlist?.url || !pageToken) return;
    const response = await fetch(`/api/search?type=youtube&action=playlistItems&playlistId=${encodeURIComponent(state.playlist.url)}&pageToken=${encodeURIComponent(pageToken)}&maxResults=24`);
    const data = await response.json();
    if (!response.ok) throw new Error('more_playlist_items_unavailable');
    const nextTracks = mapPlaylistVideoItems(data.items, { channelId: state.playlist.channelId || '', channelTitle: state.playlist.artist || '', img: state.playlist.img || '', collectionId: state.playlist.url, collectionTitle: state.playlist.title, collectionImg: state.playlist.img || '' }, state.tracks.length);
    state.tracks = [...state.tracks, ...nextTracks];
    void reserveDiscoveredCandidates(nextTracks, { context: 'playlist', queryContext: `playlist:${state.playlist.url}` });
    state.pageInfo = data.pageInfo || state.pageInfo;
    state.nextPageToken = data.nextPageToken || '';
    if (queuePlaybackMode === 'prebuilt_playlist' && queuePlaylistContext?.playlistId === String(state.playlist.url)) {
        appendPrebuiltPlaylistTracks(nextTracks);
        queuePlaylistContext.nextPageToken = state.nextPageToken;
        queuePlaylistContext.totalResults = Number(state.pageInfo?.totalResults || queuePlaylistContext.totalResults || state.tracks.length);
        persistQueueMode();
        persistQueue();
        renderQueue();
    }
    renderOpenedPlaylist();
}

function buildMediaCard(song, idx) {
    const div = document.createElement('div');
    div.className = 'card';
    div.dataset.idx = song.sourceIndex ?? idx;
    div.style.animationDelay = `${Math.min(idx * 0.03, 0.5)}s`;
    const artistClickable = !!song.channelId;
    const isFreeVideo = song.type === 'freevideo' || song.resourceKind === 'commons#video';
    const isVideo = song.resourceKind === 'youtube#video' || isFreeVideo;
    const isDirectAudio = song.type === 'mp3';
    const imageErrorAction = "removeCardForMissingArtwork(this)";
    div.classList.toggle('video-card', isVideo);
    div.classList.toggle('audio-card', isDirectAudio);
    div.innerHTML = `
        <div class="card-img-wrap">
            ${isVideo && song.type !== 'search_trigger' ? `<span class="video-source-badge"><i class="fas ${isFreeVideo ? 'fa-leaf' : 'fa-play'}"></i> ${isFreeVideo ? 'Libre' : 'Video'}</span><span class="card-duration">${formatContentDuration(song.duration)}</span>` : ''}
            <div class="skeleton"></div>
            <img src="${escapeHtml(song.img || '')}" class="card-img" width="320" height="180" loading="lazy" decoding="async"
                 onload="this.classList.add('loaded')"
                 onerror="${imageErrorAction}">
            <div class="card-spinner">
                <div class="orbit-spinner" style="--s:26px;--d:5px;"><i></i><i></i><i></i></div>
                <span>Cargando</span>
            </div>
            ${song.type !== 'search_trigger' ? `<button type="button" class="card-favorite${isFavoriteSong(song) ? ' active' : ''}" title="Guardar en favoritos" aria-label="Guardar en favoritos"><i class="${isFavoriteSong(song) ? 'fas' : 'far'} fa-heart"></i></button>
            <div class="card-actions" aria-label="Acciones rápidas">
                <button type="button" class="card-addq" title="Agregar a Playlist" aria-label="Agregar a Playlist"><i class="fas fa-list"></i></button>
                <button type="button" class="play-btn" title="Reproducir" aria-label="Reproducir"><i class="fas fa-play"></i></button>
            </div>` : ''}
        </div>
        <div class="card-title" title="${escapeHtml(song.title)}">${escapeHtml(song.title)}</div>
        <div class="card-desc${artistClickable ? ' artist-link' : ''}">${escapeHtml(song.artist)}</div>
        <div class="card-meta">${escapeHtml(contentMetaLabel(song))}${videoStatsLabel(song) ? `<span class="card-stats">${escapeHtml(videoStatsLabel(song))}</span>` : ''}</div>
        ${descriptionExcerpt(song.description) ? `<p class="card-summary" title="${escapeHtml(song.description)}">${escapeHtml(descriptionExcerpt(song.description))}</p>` : ''}`;
    div.onclick = () => {
        if (song.type === 'search_trigger' && song.query) {
            performSmartSearch(song.query);
            return;
        }
        selectSong(song, song.sourceIndex ?? idx);
    };
    if (song.type !== 'search_trigger') {
        div.querySelector('.card-favorite').onclick = (e) => {
            e.stopPropagation();
            toggleFavoriteSong(song, e.currentTarget);
        };
        div.querySelector('.card-addq').onclick = (e) => {
            e.stopPropagation();
            addToQueue(song);
        };
    }
    if (artistClickable) {
        div.querySelector('.card-desc').onclick = (e) => {
            e.stopPropagation();
            browseChannel(song.channelId, song.channelTitle || song.artist);
        };
    }
    return div;
}

function buildPlaylistCard(playlist, idx) {
    const div = document.createElement('div');
    const count = Number(playlist?.itemCount);
    const hasCount = Number.isFinite(count) && count > 0;
    div.className = 'card playlist-card';
    div.dataset.playlistId = String(playlist?.url || '');
    div.setAttribute('role', 'button');
    div.tabIndex = 0;
    div.setAttribute('aria-label', `Abrir lista ${playlist?.title || 'de YouTube'}`);
    div.style.animationDelay = `${Math.min(idx * 0.03, 0.5)}s`;
    div.innerHTML = `
        <div class="card-img-wrap">
            <span class="playlist-source-badge"><i class="fas fa-list"></i> Lista</span>
            <img src="${escapeHtml(playlist.img || '')}" class="card-img loaded" width="320" height="180" loading="lazy" decoding="async" alt="" onerror="removeCardForMissingArtwork(this)">
            <div class="playlist-card-actions" aria-label="Acciones de la lista">
                <span class="playlist-count-badge" title="Cantidad de videos de la playlist"><i class="fas fa-film"></i> ${hasCount ? `${new Intl.NumberFormat('es-UY').format(count)} videos` : 'Cantidad pendiente'}</span>
                <button type="button" class="playlist-play-btn" title="Reproducir lista completa" aria-label="Reproducir lista completa"><i class="fas fa-play"></i></button>
            </div>
        </div>
        <div class="playlist-open"><i class="fas fa-list-music"></i> Abrir lista de YouTube</div>
        <div class="card-title" title="${escapeHtml(playlist.title)}">${escapeHtml(playlist.title)}</div>
        <div class="card-desc">${escapeHtml(playlist.artist || 'Lista de YouTube')}</div>
        ${descriptionExcerpt(playlist.description) ? `<p class="card-summary" title="${escapeHtml(playlist.description)}">${escapeHtml(descriptionExcerpt(playlist.description))}</p>` : ''}`;
    div.onclick = () => openPlaylist(playlist);
    div.onkeydown = (event) => {
        if (event.target !== div || !['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        openPlaylist(playlist);
    };
    div.querySelector('.playlist-play-btn').onclick = async (event) => {
        event.stopPropagation();
        const button = event.currentTarget;
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        try { await openPlaylist(playlist, { playNow: true }); }
        finally {
            if (button.isConnected) {
                button.disabled = false;
                button.innerHTML = '<i class="fas fa-play"></i>';
            }
        }
    };
    return div;
}

function renderLibraryRail(list, title, icon, isPlaylist = false, options = {}) {
    const visibleItems = itemsWithArtwork(list).filter(item => !isPlaylist || hasUsablePlaylistItems(item));
    if (!visibleItems.length) return;
    const container = document.getElementById('dynamicSections');
    const section = document.createElement('section');
    section.className = `library-rail-section ${options.className || ''}`.trim();
    const eyebrow = options.eyebrow ? `<span class="featured-edition">${escapeHtml(options.eyebrow)}</span>` : '';
    const hint = options.hint || '5 visibles · deslizá para explorar';
    const controls = options.showControls ? `<span class="library-rail-controls"><button type="button" class="library-rail-nav" data-direction="-1" aria-label="Ver videos anteriores"><i class="fas fa-chevron-left"></i></button><button type="button" class="library-rail-nav" data-direction="1" aria-label="Ver más videos"><i class="fas fa-chevron-right"></i></button></span>` : '';
    section.innerHTML = `<div class="library-rail-title">${icon} <span>${escapeHtml(title)}</span>${eyebrow}<span class="library-rail-hint">${escapeHtml(hint)}</span>${controls}</div>`;
    const rail = document.createElement('div');
    rail.className = 'library-rail';
    const batchSize = 5;
    let rendered = 0;
    const appendBatch = () => {
        let nextItems = visibleItems.slice(rendered, rendered + batchSize);
        if (!nextItems.length) {
            nextItems = visibleItems.slice(0, batchSize);
        }
        nextItems.forEach((item, offset) => {
            const index = (rendered + offset) % visibleItems.length;
            const card = isPlaylist ? buildPlaylistCard(item, index) : buildMediaCard(item, index);
            card.classList.add('library-card');
            rail.appendChild(card);
        });
        rendered += nextItems.length;
        return true;
    };
    rail._appendBatch = appendBatch;
    appendBatch();
    rail.addEventListener('scroll', () => {
        const closeToEnd = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 120;
        if (closeToEnd) appendBatch();
    }, { passive: true });
    if (options.showControls) {
        section.querySelectorAll('.library-rail-nav').forEach(button => {
            button.addEventListener('click', () => {
                const direction = Number(button.dataset.direction) || 1;
                rail.scrollBy({ left: direction * Math.max(rail.clientWidth * 0.82, 260), behavior: 'smooth' });
            });
        });
    }
    section.appendChild(rail);
    if (options.mountBefore?.parentNode === container) container.insertBefore(section, options.mountBefore);
    else container.appendChild(section);
    setTimeout(() => { initRailDragScroll(); initAutoMovingCarousels(); }, 20);
}

function renderGrid(list, title, icon) {
    const visibleMedia = itemsWithArtwork(list);
    if (!visibleMedia.length) return;
    const container = document.getElementById('dynamicSections');
    const section = document.createElement('div');
    section.innerHTML = `<div class="section-title">${icon} ${escapeHtml(title)}</div>`;
    const grid = document.createElement('div');
    grid.className = 'grid';
    visibleMedia.forEach((song, idx) => grid.appendChild(buildMediaCard(song, idx)));
    section.appendChild(grid);
    container.appendChild(section);
    setTimeout(() => { if (typeof observeScrollAssembly === 'function') observeScrollAssembly(section); }, 20);
}

function setAmbientArtwork(item, lockToCurrent = false) {
    if (!hasValidArtwork(item)) return false;
    const background = document.getElementById('ambientArtworkBackground');
    if (!background) return false;
    const imageUrl = String(item.img || item.thumbnail || '').trim();
    const probe = new Image();
    probe.onload = () => {
        const safeUrl = imageUrl.replace(/"/g, '%22').replace(/\\/g, '%5C');
        background.style.backgroundImage = `url("${safeUrl}")`;
        background.classList.add('is-visible');
    };
    probe.onerror = () => {};
    probe.src = imageUrl;
    if (lockToCurrent) ambientArtworkLockedToCurrent = true;
    return true;
}

function ambientArtworkCandidates() {
    return uniqueMediaByUrl([
        ...homeRecommended,
        ...homeMusicVideos,
        ...homeVideos,
        ...homeMusic,
        ...homePlaylists
    ], 80).filter(hasValidArtwork);
}

function rotateAmbientArtwork() {
    if (ambientArtworkLockedToCurrent || document.visibilityState !== 'visible') return;
    const candidates = ambientArtworkCandidates();
    if (!candidates.length) return;
    ambientArtworkIndex = (ambientArtworkIndex + 1) % candidates.length;
    setAmbientArtwork(candidates[ambientArtworkIndex]);
}

function refreshAmbientArtworkFromCatalog() {
    if (ambientArtworkLockedToCurrent) return;
    const candidates = ambientArtworkCandidates();
    if (!candidates.length) return;
    ambientArtworkIndex = Math.abs(featuredHash(candidates.map(item => item.url).join('|'))) % candidates.length;
    setAmbientArtwork(candidates[ambientArtworkIndex]);
    if (!ambientArtworkRotationTimer && !nowarfyPageHidden) ambientArtworkRotationTimer = setInterval(rotateAmbientArtwork, 14000);
}

