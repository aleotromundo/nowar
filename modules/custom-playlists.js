
function renderCustomPlaylistHomeRail() {
    const container = document.getElementById('dynamicSections');
    const playlists = readCustomPlaylists();
    if (!container || !playlists.length) return;
    const section = document.createElement('section');
    section.className = 'custom-playlists-section home-custom-playlists';
    section.innerHTML = `<div class="section-title"><i class="fas fa-list-music"></i> Tus listas <span class="library-rail-hint">Tu música, a tu manera</span><button type="button" class="custom-playlist-new-inline"><i class="fas fa-plus"></i> Nueva lista</button></div>`;
    const grid = document.createElement('div');
    grid.className = 'custom-playlists-grid';
    playlists.slice(0, 4).forEach(playlist => {
        const card = document.createElement('article');
        card.className = 'custom-playlist-card';
        const artwork = playlist.tracks.find(track => track.img)?.img || '';
        card.innerHTML = `<button type="button" class="custom-playlist-art" aria-label="Abrir ${escapeHtml(playlist.title)}">${artwork ? `<img src="${escapeHtml(artwork)}" alt="" loading="lazy">` : '<i class="fas fa-list-music"></i>'}</button><div class="custom-playlist-card-copy"><strong>${escapeHtml(playlist.title)}</strong><span>${playlist.tracks.length} canción${playlist.tracks.length === 1 ? '' : 'es'}</span></div><div class="custom-playlist-card-actions"><button type="button" class="custom-playlist-play" aria-label="Reproducir ${escapeHtml(playlist.title)}"><i class="fas fa-play"></i></button></div>`;
        card.querySelector('.custom-playlist-art').onclick = () => openCustomPlaylist(playlist.id);
        card.querySelector('.custom-playlist-play').onclick = () => playCustomPlaylist(playlist.id);
        grid.appendChild(card);
    });
    section.querySelector('.custom-playlist-new-inline').onclick = () => openCustomPlaylistModal();
    section.appendChild(grid);
    container.appendChild(section);
}
