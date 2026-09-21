from pathlib import Path

root = Path(__file__).parent
script = (root / 'script.js').read_text(encoding='utf-8')
storage = (root / 'modules/storage.js').read_text(encoding='utf-8')
queue = (root / 'modules/playback-queue.js').read_text(encoding='utf-8')
taste = (root / 'modules/state-and-taste.js').read_text(encoding='utf-8')
sw = (root / 'sw.js').read_text(encoding='utf-8')

checks = {
    'storage_loaded_before_app_modules': "'storage.js'" in script and script.index("'storage.js'") < script.index("'core.js'"),
    'versioned_indexeddb': "indexedDB.open(DB_NAME, DB_VERSION)" in storage and "DB_VERSION = 1" in storage,
    'records_store': "createObjectStore(STORE_NAME, { keyPath: 'key' })" in storage,
    'legacy_migration_is_non_destructive': 'if (!existing) await putRecord' in storage and 'writeLegacy(key, value)' in storage,
    'fallback_when_indexeddb_unavailable': "return raw == null ? fallback : parseLegacy(raw, fallback);" in storage,
    'queue_async_write': 'window.nowarfyStorage.set(\'nowarfy_queue\'' in queue,
    'queue_async_hydration': 'async function hydrateQueueFromIndexedDB()' in queue and 'void hydrateQueueFromIndexedDB();' in taste,
    'taste_async_write': "window.nowarfyStorage.set(TASTE_STORAGE_KEY, payload)" in taste,
    'favorites_async_write': "window.nowarfyStorage.set('nowarfy_favs', favorites)" in (root / 'modules/player-pwa.js').read_text(encoding='utf-8'),
    'service_worker_precaches_storage': "'/modules/storage.js'" in sw,
}
for key, value in checks.items():
    print(f'{key}: {value}')
assert all(checks.values()), checks
print('ALL_CHECKS_PASSED')
