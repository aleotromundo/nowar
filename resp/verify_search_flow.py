from pathlib import Path

html_content = Path('index.html').read_text(encoding='utf-8')
js_content = Path('script.js').read_text(encoding='utf-8')

# Extraer la función loadHomeCatalogSources de forma exacta
start = js_content.index('async function loadHomeCatalogSources() {')
end = js_content.index('// La portada reutiliza caché/reserva local;', start)
startup = js_content[start:end]

checks = {
    'search_input_present': 'id="searchInput"' in html_content,
    'enter_handler': 'onkeydown="handleSearchKeydown(event)"' in html_content,
    'no_keyup_handler': 'onkeyup' not in html_content,
    'no_youtube_search_in_startup': 'fetchYouTubeSearch' not in startup,
    'no_openverse_search_in_startup': 'fetchOpenverseTracks' not in startup,
    'no_api_fetch_in_startup': 'fetch(' not in startup,
    'search_inside_enter': 'performSmartSearch(query);' in js_content[js_content.index('function handleSearchKeydown'):js_content.index('function clearSearch')],
    'local_reserve_loader': 'readLocalReserveCandidates' in startup,
}

for key, value in checks.items():
    print(f"{key}: {value}")

assert all(checks.values()), checks
print('ALL_CHECKS_PASSED')
