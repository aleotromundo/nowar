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
    // Si un módulo no carga, los siguientes tampoco pueden hacerlo (dependen del orden): se reintenta una vez
    // y, si persiste, se avisa en pantalla en vez de dejar la app inerte sin explicación.
    const showLoadError = () => {
        if (document.getElementById('nowarfyLoadError')) return;
        const box = document.createElement('div');
        box.id = 'nowarfyLoadError';
        box.setAttribute('role', 'alert');
        box.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;padding:14px 16px;border-radius:12px;background:#1f2937;color:#fff;font:600 14px/1.4 system-ui,sans-serif;display:flex;gap:12px;align-items:center;justify-content:space-between;box-shadow:0 8px 30px rgba(0,0,0,.45)';
        const text = document.createElement('span');
        text.textContent = 'No pudimos cargar Nowarfy por completo. Revisá tu conexión y recargá la página.';
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Recargar';
        button.style.cssText = 'flex:none;padding:8px 14px;border:0;border-radius:8px;background:#ef4444;color:#fff;font:inherit;cursor:pointer';
        button.onclick = () => location.reload();
        box.append(text, button);
        document.body.appendChild(box);
    };
    const loadNext = (index, attempt = 0) => {
        if (index >= modules.length) {
            window.nowarfyModulesReady = true;
            window.dispatchEvent(new Event('nowarfy:modules-ready'));
            return;
        }
        const script = document.createElement('script');
        script.src = `${base}${modules[index]}`;
        script.onload = () => loadNext(index + 1);
        script.onerror = () => {
            script.remove();
            console.error(`[Nowarfy] No se pudo cargar ${modules[index]}`);
            if (attempt < 1) setTimeout(() => loadNext(index, attempt + 1), 800);
            else showLoadError();
        };
        document.head.appendChild(script);
    };
    loadNext(0);
})();
