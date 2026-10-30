// Vista clásica (estilo reproductor de escritorio): comparte el estado y los controles del reproductor.
(function () {
    const STORAGE_KEY = 'nowarfy_classic';
    const BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    const PRESETS = {
        flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        bass: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
        treble: [0, 0, 0, 0, 0, 1, 3, 4, 5, 6],
        rock: [4, 3, 1, -1, -2, -1, 1, 3, 4, 4]
    };
    const $ = (id) => document.getElementById(id);

    // --- Panel on/off ---
    let syncTimer = null;
    function startSyncTimer() {
        if (syncTimer) return;
        syncTimer = window.setInterval(syncDisplay, 500);
    }
    function stopSyncTimer() {
        if (!syncTimer) return;
        window.clearInterval(syncTimer);
        syncTimer = null;
    }

    function setClassic(on) {
        document.body.classList.toggle('mode-classic', on);
        $('classicPanel').hidden = !on;
        $('classicToggle').setAttribute('aria-pressed', String(on));
        $('classicToggle').setAttribute('aria-expanded', String(on));
        try { localStorage.setItem(STORAGE_KEY, on ? '1' : '0'); } catch (_) {}
        if (on) {
            renderPlaylist();
            syncDisplay();
            startSyncTimer();
        } else {
            stopSyncTimer();
        }
    }

    // --- Pantalla: refleja el estado que ya muestra el reproductor ---
    function syncDisplay() {
        if (!$('classicPanel') || $('classicPanel').hidden) return;
        $('classicTitle').textContent = $('currTitle')?.textContent || 'Sin canción';
        $('classicArtist').textContent = $('currArtist')?.textContent || '—';
        $('classicTime').textContent = $('currTime')?.textContent || '0:00';
        $('classicTotalTime').textContent = $('totalTime')?.textContent || '0:00';
        const playing = typeof isPlaying !== 'undefined' && isPlaying;
        document.querySelector('.classic-display')?.classList.toggle('is-playing', !!playing);
        const playButton = $('classicPlayPause');
        playButton.setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir');
        playButton.title = playing ? 'Pausar' : 'Reproducir';
        const playIcon = playButton.querySelector('i');
        if (playIcon) playIcon.className = `fas fa-${playing ? 'pause' : 'play'}`;
        const hasQueue = typeof queue !== 'undefined' && queue.length > 0;
        const canNavigate = hasQueue || !!(nowarfyAuthUser && nowarfyRemoteSession && !nowarfyRemoteIsPlayer && nowarfyRemoteShadowSong);
        playButton.disabled = !currentSong();
        $('classicPrevious').disabled = !canNavigate;
        $('classicNext').disabled = !canNavigate;

        const shuffleButton = $('classicShuffle');
        const shuffled = typeof shuffleMode !== 'undefined' && shuffleMode;
        shuffleButton.classList.toggle('is-active', !!shuffled);
        shuffleButton.setAttribute('aria-pressed', String(!!shuffled));
        shuffleButton.title = shuffled ? 'Desactivar reproducción aleatoria' : 'Activar reproducción aleatoria';

        const favoriteButton = $('classicFavorite');
        const song = currentSong();
        const favorite = !!song && typeof isFavoriteSong === 'function' && isFavoriteSong(song);
        favoriteButton.classList.toggle('is-active', favorite);
        favoriteButton.setAttribute('aria-pressed', String(favorite));
        favoriteButton.title = favorite ? 'Quitar de favoritos' : 'Guardar en favoritos';
        favoriteButton.setAttribute('aria-label', favoriteButton.title);
        const favoriteIcon = favoriteButton.querySelector('i');
        if (favoriteIcon) favoriteIcon.className = `${favorite ? 'fas' : 'far'} fa-heart`;

        const volume = $('volumeSlider');
        if (volume) $('classicVolume').value = volume.value;
    }

    function currentSong() {
        return typeof currentQueueSong === 'function'
            ? currentQueueSong()
            : (typeof queue !== 'undefined' && typeof currentIndex !== 'undefined' ? queue[currentIndex] : null);
    }

    // --- Playlist: la misma cola que ya usa la app ---
    function renderPlaylist() {
        const list = $('classicPlaylist');
        if (!list || $('classicPanel').hidden) return;
        const items = (typeof queue !== 'undefined' && Array.isArray(queue)) ? queue : [];
        const current = typeof currentIndex !== 'undefined' ? currentIndex : -1;
        list.innerHTML = '';
        if (!items.length) {
            const empty = document.createElement('li');
            empty.className = 'classic-empty';
            empty.textContent = 'La playlist está vacía';
            list.appendChild(empty);
            return;
        }
        items.forEach((song, i) => {
            const li = document.createElement('li');
            li.className = i === current ? 'is-current' : '';
            const btn = document.createElement('button');
            btn.type = 'button';
            if (i === current) btn.setAttribute('aria-current', 'true');
            btn.setAttribute('aria-label', `Reproducir ${song?.title || 'Sin título'}${song?.artist ? ` de ${song.artist}` : ''}`);
            const title = document.createElement('span');
            title.className = 'classic-track-title';
            title.textContent = `${i + 1}. ${song?.title || 'Sin título'}`;
            btn.appendChild(title);
            if (song?.artist) {
                const artist = document.createElement('span');
                artist.className = 'classic-track-artist';
                artist.textContent = song.artist;
                btn.appendChild(artist);
            }
            btn.addEventListener('click', () => { if (typeof playQueueAt === 'function') playQueueAt(i); });
            li.appendChild(btn);
            list.appendChild(li);
        });
    }

    // --- Ecualizador ---
    // Web Audio solo puede procesar medios del mismo documento y con CORS.
    // YouTube vive en un iframe de otro origen, así que su audio nunca llega acá.
    let ctx = null, filters = [], eqSources = new Map(), eqOn = false;
    const corsProbeCache = new Map();

    function eqStatus(message, tone = '') {
        const el = $('classicEqStatus');
        if (!el) return;
        el.textContent = message || '';
        if (tone) el.dataset.tone = tone;
        else delete el.dataset.tone;
    }

    function buildEqBands() {
        const wrap = $('classicEqBands');
        wrap.innerHTML = '';
        BANDS.forEach((f, i) => {
            const label = document.createElement('label');
            label.className = 'classic-band';
            label.innerHTML = `<input type="range" min="-12" max="12" step="1" value="0" data-band="${i}" aria-label="Banda ${f >= 1000 ? (f / 1000) + 'k' : f} Hz"><span>${f >= 1000 ? (f / 1000) + 'k' : f}</span>`;
            wrap.appendChild(label);
        });
        wrap.addEventListener('input', (e) => {
            if (!e.target.matches('input[data-band]')) return;
            const i = Number(e.target.dataset.band);
            if (filters[i]) filters[i].gain.value = Number(e.target.value);
            $('classicEqPreset').value = 'custom';
        });
    }

    function ensureEqContext() {
        if (ctx) return true;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        try {
            ctx = new AC();
            filters = BANDS.map((f) => {
                const b = ctx.createBiquadFilter();
                b.type = 'peaking'; b.frequency.value = f; b.Q.value = 1.1; b.gain.value = 0;
                return b;
            });
            filters.forEach((filter, i) => {
                if (i) filters[i - 1].connect(filter);
            });
            filters[filters.length - 1].connect(ctx.destination);
            document.querySelectorAll('#classicEqBands input[type=range]').forEach((slider, i) => {
                if (filters[i]) filters[i].gain.value = Number(slider.value);
            });
            return true;
        } catch (err) {
            console.warn('[Nowarfy] Ecualizador no disponible:', err);
            ctx = null;
            return false;
        }
    }

    // Un HEAD/GET en modo CORS confirma que el servidor manda
    // Access-Control-Allow-Origin. Sin eso, Web Audio devolvería silencio.
    function mediaAllowsCors(url) {
        const value = String(url || '').trim();
        if (!value) return Promise.resolve(false);
        if (/^(blob:|data:)/i.test(value)) return Promise.resolve(true);
        if (!/^https?:/i.test(value)) return Promise.resolve(false);
        if (corsProbeCache.has(value)) return corsProbeCache.get(value);
        const probe = (async () => {
            const controller = new AbortController();
            const timer = window.setTimeout(() => controller.abort(), 5000);
            const attempt = async (method) => {
                const response = await fetch(value, { method, mode: 'cors', cache: 'no-store', signal: controller.signal });
                const ok = response.ok;
                try { await response.body?.cancel?.(); } catch (_) {}
                return ok;
            };
            try {
                try { if (await attempt('HEAD')) return true; } catch (_) {}
                return await attempt('GET');
            } catch (_) {
                return false;
            } finally {
                window.clearTimeout(timer);
            }
        })();
        corsProbeCache.set(value, probe);
        return probe;
    }

    function attachSource(media) {
        if (!ctx) return null;
        let node = eqSources.get(media);
        if (!node) {
            try {
                node = ctx.createMediaElementSource(media);
            } catch (err) {
                console.warn('[Nowarfy] No se pudo conectar el medio al EQ:', err);
                return null;
            }
            eqSources.set(media, node);
        }
        try { node.disconnect(); } catch (_) {}
        try {
            node.connect(eqOn ? filters[0] : ctx.destination);
        } catch (err) {
            return null;
        }
        return node;
    }

    function connectChain(on) {
        if (!ctx || !eqSources.size) return;
        eqSources.forEach((node) => {
            try { node.disconnect(); } catch (_) {}
            try { node.connect(on ? filters[0] : ctx.destination); } catch (_) {}
        });
    }

    // Recarga la pista actual con crossOrigin para poder ecualizarla sin perder la posición.
    function routeCurrentMedia(media, url) {
        if (!ctx || !media) return false;
        if (media.crossOrigin === 'anonymous') return !!attachSource(media);
        const position = Number(media.currentTime) || 0;
        const wasPlaying = !media.paused;
        const savedOnPause = media.onpause;
        media.onpause = null;
        media.crossOrigin = 'anonymous';
        media.removeAttribute('src');
        if (!attachSource(media)) {
            media.src = url;
            media.load();
            media.onpause = savedOnPause;
            return false;
        }
        media.src = url;
        media.load();
        const restore = () => {
            try { media.currentTime = Math.min(position, Math.max(0, (media.duration || position) - 0.15)); } catch (_) {}
            if (wasPlaying) media.play().catch(() => {});
            media.onpause = savedOnPause;
        };
        media.addEventListener('loadedmetadata', restore, { once: true });
        window.setTimeout(() => { if (media.onpause === null) media.onpause = savedOnPause; }, 5000);
        return true;
    }

    // Llamado por playback-queue ANTES de asignar `media.src`. Devuelve el elemento
    // a usar (o una promesa con él) si hay que verificar CORS primero.
    function prepareMediaLoad(media, url) {
        if (!media || !url) return media;
        const routed = eqSources.has(media);
        if (!eqOn && !routed) {
            if (media.crossOrigin) media.removeAttribute('crossorigin');
            return media;
        }
        return mediaAllowsCors(url).then((allowed) => {
            if (!allowed) {
                if (!routed) return media;
                const node = eqSources.get(media);
                if (node) { try { node.disconnect(); } catch (_) {} eqSources.delete(media); }
                eqStatus('Esta pista no permite EQ (su servidor no habilita CORS). Se escucha sin ecualizar.', 'warn');
                return typeof window.nowarfyRebuildMediaElement === 'function' ? window.nowarfyRebuildMediaElement(media) : media;
            }
            if (!ensureEqContext()) return media;
            if (media.crossOrigin !== 'anonymous') media.crossOrigin = 'anonymous';
            attachSource(media);
            if (eqOn) eqStatus('EQ activo.');
            return media;
        }).catch(() => media);
    }

    async function setEq(on) {
        const btn = $('classicEqToggle');
        if (!btn) return;
        if (!on) {
            eqOn = false;
            connectChain(false);
            btn.textContent = 'EQ off';
            btn.setAttribute('aria-pressed', 'false');
            eqStatus('EQ desactivado.');
            return;
        }
        if (!ensureEqContext()) {
            btn.textContent = 'EQ no disponible';
            btn.setAttribute('aria-pressed', 'false');
            eqStatus('Este navegador no permite procesar audio.', 'error');
            return;
        }
        eqOn = true;
        btn.textContent = 'EQ on';
        btn.setAttribute('aria-pressed', 'true');
        void ctx.resume().catch(() => {});
        const song = typeof currentQueueSong === 'function' ? currentQueueSong() : null;
        const media = typeof activeAudioEl !== 'undefined' ? activeAudioEl : null;
        const url = media?.currentSrc || media?.src || '';
        const youtubePlaying = song?.type === 'yt' && typeof isPlaying !== 'undefined' && !!isPlaying;
        if (youtubePlaying || (song?.type === 'yt' && url)) {
            eqStatus('YouTube se reproduce fuera de la página: el EQ no puede procesar su audio. Usá «Buscar versión de audio».', 'warn');
            return;
        }
        if (!media || !url) {
            eqStatus('EQ listo: se aplicará a la próxima pista compatible.');
            return;
        }
        const allowed = await mediaAllowsCors(url);
        if (!allowed) {
            eqStatus('Esta pista viene de un servidor sin CORS: se escucha sin EQ. Usá «Buscar versión de audio».', 'warn');
            return;
        }
        const routed = routeCurrentMedia(media, url);
        eqStatus(routed ? 'EQ activo en esta pista.' : 'No se pudo aplicar el EQ a esta pista.', routed ? '' : 'error');
    }

    function applyPreset(name) {
        if (name === 'custom') return;
        const gains = PRESETS[name] || PRESETS.flat;
        const sliders = document.querySelectorAll('#classicEqBands input[type=range]');
        gains.forEach((g, i) => {
            if (sliders[i]) sliders[i].value = g;
            if (filters[i]) filters[i].gain.value = g;
        });
    }

    // --- Puente para YouTube: buscar una versión de audio libre del mismo tema ---
    const EQ_STOP_WORDS = new Set([
        'official', 'oficial', 'video', 'videoclip', 'audio', 'lyric', 'lyrics', 'letra', 'letras',
        'hd', 'hq', '4k', '8k', 'remaster', 'remastered', 'live', 'en', 'vivo', 'version', 'edit',
        'extended', 'mix', 'ft', 'feat', 'the', 'a', 'de', 'la', 'el', 'los', 'las', 'y', 'and',
        'con', 'with', 'vs', 'music', 'musica', 'song', 'tema'
    ]);
    function eqTokens(value) {
        return String(value || '')
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[\(\[\{][^\)\]\}]*[\)\]\}]/g, ' ')
            .replace(/[^a-z0-9]+/g, ' ')
            .split(' ')
            .filter(token => token.length > 1 && !EQ_STOP_WORDS.has(token));
    }
    function eqTrackScore(song, candidate) {
        const songTokens = new Set(eqTokens(song.title));
        const candidateTokens = new Set(eqTokens(candidate.title));
        if (!songTokens.size || !candidateTokens.size) return 0;
        let shared = 0;
        songTokens.forEach(token => { if (candidateTokens.has(token)) shared += 1; });
        let score = shared / songTokens.size;
        const artistTokens = eqTokens(song.artist);
        if (artistTokens.length) {
            const haystack = `${candidate.artist || ''} ${candidate.title || ''}`.toLowerCase();
            score += (artistTokens.filter(token => haystack.includes(token)).length / artistTokens.length) * 0.25;
        }
        const a = Number(song.duration), b = Number(candidate.duration);
        if (a > 0 && b > 0) {
            const diff = Math.abs(a - b);
            if (diff <= 5) score += 0.15;
            else if (diff <= 20) score += 0.05;
            else if (diff > 90) score -= 0.25;
        }
        return score;
    }
    function replaceCurrentSong(previous, replacement) {
        const index = typeof currentIndex === 'number' ? currentIndex : -1;
        if (index < 0 || !Array.isArray(queue) || !queue[index] || queue[index]._qid !== previous._qid) return;
        queue[index] = { ...replacement, type: 'mp3', _qid: previous._qid };
        if (typeof renderQueue === 'function') renderQueue();
        if (typeof persistQueue === 'function') persistQueue();
        eqStatus(`Cambiando a «${replacement.title}${replacement.artist ? ` · ${replacement.artist}` : ''}»…`);
        if (typeof playQueueAt === 'function') playQueueAt(index);
    }
    async function findAudioVersion() {
        const button = $('classicEqFindAudio');
        const song = typeof currentQueueSong === 'function' ? currentQueueSong() : null;
        if (!song) { eqStatus('Primero poné algo en reproducción.', 'warn'); return; }
        if (typeof fetchOpenverseTracks !== 'function') { eqStatus('La búsqueda de audio no está disponible.', 'error'); return; }
        if (button) button.disabled = true;
        eqStatus('Buscando una versión de audio del mismo tema…');
        try {
            const baseTitle = String(song.title || '').replace(/[\(\[\{][^\)\]\}]*[\)\]\}]/g, ' ').replace(/\s+/g, ' ').trim();
            const queries = [...new Set([
                [song.artist, baseTitle].filter(Boolean).join(' ').trim(),
                baseTitle
            ].filter(Boolean))];
            const found = [];
            const seen = new Set();
            const collect = (track) => {
                const key = String(track?.url || '').trim();
                if (!key || seen.has(key)) return;
                seen.add(key);
                found.push(track);
            };
            const openverseBatches = await Promise.allSettled(queries.map(query =>
                fetchOpenverseTracks(query, 20, { reserveContext: 'eq' })
            ));
            openverseBatches.forEach(result => {
                if (result.status === 'fulfilled') result.value.forEach(collect);
            });
            // Jamendo suele tener más música "de catálogo"; su CDN también permite CORS.
            for (const query of queries.slice(0, 1)) {
                try {
                    const response = await fetch(`/api/search?type=jamendo&query=${encodeURIComponent(query)}&maxResults=20`);
                    if (!response.ok) continue;
                    const data = await response.json();
                    (data.results || []).forEach(track => collect({
                        title: track.title,
                        artist: track.artist,
                        url: track.url,
                        type: 'mp3',
                        duration: track.duration,
                        img: track.thumbnail || 'assets/nowarfy-icon-512.png',
                        genre: track.genre || 'unknown',
                        license: track.license || '',
                        sourceUrl: track.sourceUrl || ''
                    }));
                } catch (_) {}
            }
            const ranked = found
                .map(track => ({ track, score: eqTrackScore(song, track) }))
                .filter(entry => entry.score >= 0.55)
                .sort((a, b) => b.score - a.score)
                .slice(0, 8);
            if (!ranked.length) {
                eqStatus('No encontré una versión libre del mismo tema en los catálogos disponibles.', 'warn');
                return;
            }
            for (const entry of ranked) {
                if (await mediaAllowsCors(entry.track.url)) { replaceCurrentSong(song, entry.track); return; }
            }
            eqStatus('Encontré versiones, pero ninguna permite ecualizar.', 'warn');
        } catch (error) {
            console.warn('[Nowarfy] Búsqueda de versión de audio falló:', error);
            eqStatus('No se pudo buscar la versión de audio. Revisá la conexión.', 'error');
        } finally {
            if (button) button.disabled = false;
        }
    }
    window.nowarfyEq = {
        isEnabled: () => eqOn,
        isRouted: (media) => !!media && eqSources.has(media),
        prepareMediaLoad,
        allowsCors: mediaAllowsCors
    };

    function init() {
        if (!$('classicToggle') || !$('classicPanel')) return;
        buildEqBands();
        $('classicToggle').addEventListener('click', () => setClassic($('classicPanel').hidden));
        $('classicClose').addEventListener('click', () => setClassic(false));
        $('classicVolume').addEventListener('input', (e) => { if (typeof setVolume === 'function') setVolume(e.target.value); });
        $('classicPlayPause').addEventListener('click', () => { if (typeof togglePlay === 'function') togglePlay(); syncDisplay(); });
        $('classicPrevious').addEventListener('click', () => { if (typeof prevSong === 'function') prevSong(); });
        $('classicNext').addEventListener('click', () => { if (typeof nextSong === 'function') nextSong(true); });
        $('classicShuffle').addEventListener('click', () => { if (typeof toggleShuffle === 'function') toggleShuffle(); syncDisplay(); });
        $('classicFavorite').addEventListener('click', () => { if (typeof toggleFavorite === 'function') toggleFavorite(); syncDisplay(); });
        $('classicEqToggle').addEventListener('click', () => setEq(!eqOn));
        $('classicEqPreset').addEventListener('change', (e) => applyPreset(e.target.value));
        $('classicEqFindAudio')?.addEventListener('click', () => findAudioVersion());
        window.addEventListener('nowarfy:queue-updated', () => {
            if (!$('classicPanel').hidden) renderPlaylist();
            if (eqOn) {
                const current = typeof currentQueueSong === 'function' ? currentQueueSong() : null;
                if (current?.type === 'yt') eqStatus('YouTube se reproduce fuera de la página: el EQ no puede procesar su audio. Usá «Buscar versión de audio».', 'warn');
            }
        });
        try {
            if (localStorage.getItem(STORAGE_KEY) === '1') setClassic(true);
        } catch (_) {}
    }

    if (window.nowarfyModulesReady) init();
    else window.addEventListener('nowarfy:modules-ready', init, { once: true });
})();
