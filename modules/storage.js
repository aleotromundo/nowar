// OPT-111: almacenamiento asíncrono con migración gradual desde localStorage.
(function installNowarfyStorage(global) {
    const DB_NAME = 'nowarfy-storage';
    const DB_VERSION = 1;
    const STORE_NAME = 'records';
    const MIGRATION_KEY = 'nowarfy_idb_migration_v1';
    const MIGRATED_VALUE = 'completed';
    const LEGACY_KEYS = [
        'nowarfy_queue',
        'nowarfy_queue_qid',
        'nowarfy_queue_round',
        'nowarfy_queue_mode_v1',
        'nowarfy_queue_playlist_v1',
        'nowarfy_video_resume_v1',
        'youtoo_taste_v1',
        'nowarfy_favs'
    ];

    let dbPromise = null;
    let migrationPromise = null;

    function canUseIndexedDB() {
        return typeof global.indexedDB !== 'undefined';
    }

    function readLegacy(key) {
        try { return global.localStorage.getItem(key); } catch (_) { return null; }
    }

    function parseLegacy(raw, fallback) {
        if (raw == null) return fallback;
        try { return JSON.parse(raw); } catch (_) { return raw; }
    }

    function writeLegacy(key, value) {
        try {
            if (value == null) global.localStorage.removeItem(key);
            else global.localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
        } catch (_) { /* localStorage puede estar bloqueado o lleno. */ }
    }

    function requestPromise(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('indexeddb_request_failed'));
        });
    }

    function openDatabase() {
        if (!canUseIndexedDB()) return Promise.reject(new Error('indexeddb_unavailable'));
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            const request = global.indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'key' });
                }
            };
            request.onsuccess = () => {
                const db = request.result;
                db.onversionchange = () => db.close();
                resolve(db);
            };
            request.onerror = () => reject(request.error || new Error('indexeddb_open_failed'));
            request.onblocked = () => reject(new Error('indexeddb_open_blocked'));
        }).catch(error => {
            dbPromise = null;
            throw error;
        });
        return dbPromise;
    }

    async function getRecord(key) {
        const db = await openDatabase();
        const transaction = db.transaction(STORE_NAME, 'readonly');
        return requestPromise(transaction.objectStore(STORE_NAME).get(key));
    }

    async function putRecord(key, value) {
        const db = await openDatabase();
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const record = { key, value, updatedAt: Date.now() };
        await requestPromise(transaction.objectStore(STORE_NAME).put(record));
        return value;
    }

    async function migrateLegacyStorage() {
        if (migrationPromise) return migrationPromise;
        migrationPromise = (async () => {
            if (!canUseIndexedDB()) return false;
            try {
                for (const key of LEGACY_KEYS) {
                    const legacy = readLegacy(key);
                    if (legacy == null) continue;
                    const existing = await getRecord(key);
                    if (!existing) await putRecord(key, parseLegacy(legacy, legacy));
                }
                try { global.localStorage.setItem(MIGRATION_KEY, MIGRATED_VALUE); } catch (_) {}
                return true;
            } catch (error) {
                migrationPromise = null;
                return false;
            }
        })();
        return migrationPromise;
    }

    async function ready() {
        if (!canUseIndexedDB()) return false;
        try {
            await openDatabase();
            return await migrateLegacyStorage();
        } catch (_) {
            return false;
        }
    }

    async function get(key, fallback = null) {
        if (await ready()) {
            try {
                const record = await getRecord(key);
                if (record && Object.prototype.hasOwnProperty.call(record, 'value')) return record.value;
            } catch (_) {}
        }
        const raw = readLegacy(key);
        return raw == null ? fallback : parseLegacy(raw, fallback);
    }

    async function set(key, value) {
        const available = await ready();
        if (available) {
            try {
                await putRecord(key, value);
                // Durante la transición se conserva el legado como respaldo para versiones anteriores.
                // No se borra nunca automáticamente: la migración es reversible y no destructiva.
                writeLegacy(key, value);
                return value;
            } catch (_) {}
        }
        writeLegacy(key, value);
        return value;
    }

    async function remove(key) {
        const available = await ready();
        if (available) {
            try {
                const db = await openDatabase();
                const transaction = db.transaction(STORE_NAME, 'readwrite');
                await requestPromise(transaction.objectStore(STORE_NAME).delete(key));
            } catch (_) {}
        }
        writeLegacy(key, null);
    }

    global.nowarfyStorage = Object.freeze({
        dbName: DB_NAME,
        keys: Object.freeze({ migration: MIGRATION_KEY }),
        supported: canUseIndexedDB,
        ready,
        migrateLegacyStorage,
        get,
        set,
        remove
    });
})(window);
