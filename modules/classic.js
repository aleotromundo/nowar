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
    const audioElements = () => [$('audio-element'), $('audio-element-next')].filter(Boolean);

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

    // --- Ecualizador (solo para <audio> directo; YouTube no pasa por aquí) ---
    let ctx = null, filters = [], eqSources = new Map(), eqOn = false;
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
    function ensureGraph() {
        if (ctx) return eqSources.size === audioElements().length;
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
            const sliders = document.querySelectorAll('#classicEqBands input[type=range]');
            sliders.forEach((slider, i) => { if (filters[i]) filters[i].gain.value = Number(slider.value); });
            audioElements().forEach((media) => {
                const node = ctx.createMediaElementSource(media);
                eqSources.set(media, node);
                // Keep playback audible until EQ is explicitly enabled.
                node.connect(ctx.destination);
            });
            return eqSources.size === audioElements().length && eqSources.size > 0;
        } catch (err) {
            console.warn('[Nowarfy] Ecualizador no disponible:', err);
            eqSources.forEach((node) => {
                try { node.disconnect(); node.connect(ctx.destination); } catch (_) {}
            });
            return false;
        }
    }
    function connectChain(on) {
        if (!ctx || !eqSources.size) return;
        eqSources.forEach((node) => {
            try { node.disconnect(); } catch (_) {}
            node.connect(on ? filters[0] : ctx.destination);
        });
    }
    function setEq(on) {
        const btn = $('classicEqToggle');
        if (on && !ensureGraph()) {
            btn.textContent = 'EQ no disponible';
            btn.setAttribute('aria-pressed', 'false');
            return;
        }
        eqOn = on;
        if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => {});
        connectChain(on);
        btn.textContent = on ? 'EQ on' : 'EQ off';
        btn.setAttribute('aria-pressed', String(on));
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
        window.addEventListener('nowarfy:queue-updated', () => {
            if (!$('classicPanel').hidden) renderPlaylist();
        });
        try {
            if (localStorage.getItem(STORAGE_KEY) === '1') setClassic(true);
        } catch (_) {}
    }

    if (window.nowarfyModulesReady) init();
    else window.addEventListener('nowarfy:modules-ready', init, { once: true });
})();
