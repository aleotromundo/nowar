from pathlib import Path
from bs4 import BeautifulSoup

p = Path('index.html').read_text()
soup = BeautifulSoup(p, 'html.parser')
start = p.index('async function loadHomeCatalogSources')
end = p.index('\n        }\n\n        // La portada reutiliza caché/reserva local', start) + len('\n        }')
startup = p[start:end]
search = soup.select_one('#searchInput')
checks = {
    'no_youtube_search_in_startup': 'fetchYouTubeSearch' not in startup,
    'no_openverse_search_in_startup': 'fetchOpenverseTracks' not in startup,
    'no_api_fetch_in_startup': 'fetch(' not in startup,
    'enter_handler': search and search.get('onkeydown') == 'handleSearchKeydown(event)',
    'no_keyup_handler': search and not search.get('onkeyup'),
    'search_inside_enter': 'performSmartSearch(query);' in p[p.index('function handleSearchKeydown'):p.index('function clearSearch')],
    'local_reserve_loader': 'readLocalReserveCandidates' in startup,
}
for key, value in checks.items():
    print(key, value)
assert all(checks.values()), checks
print('startup_search_calls', 0)
print('search_trigger', search.get('onkeydown'))
