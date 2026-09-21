// OPT-109: punto de entrada estable. Los módulos se cargan en orden porque conservan
// el contrato global existente con index.html, sus handlers inline y el Service Worker.
(function loadNowarfyModules() {
    const modules = [
        'storage.js',
        'core.js',
        'state-and-taste.js',
        'catalog.js',
        'reserve.js',
        'playback-queue.js',
        'lyrics-video.js',
        'player-pwa.js'
    ];
    const base = '/modules/';
    modules.forEach((moduleName) => {
        document.write(`<script src="${base}${moduleName}"><\/script>`);
    });
})();
