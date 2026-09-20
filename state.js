const STORAGE_KEYS = Object.freeze({
  favorites: 'nowarfy_favs',
  queue: 'nowarfy_queue',
  queueId: 'nowarfy_queue_qid',
  queueRound: 'nowarfy_queue_round',
  taste: 'youtoo_taste_v1',
  volume: 'nowarfy_vol'
});

function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch (_) {
    return fallback;
  }
}

export function createAppState() {
  return {
    storageKeys: STORAGE_KEYS,
    favorites: Array.isArray(readJson(STORAGE_KEYS.favorites, []))
      ? readJson(STORAGE_KEYS.favorites, []) : [],
    queue: Array.isArray(readJson(STORAGE_KEYS.queue, []))
      ? readJson(STORAGE_KEYS.queue, []) : [],
    queueIdCounter: Number(localStorage.getItem(STORAGE_KEYS.queueId) || 0) || 0,
    queueRound: Number(localStorage.getItem(STORAGE_KEYS.queueRound) || 0) || 0,
    currentIndex: -1,
    currentPlayingQid: null,
    isPlaying: false,
    searchQuery: '',
    activeBrowseMode: 'home'
  };
}

export function persistAppState(state) {
  if (!state) return;
  try {
    localStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify(state.favorites || []));
    localStorage.setItem(STORAGE_KEYS.queue, JSON.stringify(state.queue || []));
    localStorage.setItem(STORAGE_KEYS.queueId, String(state.queueIdCounter || 0));
    localStorage.setItem(STORAGE_KEYS.queueRound, String(state.queueRound || 0));
  } catch (_) {
    // El almacenamiento local puede estar bloqueado o lleno; la app sigue funcionando.
  }
}
