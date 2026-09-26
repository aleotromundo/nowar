// --- HELPER: VIEW TRANSITIONS API ---
// Permite que los cambios de DOM se animen como una App Nativa fluida
function navigateWithTransition(updateDOMCallback) {
    if (!document.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        updateDOMCallback();
        return;
    }
    const transition = document.startViewTransition(() => {
        updateDOMCallback();
    });
    transition.ready.catch(() => {});
    transition.finished.catch(() => {});
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
const NOWARFY_REMOTE_DEVICE_KEY = 'nowarfy_remote_device_key_v1';
const nowarfyRemoteDeviceKey = localStorage.getItem(NOWARFY_REMOTE_DEVICE_KEY) || (() => { const key = (crypto.randomUUID?.() || `${Date.now()}-${Math.random()}-${Math.random()}`).replace(/-/g, ''); localStorage.setItem(NOWARFY_REMOTE_DEVICE_KEY, key); return key; })();

function authStatus(message, isError = false) {
    const target = document.getElementById('nowarfyAuthStatus');
    if (target) { target.textContent = message || ''; target.style.color = isError ? '#ffb5bd' : '#b9e9d5'; }
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
    if (image) { image.src = qrUrl; image.alt = `Código QR para vincular ${nowarfyAuthUser ? 'otro dispositivo a tu cuenta' : 'un dispositivo con Nowarfy'}`; }
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
async function initNowarfyAuth() {
    if (nowarfySupabase) return nowarfySupabase;
    if (nowarfyAuthInitPromise) return nowarfyAuthInitPromise;
    nowarfyAuthInitPromise = (async () => {
        try {
            if (!window.supabase?.createClient) {
                await new Promise((resolve, reject) => {
                    const startedAt = Date.now();
                    const waitForSdk = () => {
                        if (window.supabase?.createClient) return resolve();
                        if (Date.now() - startedAt > 10000) return reject(new Error('El módulo de autenticación no terminó de cargar. Recargá la página e intentá nuevamente.'));
                        window.setTimeout(waitForSdk, 50);
                    };
                    waitForSdk();
                });
            }
            const response = await fetch(AUTH_CONFIG_ENDPOINT, { cache: 'no-store' });
            const config = await response.json().catch(() => ({}));
            if (!response.ok || !config.configured || !window.supabase?.createClient) {
                nowarfyAuthConfigured = false;
                nowarfyAuthInitialised = false;
                updateNowarfyAuthUI();
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
    if (!nowarfyAuthConfigured && !nowarfyAuthUser) authStatus('La autenticación todavía no está configurada en este deployment.', true);
    modal.querySelector('input:not([disabled])')?.focus();
}
function closeNowarfyAuth() {
    const modal = document.getElementById('nowarfyAuthModal');
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.body.classList.remove('auth-modal-open');
    authStatus('');
}
async function submitNowarfyAuth(mode) {
    if (!nowarfySupabase) await initNowarfyAuth();
    if (!nowarfyAuthConfigured || !nowarfySupabase) { authStatus('La autenticación todavía está cargando. Intentá nuevamente en un instante.', true); return; }
    const email = String(document.getElementById('authEmailInput')?.value || '').trim();
    const password = String(document.getElementById('authPasswordInput')?.value || '');
    if (!email) { authStatus('Escribí un email válido.', true); return; }
    if ((mode === 'signin' || mode === 'signup') && password.length < 6) { authStatus('La contraseña debe tener al menos 6 caracteres.', true); return; }
    authStatus('Procesando…');
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
            activeDeviceStale = !!activeDevice.error || !activeDevice.data || (Date.now() - new Date(activeDevice.data.last_seen_at).getTime() > 45000);
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
                if (nowarfyRemoteIsPlayer) void executeNowarfyRemoteCommand(command);
                else nowarfyPendingRemoteCommands.push(command);
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
                if (nowarfyRemoteIsPlayer) void executeNowarfyRemoteCommand(command);
                else nowarfyPendingRemoteCommands.push(command);
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
                if (wasPlayer && !nowarfyRemoteIsPlayer) { stopAll(); isPlaying = false; updateIcon(); setTrackLoading(false); }
                updateNowarfyAuthUI();
                if (payload.new.state) updateRemoteControlsFromState(payload.new.state);
                if (nowarfyRemoteIsPlayer && nowarfyPendingRemoteCommands.length) { const pending = nowarfyPendingRemoteCommands.splice(0); pending.forEach(command => void executeNowarfyRemoteCommand(command)); }
                remoteStatus(nowarfyRemoteIsPlayer ? 'Este dispositivo es el reproductor activo.' : 'Control remoto conectado; el reproductor activo está en otro dispositivo.');
            })
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'youtoo_remote_commands', filter: `user_id=eq.${nowarfyAuthUser.id}` }, payload => { const command = payload.new.command || {}; if (command.commandId && nowarfyRemoteSeenCommandIds.has(command.commandId)) return; if (command.commandId) nowarfyRemoteSeenCommandIds.set(command.commandId, Date.now()); if (payload.new.device_id !== nowarfyRemoteDeviceId && (!command.targetDeviceId || command.targetDeviceId === nowarfyRemoteDeviceId)) { if (nowarfyRemoteIsPlayer) void executeNowarfyRemoteCommand(command); else nowarfyPendingRemoteCommands.push(command); } })
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
    return nowarfyRemoteDevices;
}
function toggleNowarfyDevicePicker() {
    const picker = document.getElementById('nowarfyDevicePicker');
    if (!picker) return;
    picker.hidden = !picker.hidden;
    if (!picker.hidden) void refreshNowarfyRemoteDevices();
}
async function teardownNowarfyRemoteControl() { if (nowarfyRemoteStateTimer) clearInterval(nowarfyRemoteStateTimer); if (nowarfyDeviceRefreshTimer) clearInterval(nowarfyDeviceRefreshTimer); nowarfyRemoteStateTimer = null; nowarfyDeviceRefreshTimer = null; if (nowarfyRemoteShadowTimer) clearInterval(nowarfyRemoteShadowTimer); nowarfyRemoteShadowTimer = null; nowarfyRemoteDevices = []; nowarfyRemoteBroadcastReady = false; nowarfyBroadcastChannelReady = false; nowarfyRemoteSeenCommandIds.clear(); if (nowarfyBroadcastChannel) { nowarfyBroadcastChannel.close(); nowarfyBroadcastChannel = null; } if (nowarfyRemoteChannel && nowarfySupabase) await nowarfySupabase.removeChannel(nowarfyRemoteChannel); nowarfyRemoteChannel = null; nowarfyRemoteSession = null; nowarfyRemoteShadowSong = null; nowarfyRemoteShadowState = null; nowarfyRemoteDeviceId = null; nowarfyRemoteIsPlayer = false; }
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
            const handoff = await nowarfySupabase.from('youtoo_remote_commands').insert({ session_id: nowarfyRemoteSession.id, user_id: nowarfyAuthUser.id, device_id: nowarfyRemoteDeviceId, command: { type: 'handoff', targetDeviceId: deviceId, state: nextState } });
            if (handoff.error) throw handoff.error;
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
    // Enviar primero por BroadcastChannel para respuesta instantánea en tabs del mismo navegador
    if (nowarfyBroadcastChannelReady && nowarfyBroadcastChannel) {
        try { nowarfyBroadcastChannel.postMessage({ type: 'remote-state', senderDeviceId: nowarfyRemoteDeviceId, state }); } catch (_) {}
    }
    if (nowarfyRemoteBroadcastReady && nowarfyRemoteChannel) {
        try { await nowarfyRemoteChannel.send({ type: 'broadcast', event: 'remote-state', payload: { senderDeviceId: nowarfyRemoteDeviceId, state } }); } catch (_) {}
    }
    const result = await nowarfySupabase.from('youtoo_remote_sessions').update({ state, version: Number(nowarfyRemoteSession.version || 0) + 1, updated_at: new Date().toISOString() }).eq('id', nowarfyRemoteSession.id).eq('active_device_id', nowarfyRemoteDeviceId);
    if (!result.error) nowarfyRemoteSession.state = state;
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
        const nextShadow = { type: state.type || 'yt', url: state.resourceId, title: state.title || 'Reproduciendo en otro dispositivo', artist: state.artist || '', img: state.img || '', channelId: state.channelId || '' };
        if (!nowarfyRemoteShadowSong || nowarfyRemoteShadowSong.url !== nextShadow.url || nowarfyRemoteShadowSong.title !== nextShadow.title) { nowarfyRemoteShadowSong = nextShadow; updateNowPlaying(nextShadow); }
        isPlaying = !!state.isPlaying;
        updateIcon();
        updateRemoteShadowProgress();
    }
    const volume = document.getElementById('volumeSlider');
    if (volume && document.activeElement !== volume && Number.isFinite(Number(state.volume))) { volume.value = Number(state.volume) / 100; volume.style.background = `linear-gradient(to right, var(--accent) ${Number(state.volume)}%, #535353 ${Number(state.volume)}%)`; }
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
function showNowarfyHandoffPrompt() { const prompt = document.getElementById('nowarfyHandoffPrompt'); if (prompt) prompt.hidden = false; }
async function unlockNowarfyHandoff() {
    nowarfyAudioUnlocked = true;
    const prompt = document.getElementById('nowarfyHandoffPrompt'); if (prompt) prompt.hidden = true;
    const pending = nowarfyPendingHandoff; nowarfyPendingHandoff = null;
    if (!pending) return;
    const song = queue[pending.idx];
    try {
        if (song?.type === 'yt' && ytPlayer?.playVideo) ytPlayer.playVideo();
        else if (activeAudioEl) { await activeAudioEl.play(); if (Number(pending.state.position) > 0) activeAudioEl.currentTime = Number(pending.state.position) || 0; }
        isPlaying = true; updateIcon(); await publishNowarfyRemoteState();
    } catch (error) { isPlaying = false; updateIcon(); remoteStatus('El navegador no permitió iniciar el audio en este dispositivo.'); }
}
async function executeNowarfyRemoteCommand(command) {
    if (!nowarfyRemoteIsPlayer) return;
    const type = command.type;
    if (type === 'handoff') {
        const state = command.state || nowarfyRemoteSession?.state || {};
        if (Array.isArray(state.playlist) && state.playlist.length) updateRemoteControlsFromState(state, true);
        const targetUrl = state.resourceId || state.title;
        let idx = queue.findIndex(song => (state.currentQid && song._qid === state.currentQid) || (targetUrl && String(song.url) === String(targetUrl)));
        if (idx < 0 && state.resourceId) {
            const incoming = { _qid: state.currentQid || `remote-${Date.now()}`, url: state.resourceId, type: state.type || 'yt', title: state.title || 'Reproducción remota', artist: state.artist || '', img: state.img || '', channelId: state.channelId || '', duration: Number(state.duration) || 0 };
            queue.unshift(incoming); queueSeenKeys.add(songKey(incoming)); idx = 0;
        }
        if (idx >= 0) {
            const shouldPlay = state.isPlaying !== false;
            const deferAutoplay = shouldPlay && !nowarfyAudioUnlocked;
            nowarfyPendingHandoff = deferAutoplay ? { idx, state } : null;
            playbackStoppedByUser = !shouldPlay;
            playQueueAt(idx, { deferAutoplay, resumeSession: { ...state, wasPlaying: shouldPlay && !deferAutoplay } });
            const volume = Math.max(0, Math.min(100, Number(state.volume ?? 80))) / 100;
            setVolume(volume);
            if (deferAutoplay) showNowarfyHandoffPrompt();
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
    if (type === 'toggle') togglePlay();
    else if (type === 'next') nextSong(true);
    else if (type === 'prev') prevSong();
    else if (type === 'volume') setVolume(Math.max(0, Math.min(100, Number(command.value))) / 100);
    else if (type === 'seekPercent') commitSeek(Math.max(0, Math.min(100, Number(command.value))) / 100);
    else if (type === 'seekDelta') {
        const delta = Number(command.value) || 0;
        const song = currentQueueSong();
        if (song?.type === 'yt' && ytPlayer?.getCurrentTime) ytPlayer.seekTo(Math.max(0, ytPlayer.getCurrentTime() + delta), true);
        else if (activeAudioEl) activeAudioEl.currentTime = Math.max(0, Math.min(activeAudioEl.duration || 0, activeAudioEl.currentTime + delta));
    } else if (type === 'pause' && isPlaying) togglePlay();
    else if (type === 'play' && !isPlaying) togglePlay();
    await publishNowarfyRemoteState();
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
                rail.scrollLeft += speed;
                if (rail._appendBatch && rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 140) {
                    rail._appendBatch();
                }
            }
        });
    });

    if (!autoCarouselAnimationFrame && activeAutoCarousels.length) {
        const loop = () => {
            activeAutoCarousels.forEach(c => c.step());
            autoCarouselAnimationFrame = requestAnimationFrame(loop);
        };
        autoCarouselAnimationFrame = requestAnimationFrame(loop);
    }
}

let currentList = [];
let favorites = JSON.parse(localStorage.getItem('nowarfy_favs')) || [];
let currentIndex = -1;
let isPlaying = false;

