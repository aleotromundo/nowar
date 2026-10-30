(function loadNowarfyModules() {
    const modules = [
        'storage.js',
        'custom-playlists.js',
        'core.js',
        'state-and-taste.js',
        'catalog.js',
        'reserve.js',
        'playback-queue.js',
        'lyrics-video.js',
        'player-pwa.js'
    ];
    const base = '/modules/';
    const loader = document.getElementById('loader');
    const message = document.getElementById('loaderMessage');
    const retryButton = document.getElementById('loaderRetry');
    const setStatus = (text, loading) => {
        if (message) message.textContent = text;
        if (loader) {
            loader.classList.toggle('is-error', !loading);
            loader.setAttribute('aria-busy', String(loading));
        }
        if (retryButton) retryButton.hidden = loading;
    };
    const loadNext = (index) => {
        if (index >= modules.length) {
            window.nowarfyModulesReady = true;
            delete window.retryNowarfyModules;
            setStatus('Preparando el inicio...', true);
            window.dispatchEvent(new Event('nowarfy:modules-ready'));
            return;
        }
        const script = document.createElement('script');
        script.charset = 'utf-8';
        let failed = false;
        const fail = () => {
            if (failed) return;
            failed = true;
            window.clearTimeout(loadTimeout);
            script.remove();
            console.error(`[Nowarfy] No se pudo cargar ${modules[index]}`);
            setStatus(`No se pudo iniciar Nowarfy al cargar ${modules[index]}. Revisá la conexión e intentá de nuevo.`, false);
            window.retryNowarfyModules = () => {
                setStatus('Reintentando inicio...', true);
                loadNext(index);
            };
        };
        const loadTimeout = window.setTimeout(fail, 20000);
        script.src = `${base}${modules[index]}`;
        script.onload = () => {
            window.clearTimeout(loadTimeout);
            if (!failed) loadNext(index + 1);
        };
        script.onerror = fail;
        document.head.appendChild(script);
    };
    loadNext(0);
})();
