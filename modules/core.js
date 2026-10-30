// --- HELPER: VIEW TRANSITIONS API ---
// Permite que los cambios de DOM se animen como una App Nativa fluida
function navigateWithTransition(updateDOMCallback) {
    // La View Transitions API puede recortar el contenido desplazable durante
    // navegaciones rápidas. Las animaciones de entrada ya aportan movimiento
    // sin bloquear ni cortar el panel principal.
    try { updateDOMCallback(); } catch (error) { console.error('[Nowarfy] Error renderizando la vista:', error); }
}

// --- CONFIGURACIÓN ---
const YOUTUBE_API_KEY = '';
const OPENVERSE_CLIENT_ID = '';
const OPENVERSE_CLIENT_SECRET = '';

// --- IDENTIDAD OPCIONAL DE NOWARFY ---
const AUTH_CONFIG_ENDPOINT = '/api/auth-config';
let nowarfySupabase = null;
let nowarfyAuthUser = null;
let nowarfyAnonymousId = localStorage.getItem('nowarfy_anon_id') || (()=>{ const id='anon_'+Math.random().toString(36).slice(2,11); localStorage.setItem('nowarfy_anon_id', id); return id; })();
let nowarfyAuthConfigured = false;
let nowarfyAuthInitialised = false;
let nowarfyAuthInitPromise = null;
let nowarfySupabaseSdkPromise = null;
let nowarfyRemoteChannel = null;
let nowarfyRemoteBroadcastReady = false;
// BroadcastChannel para comunicación ultra-rápida entre tabs del mismo navegador
let nowarfyBroadcastChannel = null;
let nowarfyBroadcastChannelReady = false;
const nowarfyRemoteSeenCommandIds = new Map();
let nowarfyRemoteSession = null;
let nowarfyRemoteShadowSong = null;
let nowarfyRemoteShadowState = null;
let nowarfyRemoteShadowTimer = null;
let nowarfyRemoteDeviceId = null;
let nowarfyRemoteIsPlayer = false;
let nowarfyClaimInFlight = false;
let nowarfyRemoteDevices = [];
let nowarfyDeviceRefreshTimer = null;
let nowarfyRemoteStateTimer = null;
let nowarfyPageHidden = document.visibilityState === 'hidden';
let nowarfyProgressSource = null;
let nowarfyAudioUnlocked = false;
let nowarfyPendingHandoff = null;
let nowarfyPendingRemoteCommands = [];
// Ventana en la que el botón de play del control remoto se manda como `play`
// idempotente en vez de `toggle`, para no pausar justo después de un traspaso.
let nowarfyHandoffPendingUntil = 0;
let nowarfyRoleRefreshAt = 0;
let nowarfyRoleReconcileAt = 0;
// "Sonar también acá": este equipo replica la reproducción del reproductor
// principal. Es una preferencia local de cada dispositivo.
const NOWARFY_MIRROR_KEY = 'nowarfy_mirror_playback_v1';
let nowarfyMirrorEnabled = localStorage.getItem(NOWARFY_MIRROR_KEY) === '1';
let nowarfyMirrorBusy = false;
let nowarfyMirrorLastSeekAt = 0;
let nowarfyMirrorPendingUrl = '';
let nowarfyMirrorPendingUntil = 0;
// Una vez que elegís un dispositivo, el acceso flotante queda a mano aunque
// el otro equipo se desconecte un momento.
let nowarfyDeviceDockPinned = false;
const NOWARFY_REMOTE_DEVICE_STALE_MS = 2 * 60 * 1000;
const NOWARFY_REMOTE_DEVICE_KEY = 'nowarfy_remote_device_key_v1';
const nowarfyRemoteDeviceKey = localStorage.getItem(NOWARFY_REMOTE_DEVICE_KEY) || (() => { const key = (crypto.randomUUID?.() || `${Date.now()}-${Math.random()}-${Math.random()}`).replace(/-/g, ''); localStorage.setItem(NOWARFY_REMOTE_DEVICE_KEY, key); return key; })();

// La política de autoplay solo permite iniciar audio tras una interacción real
// con esta página. Cualquier toque o tecla cuenta y el navegador lo recuerda
// hasta recargar. Si había un traspaso esperando, se reanuda en ese momento.
function nowarfyMarkAudioUnlocked() {
    nowarfyAudioUnlocked = true;
    if (nowarfyPendingHandoff) void unlockNowarfyHandoff();
}
['pointerdown', 'keydown', 'touchend'].forEach(type => {
    window.addEventListener(type, nowarfyMarkAudioUnlocked, { capture: true, passive: true });
});

// --- DIAGNÓSTICO DE SINCRONIZACIÓN (solo lectura) ---
// No altera el protocolo remoto: únicamente observa el estado que ya circula.
let nowarfyRemoteDiagTimer = null;
let nowarfyRemoteLastStateAt = 0;
let nowarfyRemoteLastPublishAt = 0;
let nowarfyRemoteLastCommandLabel = '';
const nowarfyRemoteDiagEvents = [];

function authStatus(message, isError = false, loading = false) {
    const target = document.getElementById('nowarfyAuthStatus');
    if (!target) return;
    const messageElement = document.getElementById('nowarfyAuthStatusMessage');
    const spinner = target.querySelector('.loader-spinner');
    if (messageElement) messageElement.textContent = message || '';
    else target.textContent = message || '';
    if (spinner) spinner.hidden = !loading;
    target.classList.toggle('is-loading', loading);
    target.classList.toggle('is-error', isError);
    target.setAttribute('aria-busy', String(loading));
    target.style.color = isError ? '#ffb5bd' : '#b9e9d5';
}
function updateNowarfyConnectionStatus() {
    const panel = document.getElementById('nowarfySideStatus');
    const dot = document.getElementById('nowarfyConnectionDot');
    const label = document.getElementById('nowarfyConnectionLabel');
    if (!panel) return;
    const connected = !!nowarfyAuthUser && !!nowarfyRemoteSession && !!nowarfyRemoteBroadcastReady;
    const player = connected && nowarfyRemoteIsPlayer;
    const state = player ? 'player' : connected ? 'online' : 'offline';
    panel.dataset.state = state;
    if (dot) dot.className = `fas fa-circle connection-dot-${state}`;
    if (label) label.textContent = player ? 'Reproductor conectado' : connected ? 'Sincronización conectada' : 'Sin sincronización';
}
function buildNowarfyPairingUrl() {
    const url = new URL(window.location.href);
    url.hash = '';
    url.search = '';
    url.searchParams.set('pair', 'nowarfy');
    if (nowarfyRemoteSession?.id) url.searchParams.set('session', nowarfyRemoteSession.id);
    url.searchParams.set('source', nowarfyRemoteDeviceKey);
    return url.toString();
}
function refreshNowarfyPairingQr() {
    const link = buildNowarfyPairingUrl();
    const image = document.getElementById('nowarfyQrImage');
    const preview = document.getElementById('nowarfyQrPreview');
    const anchor = document.getElementById('nowarfyQrLink');
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=12&data=${encodeURIComponent(link)}`;
    if (image) { image.src = qrUrl; image.alt = `Código QR para vincular ${nowarfyAuthUser ? 'otro dispositivo a tu cuenta de YouToo®' : 'un dispositivo con YouToo®'}`; }
    if (preview) preview.src = qrUrl;
    if (anchor) anchor.href = link;
}
function handleNowarfyPairingLink() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('pair') !== 'nowarfy') return;
    localStorage.setItem('nowarfy_pairing_pending', JSON.stringify({ sessionId: params.get('session') || '', source: params.get('source') || '', createdAt: Date.now() }));
    const description = document.getElementById('nowarfyQrDescription');
    if (description) description.textContent = nowarfyAuthUser ? 'Este dispositivo quedó listo para sincronizarse. Abrí Cuenta para elegirlo como reproductor.' : 'Este dispositivo quedó listo para vincularse. Iniciá sesión con la misma cuenta del reproductor.';
    if (!nowarfyAuthUser) window.setTimeout(() => openNowarfyAuth(), 350);
}
function updateNowarfyAuthUI() {
    const button = document.getElementById('nowarfyAuthButton');
    const deviceStatus = document.getElementById('authDeviceStatus');
    const guest = document.getElementById('nowarfyAuthGuestPanel');
    const userPanel = document.getElementById('nowarfyAuthUserPanel');
    const email = document.getElementById('nowarfyAuthUserEmail');
    if (nowarfyAuthUser) {
        if (button) button.innerHTML = '<i class="fas fa-user-check"></i> Cuenta: ' + escapeHtml(nowarfyAuthUser.email || 'autenticada');
        if (deviceStatus) deviceStatus.textContent = 'Cuenta autenticada; este dispositivo ya puede sincronizarse con tus otros dispositivos.';
        if (guest) guest.hidden = true;
        if (userPanel) userPanel.hidden = false;
        if (email) email.textContent = nowarfyAuthUser.email || 'Usuario autenticado';
        const deviceCount = document.getElementById('nowarfyDeviceCount');
        if (deviceCount) deviceCount.textContent = `(${nowarfyRemoteDevices.length})`;
        const claimButton = document.getElementById('nowarfyClaimPlayerBtn');
        if (claimButton) {
            claimButton.disabled = nowarfyClaimInFlight || !!nowarfyRemoteIsPlayer;
            claimButton.innerHTML = nowarfyClaimInFlight
                ? '<i class="fas fa-spinner fa-spin"></i> Conectando este dispositivo…'
                : nowarfyRemoteIsPlayer
                    ? '<i class="fas fa-circle-check"></i> Este dispositivo es el reproductor activo'
                    : '<i class="fas fa-broadcast-tower"></i> Usar este dispositivo como reproductor';
            claimButton.setAttribute('aria-pressed', nowarfyRemoteIsPlayer ? 'true' : 'false');
        }
    } else {
        if (button) button.innerHTML = '<i class="fas fa-user"></i> Usar cuenta o continuar anónimo';
        if (deviceStatus) deviceStatus.textContent = nowarfyAuthConfigured ? 'Modo anónimo activo en este dispositivo; la cuenta es opcional.' : 'Modo anónimo activo; configurá la clave pública para habilitar cuentas.';
        if (guest) guest.hidden = false;
        if (userPanel) userPanel.hidden = true;
    }
    updateNowarfyConnectionStatus();
    refreshNowarfyPairingQr();
}
function loadNowarfySupabaseSdk() {
    if (window.supabase?.createClient) return Promise.resolve();
    if (nowarfySupabaseSdkPromise) return nowarfySupabaseSdkPromise;
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0';
    script.async = true;
    nowarfySupabaseSdkPromise = new Promise((resolve, reject) => {
        let settled = false;
        const finish = error => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeout);
            script.onload = null;
            script.onerror = null;
            if (error) {
                script.remove();
                reject(error);
            } else resolve();
        };
        const timeout = window.setTimeout(
            () => finish(new Error('El servicio de cuenta está tardando demasiado. Verificá la conexión e intentá de nuevo.')),
            15000
        );
        script.onload = () => window.supabase?.createClient
            ? finish()
            : finish(new Error('El módulo de autenticación no pudo inicializarse.'));
        script.onerror = () => finish(new Error('No se pudo cargar el servicio de cuenta. Verificá la conexión e intentá de nuevo.'));
        document.head.appendChild(script);
    }).catch(error => {
        nowarfySupabaseSdkPromise = null;
        throw error;
    });
    return nowarfySupabaseSdkPromise;
}

function hasStoredNowarfyAuthSession() {
    try {
        const hasSession = Object.keys(localStorage).some(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
        const hasAuthCallback = window.location.hash.includes('access_token=') || new URLSearchParams(window.location.search).has('code');
        return hasSession || hasAuthCallback;
    } catch (error) {
        console.warn('[Nowarfy] No se pudo comprobar la sesión de cuenta guardada.', error);
        return false;
    }
}

async function initNowarfyAuth() {
    if (nowarfySupabase) return nowarfySupabase;
    if (nowarfyAuthInitPromise) return nowarfyAuthInitPromise;
    nowarfyAuthInitPromise = (async () => {
        try {
            if (!window.supabase?.createClient) await loadNowarfySupabaseSdk();
            const configController = new AbortController();
            const configTimeout = window.setTimeout(() => configController.abort(), 15000);
            let response;
            let config;
            try {
                response = await fetch(AUTH_CONFIG_ENDPOINT, { cache: 'no-store', signal: configController.signal });
                config = await response.json();
            } finally {
                window.clearTimeout(configTimeout);
            }
            if (!response.ok || !config.configured || !window.supabase?.createClient) {
                nowarfyAuthConfigured = false;
                nowarfyAuthInitialised = false;
                updateNowarfyAuthUI();
                authStatus('La autenticación todavía no está configurada en este deployment.', true);
                return null;
            }
            nowarfySupabase = window.supabase.createClient(config.url, config.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
            nowarfyAuthConfigured = true;
            nowarfyAuthInitialised = true;
            const sessionResult = await nowarfySupabase.auth.getSession();
            nowarfyAuthUser = sessionResult.data?.session?.user || null;

            if (nowarfyAuthUser) {
                void loadNowarfyTaste();
            }

            nowarfySupabase.auth.onAuthStateChange((event, session) => {
                const previousUser = nowarfyAuthUser;
                nowarfyAuthUser = session?.user || null;

                if (nowarfyAuthUser) {
                    void loadNowarfyTaste();
                    if (event === 'SIGNED_IN' || (!previousUser && nowarfyAuthUser)) {
                        showToast('Cuenta conectada: historial, favoritos, listas y reproductor sincronizados', 'fa-cloud-arrow-up');
                    }
                }

                updateNowarfyAuthUI();
                if (document.getElementById('knowledgeCatalogGrid')) void renderKnowledgeBase();
                void setupNowarfyRemoteControl();
            });
            updateNowarfyAuthUI();
            authStatus('');
            void setupNowarfyRemoteControl();
            return nowarfySupabase;
        } catch (error) {
            nowarfyAuthConfigured = false;
            nowarfyAuthInitialised = false;
            updateNowarfyAuthUI();
            authStatus(error?.message || 'La autenticación no pudo inicializarse.', true);
            return null;
        } finally {
            nowarfyAuthInitPromise = null;
        }
    })();
    return nowarfyAuthInitPromise;
}
function toggleNowarfyMobileNav() {
    const sidebar = document.querySelector('.sidebar');
    const button = document.getElementById('nowarfyMobileMenuToggle');
    if (!sidebar || !button) return;
    const open = sidebar.classList.toggle('mobile-nav-open');
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
    button.innerHTML = `<i class="fas ${open ? 'fa-xmark' : 'fa-bars'}"></i>`;
}
function closeNowarfyMobileNav() {
    const sidebar = document.querySelector('.sidebar');
    const button = document.getElementById('nowarfyMobileMenuToggle');
    if (!sidebar || !button) return;
    sidebar.classList.remove('mobile-nav-open');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', 'Abrir menú');
    button.innerHTML = '<i class="fas fa-bars"></i>';
}
function openNowarfyAuth() {
    closeNowarfyMobileNav();
    const modal = document.getElementById('nowarfyAuthModal');
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add('auth-modal-open');
    updateNowarfyAuthUI();
    if (!nowarfyAuthConfigured && !nowarfyAuthUser) {
        authStatus('Conectando con el servicio de cuenta...', false, true);
        void initNowarfyAuth();
    }
    modal.querySelector('input:not([disabled])')?.focus();
    // Si el diagnóstico quedó abierto, retoma el refresco al reabrir el modal.
    if (document.getElementById('nowarfyRemoteDiag')?.open) onNowarfyRemoteDiagToggle();
}
function closeNowarfyAuth() {
    const modal = document.getElementById('nowarfyAuthModal');
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.body.classList.remove('auth-modal-open');
    // El diagnóstico no debe seguir refrescando con el modal cerrado.
    if (nowarfyRemoteDiagTimer) { clearInterval(nowarfyRemoteDiagTimer); nowarfyRemoteDiagTimer = null; }
    authStatus('');
}
async function submitNowarfyAuth(mode) {
    if (!nowarfySupabase) {
        authStatus('Conectando con el servicio de cuenta...', false, true);
        await initNowarfyAuth();
    }
    if (!nowarfyAuthConfigured || !nowarfySupabase) { authStatus('No se pudo conectar con el servicio de cuenta. Verificá la conexión e intentá de nuevo.', true); return; }
    const email = String(document.getElementById('authEmailInput')?.value || '').trim();
    const password = String(document.getElementById('authPasswordInput')?.value || '');
    if (!email) { authStatus('Escribí un email válido.', true); return; }
    if ((mode === 'signin' || mode === 'signup') && password.length < 6) { authStatus('La contraseña debe tener al menos 6 caracteres.', true); return; }
    authStatus('Procesando…', false, true);
    try {
        let result;
        if (mode === 'magic') {
            result = await nowarfySupabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}` } });
        } else if (mode === 'signup') {
            result = await nowarfySupabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}` } });
        } else {
            result = await nowarfySupabase.auth.signInWithPassword({ email, password });
        }
        if (result.error) { authStatus(result.error.message || 'No se pudo completar la autenticación.', true); return; }
        if (mode === 'magic') {
            closeNowarfyAuth();
            showToast('Enlace mágico enviado. Revisá tu correo para continuar.', 'fa-envelope');
        } else if (mode === 'signup' && !result.data?.session) {
            closeNowarfyAuth();
            showToast('Cuenta creada. Revisá tu correo para confirmar el email y luego iniciá sesión.', 'fa-envelope');
        } else {
            authStatus('Sesión iniciada correctamente.');
            updateNowarfyAuthUI();
            closeNowarfyAuth();
            showToast('Sesión iniciada. Este dispositivo ya puede sincronizarse.', 'fa-user-check');
        }
    } catch (error) {
        authStatus(error?.message || 'No se pudo completar la autenticación.', true);
    }
}
async function signOutNowarfy() {
    if (nowarfySupabase) await nowarfySupabase.auth.signOut();
    nowarfyAuthUser = null;
    await teardownNowarfyRemoteControl();
    updateNowarfyAuthUI();
    authStatus('Sesión cerrada. El modo anónimo local continúa disponible.');
}
async function switchNowarfyUser() {
    await signOutNowarfy();
    openNowarfyAuth();
}

function remoteStatus(message) { const el = document.getElementById('nowarfyRemoteStatus'); if (el) el.textContent = message; updateNowarfyConnectionStatus(); }
function currentRemotePosition() {
    try {
        const song = currentQueueSong?.();
        const duration = getDuration?.() || 0;
        let position = 0;
        if (song?.type === 'yt' && ytPlayer?.getCurrentTime) position = ytPlayer.getCurrentTime() || 0;
        else if (activeAudioEl) position = activeAudioEl.currentTime || 0;
        return { song, position, duration };
    } catch (_) { return { song: null, position: 0, duration: 0 }; }
}
function remoteSongSnapshot(song) {
    if (!song?.url) return null;
    return { _qid: song._qid || null, url: song.url, type: song.type || 'yt', title: song.title || '', artist: song.artist || '', img: song.img || '', channelId: song.channelId || '', channelTitle: song.channelTitle || '', duration: Number(song.duration) || 0, categoryId: song.categoryId || '', description: song.description || '', genre: song.genre || '' };
}
function remoteStateSnapshot() {
    const { song, position, duration } = currentRemotePosition();
    const positionAt = Date.now();
    return { resourceId: song?.url || null, title: song?.title || '', artist: song?.artist || '', type: song?.type || null, img: song?.img || '', channelId: song?.channelId || '', isPlaying: !!isPlaying, volume: Math.round(lastVolume * 100), position: Math.round(position * 10) / 10, positionAt, duration: Math.round(duration * 10) / 10, currentQid: currentPlayingQid || song?._qid || null, queueRound, playlist: Array.isArray(queue) ? queue.slice(0, 100).map(remoteSongSnapshot).filter(Boolean) : [], updatedAt: new Date(positionAt).toISOString() };
}
function detectNowarfyDeviceName() {
    const ua = navigator.userAgent || '';
    const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac OS X|Macintosh/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Web';
    const browser = /Edg\//i.test(ua) ? 'Edge' : /OPR\//i.test(ua) ? 'Opera' : /Firefox\//i.test(ua) ? 'Firefox' : /CriOS\//i.test(ua) ? 'Chrome iOS' : /Chrome\//i.test(ua) ? 'Chrome' : /Safari\//i.test(ua) && !/Chrome|CriOS/i.test(ua) ? 'Safari' : 'Navegador';
    const kind = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) ? 'Móvil' : 'Computadora';
    return `${kind} · ${os} · ${browser}`;
}
async function ensureNowarfyRemoteSession() {
    if (!nowarfySupabase || !nowarfyAuthUser) return null;
    const uid = nowarfyAuthUser.id;
    const deviceName = detectNowarfyDeviceName();
    const deviceResult = await nowarfySupabase.from('youtoo_remote_devices').upsert({ user_id: uid, device_key: nowarfyRemoteDeviceKey, device_name: deviceName, role: 'controller', last_seen_at: new Date().toISOString() }, { onConflict: 'user_id,device_key' }).select('id').single();
    if (deviceResult.error) throw deviceResult.error;
    nowarfyRemoteDeviceId = deviceResult.data.id;
    let sessionResult = await nowarfySupabase.from('youtoo_remote_sessions').select('*').eq('user_id', uid).maybeSingle();
    if (sessionResult.error) throw sessionResult.error;
    if (!sessionResult.data) sessionResult = await nowarfySupabase.from('youtoo_remote_sessions').insert({ user_id: uid, state: remoteStateSnapshot(), active_device_id: null }).select('*').single();
    if (sessionResult.error) throw sessionResult.error;
    nowarfyRemoteSession = sessionResult.data;
    nowarfyRemoteIsPlayer = nowarfyRemoteSession.active_device_id === nowarfyRemoteDeviceId;
    return nowarfyRemoteSession;
}
async function setupNowarfyRemoteControl() {
    if (!nowarfyAuthUser || !nowarfySupabase) { await teardownNowarfyRemoteControl(); return; }
    try {
        await ensureNowarfyRemoteSession();
        const activeExpired = nowarfyRemoteSession?.expires_at && new Date(nowarfyRemoteSession.expires_at).getTime() <= Date.now();
        let activeDeviceStale = false;
        if (nowarfyRemoteSession?.active_device_id && nowarfyRemoteSession.active_device_id !== nowarfyRemoteDeviceId) {
            const activeDevice = await nowarfySupabase.from('youtoo_remote_devices').select('last_seen_at').eq('id', nowarfyRemoteSession.active_device_id).maybeSingle();
            activeDeviceStale = !!activeDevice.error || !activeDevice.data || (Date.now() - new Date(activeDevice.data.last_seen_at).getTime() > NOWARFY_REMOTE_DEVICE_STALE_MS);
        }
        if (nowarfyRemoteSession && (!nowarfyRemoteSession.active_device_id || activeExpired || activeDeviceStale)) {
            const claimBuilder = nowarfySupabase.from('youtoo_remote_sessions')
                .update({ active_device_id: nowarfyRemoteDeviceId, state: remoteStateSnapshot(), version: Number(nowarfyRemoteSession.version || 0) + 1, updated_at: new Date().toISOString(), expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() })
                .eq('id', nowarfyRemoteSession.id);
            if (activeExpired || activeDeviceStale) claimBuilder.eq('active_device_id', nowarfyRemoteSession.active_device_id);
            else claimBuilder.is('active_device_id', null);
            const claim = await claimBuilder.select('*').maybeSingle();
            if (!claim.error && claim.data) {
                nowarfyRemoteSession = claim.data;
                nowarfyRemoteIsPlayer = true;
            } else {
                const refreshed = await nowarfySupabase.from('youtoo_remote_sessions').select('*').eq('id', nowarfyRemoteSession.id).maybeSingle();
                if (!refreshed.error && refreshed.data) {
                    nowarfyRemoteSession = refreshed.data;
                    nowarfyRemoteIsPlayer = refreshed.data.active_device_id === nowarfyRemoteDeviceId;
                }
            }
        }
        // Inicializar BroadcastChannel para comunicación entre tabs del mismo navegador
        if (nowarfyBroadcastChannel) nowarfyBroadcastChannel.close();
        nowarfyBroadcastChannel = new BroadcastChannel('nowarfy-remote-control');
        nowarfyBroadcastChannel.onmessage = (event) => {
            const message = event.data || {};
            if (message.senderDeviceId === nowarfyRemoteDeviceId) return;
            if (message.type === 'remote-command') {
                const command = message.command || {};
                if (!command.type || (command.targetDeviceId && command.targetDeviceId !== nowarfyRemoteDeviceId)) return;
                if (message.commandId && nowarfyRemoteSeenCommandIds.has(message.commandId)) return;
                if (message.commandId) {
                    nowarfyRemoteSeenCommandIds.set(message.commandId, Date.now());
                    for (const [id, timestamp] of nowarfyRemoteSeenCommandIds) if (Date.now() - timestamp > 60000) nowarfyRemoteSeenCommandIds.delete(id);
                }
                void nowarfyHandleIncomingCommand(command);
            } else if (message.type === 'remote-state') {
                if (message.senderDeviceId === nowarfyRemoteDeviceId || nowarfyRemoteIsPlayer || !message.state) return;
                updateRemoteControlsFromState(message.state);
            }
        };
        nowarfyBroadcastChannelReady = true;

        if (nowarfyRemoteChannel) await nowarfySupabase.removeChannel(nowarfyRemoteChannel);
        nowarfyRemoteChannel = nowarfySupabase.channel(`nowarfy-remote-${nowarfyAuthUser.id}`)
            .on('broadcast', { event: 'remote-command' }, packet => {
                const message = packet?.payload || packet || {};
                if (message.senderDeviceId === nowarfyRemoteDeviceId) return;
                const command = message.command || {};
                if (!command.type || (command.targetDeviceId && command.targetDeviceId !== nowarfyRemoteDeviceId)) return;
                if (message.commandId && nowarfyRemoteSeenCommandIds.has(message.commandId)) return;
                if (message.commandId) {
                    nowarfyRemoteSeenCommandIds.set(message.commandId, Date.now());
                    for (const [id, timestamp] of nowarfyRemoteSeenCommandIds) if (Date.now() - timestamp > 60000) nowarfyRemoteSeenCommandIds.delete(id);
                }
                void nowarfyHandleIncomingCommand(command);
            })
            .on('broadcast', { event: 'remote-state' }, packet => {
                const message = packet?.payload || packet || {};
                if (message.senderDeviceId === nowarfyRemoteDeviceId || nowarfyRemoteIsPlayer || !message.state) return;
                updateRemoteControlsFromState(message.state);
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'youtoo_remote_sessions', filter: `user_id=eq.${nowarfyAuthUser.id}` }, payload => {
                const wasPlayer = nowarfyRemoteIsPlayer;
                nowarfyRemoteSession = payload.new;
                nowarfyRemoteIsPlayer = payload.new.active_device_id === nowarfyRemoteDeviceId;
                updateRemoteShadowTimer();
                if (wasPlayer !== nowarfyRemoteIsPlayer) nowarfyRemoteDiagLog('Cambio de rol', `${wasPlayer ? 'reproductor' : 'control'} → ${nowarfyRemoteIsPlayer ? 'reproductor' : 'control'} · v${payload.new.version ?? 0}`);
                if (wasPlayer && !nowarfyRemoteIsPlayer) { stopAll(); isPlaying = false; updateIcon(); setTrackLoading(false); }
                if (wasPlayer !== nowarfyRemoteIsPlayer) { syncNowarfyRemoteTimers(); renderNowarfyDeviceDock(); }
                updateNowarfyAuthUI();
                if (payload.new.state) updateRemoteControlsFromState(payload.new.state);
                nowarfyFlushPendingRemoteCommands();
                if (!nowarfyRemoteIsPlayer && nowarfyMirrorEnabled) applyNowarfyMirrorState(payload.new.state || nowarfyRemoteShadowState);
                remoteStatus(nowarfyRemoteIsPlayer ? 'Este dispositivo es el reproductor activo.' : 'Control remoto conectado; el reproductor activo está en otro dispositivo.');
            })
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'youtoo_remote_commands', filter: `user_id=eq.${nowarfyAuthUser.id}` }, payload => { const command = payload.new.command || {}; if (command.commandId && nowarfyRemoteSeenCommandIds.has(command.commandId)) return; if (command.commandId) nowarfyRemoteSeenCommandIds.set(command.commandId, Date.now()); if (payload.new.device_id !== nowarfyRemoteDeviceId && (!command.targetDeviceId || command.targetDeviceId === nowarfyRemoteDeviceId)) void nowarfyHandleIncomingCommand(command); })
            .on('postgres_changes', { event: '*', schema: 'public', table: NOWARFY_TASTE_TABLE, filter: `user_id=eq.${nowarfyAuthUser.id}` }, payload => { if (!nowarfyTasteSyncInFlight) void loadNowarfyTaste(); })
            .subscribe(status => { nowarfyRemoteBroadcastReady = status === 'SUBSCRIBED'; if (status === 'SUBSCRIBED') { updateNowarfyAuthUI(); remoteStatus(nowarfyRemoteIsPlayer ? 'Este dispositivo es el reproductor activo.' : 'Control remoto conectado; elegí otro dispositivo como reproductor.'); } });
        if (!nowarfyRemoteIsPlayer && nowarfyRemoteSession?.state) updateRemoteControlsFromState(nowarfyRemoteSession.state);
        await refreshNowarfyRemoteDevices();
        try {
            const pendingPairing = JSON.parse(localStorage.getItem('nowarfy_pairing_pending') || 'null');
            if (pendingPairing && Date.now() - Number(pendingPairing.createdAt || 0) < 15 * 60 * 1000) {
                localStorage.removeItem('nowarfy_pairing_pending');
                showToast('Dispositivo vinculado. Ya aparece en tu lista de reproducción remota.', 'fa-link');
            }
        } catch (_) {}
        syncNowarfyRemoteTimers();
        updateRemoteShadowTimer();
    } catch (error) { remoteStatus('Control remoto no disponible todavía; la reproducción local sigue funcionando.'); }
}
async function touchNowarfyRemoteDevice() {
    if (!nowarfySupabase || !nowarfyAuthUser || !nowarfyRemoteDeviceId) return;
    const deviceName = detectNowarfyDeviceName();
    await nowarfySupabase.from('youtoo_remote_devices').update({ last_seen_at: new Date().toISOString(), role: nowarfyRemoteIsPlayer ? 'player' : 'controller', device_name: deviceName }).eq('id', nowarfyRemoteDeviceId).eq('user_id', nowarfyAuthUser.id);
}
async function refreshNowarfyRemoteDevices() {
    if (!nowarfySupabase || !nowarfyAuthUser) return [];
    void reconcileNowarfyRemoteRole();
    const cutoff = new Date(Date.now() - 25000).toISOString();
    const result = await nowarfySupabase.from('youtoo_remote_devices').select('id,device_name,role,last_seen_at').eq('user_id', nowarfyAuthUser.id).gte('last_seen_at', cutoff).order('last_seen_at', { ascending: false });
    if (result.error) return nowarfyRemoteDevices;
    nowarfyRemoteDevices = result.data || [];
    const count = document.getElementById('nowarfyDeviceCount');
    if (count) count.textContent = `(${nowarfyRemoteDevices.length})`;
    const hint = document.getElementById('nowarfyDevicePickerHint');
    if (hint) hint.textContent = `${nowarfyRemoteDevices.length} dispositivo${nowarfyRemoteDevices.length === 1 ? '' : 's'}`;
    const list = document.getElementById('nowarfyDeviceList');
    if (list) {
        list.innerHTML = nowarfyRemoteDevices.length ? nowarfyRemoteDevices.map((device, index) => {
            const isSelected = device.id === nowarfyRemoteSession?.active_device_id;
            const isCurrent = device.id === nowarfyRemoteDeviceId;
            const isMobile = /Móvil/i.test(device.device_name || '');
            const icon = isSelected ? 'fa-volume-high' : (isMobile ? 'fa-mobile-screen' : 'fa-desktop');
            return `<button type="button" class="nowarfy-device-option${isSelected ? ' is-active' : ''}" onclick="selectNowarfyPlaybackDevice('${device.id}')">
                <span class="device-info">
                    <i class="fas ${icon}"></i>
                    <span class="device-name-text">${escapeHtml(device.device_name || 'Dispositivo')}</span>
                </span>
                <small class="device-status-text">${isSelected ? 'Reproduciendo' : isCurrent ? 'Este equipo' : 'Disponible'}</small>
            </button>`;
        }).join('') : '<small>No hay dispositivos activos.</small>';
    }
    updateNowarfyAuthUI();
    renderNowarfyDeviceDock();
    return nowarfyRemoteDevices;
}
function toggleNowarfyDevicePicker() {
    const picker = document.getElementById('nowarfyDevicePicker');
    if (!picker) return;
    picker.hidden = !picker.hidden;
    if (!picker.hidden) void refreshNowarfyRemoteDevices();
}

// --- Acceso flotante para cambiar de dispositivo ---
function nowarfyShortDeviceName(name) {
    const value = String(name || '').trim();
    if (!value) return 'Dispositivo';
    const [kind, os] = value.split(' · ');
    return os ? `${kind} · ${os}` : value;
}
function nowarfyActiveDeviceLabel() {
    if (nowarfyRemoteIsPlayer) return 'Reproduciendo acá';
    const active = nowarfyRemoteDevices.find(device => device.id === nowarfyRemoteSession?.active_device_id);
    return active ? `En ${nowarfyShortDeviceName(active.device_name)}` : 'Dispositivos';
}
function renderNowarfyDeviceDock() {
    const dock = document.getElementById('nowarfyDeviceDock');
    if (!dock) return;
    const show = !!nowarfyAuthUser && !!nowarfyRemoteSession && (nowarfyDeviceDockPinned || nowarfyRemoteDevices.length > 1);
    dock.hidden = !show;
    if (!show) { toggleNowarfyDeviceDock(false); return; }
    const label = document.getElementById('nowarfyDeviceDockLabel');
    if (label) label.textContent = nowarfyActiveDeviceLabel();
    const button = document.getElementById('nowarfyDeviceDockButton');
    if (button) {
        button.classList.toggle('is-player', nowarfyRemoteIsPlayer);
        button.classList.toggle('is-mirror', !nowarfyRemoteIsPlayer && nowarfyMirrorEnabled);
        button.title = nowarfyRemoteIsPlayer ? 'Este equipo reproduce · cambiar de dispositivo' : `${nowarfyActiveDeviceLabel()} · cambiar de dispositivo`;
    }
    const list = document.getElementById('nowarfyDeviceDockList');
    if (list) {
        const items = nowarfyRemoteDevices.map((device) => {
            const isActive = device.id === nowarfyRemoteSession?.active_device_id;
            const isCurrent = device.id === nowarfyRemoteDeviceId;
            const status = isActive ? 'Reproduciendo' : isCurrent ? 'Reproducir en este equipo' : 'Disponible';
            return `<button type="button" class="nowarfy-dock-device${isActive ? ' is-active' : ''}" onclick="selectNowarfyPlaybackDevice('${device.id}')" aria-current="${isActive ? 'true' : 'false'}">
                <span class="nowarfy-dock-device-icon"><i class="fas ${isActive ? 'fa-volume-high' : 'fa-display'}"></i></span>
                <span class="nowarfy-dock-device-text"><strong>${escapeHtml(nowarfyShortDeviceName(device.device_name))}</strong><small>${status}</small></span>
                ${isCurrent ? '<em>este equipo</em>' : ''}
            </button>`;
        }).join('');
        list.innerHTML = items || '<small class="nowarfy-dock-empty">No hay otros dispositivos activos ahora.</small>';
    }
    const mirror = document.getElementById('nowarfyDeviceDockMirror');
    if (mirror) {
        mirror.setAttribute('aria-pressed', String(!nowarfyRemoteIsPlayer && nowarfyMirrorEnabled));
        mirror.disabled = nowarfyRemoteIsPlayer;
        mirror.innerHTML = nowarfyRemoteIsPlayer
            ? '<i class="fas fa-volume-high"></i> Este equipo ya reproduce'
            : `<i class="fas ${nowarfyMirrorEnabled ? 'fa-volume-high' : 'fa-volume-low'}"></i> ${nowarfyMirrorEnabled ? 'Dejar de sonar acá' : 'Sonar también acá'}`;
    }
}
function toggleNowarfyDeviceDock(force) {
    const panel = document.getElementById('nowarfyDeviceDockPanel');
    const button = document.getElementById('nowarfyDeviceDockButton');
    if (!panel) return;
    const open = typeof force === 'boolean' ? force : panel.hidden;
    panel.hidden = !open;
    if (button) button.setAttribute('aria-expanded', String(open));
    if (open) { renderNowarfyDeviceDock(); void refreshNowarfyRemoteDevices(); }
}
document.addEventListener('pointerdown', (event) => {
    const dock = document.getElementById('nowarfyDeviceDock');
    if (!dock || dock.hidden || !(event.target instanceof Element)) return;
    if (event.target.closest('#nowarfyDeviceDock')) return;
    toggleNowarfyDeviceDock(false);
}, true);

// --- "Sonar también acá" ---
// El reproductor principal manda el estado; este equipo lo imita (pista,
// pausa y posición). No publica estado para no pisar al principal.
function nowarfyMirrorExpectedPosition(state) {
    const duration = Number(state?.duration || 0);
    const capturedAt = Number(state?.positionAt) || Date.parse(state?.updatedAt) || Date.now();
    const elapsed = state?.isPlaying === false ? 0 : Math.max(0, (Date.now() - capturedAt) / 1000);
    const position = Math.max(0, Number(state?.position || 0) + elapsed);
    return duration > 0 ? Math.min(duration, position) : position;
}
// Qué tiene cargado este equipo de verdad. No alcanza con mirar la cola:
// el control remoto copia la lista del reproductor principal y la pista
// puede estar en currentIndex sin que el audio local la haya cargado aún.
function nowarfyMirrorLoadedUrl(song) {
    if (!song) return '';
    if (song.type === 'yt') {
        try {
            const data = ytPlayer?.getVideoData?.();
            if (data?.video_id) return String(data.video_id);
            const url = ytPlayer?.getVideoUrl?.() || '';
            const match = String(url).match(/[?&]v=([^&]+)/);
            return match ? decodeURIComponent(match[1]) : '';
        } catch (_) { return ''; }
    }
    if (typeof activeAudioEl === 'undefined' || !activeAudioEl) return '';
    return String(activeAudioEl.currentSrc || activeAudioEl.src || '');
}
async function applyNowarfyMirrorState(state) {
    if (!state || !nowarfyMirrorEnabled || nowarfyRemoteIsPlayer || nowarfyMirrorBusy) return;
    const url = String(state.resourceId || '');
    if (!url) return;
    const localSong = Array.isArray(queue) && currentIndex >= 0 ? queue[currentIndex] : null;
    if (!localSong) return;
    const loaded = nowarfyMirrorLoadedUrl(localSong);
    const sameTrack = loaded === String(localSong.url);
    if (!sameTrack) {
        const idx = Array.isArray(queue) ? queue.findIndex(song => String(song.url) === url) : -1;
        if (idx < 0) return;
        // Evita reiniciar la misma carga si el estado remoto vuelve a llegar
        // antes de que el medio termine de estar listo.
        if (nowarfyMirrorPendingUrl === url && Date.now() < nowarfyMirrorPendingUntil) return;
        nowarfyMirrorPendingUrl = url;
        nowarfyMirrorPendingUntil = Date.now() + 12000;
        nowarfyMirrorBusy = true;
        try {
            playQueueAt(idx, {
                deferAutoplay: state.isPlaying === false,
                resumeSession: { ...state, wasPlaying: state.isPlaying !== false }
            });
        } finally { nowarfyMirrorBusy = false; }
        return;
    }
    nowarfyMirrorPendingUrl = '';
    if (state.isPlaying === false) {
        if (localSong.type === 'yt') {
            ytPlaybackIntent = false;
            try { ytPlayer?.pauseVideo?.(); } catch (_) {}
        } else if (typeof activeAudioEl !== 'undefined' && activeAudioEl && !activeAudioEl.paused) {
            try { activeAudioEl.pause(); } catch (_) {}
        }
        return;
    }
    const expected = nowarfyMirrorExpectedPosition(state);
    if (localSong.type === 'yt') {
        let ytState = null;
        try { ytState = ytPlayer?.getPlayerState?.(); } catch (_) { ytState = null; }
        if (ytState !== window.YT?.PlayerState?.PLAYING && ytState !== window.YT?.PlayerState?.BUFFERING) {
            playbackStoppedByUser = false;
            ytPlaybackIntent = true;
            try { ytPlayer?.playVideo?.(); } catch (_) {}
        }
        const actual = Number(ytPlayer?.getCurrentTime?.() || 0);
        if (actual > 0 && Math.abs(actual - expected) > 3.5 && Date.now() - nowarfyMirrorLastSeekAt > 6000) {
            nowarfyMirrorLastSeekAt = Date.now();
            try { ytPlayer?.seekTo?.(expected, true); } catch (_) {}
        }
        return;
    }
    if (typeof activeAudioEl === 'undefined' || !activeAudioEl) return;
    if (activeAudioEl.paused) {
        playbackStoppedByUser = false;
        const attempt = activeAudioEl.play();
        if (attempt?.catch) attempt.catch(() => {});
    }
    if (Math.abs((Number(activeAudioEl.currentTime) || 0) - expected) > 3.5 && Date.now() - nowarfyMirrorLastSeekAt > 6000) {
        nowarfyMirrorLastSeekAt = Date.now();
        try { activeAudioEl.currentTime = Math.max(0, Math.min(expected, Number(activeAudioEl.duration) || expected)); } catch (_) {}
    }
}
async function toggleNowarfyMirrorPlayback() {
    if (nowarfyRemoteIsPlayer) { showToast('Este equipo ya es el reproductor principal', 'fa-circle-info'); return; }
    nowarfyMirrorEnabled = !nowarfyMirrorEnabled;
    try { localStorage.setItem(NOWARFY_MIRROR_KEY, nowarfyMirrorEnabled ? '1' : '0'); } catch (_) {}
    // El clic en el botón es la interacción que habilita el audio.
    nowarfyAudioUnlocked = true;
    renderNowarfyDeviceDock();
    if (nowarfyMirrorEnabled) {
        const state = nowarfyRemoteShadowState || nowarfyRemoteSession?.state;
        showToast('Este equipo también va a reproducir el audio', 'fa-volume-high');
        nowarfyMirrorLastSeekAt = 0;
        if (state) await applyNowarfyMirrorState(state);
    } else {
        try { activeAudioEl?.pause?.(); } catch (_) {}
        if (ytPlayer?.pauseVideo) { try { ytPlaybackIntent = false; ytPlayer.pauseVideo(); } catch (_) {} }
        showToast('Este equipo dejó de reproducir en paralelo', 'fa-volume-xmark');
    }
}
async function teardownNowarfyRemoteControl() { if (nowarfyRemoteDiagTimer) { clearInterval(nowarfyRemoteDiagTimer); nowarfyRemoteDiagTimer = null; } const diagPanel = document.getElementById('nowarfyRemoteDiag'); if (diagPanel) diagPanel.open = false; if (nowarfyRemoteStateTimer) clearInterval(nowarfyRemoteStateTimer); if (nowarfyDeviceRefreshTimer) clearInterval(nowarfyDeviceRefreshTimer); nowarfyRemoteStateTimer = null; nowarfyDeviceRefreshTimer = null; if (nowarfyRemoteShadowTimer) clearInterval(nowarfyRemoteShadowTimer); nowarfyRemoteShadowTimer = null; nowarfyRemoteDevices = []; nowarfyRemoteBroadcastReady = false; nowarfyBroadcastChannelReady = false; nowarfyRemoteSeenCommandIds.clear(); if (nowarfyBroadcastChannel) { nowarfyBroadcastChannel.close(); nowarfyBroadcastChannel = null; } if (nowarfyRemoteChannel && nowarfySupabase) await nowarfySupabase.removeChannel(nowarfyRemoteChannel); nowarfyRemoteChannel = null; nowarfyRemoteSession = null; nowarfyRemoteShadowSong = null; nowarfyRemoteShadowState = null; nowarfyRemoteDeviceId = null; nowarfyRemoteIsPlayer = false; renderNowarfyDeviceDock(); }
async function claimNowarfyPlayer() { return selectNowarfyPlaybackDevice(nowarfyRemoteDeviceId); }
async function selectNowarfyPlaybackDevice(deviceId) {
    if (nowarfyClaimInFlight) return;
    if (!nowarfySupabase || !nowarfyAuthUser) { remoteStatus('La sesión todavía no está lista.'); return; }
    if (!nowarfyRemoteSession) { try { await setupNowarfyRemoteControl(); } catch (_) {} }
    if (!nowarfyRemoteSession || !deviceId) { remoteStatus('No se encontró ese dispositivo conectado.'); return; }
    nowarfyClaimInFlight = true;
    updateNowarfyAuthUI();
    remoteStatus(deviceId === nowarfyRemoteDeviceId ? 'Conectando este dispositivo como reproductor…' : 'Enviando la reproducción al dispositivo elegido…');
    try {
        const nextState = nowarfyRemoteIsPlayer ? remoteStateSnapshot() : (nowarfyRemoteSession.state || remoteStateSnapshot());
        const result = await nowarfySupabase.from('youtoo_remote_sessions')
            .update({ active_device_id: deviceId, state: nextState, version: Number(nowarfyRemoteSession.version || 0) + 1, updated_at: new Date().toISOString(), expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() })
            .eq('id', nowarfyRemoteSession.id).eq('user_id', nowarfyAuthUser.id).select('*').maybeSingle();
        if (result.error) throw result.error;
        if (!result.data || result.data.active_device_id !== deviceId) throw new Error('Supabase no confirmó el dispositivo elegido.');
        nowarfyRemoteSession = result.data;
        nowarfyDeviceDockPinned = true;
        nowarfyRemoteDiagLog('Handoff solicitado', `→ ${nowarfyRemoteDiagShortId(deviceId)} · v${result.data.version ?? 0}`);
        const wasLocalPlayer = nowarfyRemoteIsPlayer;
        nowarfyRemoteIsPlayer = deviceId === nowarfyRemoteDeviceId;
        updateRemoteShadowTimer();
        if (deviceId !== nowarfyRemoteDeviceId && wasLocalPlayer) {
            stopAll();
            isPlaying = false;
            updateIcon();
            setTrackLoading(false);
        }
        if (nowarfyRemoteIsPlayer) {
            await touchNowarfyRemoteDevice();
            await executeNowarfyRemoteCommand({ type: 'handoff', state: nextState });
        } else {
            const handoffCommand = { type: 'handoff', targetDeviceId: deviceId, state: nextState };
            const handoffId = `handoff-${nowarfyRemoteDeviceId}-${Date.now()}`;
            // El broadcast llega al instante; el insert queda como respaldo para
            // cuando el realtime de la tabla de comandos no está disponible.
            if (nowarfyBroadcastChannelReady && nowarfyBroadcastChannel) {
                try { nowarfyBroadcastChannel.postMessage({ type: 'remote-command', senderDeviceId: nowarfyRemoteDeviceId, commandId: handoffId, command: handoffCommand }); } catch (_) {}
            }
            if (nowarfyRemoteBroadcastReady && nowarfyRemoteChannel) {
                try { await nowarfyRemoteChannel.send({ type: 'broadcast', event: 'remote-command', payload: { commandId: handoffId, senderDeviceId: nowarfyRemoteDeviceId, command: handoffCommand } }); } catch (_) {}
            }
            const handoff = await nowarfySupabase.from('youtoo_remote_commands').insert({ session_id: nowarfyRemoteSession.id, user_id: nowarfyAuthUser.id, device_id: nowarfyRemoteDeviceId, command: handoffCommand });
            if (handoff.error) throw handoff.error;
            nowarfyHandoffPendingUntil = Date.now() + 6000;
        }
        remoteStatus(nowarfyRemoteIsPlayer ? 'Este dispositivo es el reproductor activo.' : 'Reproducción enviada al dispositivo elegido.');
        updateNowarfyAuthUI();
        await refreshNowarfyRemoteDevices();
        if (nowarfyRemoteIsPlayer) await publishNowarfyRemoteState();
        showToast(nowarfyRemoteIsPlayer ? 'Este dispositivo reproduce ahora.' : 'Reproducción enviada al dispositivo elegido.', 'fa-mobile-screen-button');
    } catch (error) {
        remoteStatus(`No se pudo elegir el dispositivo: ${error?.message || 'error de sesión'}`);
    } finally {
        nowarfyClaimInFlight = false;
        updateNowarfyAuthUI();
        await refreshNowarfyRemoteDevices();
    }
}
async function releaseNowarfyPlayer() { if (!nowarfySupabase || !nowarfyRemoteSession || !nowarfyRemoteIsPlayer) return; await nowarfySupabase.from('youtoo_remote_sessions').update({ active_device_id: null, state: remoteStateSnapshot(), version: Number(nowarfyRemoteSession.version || 0) + 1, updated_at: new Date().toISOString() }).eq('id', nowarfyRemoteSession.id); nowarfyRemoteIsPlayer = false; updateNowarfyAuthUI(); remoteStatus('Reproductor liberado; este dispositivo queda como control.'); }
async function publishNowarfyRemoteState() {
    if (!nowarfySupabase || !nowarfyRemoteSession || !nowarfyRemoteIsPlayer) return;
    const state = remoteStateSnapshot();
    nowarfyRemoteLastPublishAt = Date.now();
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    // Enviar primero por BroadcastChannel para respuesta instantánea en tabs del mismo navegador
    if (nowarfyBroadcastChannelReady && nowarfyBroadcastChannel) {
        try { nowarfyBroadcastChannel.postMessage({ type: 'remote-state', senderDeviceId: nowarfyRemoteDeviceId, state }); } catch (_) {}
    }
    if (nowarfyRemoteBroadcastReady && nowarfyRemoteChannel) {
        try { await nowarfyRemoteChannel.send({ type: 'broadcast', event: 'remote-state', payload: { senderDeviceId: nowarfyRemoteDeviceId, state } }); } catch (_) {}
    }
    const result = await nowarfySupabase.from('youtoo_remote_sessions').update({ state, version: Number(nowarfyRemoteSession.version || 0) + 1, updated_at: new Date().toISOString(), expires_at: expiresAt }).eq('id', nowarfyRemoteSession.id).eq('active_device_id', nowarfyRemoteDeviceId);
    if (!result.error) {
        nowarfyRemoteSession.state = state;
        nowarfyRemoteSession.expires_at = expiresAt;
    }
}
function updateRemoteShadowTimer() {
    if (nowarfyRemoteShadowTimer) clearInterval(nowarfyRemoteShadowTimer);
    nowarfyRemoteShadowTimer = null;
    if (nowarfyRemoteSession && !nowarfyRemoteIsPlayer && !nowarfyPageHidden) nowarfyRemoteShadowTimer = setInterval(updateRemoteShadowProgress, 500);
}
function syncNowarfyRemoteTimers() {
    if (nowarfyDeviceRefreshTimer) clearInterval(nowarfyDeviceRefreshTimer);
    if (nowarfyRemoteStateTimer) clearInterval(nowarfyRemoteStateTimer);
    nowarfyDeviceRefreshTimer = null;
    nowarfyRemoteStateTimer = null;
    if (!nowarfyRemoteSession) return;
    if (!nowarfyPageHidden) nowarfyDeviceRefreshTimer = setInterval(() => { void refreshNowarfyRemoteDevices(); }, 5000);
    // El reproductor activo debe conservar su heartbeat aunque su pestaña esté oculta.
    if (!nowarfyPageHidden || nowarfyRemoteIsPlayer) {
        nowarfyRemoteStateTimer = setInterval(() => {
            void touchNowarfyRemoteDevice();
            if (nowarfyRemoteIsPlayer) void publishNowarfyRemoteState();
        }, 3000);
    }
}
function updateRemoteShadowProgress() {
    if (nowarfyRemoteIsPlayer || !nowarfyRemoteShadowState) return;
    const state = nowarfyRemoteShadowState;
    const duration = Number(state.duration || 0);
    if (!duration) return;
    const capturedAt = Number(state.positionAt) || Date.parse(state.updatedAt) || Date.now();
    const elapsed = state.isPlaying ? Math.max(0, (Date.now() - capturedAt) / 1000) : 0;
    const position = Math.min(duration, Math.max(0, Number(state.position || 0) + elapsed));
    const pct = Math.max(0, Math.min(100, position / duration * 100));
    progFill.style.width = `${pct}%`;
    progThumb.style.left = `${pct}%`;
    currTimeEl.innerText = format(position);
    totalTimeEl.innerText = format(duration);
}
function updateRemoteControlsFromState(state, forceQueue = false) {
    if (!state) return;
    if (!nowarfyRemoteIsPlayer) nowarfyRemoteLastStateAt = Date.now();
    if (!nowarfyRemoteIsPlayer) nowarfyRemoteShadowState = { ...state };
    if ((!nowarfyRemoteIsPlayer || forceQueue) && Array.isArray(state.playlist) && state.playlist.length) {
        const remoteQueue = state.playlist.map(item => ({ ...item, _qid: item._qid || queueIdCounter++ })).filter(item => item.url);
        if (remoteQueue.length) {
            queue = remoteQueue;
            queueSeenKeys = new Set(queue.map(songKey));
            currentPlayingQid = state.currentQid || state.resourceId || queue[0]?._qid || null;
            currentIndex = queue.findIndex(item => item._qid === state.currentQid || String(item.url) === String(state.resourceId));
            if (currentIndex < 0) currentIndex = 0;
            persistQueue();
            renderQueue();
        }
    }
    if (!nowarfyRemoteIsPlayer && state.resourceId) {
        const currentQueueItem = Array.isArray(queue) && currentIndex >= 0 ? queue[currentIndex] : null;
        const nextShadow = { _qid: currentQueueItem?._qid || state.currentQid || null, type: state.type || 'yt', url: state.resourceId, title: state.title || 'Reproduciendo en otro dispositivo', artist: state.artist || '', img: state.img || '', channelId: state.channelId || '' };
        if (!nowarfyRemoteShadowSong || nowarfyRemoteShadowSong.url !== nextShadow.url || nowarfyRemoteShadowSong.title !== nextShadow.title) { nowarfyRemoteShadowSong = nextShadow; updateNowPlaying(nextShadow); }
        isPlaying = !!state.isPlaying;
        updateIcon();
        updateRemoteShadowProgress();
    }
    const volume = document.getElementById('volumeSlider');
    if (volume && document.activeElement !== volume && Number.isFinite(Number(state.volume))) { volume.value = Number(state.volume) / 100; volume.style.background = `linear-gradient(to right, var(--accent) ${Number(state.volume)}%, #535353 ${Number(state.volume)}%)`; }
    if (nowarfyMirrorEnabled && !nowarfyRemoteIsPlayer) void applyNowarfyMirrorState(state);
}
function nowarfyRemoteDiagLog(label, detail = '') {
    nowarfyRemoteDiagEvents.unshift({ at: Date.now(), label, detail });
    if (nowarfyRemoteDiagEvents.length > 6) nowarfyRemoteDiagEvents.length = 6;
}
function nowarfyRemoteDiagAge(timestamp) {
    if (!timestamp) return '—';
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    return seconds < 1 ? 'ahora' : `hace ${seconds}s`;
}
function nowarfyRemoteDiagShortId(value) {
    return value ? String(value).slice(0, 8) : '—';
}
function onNowarfyRemoteDiagToggle() {
    const panel = document.getElementById('nowarfyRemoteDiag');
    if (nowarfyRemoteDiagTimer) { clearInterval(nowarfyRemoteDiagTimer); nowarfyRemoteDiagTimer = null; }
    if (!panel || !panel.open) return;
    renderNowarfyRemoteDiag();
    // Solo refresca mientras el panel está abierto y visible en este dispositivo.
    nowarfyRemoteDiagTimer = setInterval(renderNowarfyRemoteDiag, 500);
    nowarfyRemoteDiagLog('Diagnóstico abierto', `${nowarfyRemoteDevices.length} dispositivos visibles`);
}
function renderNowarfyRemoteDiag() {
    if (!document.getElementById('nowarfyRemoteDiagLog')) return;
    const set = (id, value) => { const el = document.getElementById(id); if (el && el.textContent !== value) el.textContent = value; };
    // El snapshot toca el reproductor; si un módulo aún no cargó, el panel no debe romperse.
    let state = null;
    try { state = nowarfyRemoteIsPlayer ? remoteStateSnapshot() : (nowarfyRemoteShadowState || nowarfyRemoteSession?.state || null); } catch (_) { state = nowarfyRemoteShadowState || null; }
    const duration = Number(state?.duration) || 0;
    const position = Number(state?.position) || 0;
    const heartbeat = nowarfyRemoteIsPlayer ? nowarfyRemoteLastPublishAt : nowarfyRemoteLastStateAt;
    set('ndRol', !nowarfyAuthUser ? 'sin sesión' : nowarfyRemoteIsPlayer ? 'reproductor' : 'control');
    set('ndDevice', nowarfyRemoteDiagShortId(nowarfyRemoteDeviceId));
    set('ndSession', nowarfyRemoteDiagShortId(nowarfyRemoteSession?.id));
    set('ndVersion', nowarfyRemoteSession ? String(nowarfyRemoteSession.version ?? 0) : '—');
    set('ndRealtime', nowarfyRemoteBroadcastReady ? 'conectado' : 'sin conexión');
    set('ndTabs', nowarfyBroadcastChannelReady ? 'activo' : 'no');
    set('ndState', state ? `${format(position)} / ${format(duration)} · ${nowarfyRemoteIsPlayer ? 'publicado' : 'recibido'} ${nowarfyRemoteDiagAge(heartbeat)}` : '—');
    set('ndQueue', `${Array.isArray(queue) ? queue.length : 0} en cola · ${nowarfyPendingRemoteCommands.length} pendientes`);
    set('ndCommand', nowarfyRemoteLastCommandLabel || '—');
    const list = document.getElementById('nowarfyRemoteDiagLog');
    list.innerHTML = nowarfyRemoteDiagEvents.length
        ? nowarfyRemoteDiagEvents.map(event => `<li><time>${new Date(event.at).toLocaleTimeString()}</time> <strong>${escapeHtml(event.label)}</strong>${event.detail ? ` <span>${escapeHtml(event.detail)}</span>` : ''}</li>`).join('')
        : '<li class="is-empty">Todavía no hay eventos.</li>';
}
async function copyNowarfyRemoteDiag() {
    const panel = document.getElementById('nowarfyRemoteDiag');
    if (!panel) return;
    const labels = [...panel.querySelectorAll('.nowarfy-remote-diag-grid span')].map(el => el.textContent);
    const values = [...panel.querySelectorAll('.nowarfy-remote-diag-grid code')].map(el => el.textContent);
    const events = nowarfyRemoteDiagEvents.map(event => `${new Date(event.at).toLocaleTimeString()} ${event.label} ${event.detail}`.replace(/\s+$/, ''));
    const text = [
        `Nowarfy · diagnóstico remoto · ${new Date().toISOString()}`,
        ...labels.map((label, index) => `${label}: ${values[index] || '—'}`),
        '',
        'Eventos:',
        ...(events.length ? events : ['sin eventos'])
    ].join('\n');
    try {
        await navigator.clipboard.writeText(text);
        showToast('Diagnóstico copiado al portapapeles', 'fa-copy');
    } catch (_) {
        showToast('No se pudo copiar el diagnóstico', 'fa-triangle-exclamation');
    }
}
async function sendNowarfyCommand(type, value = null, optimisticUpdate = false) {
    if (!nowarfySupabase || !nowarfyAuthUser || !nowarfyRemoteSession) return;
    if (nowarfyRemoteIsPlayer) { 
        await executeNowarfyRemoteCommand({ type, value }); 
        return; 
    }
    
    // Optimistic update: actualizar UI localmente antes de confirmar
    if (optimisticUpdate) {
        applyOptimisticUpdate(type, value);
    }
    
    const commandId = `${nowarfyRemoteDeviceId || 'device'}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const command = { type, value, commandId };
    nowarfyRemoteLastCommandLabel = `${type}${value === null || value === undefined ? '' : ` (${typeof value === 'object' ? 'objeto' : value})`} · enviado`;
    nowarfyRemoteDiagLog('Comando enviado', `${type} → ${nowarfyRemoteDiagShortId(nowarfyRemoteSession.active_device_id)}`);
    const isRealtimeCommand = ['volume', 'seekPercent', 'seekDelta'].includes(type);
    let broadcastSent = false;
    // Enviar primero por BroadcastChannel para respuesta instantánea en tabs del mismo navegador
    if (nowarfyBroadcastChannelReady && nowarfyBroadcastChannel) {
        try {
            nowarfyBroadcastChannel.postMessage({ type: 'remote-command', senderDeviceId: nowarfyRemoteDeviceId, commandId, command });
            broadcastSent = true;
        } catch (_) { broadcastSent = false; }
    }
    if (nowarfyRemoteBroadcastReady && nowarfyRemoteChannel) {
        try {
            const response = await nowarfyRemoteChannel.send({ type: 'broadcast', event: 'remote-command', payload: { commandId, senderDeviceId: nowarfyRemoteDeviceId, command } });
            broadcastSent = broadcastSent || response?.status === 'ok' || response?.status === 'success';
        } catch (_) { }
    }
    if (isRealtimeCommand && broadcastSent) return;
    const result = await nowarfySupabase.from('youtoo_remote_commands').insert({ session_id: nowarfyRemoteSession.id, user_id: nowarfyAuthUser.id, device_id: nowarfyRemoteDeviceId, command });
    if (result.error && !broadcastSent) remoteStatus('No se pudo enviar el comando remoto.');
}

function applyOptimisticUpdate(type, value) {
    // Actualizar UI inmediatamente para mejor percepción de velocidad
    if (type === 'toggle') {
        isPlaying = !isPlaying;
        updateIcon();
    } else if (type === 'play') {
        isPlaying = true;
        updateIcon();
    } else if (type === 'pause') {
        isPlaying = false;
        updateIcon();
    } else if (type === 'volume') {
        const volumeSlider = document.getElementById('volumeSlider');
        if (volumeSlider) {
            const vol = Math.max(0, Math.min(100, Number(value)));
            volumeSlider.value = vol / 100;
            volumeSlider.style.background = `linear-gradient(to right, var(--accent) ${vol}%, #535353 ${vol}%)`;
        }
    } else if (type === 'seekPercent') {
        const progressContainer = document.querySelector('.progress-container');
        if (progressContainer && nowarfyRemoteShadowState?.duration) {
            const percent = Math.max(0, Math.min(100, Number(value)));
            const duration = nowarfyRemoteShadowState.duration;
            const newPosition = (percent / 100) * duration;
            updateProgressUI(newPosition, duration);
        }
    }
}
function nowarfyHideHandoffPrompt() { const prompt = document.getElementById('nowarfyHandoffPrompt'); if (prompt) prompt.hidden = true; }
function showNowarfyHandoffPrompt() { const prompt = document.getElementById('nowarfyHandoffPrompt'); if (prompt) prompt.hidden = false; }
function nowarfyRemoteIsActuallyPlaying() {
    let song = null;
    try { song = currentQueueSong?.() || null; } catch (_) { song = null; }
    if (song?.type === 'yt') {
        try {
            const state = ytPlayer?.getPlayerState?.();
            return state === window.YT?.PlayerState?.PLAYING || state === window.YT?.PlayerState?.BUFFERING;
        } catch (_) { return false; }
    }
    return typeof activeAudioEl !== 'undefined' && !!activeAudioEl && !activeAudioEl.paused;
}
// El navegador bloquea el audio remoto hasta que haya una interacción real en
// este equipo. Devolver true significa que el error ya está explicado al usuario.
function nowarfyHandleAutoplayBlocked(error) {
    if (!nowarfyRemoteIsPlayer) return false;
    if (error?.name && error.name !== 'NotAllowedError' && error.name !== 'AbortError') return false;
    nowarfyAudioUnlocked = false;
    isPlaying = false;
    nowarfyPendingHandoff = (typeof currentIndex === 'number' && currentIndex >= 0 && queue[currentIndex])
        ? { idx: currentIndex, state: remoteStateSnapshot() }
        : null;
    try { updateIcon(); } catch (_) {}
    try { updatePlaybackState?.(); } catch (_) {}
    try { setTrackLoading?.(false); } catch (_) {}
    showNowarfyHandoffPrompt();
    remoteStatus('El navegador bloqueó el audio en este equipo: tocá «Desbloquear audio».');
    nowarfyRemoteDiagLog('Audio bloqueado', 'política de autoplay');
    void publishNowarfyRemoteState();
    return true;
}
function nowarfyRetryRemotePlayback() {
    let song = null;
    try { song = currentQueueSong?.() || null; } catch (_) { song = null; }
    if (!song) return false;
    if (song.type === 'yt') {
        if (!ytPlayer?.playVideo) return false;
        try {
            playbackStoppedByUser = false;
            ytPlaybackIntent = true;
            ytPlayer.playVideo();
            return true;
        } catch (_) { return false; }
    }
    if (typeof activeAudioEl === 'undefined' || !activeAudioEl) return false;
    const attempt = activeAudioEl.play();
    if (attempt?.catch) attempt.catch(() => nowarfyHandleAutoplayBlocked());
    return true;
}
// Vigila que el traspaso remoto realmente arranque. Si el navegador lo bloquea,
// muestra el aviso en este equipo y refleja la pausa en el control.
function nowarfyWatchRemotePlayback(attempt = 0) {
    const delays = [1800, 2500, 5000, 6000];
    const expectedUrl = (() => { try { return currentQueueSong?.()?.url || ''; } catch (_) { return ''; } })();
    window.setTimeout(() => {
        if (!nowarfyRemoteIsPlayer) return;
        let song = null;
        try { song = currentQueueSong?.() || null; } catch (_) { song = null; }
        if ((song?.url || '') !== expectedUrl) return;
        if (playbackStoppedByUser) return;
        if (nowarfyRemoteIsActuallyPlaying()) { nowarfyHideHandoffPrompt(); return; }
        // La API de YouTube puede estar cargando todavía; no declarar bloqueo antes de tiempo.
        if (song?.type === 'yt' && !ytPlayer && attempt < delays.length - 1) { nowarfyWatchRemotePlayback(attempt + 1); return; }
        if (attempt < delays.length - 1) {
            nowarfyRetryRemotePlayback();
            nowarfyWatchRemotePlayback(attempt + 1);
            return;
        }
        nowarfyHandleAutoplayBlocked();
    }, delays[Math.min(attempt, delays.length - 1)]);
}
async function unlockNowarfyHandoff() {
    nowarfyAudioUnlocked = true;
    const pending = nowarfyPendingHandoff;
    nowarfyPendingHandoff = null;
    if (!pending && nowarfyRemoteIsActuallyPlaying()) { nowarfyHideHandoffPrompt(); return; }
    let song = pending && queue[pending.idx] ? queue[pending.idx] : null;
    if (!song) { try { song = currentQueueSong?.() || null; } catch (_) { song = null; } }
    const position = Number(pending?.state?.position) || 0;
    try {
        if (!song) { nowarfyHideHandoffPrompt(); return; }
        if (pending && currentIndex !== pending.idx) {
            playbackStoppedByUser = false;
            playQueueAt(pending.idx, { resumeSession: { ...(pending.state || {}), wasPlaying: true } });
        } else if (song.type === 'yt') {
            playbackStoppedByUser = false;
            ytPlaybackIntent = true;
            if (ytPlayer?.playVideo) {
                if (position > 0) { try { ytPlayer.seekTo(position, true); } catch (_) {} }
                ytPlayer.playVideo();
            } else {
                playQueueAt(currentIndex, pending ? { resumeSession: { ...(pending.state || {}), wasPlaying: true } } : {});
            }
        } else if (typeof activeAudioEl !== 'undefined' && activeAudioEl?.src) {
            playbackStoppedByUser = false;
            if (position > 0) { try { activeAudioEl.currentTime = position; } catch (_) {} }
            await activeAudioEl.play();
        } else {
            playbackStoppedByUser = false;
            playQueueAt(currentIndex, pending ? { resumeSession: { ...(pending.state || {}), wasPlaying: true } } : {});
        }
        isPlaying = true;
        updateIcon();
        try { updatePlaybackState?.(); } catch (_) {}
        nowarfyHideHandoffPrompt();
        await publishNowarfyRemoteState();
    } catch (error) {
        nowarfyPendingHandoff = pending || nowarfyPendingHandoff;
        isPlaying = false;
        try { updateIcon(); } catch (_) {}
        remoteStatus('El navegador no permitió iniciar el audio en este dispositivo. Probá tocar el botón otra vez.');
        showNowarfyHandoffPrompt();
    }
}
async function executeNowarfyRemoteCommand(command) {
    if (!nowarfyRemoteIsPlayer) return;
    const type = command.type;
    nowarfyRemoteLastCommandLabel = `${type}${command.value === null || command.value === undefined ? '' : ' (valor)'} · recibido`;
    nowarfyRemoteDiagLog('Comando recibido', String(type || 'sin tipo'));
    if (type === 'handoff') {
        const state = command.state || nowarfyRemoteSession?.state || {};
        const shouldPlay = state.isPlaying !== false;
        // Si este equipo ya está reproduciendo justo esa pista (por ejemplo,
        // porque el polling y el comando de handoff llegaron casi juntos), no
        // la reiniciamos.
        if (shouldPlay && state.resourceId && nowarfyRemoteIsActuallyPlaying() && nowarfyMirrorLoadedUrl(currentQueueSong()) === String(state.resourceId)) return;
        if (Array.isArray(state.playlist) && state.playlist.length) updateRemoteControlsFromState(state, true);
        const targetUrl = state.resourceId || state.title;
        let idx = queue.findIndex(song => (state.currentQid && song._qid === state.currentQid) || (targetUrl && String(song.url) === String(targetUrl)));
        if (idx < 0 && state.resourceId) {
            const incoming = { _qid: state.currentQid || `remote-${Date.now()}`, url: state.resourceId, type: state.type || 'yt', title: state.title || 'Reproducción remota', artist: state.artist || '', img: state.img || '', channelId: state.channelId || '', duration: Number(state.duration) || 0 };
            queue.unshift(incoming); queueSeenKeys.add(songKey(incoming)); idx = 0;
        }
        if (idx >= 0) {
            nowarfyPendingHandoff = null;
            nowarfyHideHandoffPrompt();
            playbackStoppedByUser = !shouldPlay;
            // Intentamos reproducir siempre: si el navegador ya tiene interacción
            // (lo normal), arranca sin tocar nada. Si la bloquea, el vigilante
            // muestra el aviso en este equipo y avisa al control remoto.
            playQueueAt(idx, { resumeSession: { ...state, wasPlaying: shouldPlay } });
            const volume = Math.max(0, Math.min(100, Number(state.volume ?? 80))) / 100;
            setVolume(volume);
            if (shouldPlay) nowarfyWatchRemotePlayback(0);
            if (!shouldPlay && state.type !== 'yt' && Number(state.position) > 0) window.setTimeout(() => { if (activeAudioEl) activeAudioEl.currentTime = Number(state.position) || 0; }, 250);
        }
        return;
    }
    if (type === 'playSong') {
        // Comando para reproducir una canción específica desde otro dispositivo
        // Aceptar ambos formatos: el protocolo de la PR y el de main.
        const song = command.song || command.value;
        const startIndex = Number(command.startIndex) || 0;
        if (!song?.url) return;
        
        // Agregar la canción a la cola si no está
        const k = songKey(song);
        let idx = queue.findIndex(s => songKey(s) === k);
        if (idx < 0) {
            const q = withQid(song);
            queueSeenKeys.add(k);
            queue.push(q);
            idx = queue.length - 1;
            persistQueue();
            renderQueue();
        }
        
        // Reproducir desde el índice especificado (para soporte de playlists)
        const playIdx = Math.max(0, Math.min(idx + startIndex, queue.length - 1));
        playQueueAt(playIdx, { sourceIdx: playIdx, resumeSession: { wasPlaying: true } });
        nowarfyWatchRemotePlayback(0);
        await publishNowarfyRemoteState();
        return;
    }
    if (type === 'addToQueue') {
        // Comando para agregar una canción a la cola desde otro dispositivo
        const song = command.song;
        if (!song?.url) return;
        
        const k = songKey(song);
        if (queueSeenKeys.has(k)) {
            showToast('Ya está en la Playlist', 'fa-circle-info');
            return;
        }
        
        const q = withQid(song);
        queueSeenKeys.add(k);
        queue.push(q);
        void reserveDiscoveredCandidates([song], { context: 'queue', seed: song, queryContext: 'queue' });
        persistQueue();
        renderQueue();
        showToast(`"${song.title}" agregada a la cola`, 'fa-list');
        if (currentPlayingQid == null) playQueueAt(queue.length - 1);
        await publishNowarfyRemoteState();
        return;
    }
    if (type === 'toggle') {
        togglePlay();
        if (isPlaying) nowarfyWatchRemotePlayback(0);
    } else if (type === 'next') {
        nextSong(true);
        nowarfyWatchRemotePlayback(0);
    } else if (type === 'prev') {
        prevSong();
        nowarfyWatchRemotePlayback(0);
    } else if (type === 'volume') setVolume(Math.max(0, Math.min(100, Number(command.value))) / 100);
    else if (type === 'seekPercent') commitSeek(Math.max(0, Math.min(100, Number(command.value))) / 100);
    else if (type === 'seekDelta') {
        const delta = Number(command.value) || 0;
        const song = currentQueueSong();
        if (song?.type === 'yt' && ytPlayer?.getCurrentTime) ytPlayer.seekTo(Math.max(0, ytPlayer.getCurrentTime() + delta), true);
        else if (activeAudioEl) activeAudioEl.currentTime = Math.max(0, Math.min(activeAudioEl.duration || 0, activeAudioEl.currentTime + delta));
    } else if (type === 'pause' && isPlaying) togglePlay();
    else if (type === 'play' && !isPlaying) {
        togglePlay();
        if (isPlaying) nowarfyWatchRemotePlayback(0);
    }
    await publishNowarfyRemoteState();
}

// Si el realtime de la tabla de sesiones no está habilitado (o llega tarde), un
// comando dirigido a este equipo es la señal para volver a leer quién manda.
async function refreshNowarfyRemoteRole() {
    if (!nowarfySupabase || !nowarfyRemoteSession?.id || !nowarfyRemoteDeviceId) return nowarfyRemoteIsPlayer;
    if (Date.now() - nowarfyRoleRefreshAt < 1200) return nowarfyRemoteIsPlayer;
    nowarfyRoleRefreshAt = Date.now();
    const result = await nowarfySupabase.from('youtoo_remote_sessions').select('*').eq('id', nowarfyRemoteSession.id).maybeSingle();
    if (result.error || !result.data) return nowarfyRemoteIsPlayer;
    nowarfyRemoteSession = result.data;
    const wasPlayer = nowarfyRemoteIsPlayer;
    nowarfyRemoteIsPlayer = result.data.active_device_id === nowarfyRemoteDeviceId;
    if (!wasPlayer && nowarfyRemoteIsPlayer) {
        nowarfyRemoteDiagLog('Rol recuperado', 'este equipo es reproductor');
        updateRemoteShadowTimer();
        syncNowarfyRemoteTimers();
        updateNowarfyAuthUI();
        renderNowarfyDeviceDock();
        remoteStatus('Este dispositivo es el reproductor activo.');
        if (result.data.state) updateRemoteControlsFromState(result.data.state);
    }
    return nowarfyRemoteIsPlayer;
}
function nowarfyFlushPendingRemoteCommands() {
    if (!nowarfyRemoteIsPlayer || !nowarfyPendingRemoteCommands.length) return;
    const pending = nowarfyPendingRemoteCommands.splice(0);
    pending.forEach(command => {
        // Los comandos viejos ya no representan lo que el usuario quiere ahora.
        if (Date.now() - Number(command._receivedAt || Date.now()) < 20000) void executeNowarfyRemoteCommand(command);
    });
}
// Respaldo por polling: si Realtime no entrega el cambio de sesión, este equipo
// igual se entera en pocos segundos de que fue elegido como reproductor.
async function reconcileNowarfyRemoteRole() {
    if (!nowarfySupabase || !nowarfyAuthUser || !nowarfyRemoteSession?.id || !nowarfyRemoteDeviceId) return;
    if (Date.now() - nowarfyRoleReconcileAt < 8000) return;
    nowarfyRoleReconcileAt = Date.now();
    const result = await nowarfySupabase.from('youtoo_remote_sessions').select('*').eq('id', nowarfyRemoteSession.id).maybeSingle();
    if (result.error || !result.data) return;
    const wasPlayer = nowarfyRemoteIsPlayer;
    const isPlayerNow = result.data.active_device_id === nowarfyRemoteDeviceId;
    if (wasPlayer === isPlayerNow) {
        // El reproductor no se pisa su propia sesión con una lectura vieja.
        if (!isPlayerNow) {
            nowarfyRemoteSession = result.data;
            if (result.data.state) updateRemoteControlsFromState(result.data.state);
        }
        return;
    }
    nowarfyRemoteSession = result.data;
    nowarfyRemoteIsPlayer = isPlayerNow;
    nowarfyDeviceDockPinned = true;
    updateRemoteShadowTimer();
    syncNowarfyRemoteTimers();
    updateNowarfyAuthUI();
    renderNowarfyDeviceDock();
    nowarfyRemoteDiagLog('Rol reconciliado', `${wasPlayer ? 'reproductor' : 'control'} → ${nowarfyRemoteIsPlayer ? 'reproductor' : 'control'}`);
    if (nowarfyRemoteIsPlayer) {
        remoteStatus('Este dispositivo es el reproductor activo.');
        const hasPendingHandoff = nowarfyPendingRemoteCommands.some(command => command.type === 'handoff');
        if (!hasPendingHandoff) await executeNowarfyRemoteCommand({ type: 'handoff', state: result.data.state || remoteStateSnapshot() });
        nowarfyFlushPendingRemoteCommands();
    } else {
        stopAll();
        isPlaying = false;
        updateIcon();
        setTrackLoading(false);
        if (result.data.state) updateRemoteControlsFromState(result.data.state);
        remoteStatus('Control remoto conectado; el reproductor activo está en otro dispositivo.');
    }
}
async function nowarfyHandleIncomingCommand(command) {
    if (!command?.type) return;
    if (nowarfyRemoteIsPlayer) { await executeNowarfyRemoteCommand(command); return; }
    const targeted = command.targetDeviceId && command.targetDeviceId === nowarfyRemoteDeviceId;
    // Los comandos de reproducción merecen una verificación de rol: si el
    // realtime de sesiones falló, esta lectura evita que el play se pierda.
    if (targeted || ['handoff', 'playSong', 'play', 'toggle'].includes(command.type)) {
        if (await refreshNowarfyRemoteRole()) { await executeNowarfyRemoteCommand(command); return; }
    }
    // Solo se guardan los comandos dirigidos a este equipo (por ejemplo, un
    // handoff): los comandos generales son para el reproductor, no para todos
    // los controles, y no deben ejecutarse si este equipo asume el rol después.
    if (!targeted) return;
    nowarfyPendingRemoteCommands.push({ ...command, _receivedAt: Date.now() });
    if (nowarfyPendingRemoteCommands.length > 20) nowarfyPendingRemoteCommands.splice(0, nowarfyPendingRemoteCommands.length - 20);
}

function initRailDragScroll() {
    const rails = document.querySelectorAll('.library-rail, .taste-chips, .nowarfy-device-list');
    rails.forEach(rail => {
        if (rail.dataset.dragInitialized) return;
        rail.dataset.dragInitialized = 'true';
        let isDown = false;
        let startX = 0;
        let scrollLeft = 0;

        rail.addEventListener('mousedown', (e) => {
            if (e.target.closest('button, a, input')) return;
            isDown = true;
            rail.classList.add('is-dragging');
            startX = e.pageX - rail.offsetLeft;
            scrollLeft = rail.scrollLeft;
        });

        rail.addEventListener('mouseleave', () => {
            isDown = false;
            rail.classList.remove('is-dragging');
        });

        rail.addEventListener('mouseup', () => {
            isDown = false;
            rail.classList.remove('is-dragging');
        });

        rail.addEventListener('mousemove', (e) => {
            if (!isDown) return;
            e.preventDefault();
            const x = e.pageX - rail.offsetLeft;
            const walk = (x - startX) * 1.5;
            rail.scrollLeft = scrollLeft - walk;
        });
    });
}

let sectionInfiniteObserver = null;
let sectionInfiniteLoading = false;

function attachSectionInfiniteScroll(container, loadMoreCallback) {
    if (!container || !('IntersectionObserver' in window)) return;
    let sentinel = container.querySelector('.nowarfy-infinite-sentinel');
    if (!sentinel) {
        sentinel = document.createElement('div');
        sentinel.className = 'nowarfy-infinite-sentinel';
        sentinel.innerHTML = '<div class="nowarfy-orbit-loader" style="width:36px;height:36px;"></div><span>Sumando más propuestas...</span>';
        container.appendChild(sentinel);
    }
    sectionInfiniteObserver?.disconnect();
    sectionInfiniteObserver = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting) && !sectionInfiniteLoading) {
            sectionInfiniteLoading = true;
            Promise.resolve(loadMoreCallback()).finally(() => {
                setTimeout(() => { sectionInfiniteLoading = false; }, 400);
            });
        }
    }, { rootMargin: '400px 0px' });
    sectionInfiniteObserver.observe(sentinel);
}

let scrollAssembleObserver = null;

function initScrollAssemblyEngine() {
    if (!('IntersectionObserver' in window)) return;
    const container = document.querySelector('.content-area') || document.body;

    scrollAssembleObserver?.disconnect();
    scrollAssembleObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const el = entry.target;
            if (entry.isIntersecting && entry.intersectionRatio > 0.08) {
                el.classList.remove('is-disassembled');
                el.classList.add('is-assembled');
            } else {
                const bounds = entry.boundingClientRect;
                if (bounds.top < 80) {
                    el.classList.add('is-disassembled');
                    el.classList.remove('is-assembled');
                } else {
                    el.classList.remove('is-assembled');
                    el.classList.remove('is-disassembled');
                }
            }
        });
    }, {
        root: container.classList.contains('content-area') ? container : null,
        threshold: [0, 0.1, 0.5, 0.9, 1],
        rootMargin: '20px 0px 20px 0px'
    });

    observeScrollAssembly();
}

function observeScrollAssembly(parent = document) {
    if (!scrollAssembleObserver) return;
    const selectors = '.card, .song-row, .discovery-card, .video-card, .playlist-card, .library-rail-section, .home-welcome, .section-title, .featured-rail';
    const targets = parent.querySelectorAll(selectors);
    targets.forEach((el, index) => {
        if (!el.classList.contains('scroll-assemble')) {
            el.classList.add('scroll-assemble');
            el.setAttribute('data-stagger', String((index % 4) + 1));
        }
        scrollAssembleObserver.observe(el);
    });
}

function initTouchSwipeGestures() {
    const queuePanel = document.getElementById('queuePanel');
    if (queuePanel && !queuePanel.dataset.touchInitialized) {
        queuePanel.dataset.touchInitialized = 'true';
        let startX = 0;
        let startY = 0;
        queuePanel.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) return;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        }, { passive: true });

        queuePanel.addEventListener('touchend', (e) => {
            if (!e.changedTouches.length) return;
            const deltaX = e.changedTouches[0].clientX - startX;
            const deltaY = e.changedTouches[0].clientY - startY;
            if (deltaX > 80 && Math.abs(deltaY) < 60) {
                closeQueuePanel();
            }
        }, { passive: true });
    }

    initRailDragScroll();
    initAutoMovingCarousels();
}

let autoCarouselAnimationFrame = null;
let activeAutoCarousels = [];

function initAutoMovingCarousels() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const rails = document.querySelectorAll('.library-rail');
    rails.forEach((rail, index) => {
        if (rail.dataset.autoCarouselInitialized) return;
        rail.dataset.autoCarouselInitialized = 'true';
        rail.classList.add('auto-carousel');

        let isPaused = false;
        let speed = (index % 2 === 0 ? 0.35 : 0.45);

        const pause = () => { isPaused = true; rail.classList.add('auto-paused'); };
        const resume = () => { setTimeout(() => { isPaused = false; rail.classList.remove('auto-paused'); }, 800); };

        rail.addEventListener('mouseenter', pause);
        rail.addEventListener('mouseleave', resume);
        rail.addEventListener('touchstart', pause, { passive: true });
        rail.addEventListener('touchend', resume, { passive: true });
        rail.addEventListener('mousedown', pause);
        rail.addEventListener('mouseup', resume);

        activeAutoCarousels.push({
            el: rail,
            get isPaused() { return isPaused || rail.classList.contains('is-dragging'); },
            step() {
                if (this.isPaused) return;
                if (!this.el.isConnected) return;
                if (rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 2 && rail.scrollLeft > 0) {
                    rail.scrollLeft = 0;
                    return;
                }
                rail.scrollLeft += speed;
                if (rail._appendBatch && rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 140) {
                    rail._appendBatch();
                }
            }
        });
    });

    activeAutoCarousels = activeAutoCarousels.filter(carousel => carousel.el.isConnected);
    if (!autoCarouselAnimationFrame && activeAutoCarousels.length) {
        const loop = () => {
            activeAutoCarousels = activeAutoCarousels.filter(carousel => carousel.el.isConnected);
            activeAutoCarousels.forEach(carousel => carousel.step());
            autoCarouselAnimationFrame = activeAutoCarousels.length ? requestAnimationFrame(loop) : null;
        };
        autoCarouselAnimationFrame = requestAnimationFrame(loop);
    }
}

let currentList = [];
let favorites = JSON.parse(localStorage.getItem('nowarfy_favs')) || [];
let currentIndex = -1;
let isPlaying = false;
