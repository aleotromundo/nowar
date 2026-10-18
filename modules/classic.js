// Vista clásica (estilo reproductor de escritorio): solo presentación.
// Reutiliza los controles y el estado existentes (queue, currentIndex, playQueueAt, togglePlay, etc.).
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
    const audio = () => $('audio-element');

    // --- Panel on/off ---
    function setClassic(on) {
        document.body.classList.toggle('mode-classic', on);
        $('classicPanel').hidden = !on;
        $('classicToggle').setAttribute('aria-pressed', String(on));
        try { localStorage.setItem(STORAGE_KEY, on ? '1' : '0'); } catch (_) {}
        if (on) renderPlaylist();
    }

    // --- Pantalla: refleja el estado que ya muestra el reproductor ---
    function syncDisplay() {
        if (!$('classicPanel') || $('classicPanel').hidden) return;
        $('classicTitle').textContent = $('currTitle')?.textContent || 'Sin canción';
        $('classicArtist').textContent = $('currArtist')?.textContent || '—';
        $('classicTime').textContent = $('currTime')?.textContent || '0:00';
        const playing = typeof isPlaying !== 'undefined' && isPlaying;
        document.querySelector('.classic-display')?.classList.toggle('is-playing', !!playing);
    }

    // --- Playlist: la misma cola que ya usa la app ---
    function renderPlaylist() {
        const list = $('classicPlaylist');
        if (!list) return;
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
            btn.textContent = `${i + 1}. ${song?.title || 'Sin título'}`;
            btn.addEventListener('click', () => { if (typeof playQueueAt === 'function') playQueueAt(i); });
            li.appendChild(btn);
            list.appendChild(li);
        });
    }

    // --- Ecualizador (solo para <audio> directo; YouTube no pasa por aquí) ---
    let ctx = null, source = null, filters = [], eqOn = false;
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
            const i = Number(e.target.dataset.band);
            if (filters[i]) filters[i].gain.value = Number(e.target.value);
        });
    }
    function ensureGraph() {
        if (ctx) return true;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        try {
            ctx = new AC();
            source = ctx.createMediaElementSource(audio());
            filters = BANDS.map((f) => {
                const b = ctx.createBiquadFilter();
                b.type = 'peaking'; b.frequency.value = f; b.Q.value = 1.1; b.gain.value = 0;
                return b;
            });
            return true;
        } catch (err) {
            console.warn('[Nowarfy] Ecualizador no disponible:', err);
            ctx = null;
            return false;
        }
    }
    function connectChain(on) {
        if (!ctx || !source) return;
        try { source.disconnect(); } catch (_) {}
        filters.forEach((f) => { try { f.disconnect(); } catch (_) {} });
        if (on) {
            let node = source;
            filters.forEach((f) => { node.connect(f); node = f; });
            node.connect(ctx.destination);
        } else {
            source.connect(ctx.destination);
        }
    }
    function setEq(on) {
        const btn = $('classicEqToggle');
        if (on && !ensureGraph()) {
            btn.textContent = 'EQ no disponible';
            btn.setAttribute('aria-pressed', 'false');
            return;
        }
        eqOn = on;
        if (ctx && ctx.state === 'suspended') ctx.resume();
        connectChain(on);
        btn.textContent = on ? 'EQ on' : 'EQ off';
        btn.setAttribute('aria-pressed', String(on));
    }
    function applyPreset(name) {
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
        $('classicEqToggle').addEventListener('click', () => setEq(!eqOn));
        $('classicEqPreset').addEventListener('change', (e) => applyPreset(e.target.value));
        setInterval(() => { syncDisplay(); renderPlaylistIfChanged(); }, 500);
        try {
            if (localStorage.getItem(STORAGE_KEY) === '1') setClassic(true);
        } catch (_) {}
    }

    let lastSig = '';
    function renderPlaylistIfChanged() {
        if (!$('classicPanel') || $('classicPanel').hidden) return;
        const sig = (typeof queue !== 'undefined' ? queue.length : 0) + ':' + (typeof currentIndex !== 'undefined' ? currentIndex : -1);
        if (sig !== lastSig) { lastSig = sig; renderPlaylist(); }
    }

    if (window.nowarfyModulesReady) init();
    else window.addEventListener('nowarfy:modules-ready', init, { once: true });
})();
