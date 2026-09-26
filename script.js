// OPT-109: punto de entrada estable. La carga es estrictamente secuencial porque
// los módulos conservan el contrato global existente con index.html y sus handlers inline.
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
    const loadNext = (index) => {
        if (index >= modules.length) {
            window.nowarfyModulesReady = true;
            window.dispatchEvent(new Event('nowarfy:modules-ready'));
            return;
        }
        const script = document.createElement('script');
        script.src = `${base}${modules[index]}`;
        script.onload = () => loadNext(index + 1);
        script.onerror = () => console.error(`[Nowarfy] No se pudo cargar ${modules[index]}`);
        document.head.appendChild(script);
    };
    loadNext(0);
})();
