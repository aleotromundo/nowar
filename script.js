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
        if (nowarfyDeviceRefreshTimer) clearInterval(nowarfyDeviceRefreshTimer);
        nowarfyDeviceRefreshTimer = setInterval(() => { void refreshNowarfyRemoteDevices(); }, 5000);
        if (nowarfyRemoteStateTimer) clearInterval(nowarfyRemoteStateTimer);
        nowarfyRemoteStateTimer = setInterval(() => { void touchNowarfyRemoteDevice(); if (nowarfyRemoteIsPlayer) void publishNowarfyRemoteState(); }, 3000);
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
    if (nowarfyRemoteSession && !nowarfyRemoteIsPlayer) nowarfyRemoteShadowTimer = setInterval(updateRemoteShadowProgress, 500);
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

// --- COLA DE REPRODUCCIÓN PERSISTENTE (radio automática) ---
const QUEUE_BATCH = 20;
let queue = [];
let queueSeenKeys = new Set();
let queueIdCounter = 0;
let currentPlayingQid = null;
let currentSourceIdx = null;
let queueRound = 0;
let queueFetching = false;
let dragSrcQid = null;
let searchQuery = "";
let currentMood = null;
let searchTimeout = null;
let activeSearchPagination = null;
let searchMoreObserver = null;
let knowledgeMoreObserver = null;
let ytPlayer = null;
let ytStartupTimer = null;
let ytPlaybackIntent = false;
let ytPlayCommandAt = 0;
let ytApiReady = false;
let pendingYTRequest = null;
let progressInterval = null;
let youtubeQuotaBlockedUntil = 0;
let youtubeQuotaNoticeShown = false;
let shuffleMode = false;
let isSeeking = false;
let lastVolume = 0.8;
const VIDEO_AUTOPLAY_STORAGE_KEY = 'youtoo_video_autoplay_v1';
const CONTINUOUS_PLAYBACK_STORAGE_KEY = 'nowarfy_continuous_playback_v1';
const QUEUE_MODE_STORAGE_KEY = 'nowarfy_queue_mode_v1';
const QUEUE_PLAYLIST_STORAGE_KEY = 'nowarfy_queue_playlist_v1';
const VIDEO_RESUME_STORAGE_KEY = 'nowarfy_video_resume_v1';
const VIDEO_RESUME_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
let videoAutoplay = localStorage.getItem(VIDEO_AUTOPLAY_STORAGE_KEY) !== 'false';
let continuousPlayback = localStorage.getItem(CONTINUOUS_PLAYBACK_STORAGE_KEY) !== 'false';
let queuePlaybackMode = localStorage.getItem(QUEUE_MODE_STORAGE_KEY) === 'prebuilt_playlist' ? 'prebuilt_playlist' : 'radio';
let queuePlaylistContext = null;
let videoStageObserver = null;
let videoStageMinimized = false;
let pendingVideoResumeSession = null;
let restoreVideoMinimizedAfterReady = false;
let lastVideoResumeSaveAt = 0;
let playbackStoppedByUser = false;
let externalAudioFocusInterrupted = false;
let externalAudioFocusResumePending = false;
let externalAudioFocusLastState = '';
let externalAudioFocusRecoveryTimer = null;
let externalAudioFocusResumeCheckTimer = null;
let externalAudioFocusResumeAttempting = false;
let externalAudioFocusRecoveryAttempts = 0;
let externalAudioFocusFadeTimer = null;
let externalAudioFocusVolume = null;
let videoStageManualMinimized = false;
let videoStageNeedsVisualRefresh = false;
let videoFrameRefreshTimer = null;
let videoFrameRestoreAwaitingPlayer = '';
let youtubeCompactWindow = null;
let youtubeEmbedFallbackUrl = '';
let mediaTransitionInProgress = false;
let automaticAdvanceTimer = null;
let automaticAdvanceTargetQid = null;
let automaticQueueRecoveryInFlight = false;
const PLAYBACK_CONTINUITY_CHECK_MS = 9000;
const EXTERNAL_AUDIO_RESUME_DELAY_MS = 900;
const EXTERNAL_AUDIO_RESUME_RETRY_MS = 2500;
const NOWARFY_AUDIO_PRIORITY_MODE = true;
const YT_PLAY_RETRY_THROTTLE_MS = 750;
const YT_END_EARLY_TOLERANCE_SECONDS = 1.5;
let channelFilter = null;
let activeBrowseMode = 'home';
let globalPlaylistCatalogState = null;
let globalChannelCatalogState = null;
let globalCatalogMineOnly = false;
let homeFeedLoaded = false;
let homeFeedLoading = false;
let initialRadioQueueReady = false;
const FEATURED_ROTATION_STORAGE_KEY = 'nowarfy_featured_rotation_v1';
const FEATURED_EDITION_SIZE = 5;
const FEATURED_THEMES = ['violet', 'aqua', 'ember', 'electric'];
let homeVideos = [];
let homeMusicVideos = [];
let homeChannels = [];
let homePlaylists = [];
let homeMusic = [];
let homeRecommended = [];
let ambientArtworkIndex = 0;
let ambientArtworkRotationTimer = null;
let ambientArtworkLockedToCurrent = false;
let activeChannelCatalog = null;
let activePlaylistCatalog = null;
let nowarfyRestoringHistory = false;
let nowarfyLastHistoryState = null;
let knowledgeBaseState = null;
let knowledgeBaseSearchTimer = null;
const LYRICS_CACHE_KEY = 'nowarfy_verified_lyrics_v1';
const LYRICS_CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const LYRICS_CACHE_MAX_ITEMS = 80;
let lyricsRequestToken = 0;
let lyricsZoom = 1;
let currentLyrics = null;
let lyricsLoadingKey = '';
let videoStageAutoHiddenReason = '';

const audioEl = document.getElementById('audio-element');
const nextAudioEl = document.getElementById('audio-element-next');
const freeVideoEl = document.getElementById('freeVideoPlayer');
let activeAudioEl = audioEl;
let mediaSessionHandlersReady = false;
let mediaSessionSongKey = '';
let crossfadeInProgress = false;
let crossfadeTimer = null;
const CROSSFADE_SECONDS = 3;
const playerBar = document.getElementById('playerBar');
const pipBtn = document.getElementById('pipBtn');
const progressTrack = document.getElementById('progressTrack');
const progFill = document.getElementById('progFill');
const progThumb = document.getElementById('progThumb');
const currTimeEl = document.getElementById('currTime');
const totalTimeEl = document.getElementById('totalTime');
const searchInput = document.getElementById('searchInput');
const searchClearBtn = document.getElementById('searchClear');
const silentAudioLoop = document.getElementById('silent-audio-loop');

initVolume();
initNowarfyHistory();
setTimeout(resetView, 0);
loadYouTubeAPI();
setupProgressDrag();
setupBackgroundPlaybackSupport();
setupKeyboardShortcuts();
restoreQueueFromStorage();
setupQueueTrashDropzone();
setupVideoStageObserver();
setupVideoStageVisibilityAwareness();
setupBackgroundPersistence();
setupPlaybackContinuity();
setupInstallableApp();
renderQueue();

window.onerror = function(msg, url, lineNo, columnNo, error) {
    if (msg && msg.includes('postMessage') && msg.includes('youtube')) return true;
    if (msg && msg.includes('Slow network')) return true;
    return false;
};

function normalizeSourceText(value) {
    let text = value == null ? '' : String(value);
    const decoder = document.createElement('textarea');
    for (let pass = 0; pass < 2; pass += 1) {
        decoder.innerHTML = text;
        const decoded = decoder.value;
        if (decoded === text) break;
        text = decoded;
    }
    return text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function descriptionExcerpt(value, maxLength = 118) {
    const clean = normalizeSourceText(value);
    if (!clean) return '';
    return clean.length > maxLength ? `${clean.slice(0, maxLength).trimEnd()}…` : clean;
}

function hasUsablePlaylistItems(item) {
    if (!(item?.resourceKind === 'youtube#playlist' || item?.type === 'playlist' || item?.isPlaylist)) return true;
    if (item.itemCount === null || item.itemCount === undefined || item.itemCount === '') return true;
    const count = Number(item.itemCount);
    return Number.isFinite(count) ? count > 0 : true;
}

function videoStatsLabel(item) {
    if (!(item?.resourceKind === 'youtube#video' || item?.type === 'yt')) return '';
    const parts = [];
    const views = Number(item.viewCount);
    const likes = Number(item.likeCount);
    const comments = Number(item.commentCount);
    if (Number.isFinite(views)) parts.push(`${formatCompactNumber(views)} vistas`);
    if (Number.isFinite(likes)) parts.push(`${formatCompactNumber(likes)} likes`);
    if (Number.isFinite(comments)) parts.push(`${formatCompactNumber(comments)} comentarios`);
    if (item.definition) parts.push(String(item.definition).toUpperCase());
    return parts.join(' · ');
}

function contentMetaLabel(item) {
    if (item?.resourceKind === 'youtube#playlist') {
        const count = Number(item.itemCount);
        return Number.isFinite(count) && count > 0 ? `${count} videos · Lista de reproducción` : 'Lista de reproducción';
    }
    if (item?.resourceKind === 'youtube#channel') return 'Canal de YouTube';
    if (item?.resourceKind === 'youtube#video' || item?.type === 'yt') {
        const duration = formatContentDuration(item.duration);
        return duration === '—' ? 'Video de YouTube' : `Video · ${duration}`;
    }
    if (item?.type === 'freevideo' || item?.resourceKind === 'commons#video') {
        const duration = formatContentDuration(item.duration);
        const source = item.license ? `Video libre · ${item.license}` : 'Video libre';
        return duration === '—' ? source : `${source} · ${duration}`;
    }
    return item?.license ? `Audio libre · ${item.license}` : 'Audio';
}

// Escapa texto para usarlo tanto en nodos de texto como dentro de atributos entre comillas.
// (textContent->innerHTML no escapa " ni ', lo que permitia salirse de un atributo.)
function escapeHtml(str) {
    return normalizeSourceText(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function hasValidArtwork(item) {
    const source = String(item?.img || item?.thumbnail || '').trim();
    if (!source) return false;
    if (/^(?:\/?assets\/|\/favicon\.ico$)/i.test(source)) return true;
    if (!/^https:\/\//i.test(source)) return false;
    try {
        const parsed = new URL(source);
        return !!parsed.hostname && !/^(?:data|blob):/i.test(parsed.protocol);
    } catch (e) {
        return false;
    }
}

function itemsWithArtwork(items) {
    return (items || []).filter(hasValidArtwork);
}

function removeCardForMissingArtwork(image) {
    const card = image?.closest?.('.card');
    if (!card) return;
    const parent = card.parentElement;
    card.remove();
    if (!parent?.querySelector?.('.card')) {
        const librarySection = parent.closest?.('.library-rail-section');
        if (librarySection) librarySection.remove();
        else parent.parentElement?.remove();
    }
}

const TASTE_STORAGE_KEY = 'youtoo_taste_v1';
const NOWARFY_TASTE_TABLE = 'nowarfy_user_taste';
let nowarfyTasteSyncTimer = null;
let nowarfyTasteSyncInFlight = false;

const EMPTY_TASTE = Object.freeze({ version: 3, personalization: true, searches: [], plays: [], channels: [], playlists: [] });

function readTaste() {
    try {
        const saved = JSON.parse(localStorage.getItem(TASTE_STORAGE_KEY));
        return {
            version: 3,
            personalization: saved?.personalization !== false,
            searches: Array.isArray(saved?.searches) ? saved.searches.filter(item => typeof item === 'string') : [],
            plays: Array.isArray(saved?.plays) ? saved.plays.filter(item => item && typeof item.title === 'string') : [],
            channels: Array.isArray(saved?.channels) ? saved.channels.filter(item => item && typeof item.id === 'string') : [],
            playlists: Array.isArray(saved?.playlists) ? saved.playlists.filter(item => item && typeof item.id === 'string') : []
        };
    } catch { return { ...EMPTY_TASTE, searches: [], plays: [], channels: [], playlists: [] }; }
}

function writeTaste(taste) {
    localStorage.setItem(TASTE_STORAGE_KEY, JSON.stringify({ ...taste, version: 3, updatedAt: Date.now() }));
    scheduleNowarfyTasteSync();
}

function scheduleNowarfyTasteSync() {
    if (!nowarfySupabase || !nowarfyAuthUser) return;
    clearTimeout(nowarfyTasteSyncTimer);
    nowarfyTasteSyncTimer = setTimeout(() => {
        void syncNowarfyTaste();
    }, 800);
}

async function syncNowarfyTaste() {
    if (nowarfyTasteSyncInFlight || !nowarfySupabase || !nowarfyAuthUser) return;
    nowarfyTasteSyncInFlight = true;
    try {
        const taste = readTaste();
        const { error } = await nowarfySupabase
            .from(NOWARFY_TASTE_TABLE)
            .upsert({
                user_id: nowarfyAuthUser.id,
                plays: taste.plays || [],
                searches: taste.searches || [],
                channels: taste.channels || [],
                playlists: taste.playlists || [],
                favorites: favorites || [],
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id' });
        if (error) console.error('Error sincronizando historial:', error);
    } finally {
        nowarfyTasteSyncInFlight = false;
    }
}

async function loadNowarfyTaste() {
    if (!nowarfySupabase || !nowarfyAuthUser) return;
    try {
        const { data, error } = await nowarfySupabase
            .from(NOWARFY_TASTE_TABLE)
            .select('plays, searches, channels, playlists, favorites')
            .eq('user_id', nowarfyAuthUser.id)
            .maybeSingle();

        if (error) {
            console.error('Error cargando historial:', error);
            return;
        }

        if (!data) {
            await syncNowarfyTaste();
            return;
        }

        const localTaste = readTaste();
        const mergedPlays = [...(localTaste.plays || []), ...(data.plays || [])];
        const uniquePlays = Array.from(new Map(mergedPlays.map(item => [item.url || `${item.title}|${item.artist}`, item])).values());

        const mergedTaste = {
            ...localTaste,
            plays: uniquePlays,
            searches: Array.from(new Set([...(localTaste.searches || []), ...(data.searches || [])])).slice(0, 12),
            channels: Array.from(new Map([...(localTaste.channels || []), ...(data.channels || [])].map(item => [item.id, item])).values()),
            playlists: Array.from(new Map([...(localTaste.playlists || []), ...(data.playlists || [])].map(item => [item.id, item])).values())
        };

        const mergedFavorites = Array.from(new Map([...(favorites || []), ...(data.favorites || [])].map(item => [item.url || `${item.title}|${item.artist}`, item])).values());

        favorites = mergedFavorites;
        localStorage.setItem('nowarfy_favs', JSON.stringify(favorites));
        if (typeof updateFavButton === 'function' && typeof currentQueueSong === 'function') {
            try { updateFavButton(currentQueueSong()); } catch (e) {}
        }

        writeTaste(mergedTaste);
        await syncNowarfyTaste();

        if (activeBrowseMode && typeof showSection === 'function') {
            if (activeBrowseMode === 'home') {
                if (typeof renderHomeFeed === 'function') renderHomeFeed();
            } else if (['favorites', 'history', 'taste', 'playlists', 'channels'].includes(activeBrowseMode)) {
                showSection(activeBrowseMode, { silent: true });
            }
        }
    } catch (error) {
        console.error('Error cargando historial:', error);
    }
}

function rememberUnique(list, entry, getKey, max = Infinity) {
    const key = getKey(entry);
    const merged = [entry, ...list.filter(item => getKey(item) !== key)];
    return Number.isFinite(max) ? merged.slice(0, max) : merged;
}

function rememberSearch(query) {
    const normalized = String(query || '').trim();
    if (!normalized) return;
    const taste = readTaste();
    if (!taste.personalization) return;
    taste.searches = [normalized, ...taste.searches.filter(item => item.toLowerCase() !== normalized.toLowerCase())].slice(0, 12);
    writeTaste(taste);
    renderTasteChips(searchQuery || normalized);
}

function rememberPlay(song) {
    if (!song?.title) return;
    const taste = readTaste();
    const entry = {
        title: song.title,
        artist: song.artist || '',
        channelId: song.channelId || '',
        channelTitle: song.channelTitle || song.artist || '',
        url: song.url || '',
        type: song.type || '',
        img: song.img || '',
        duration: song.duration || null,
        resourceKind: song.resourceKind || '',
        isPlaylist: !!song.isPlaylist,
        at: Date.now()
    };
    taste.plays = rememberUnique(taste.plays, entry, item => item.url || `${item.title}|${item.artist}`);
    writeTaste(taste);
    renderTasteChips(searchQuery);
}

function rememberChannel(channelId, title, details = {}) {
    if (!channelId) return;
    const taste = readTaste();
    const entry = {
        id: String(channelId), title: String(title || 'Canal de YouTube'),
        img: details.img || details.thumbnails?.medium?.url || details.thumbnails?.default?.url || '',
        description: details.description || '',
        at: Date.now()
    };
    taste.channels = rememberUnique(taste.channels, entry, item => item.id);
    writeTaste(taste);
    renderTasteChips(searchQuery);
}

function rememberPlaylist(playlist) {
    if (!playlist?.url) return;
    const taste = readTaste();
    const entry = {
        id: String(playlist.url), title: String(playlist.title || 'Lista de reproducción'),
        artist: String(playlist.artist || playlist.channelTitle || 'YouTube'), img: playlist.img || '',
        description: playlist.description || '', channelId: playlist.channelId || '', itemCount: playlist.itemCount ?? null, at: Date.now()
    };
    taste.playlists = rememberUnique(taste.playlists, entry, item => item.id);
    writeTaste(taste);
}

function getTasteSeed() {
    const taste = readTaste();
    if (!taste.personalization) return '';
    return taste.searches[0] || taste.plays[0]?.artist || taste.channels[0]?.title || taste.plays[0]?.title || '';
}

function getTasteTopics() {
    const taste = readTaste();
    const topics = [{ label: 'Todo', query: '', kind: 'home' }];
    const seen = new Set(['todo']);
    const add = (label, query, personalized = true) => {
        const cleanLabel = String(label || '').trim();
        const cleanQuery = String(query || '').trim();
        const key = cleanQuery.toLocaleLowerCase();
        if (!cleanLabel || !cleanQuery || seen.has(key)) return;
        seen.add(key);
        topics.push({ label: cleanLabel.slice(0, 34), query: cleanQuery.slice(0, 80), personalized });
    };
    if (taste.personalization) {
        taste.searches.forEach(value => add(value, value));
        taste.plays.forEach(item => add(item.artist || item.title, item.artist || item.title));
        taste.channels.forEach(item => add(item.title, item.title));
    }
    [
        ['Música', 'música'],
        ['Álbumes', 'álbum completo'],
        ['Videos en vivo', 'música en vivo'],
        ['Punk argentino', 'punk argentino'],
        ['Rock latino', 'rock latino']
    ].forEach(([label, query]) => add(label, query, false));
    return topics.slice(0, 10);
}

function renderTasteChips(activeQuery = '') {
    const container = document.getElementById('tasteChips');
    if (!container) return;
    const normalizedActive = String(activeQuery || '').trim().toLocaleLowerCase();
    container.innerHTML = '';
    getTasteTopics().forEach(topic => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `taste-chip${(topic.kind === 'home' && !normalizedActive) || topic.query.toLocaleLowerCase() === normalizedActive ? ' active' : ''}`;
        button.innerHTML = `${topic.personalized ? '<i class="fas fa-sparkles"></i>' : ''}${escapeHtml(topic.label)}`;
        button.onclick = () => selectTasteTopic(topic);
        container.appendChild(button);
    });
    setTimeout(initRailDragScroll, 20);
}

function selectTasteTopic(topic) {
    if (topic.kind === 'home') { resetView(); return; }
    searchInput.value = topic.query;
    searchClearBtn.classList.add('show');
    performSmartSearch(topic.query);
}

function renderPersonalizedNote() {}

function setPersonalization(enabled) {
    const taste = readTaste();
    taste.personalization = !!enabled;
    writeTaste(taste);
    homeFeedLoaded = false;
    renderTasteChips();
    renderPersonalizedNote();
    if (activeBrowseMode === 'home') resetView(); else renderTasteData();
    showToast(enabled ? 'Personalización local activada' : 'Personalización local pausada', 'fa-shield-halved');
}

function clearTasteData() {
    localStorage.removeItem(TASTE_STORAGE_KEY);
    homeFeedLoaded = false;
    renderTasteChips();
    renderPersonalizedNote();
    renderTasteData();
    showToast('Se borraron tus datos locales de descubrimiento', 'fa-trash');
}

function renderTasteData() {
    const taste = readTaste();
    navigateWithTransition(() => {
        const container = document.getElementById('dynamicSections');
        currentList = [];
        document.getElementById('loader').style.display = 'none';
        container.innerHTML = `
            <section class="taste-data-panel" aria-label="Datos de descubrimiento">
                <h2>Tus datos de descubrimiento</h2>
                <p>Tu historial, favoritos y personalización se conservan localmente en este dispositivo. En paralelo, las URLs y metadatos descubiertos alimentan una base global compartida; podés auditarla desde el botón de abajo sin borrar tu actividad personal.</p>
                <div class="taste-data-status">
                    <div><strong>${taste.personalization ? 'Personalización local activada' : 'Personalización local pausada'}</strong><span>${taste.personalization ? 'La portada y las categorías pueden usar tus señales guardadas.' : 'Se conserva el historial, pero no se usa ni se agregan nuevas señales.'}</span></div>
                    <button class="taste-action primary" type="button" id="tasteToggle">${taste.personalization ? 'Pausar' : 'Activar'}</button>
                </div>
                <div class="taste-stats">
                    <div class="taste-stat"><b>${taste.searches.length}</b><span>Búsquedas guardadas</span></div>
                    <div class="taste-stat"><b>${taste.plays.length}</b><span>Reproducciones recordadas</span></div>
                    <div class="taste-stat"><b>${taste.channels.length + taste.playlists.length}</b><span>Canales y listas abiertas</span></div>
                </div>
                <div class="taste-actions">
                    <button class="taste-action" type="button" id="knowledgeBaseBtn"><i class="fas fa-database"></i> Base de conocimiento global</button>
                    <button class="taste-action danger" type="button" id="tasteClear"><i class="fas fa-trash"></i> Borrar datos locales</button>
                </div>
            </section>`;
        document.getElementById('tasteToggle').onclick = () => setPersonalization(!taste.personalization);
        document.getElementById('tasteClear').onclick = clearTasteData;
        document.getElementById('knowledgeBaseBtn').onclick = renderKnowledgeBase;
    });
}

const KNOWLEDGE_SOURCE_LABELS = { youtube: 'YouTube', openverse: 'Openverse', commons: 'Commons', jamendo: 'Jamendo' };
const KNOWLEDGE_HEALTH_LABELS = { unverified: 'Sin verificar', healthy: 'Saludable', suspect: 'Sospechoso', invalid: 'Inválido' };
const KNOWLEDGE_KIND_LABELS = { 'youtube#video': 'Video', 'youtube#playlist': 'Lista', 'youtube#channel': 'Canal', 'commons#video': 'Video libre' };

function knowledgeSourceLabel(source) {
    return KNOWLEDGE_SOURCE_LABELS[String(source || '').toLowerCase()] || 'Otra fuente';
}
function knowledgeHealthLabel(status) {
    return KNOWLEDGE_HEALTH_LABELS[String(status || 'unverified').toLowerCase()] || 'Sin verificar';
}
function knowledgeKindLabel(item) {
    return KNOWLEDGE_KIND_LABELS[item?.resourceKind] || (item?.type === 'mp3' ? 'Audio' : item?.type === 'freevideo' ? 'Video libre' : 'Recurso');
}
function knowledgeCandidateAction(item) {
    if (!item) return;
    if (item.resourceKind === 'youtube#channel') {
        browseChannel(item.sourceId || item.channelId || item.url, item.title || item.artist || 'Canal de YouTube');
    } else if (item.resourceKind === 'youtube#playlist' || item.isPlaylist) {
        void openPlaylist(item);
    } else {
        selectSong(item);
    }
}
function knowledgeCandidateCard(item, index) {
    const source = String(item?.source || 'unknown').toLowerCase();
    const health = String(item?.healthStatus || 'unverified').toLowerCase();
    const image = escapeHtml(item?.img || 'assets/nowarfy-icon-512.png');
    const title = escapeHtml(item?.title || 'Sin título');
    const artist = escapeHtml(item?.artist || 'Artista no informado');
    const key = escapeHtml(item?.candidateKey || 'sin-clave');
    const sourceLabel = escapeHtml(knowledgeSourceLabel(source));
    const healthLabel = escapeHtml(knowledgeHealthLabel(health));
    const kindLabel = escapeHtml(knowledgeKindLabel(item));
    const favorite = isFavoriteSong(item);
    return `<article class="knowledge-candidate-card" data-knowledge-index="${index}" tabindex="0" aria-label="${title} · ${artist}">
        <div class="knowledge-candidate-art"><img src="${image}" alt="" loading="lazy" data-knowledge-image><div class="knowledge-candidate-badges"><span class="knowledge-candidate-badge source-${escapeHtml(source)}">${sourceLabel}</span><span class="knowledge-candidate-badge health-${escapeHtml(health)}">${healthLabel}</span></div></div>
        <button type="button" class="knowledge-candidate-fav${favorite ? ' active' : ''}" data-knowledge-favorite="${index}" aria-label="${favorite ? 'Quitar de favoritos' : 'Guardar en favoritos'}" title="${favorite ? 'Quitar de favoritos' : 'Guardar en favoritos'}"><i class="${favorite ? 'fas' : 'far'} fa-heart"></i></button>
        <div class="knowledge-candidate-body"><strong class="knowledge-candidate-title">${title}</strong><span class="knowledge-candidate-artist">${artist}</span><div class="knowledge-candidate-meta"><span>${kindLabel}</span>${item?.duration ? `<span>${format(item.duration)}</span>` : ''}${item?.useCount ? `<span>${Number(item.useCount)} usos</span>` : ''}</div><div class="knowledge-candidate-key">${key}</div></div>
    </article>`;
}
function renderKnowledgeCatalog() {
    const state = knowledgeBaseState;
    const grid = document.getElementById('knowledgeCatalogGrid');
    const status = document.getElementById('knowledgePanelStatus');
    const more = document.getElementById('knowledgeMoreWrap');
    if (!state || !grid || !status || !more) return;
    const totalLabel = Number.isFinite(state.total) ? ` de ${formatCompactNumber(state.total)}` : '';
    const scopeLabel = state.filters.mine ? ' · Solo tus descubrimientos' : ' · Catálogo global';
    status.innerHTML = state.loading
        ? `<span>Mostrando <strong>${state.items.length}</strong>${totalLabel}${escapeHtml(scopeLabel)}</span><span><i class="fas fa-spinner fa-spin"></i> Cargando...</span>`
        : `<span>Mostrando <strong>${state.items.length}</strong>${totalLabel}${escapeHtml(scopeLabel)}</span><span>${state.done ? 'Catálogo completo para estos filtros' : 'Desplazate para cargar más'}</span>`;
    grid.innerHTML = state.items.length ? state.items.map(knowledgeCandidateCard).join('') : (state.loading ? '' : '<div class="knowledge-panel-empty">No hay candidatos que coincidan con estos filtros.</div>');
    more.innerHTML = state.done ? '' : '<button type="button" class="catalog-more" id="knowledgeMoreButton"><i class="fas fa-plus"></i> Cargar más candidatos</button>';
    document.querySelectorAll('#knowledgeCatalogGrid .knowledge-candidate-card').forEach(card => {
        const index = Number(card.dataset.knowledgeIndex);
        const item = state.items[index];
        card.addEventListener('click', event => { if (!event.target.closest('[data-knowledge-favorite]')) knowledgeCandidateAction(item); });
        card.addEventListener('keydown', event => { if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('[data-knowledge-favorite]')) { event.preventDefault(); knowledgeCandidateAction(item); } });
        const favoriteButton = card.querySelector('[data-knowledge-favorite]');
        favoriteButton?.addEventListener('click', event => { event.stopPropagation(); toggleFavoriteSong(item, favoriteButton); });
        card.querySelector('[data-knowledge-image]')?.addEventListener('error', event => { event.currentTarget.src = 'assets/nowarfy-icon-512.png'; event.currentTarget.removeAttribute('data-knowledge-image'); });
    });
    const moreButton = document.getElementById('knowledgeMoreButton');
    moreButton?.addEventListener('click', () => void loadKnowledgeBasePage());
    if ('IntersectionObserver' in window && moreButton) {
        knowledgeMoreObserver?.disconnect();
        knowledgeMoreObserver = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) void loadKnowledgeBasePage();
        }, { rootMargin: '500px 0px' });
        knowledgeMoreObserver.observe(moreButton);
    }
}
async function loadKnowledgeBasePage({ reset = false } = {}) {
    const state = knowledgeBaseState;
    if (!state || state.loading || (state.done && !reset)) return;
    if (reset) { state.offset = 0; state.items = []; state.done = false; state.total = null; state.requestId += 1; }
    const requestId = state.requestId;
    state.loading = true;
    renderKnowledgeCatalog();
    try {
        const params = new URLSearchParams({ action: 'search', scope: 'search', includeAll: 'true', limit: String(state.limit), offset: String(state.offset) });
        if (state.filters.artist) params.set('artist', state.filters.artist);
        if (state.filters.source) params.set('source', state.filters.source);
        if (state.filters.health) params.set('healthStatus', state.filters.health);
        if (state.filters.kind) params.set('kind', state.filters.kind);
        if (state.filters.mine && nowarfyAuthUser?.id) params.set('discoveredBy', nowarfyAuthUser.id);
        const data = await globalReserveRequest(`${GLOBAL_RESERVE_ENDPOINT}?${params.toString()}`);
        if (requestId !== state.requestId || !data) return;
        const next = Array.isArray(data.results) ? data.results : [];
        const seen = new Set(state.items.map(item => item.candidateKey || reserveCandidateKey(item)));
        next.forEach(item => { const key = item.candidateKey || reserveCandidateKey(item); if (key && !seen.has(key)) { seen.add(key); state.items.push(item); } });
        state.offset += next.length;
        state.total = Number.isFinite(Number(data.total)) ? Number(data.total) : state.total;
        state.done = next.length < state.limit || (Number.isFinite(state.total) && state.offset >= state.total);
    } catch (error) {
        if (requestId === state.requestId) { state.done = true; showToast('No se pudo cargar la reserva global', 'fa-triangle-exclamation'); }
    } finally {
        if (requestId === state.requestId) { state.loading = false; renderKnowledgeCatalog(); }
    }
}
function setupKnowledgeBaseFilters() {
    const artistInput = document.getElementById('knowledgeArtistFilter');
    const sourceSelect = document.getElementById('knowledgeSourceFilter');
    const healthSelect = document.getElementById('knowledgeHealthFilter');
    const kindSelect = document.getElementById('knowledgeKindFilter');
    const mineToggle = document.getElementById('knowledgeMineToggle');
    const apply = () => {
        const mine = Boolean(mineToggle?.checked && nowarfyAuthUser?.id);
        globalCatalogMineOnly = mine;
        knowledgeBaseState.filters = { artist: artistInput?.value.trim() || '', source: sourceSelect?.value || '', health: healthSelect?.value || '', kind: kindSelect?.value || '', mine };
        clearTimeout(knowledgeBaseSearchTimer);
        knowledgeBaseSearchTimer = setTimeout(() => void loadKnowledgeBasePage({ reset: true }), 250);
    };
    artistInput?.addEventListener('input', apply);
    sourceSelect?.addEventListener('change', apply);
    healthSelect?.addEventListener('change', apply);
    kindSelect?.addEventListener('change', apply);
    mineToggle?.addEventListener('change', apply);
    document.getElementById('knowledgeRefresh')?.addEventListener('click', () => void loadKnowledgeBasePage({ reset: true }));
}
async function renderKnowledgeBase() {
    minimizeActiveVideoForNavigation();
    const container = document.getElementById('dynamicSections');
    const loader = document.getElementById('loader');
    container.innerHTML = '';
    loader.style.display = 'flex';
    try {
        const data = await globalReserveRequest(`${GLOBAL_RESERVE_ENDPOINT}?action=stats`);
        if (!data) throw new Error('stats_unavailable');
        const counts = data.sourceCounts || {};
        const kinds = data.kindCounts || {};
        const mineToggle = nowarfyAuthUser
            ? `<label class="knowledge-scope-toggle"><input type="checkbox" id="knowledgeMineToggle" ${globalCatalogMineOnly ? 'checked' : ''}> <span>Solo mis descubrimientos</span></label>`
            : '';
        const scopeNote = nowarfyAuthUser
            ? 'La vista global está activa. El interruptor filtra únicamente los recursos atribuidos a tu cuenta registrada.'
            : 'Modo anónimo: se muestra el total global recuperado por todas las sesiones. Para filtrar tus propios descubrimientos, iniciá sesión.';
        container.innerHTML = `
            <section class="taste-data-panel knowledge-panel" aria-label="Base de conocimiento global">
                <div class="section-header-back"><button type="button" class="video-stage-close" onclick="renderTasteData()"><i class="fas fa-arrow-left"></i> Volver a Tus datos</button></div>
                <h2>Base de conocimiento de Nowarfy</h2>
                <p>Catálogo colectivo de URLs y metadatos descubiertos por todos los usuarios. Esta vista muestra la base completa; tus gustos solo cambian el orden y los filtros de las secciones personalizadas.</p>
                <div class="taste-stats knowledge-summary">
                    <div class="taste-stat"><b>${formatCompactNumber(data.totalCandidates)}</b><span>Total de recursos globales</span></div>
                    <div class="taste-stat"><b>${formatCompactNumber(kinds.videos || 0)}</b><span>Videos YouTube</span></div>
                    <div class="taste-stat"><b>${formatCompactNumber(kinds.playlists || 0)}</b><span>Listas de reproducción</span></div>
                    <div class="taste-stat"><b>${formatCompactNumber(kinds.channels || 0)}</b><span>Canales</span></div>
                    <div class="taste-stat"><b>${formatCompactNumber(kinds.audio || 0)}</b><span>Audio libre y fuentes directas</span></div>
                </div>
                <div class="knowledge-toolbar" aria-label="Filtros de la base global">
                    <input class="knowledge-filter" id="knowledgeArtistFilter" type="search" placeholder="Filtrar por artista o canal…" autocomplete="off">
                    <select class="knowledge-filter" id="knowledgeSourceFilter" aria-label="Filtrar por fuente"><option value="">Todas las fuentes</option><option value="youtube">YouTube</option><option value="openverse">Openverse</option><option value="commons">Commons</option><option value="jamendo">Jamendo</option></select>
                    <select class="knowledge-filter" id="knowledgeKindFilter" aria-label="Filtrar por tipo"><option value="">Todos los tipos</option><option value="video">Videos</option><option value="playlist">Listas de reproducción</option><option value="channel">Canales</option><option value="audio">Audio directo</option><option value="freevideo">Videos libres</option></select>
                    <select class="knowledge-filter" id="knowledgeHealthFilter" aria-label="Filtrar por salud"><option value="">Todos los estados</option><option value="unverified">Sin verificar</option><option value="healthy">Saludable</option><option value="suspect">Sospechoso</option><option value="invalid">Inválido</option></select>
                    ${mineToggle}
                    <button type="button" class="taste-action" id="knowledgeRefresh"><i class="fas fa-rotate"></i> Actualizar</button>
                </div>
                <p class="knowledge-scope-note">${scopeNote}</p>
                <div class="knowledge-panel-status" id="knowledgePanelStatus"></div>
                <div class="knowledge-catalog-grid" id="knowledgeCatalogGrid"></div>
                <div class="catalog-more-wrap" id="knowledgeMoreWrap"></div>
                <div class="taste-actions"><a href="${GLOBAL_RESERVE_ENDPOINT}?action=export" class="taste-action primary" target="_blank" rel="noopener noreferrer"><i class="fas fa-download"></i> Exportar CSV completo</a></div>
            </section>`;
        knowledgeBaseState = { offset: 0, limit: 24, loading: false, done: false, total: null, items: [], filters: { artist: '', source: '', health: '', kind: '', mine: Boolean(globalCatalogMineOnly && nowarfyAuthUser?.id) }, requestId: 0 };
        setupKnowledgeBaseFilters();
        await loadKnowledgeBasePage();
    } catch (error) {
        renderEmptyState('No pudimos cargar la base global', 'La reserva global puede estar temporalmente fuera de servicio.');
    } finally {
        loader.style.display = 'none';
    }
}
function deriveChannels(videos) {
    const seen = new Set();
    return videos.filter(video => {
        if (!video.channelId || seen.has(video.channelId)) return false;
        seen.add(video.channelId);
        return true;
    }).map(video => ({ title: video.channelTitle || video.artist, artist: 'Canal de YouTube', img: video.img, url: video.channelId, type: 'yt', resourceKind: 'youtube#channel', isPlaylist: false, channelId: video.channelId, channelTitle: video.channelTitle || video.artist }));
}

function showToast(msg, icon) {
    icon = icon || 'fa-circle-check';
    const container = document.getElementById('toastContainer');
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<i class="fas ${icon}"></i><span>${escapeHtml(msg)}</span>`;
    container.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
        t.classList.remove('show');
        setTimeout(() => t.remove(), 300);
    }, 3200);
}

function handleSearchInput() {
    clearTimeout(searchTimeout);
    searchClearBtn.classList.toggle('show', searchInput.value.trim().length > 0);
}
function handleSearchKeydown(event) {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    const query = searchInput.value.trim();
    if (!query) { resetView(); return; }
    channelFilter = null;
    performSmartSearch(query);
}
function handleSearchDebounced() { handleSearchInput(); }

function clearSearch() {
    searchInput.value = '';
    searchClearBtn.classList.remove('show');
    channelFilter = null;
    resetView();
    searchInput.focus();
}

function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function parseYouTubeDuration(value) {
    if (!value) return null;
    const match = String(value).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return null;
    return (Number(match[1] || 0) * 3600) + (Number(match[2] || 0) * 60) + Number(match[3] || 0);
}

function formatContentDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '—';
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return hours ? `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}` : `${mins}:${String(secs).padStart(2, '0')}`;
}

function mapYouTubeItems(items) {
    return items
        .filter(item => item.id && (item.id.kind === 'youtube#video' || item.id.kind === 'youtube#playlist' || item.id.kind === 'youtube#channel'))
        .map(item => {
            const isChannel = item.id.kind === 'youtube#channel';
            const thumb = item.snippet.thumbnails && (item.snippet.thumbnails.medium || item.snippet.thumbnails.default || item.snippet.thumbnails.high);
            return {
                title: normalizeSourceText(item.snippet.title),
                artist: normalizeSourceText(isChannel ? 'Canal de YouTube' : item.snippet.channelTitle),
                description: normalizeSourceText(item.snippet.description),
                img: thumb ? thumb.url : '',
                url: item.id.videoId || item.id.playlistId || item.id.channelId,
                type: 'yt',
                resourceKind: item.id.kind,
                isPlaylist: item.id.kind === 'youtube#playlist',
                itemCount: item.contentDetails?.itemCount ?? null,
                duration: parseYouTubeDuration(item.contentDetails && item.contentDetails.duration),
                publishedAt: item.videoSnippet?.publishedAt || item.snippet.publishedAt || '',
                viewCount: item.statistics?.viewCount || '',
                likeCount: item.statistics?.likeCount || '',
                commentCount: item.statistics?.commentCount || '',
                definition: item.contentDetails?.definition || '',
                captionsAvailable: item.contentDetails?.caption === 'true',
                liveBroadcastContent: item.videoSnippet?.liveBroadcastContent || item.snippet.liveBroadcastContent || 'none',
                categoryId: item.videoSnippet?.categoryId || '',
                tags: Array.isArray(item.videoSnippet?.tags) ? item.videoSnippet.tags : [],
                channelId: item.snippet.channelId,
                channelTitle: item.snippet.channelTitle
            };
        });
}

function formatCompactNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return new Intl.NumberFormat('es-UY', { notation: 'compact', maximumFractionDigits: 1 }).format(number);
}

function mapPlaylistApiItems(items, fallback = {}) {
    return (items || []).map((item, index) => {
        const thumb = item.snippet?.thumbnails?.medium || item.snippet?.thumbnails?.high || item.snippet?.thumbnails?.default;
        return {
            title: normalizeSourceText(item.snippet?.title || 'Lista sin título'),
            artist: normalizeSourceText(item.snippet?.channelTitle || fallback.channelTitle || 'Lista de YouTube'),
            description: normalizeSourceText(item.snippet?.description),
            img: thumb?.url || fallback.img || '',
            url: item.id,
            type: 'yt',
            resourceKind: 'youtube#playlist',
            isPlaylist: true,
            itemCount: item.contentDetails?.itemCount,
            sourceIndex: index,
            channelId: item.snippet?.channelId || fallback.channelId || '',
            channelTitle: item.snippet?.channelTitle || fallback.channelTitle || ''
        };
    }).filter(item => item.url);
}

function mapPlaylistVideoItems(items, fallback = {}, offset = 0) {
    return (items || []).map((item, index) => {
        const thumb = item.snippet?.thumbnails?.medium || item.snippet?.thumbnails?.high || item.snippet?.thumbnails?.default;
        return {
            title: normalizeSourceText(item.snippet?.title || 'Video sin título'),
            artist: normalizeSourceText(item.snippet?.channelTitle || fallback.channelTitle || 'YouTube'),
            description: normalizeSourceText(item.snippet?.description),
            img: thumb?.url || fallback.img || '',
            url: item.contentDetails?.videoId,
            type: 'yt',
            resourceKind: 'youtube#video',
            isPlaylist: false,
            sourceIndex: offset + index,
            duration: parseYouTubeDuration(item.contentDetails?.duration),
            channelId: item.snippet?.channelId || fallback.channelId || '',
            channelTitle: item.snippet?.channelTitle || fallback.channelTitle || '',
            collectionId: fallback.collectionId || '',
            collectionTitle: fallback.collectionTitle || '',
            collectionImg: fallback.collectionImg || ''
        };
    }).filter(item => item.url);
}

function addCatalogMore(container, label, handler) {
    const wrap = document.createElement('div');
    wrap.className = 'catalog-more-wrap';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'catalog-more';
    button.innerHTML = `<i class="fas fa-plus"></i> ${escapeHtml(label)}`;
    button.onclick = async () => {
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cargando...';
        try { await handler(); }
        finally { if (button.isConnected) { button.disabled = false; button.innerHTML = `<i class="fas fa-plus"></i> ${escapeHtml(label)}`; } }
    };
    wrap.appendChild(button);
    container.appendChild(wrap);
}

function renderChannelCatalog() {
    const state = activeChannelCatalog;
    if (!state?.channel) return;
    navigateWithTransition(() => {
        const container = document.getElementById('dynamicSections');
        const channel = state.channel;
        const thumb = channel.snippet?.thumbnails?.medium || channel.snippet?.thumbnails?.high || channel.snippet?.thumbnails?.default;
        const channelTitle = channel.snippet?.title || state.title || 'Canal de YouTube';
        const customUrl = channel.snippet?.customUrl || '';
        const description = String(channel.snippet?.description || '').trim();
        const uploadsTotal = state.uploads?.pageInfo?.totalResults ?? channel.statistics?.videoCount;
        container.innerHTML = `
            <section class="channel-profile" aria-label="Perfil del canal ${escapeHtml(channelTitle)}">
                <img class="channel-profile-avatar" src="${escapeHtml(thumb?.url || '')}" alt="" onerror="this.style.visibility='hidden'">
                <div class="channel-profile-content">
                    <p class="channel-profile-kicker"><i class="fab fa-youtube"></i> Canal público de YouTube</p>
                    <h2>${escapeHtml(channelTitle)}</h2>
                    ${customUrl ? `<p class="channel-profile-handle">${escapeHtml(customUrl)}</p>` : ''}
                    ${description ? `<p class="channel-profile-description">${escapeHtml(description.slice(0, 420))}${description.length > 420 ? '…' : ''}</p>` : ''}
                    <div class="channel-profile-stats"><span><b>${formatCompactNumber(channel.statistics?.subscriberCount)}</b> suscriptores</span><span><b>${formatCompactNumber(channel.statistics?.viewCount)}</b> visualizaciones</span><span><b>${formatCompactNumber(uploadsTotal)}</b> videos públicos</span></div>
                    <div class="channel-profile-actions"><button type="button" class="channel-profile-action" id="channelProfileBack"><i class="fas fa-arrow-left"></i> Inicio</button><a class="channel-profile-action" href="https://www.youtube.com/channel/${encodeURIComponent(channel.id)}" target="_blank" rel="noopener noreferrer"><i class="fas fa-arrow-up-right-from-square"></i> Ver en YouTube</a></div>
                </div>
            </section>`;
        document.getElementById('channelProfileBack').onclick = resetView;

        const playlists = state.playlists?.items || [];
        const uploads = state.uploads?.items || [];
        currentList = uploads;
        if (playlists.length) renderPlaylistGrid(playlists, `Listas y álbumes · ${state.playlists?.pageInfo?.totalResults ?? playlists.length}`);
        if (state.playlists?.nextPageToken) addCatalogMore(container, 'Cargar más listas', () => loadMoreChannelPlaylists(state.playlists.nextPageToken));
        if (uploads.length) {
            renderGrid(uploads, `Videos del canal · ${uploadsTotal || uploads.length}`, "<i class='fas fa-clapperboard'></i>");
        } else {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.innerHTML = '<i class="fas fa-video-slash"></i><strong>Este canal no tiene videos públicos reproducibles disponibles</strong><span>Puede tener restricciones de privacidad, región o reproducción embebida.</span>';
            container.appendChild(empty);
        }
        if (state.uploads?.nextPageToken) addCatalogMore(container, 'Cargar más videos', () => loadMoreChannelUploads(state.uploads.nextPageToken));
    });
}

async function loadChannelProfile(channelReference, channelTitle = '') {
    minimizeActiveVideoForNavigation();
    const loader = document.getElementById('loader');
    const container = document.getElementById('dynamicSections');
    activeBrowseMode = 'channel';
    channelFilter = null;
    loader.style.display = 'flex';
    container.innerHTML = '';
    try {
        const response = await fetch(`/api/search?type=youtube&action=channelOverview&channelRef=${encodeURIComponent(channelReference)}&maxResults=24`);
        const data = await response.json();
        if (!response.ok || !data?.channel) throw new Error(data?.error?.message || 'channel_unavailable');
        const fallback = { channelId: data.channel.id, channelTitle: data.channel.snippet?.title || channelTitle, img: data.channel.snippet?.thumbnails?.medium?.url || '' };
        activeChannelCatalog = {
            channel: data.channel,
            title: channelTitle,
            uploadsPlaylistId: data.channel.contentDetails?.relatedPlaylists?.uploads || '',
            playlists: { ...data.playlists, items: mapPlaylistApiItems(data.playlists?.items, fallback) },
            uploads: { ...data.uploads, items: mapPlaylistVideoItems(data.uploads?.items, fallback) }
        };
        void reserveDiscoveredCandidates(activeChannelCatalog.playlists.items, { context: 'channel', queryContext: `channel:${data.channel.id}:playlists` });
        void reserveDiscoveredCandidates(activeChannelCatalog.uploads.items, { context: 'channel', queryContext: `channel:${data.channel.id}:uploads` });
        searchInput.value = data.channel.snippet?.title || channelTitle;
        searchClearBtn.classList.add('show');
        rememberChannel(data.channel.id, data.channel.snippet?.title || channelTitle, {
            img: data.channel.snippet?.thumbnails?.medium?.url || data.channel.snippet?.thumbnails?.default?.url || '',
            description: data.channel.snippet?.description || ''
        });
        renderChannelCatalog();
    } catch (error) {
        renderEmptyState('No pudimos abrir este canal', 'El enlace puede no corresponder a un canal público, o YouTube puede estar temporalmente no disponible.');
    } finally {
        loader.style.display = 'none';
    }
}

async function loadMoreChannelPlaylists(pageToken) {
    const state = activeChannelCatalog;
    if (!state?.channel?.id || !pageToken) return;
    const response = await fetch(`/api/search?type=youtube&action=channelPlaylists&channelId=${encodeURIComponent(state.channel.id)}&pageToken=${encodeURIComponent(pageToken)}&maxResults=24`);
    const data = await response.json();
    if (!response.ok) throw new Error('more_playlists_unavailable');
    const fallback = { channelId: state.channel.id, channelTitle: state.channel.snippet?.title || '', img: state.channel.snippet?.thumbnails?.medium?.url || '' };
    const nextPlaylists = mapPlaylistApiItems(data.items, fallback);
    state.playlists = { ...data, items: [...(state.playlists.items || []), ...nextPlaylists] };
    void reserveDiscoveredCandidates(nextPlaylists, { context: 'channel', queryContext: `channel:${state.channel.id}:playlists` });
    renderChannelCatalog();
}

async function loadMoreChannelUploads(pageToken) {
    const state = activeChannelCatalog;
    if (!state?.uploadsPlaylistId || !pageToken) return;
    const response = await fetch(`/api/search?type=youtube&action=channelUploads&uploadsPlaylistId=${encodeURIComponent(state.uploadsPlaylistId)}&pageToken=${encodeURIComponent(pageToken)}&maxResults=24`);
    const data = await response.json();
    if (!response.ok) throw new Error('more_uploads_unavailable');
    const fallback = { channelId: state.channel.id, channelTitle: state.channel.snippet?.title || '', img: state.channel.snippet?.thumbnails?.medium?.url || '' };
    const nextItems = mapPlaylistVideoItems(data.items, fallback, state.uploads.items.length);
    state.uploads = { ...data, items: [...(state.uploads.items || []), ...nextItems] };
    void reserveDiscoveredCandidates(nextItems, { context: 'channel', queryContext: `channel:${state.channel.id}:uploads` });
    renderChannelCatalog();
}

function markYouTubeQuotaUnavailable() {
    youtubeQuotaBlockedUntil = Date.now() + (60 * 60 * 1000);
    if (!youtubeQuotaNoticeShown) {
        youtubeQuotaNoticeShown = true;
        showToast('YouTube alcanzó su cuota temporalmente; mostramos resultados Libres', 'fa-circle-info');
    }
}

async function fetchYouTubeSearch(query, resourceTypes, opts = {}) {
    if (Date.now() < youtubeQuotaBlockedUntil) return [];

    const channelParam = opts.channelId ? `&channelId=${encodeURIComponent(opts.channelId)}` : '';
    const maxResults = opts.maxResults || 20;
    const styleKey = opts.styleKey || inferArtistStyle(query, []);
    const pageToken = String(opts.pageToken || '').trim();
    const queryKey = reserveQueryKey('youtube', query, styleKey, resourceTypes, opts.channelId || '');
    try {
        const previous = await reserveGetQueryState({ source: 'youtube', query, styleKey, queryKey });
        const retryAt = previous?.retry_after ? Date.parse(previous.retry_after) : 0;
        if (previous?.status === 'quota' && retryAt > Date.now()) return [];
        let response;
        if (YOUTUBE_API_KEY) {
            const videoFilters = resourceTypes === 'video' ? '&videoEmbeddable=true&videoSyndicated=true' : '';
            const pageParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
            const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=${resourceTypes}&maxResults=${maxResults}&q=${encodeURIComponent(query)}${channelParam}${videoFilters}${pageParam}&key=${YOUTUBE_API_KEY}`;
            response = await fetch(url);
        } else {
            const pageParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
            response = await fetch(`/api/search?query=${encodeURIComponent(query)}&type=youtube&resourceTypes=${resourceTypes}${channelParam}&maxResults=${maxResults}${pageParam}`);
        }

        const data = await response.json();
        if (!response.ok) {
            const reason = data?.error?.reason || data?.error?.status || '';
            const quota = response.status === 429 || /quota|rate.?limit/i.test(reason);
            if (quota) markYouTubeQuotaUnavailable();
            reserveSaveQueryState({ queryKey, source: 'youtube', query, styleKey, seedKey: opts.seed?.artist || null, pagesConsumed: Number(previous?.pages_consumed || 0), status: quota ? 'quota' : 'error', retryAfter: new Date(Date.now() + (quota ? 30 : 5) * 60 * 1000).toISOString(), resultCount: 0, metadata: { resourceTypes, channelId: opts.channelId || null, pageToken: pageToken || null, errorReason: reason || null } });
            return [];
        }
        const mapped = data.items && data.items.length ? mapYouTubeItems(data.items) : [];
        const nextPageToken = String(data.nextPageToken || '').trim();
        reserveSaveQueryState({ queryKey, source: 'youtube', query, styleKey, seedKey: opts.seed?.artist || null, nextPageToken, pagesConsumed: Number(previous?.pages_consumed || 0) + 1, status: 'ok', retryAfter: null, resultCount: Number(data.pageInfo?.totalResults || mapped.length || 0), metadata: { resourceTypes, channelId: opts.channelId || null, pageToken: pageToken || null, nextPageToken, resultsReturned: mapped.length, pageInfo: data.pageInfo || null } });
        void reserveDiscoveredCandidates(mapped, { context: opts.reserveContext || 'manual', seed: opts.seed || null, queryContext: `${query} ${resourceTypes}`.trim().toLowerCase() });
        mapped.nextPageToken = nextPageToken;
        mapped.pageInfo = data.pageInfo || null;
        return mapped;
    } catch (e) {
        reserveSaveQueryState({ queryKey, source: 'youtube', query, styleKey, seedKey: opts.seed?.artist || null, status: 'error', retryAfter: new Date(Date.now() + 5 * 60 * 1000).toISOString(), metadata: { resourceTypes, channelId: opts.channelId || null, pageToken: pageToken || null, error: String(e?.message || e) } });
        return [];
    }
}

async function fetchYouTubeLegacy(query, maxResults = 20) {
    try {
        const response = await fetch(`/api/search?query=${encodeURIComponent(query)}&type=youtube`);
        if (!response.ok) return [];
        const data = await response.json();
        if (!data.items || !data.items.length) return [];
        return data.items
            .filter(item => item && item.id && item.id.videoId && item.snippet)
            .slice(0, maxResults)
            .map(item => {
                const thumb = item.snippet.thumbnails && (item.snippet.thumbnails.medium || item.snippet.thumbnails.default || item.snippet.thumbnails.high);
                return {
                    title: normalizeSourceText(item.snippet.title),
                    artist: normalizeSourceText(item.snippet.channelTitle),
                    description: normalizeSourceText(item.snippet.description),
                    img: thumb ? thumb.url : '',
                    url: item.id.videoId,
                    type: 'yt',
                    resourceKind: 'youtube#video',
                    isPlaylist: false,
                    channelId: item.snippet.channelId,
                    channelTitle: item.snippet.channelTitle
                };
            });
    } catch (e) { return []; }
}

const ROCK_METAL_DISCOVERY_QUERY = 'rock metal official music';
const CONTENT_CATALOG_CACHE_KEY = 'nowarfy_catalog_cache_v1';
const CONTENT_CATALOG_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const OPENVERSE_RADIO_CACHE_KEY = 'nowarfy_openverse_radio_cache_v1';
const OPENVERSE_RADIO_CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const EMERGENCY_VIDEO_CATALOG = [
    { title: 'Metallica: Nothing Else Matters (Official Music Video)', artist: 'Metallica', channelTitle: 'Metallica', url: 'tAGnKpE4NCI', img: 'https://i.ytimg.com/vi/tAGnKpE4NCI/hqdefault.jpg', type: 'yt', resourceKind: 'youtube#video', description: 'Videoclip oficial de Metallica.' },
    { title: 'Nirvana - Smells Like Teen Spirit (Official Music Video)', artist: 'NirvanaVEVO', channelTitle: 'NirvanaVEVO', url: 'hTWKbfoikeg', img: 'https://i.ytimg.com/vi/hTWKbfoikeg/hqdefault.jpg', type: 'yt', resourceKind: 'youtube#video', description: 'Videoclip oficial de Nirvana.' },
    { title: 'System Of A Down - Chop Suey! (Official HD Video)', artist: 'systemofadownVEVO', channelTitle: 'systemofadownVEVO', url: 'CSvFpBOe8eY', img: 'https://i.ytimg.com/vi/CSvFpBOe8eY/hqdefault.jpg', type: 'yt', resourceKind: 'youtube#video', description: 'Videoclip oficial de System Of A Down.' },
    { title: 'System Of A Down - Lonely Day (Official HD Video)', artist: 'systemofadownVEVO', channelTitle: 'systemofadownVEVO', url: 'DnGdoEa1tPg', img: 'https://i.ytimg.com/vi/DnGdoEa1tPg/hqdefault.jpg', type: 'yt', resourceKind: 'youtube#video', description: 'Videoclip oficial de System Of A Down.' },
    { title: 'Numb (Official Music Video)', artist: 'Linkin Park', channelTitle: 'Linkin Park', url: 'kXYiU_JCYtU', img: 'https://i.ytimg.com/vi/kXYiU_JCYtU/hqdefault.jpg', type: 'yt', resourceKind: 'youtube#video', description: 'Videoclip oficial de Linkin Park.' },
    { title: 'Foo Fighters - The Pretender', artist: 'foofightersVEVO', channelTitle: 'foofightersVEVO', url: 'SBjQ9tuuTJQ', img: 'https://i.ytimg.com/vi/SBjQ9tuuTJQ/hqdefault.jpg', type: 'yt', resourceKind: 'youtube#video', description: 'Videoclip oficial de Foo Fighters.' },
    { title: 'MANOWAR - Warriors Of The World United (Live)', artist: 'MANOWAR', channelTitle: 'MANOWAR', url: 'G1G9D8A4Fiw', img: 'https://i.ytimg.com/vi/G1G9D8A4Fiw/hqdefault.jpg', type: 'yt', resourceKind: 'youtube#video', description: 'Video oficial en vivo de MANOWAR.' },
    { title: 'Slipknot - Psychosocial (Live from Day Of The Gusano)', artist: 'Slipknot', channelTitle: 'Slipknot', url: 'AQ0ktXH3LfI', img: 'https://i.ytimg.com/vi/AQ0ktXH3LfI/hqdefault.jpg', type: 'yt', resourceKind: 'youtube#video', description: 'Presentación en vivo de Slipknot.' },
    { title: 'ALL FOR METAL - Gods Of Metal (Official Music Video)', artist: 'Reigning Phoenix Music', channelTitle: 'Reigning Phoenix Music', url: '5A04DZNtH-w', img: 'https://i.ytimg.com/vi/5A04DZNtH-w/hqdefault.jpg', type: 'yt', resourceKind: 'youtube#video', description: 'Videoclip oficial de ALL FOR METAL.' }
];
const EMERGENCY_PLAYLISTS = [];
const GENRE_CHANNEL_LISTS = [
    { title: 'Rock', icon: 'fa-guitar', query: 'rock official music channels', styleKey: 'rock', description: 'Rock clásico, alternativo y contemporáneo.' },
    { title: 'Metal', icon: 'fa-hand-fist', query: 'metal official music channels', styleKey: 'metal', description: 'Metal clásico, extremo y moderno.' },
    { title: 'Hardcore', icon: 'fa-bolt', query: 'hardcore punk official music channels', styleKey: 'hardcore', description: 'Hardcore, punk pesado y escenas afines.' },
    { title: 'Punk', icon: 'fa-skull', query: 'punk rock official music channels', styleKey: 'punk', description: 'Punk, post-punk y espíritu independiente.' },
    { title: 'Grunge', icon: 'fa-cloud', query: 'grunge alternative rock official channels', styleKey: 'grunge', description: 'Grunge, alternativo y los noventa.' },
    { title: 'Stoner y Doom', icon: 'fa-mountain-sun', query: 'stoner doom metal official channels', styleKey: 'stoner', description: 'Riffs lentos, fuzz y peso atmosférico.' },
    { title: 'Rock latino', icon: 'fa-earth-americas', query: 'rock latino official music channels', styleKey: 'latin rock', description: 'Rock en español y escenas latinoamericanas.' }
];
const EXPLORE_COLLECTIONS = [
    { title: 'Conciertos y sesiones', icon: 'fa-tower-broadcast', query: 'rock metal live concert session', description: 'Shows en vivo, sesiones y escenarios.' },
    { title: 'Videoclips oficiales', icon: 'fa-film', query: 'rock metal official music video', description: 'Estrenos y videoclips de artistas.' },
    { title: 'Clásicos y rarezas', icon: 'fa-compact-disc', query: 'rock metal classic rare live', description: 'Archivo, tomas en vivo y joyas conocidas.' },
    { title: 'Nuevas voces', icon: 'fa-sparkles', query: 'new rock metal bands official', description: 'Bandas y lanzamientos para descubrir.' },
    { title: 'Covers y tributos', icon: 'fa-microphone-lines', query: 'rock metal cover tribute live', description: 'Interpretaciones y homenajes destacados.' },
    { title: 'Sellos y medios', icon: 'fa-satellite-dish', query: 'rock metal record label music channel', description: 'Canales de sellos, festivales y medios.' }
];
const FREE_MUSIC_COLLECTIONS = [
    { title: 'Rock libre', icon: 'fa-guitar', query: 'rock music', description: 'Pistas con licencia abierta, carátula y autor identificado.' },
    { title: 'Metal instrumental libre', icon: 'fa-bolt', query: 'metal instrumental music', description: 'Instrumentales de metal que pasan el filtro de calidad.' },
    { title: 'Punk y hardcore libre', icon: 'fa-hand-fist', query: 'punk hardcore music', description: 'Escenas libres de punk y hardcore, sin efectos ni bucles.' },
    { title: 'Sesiones y guitarras libres', icon: 'fa-record-vinyl', query: 'live guitar music', description: 'Grabaciones musicales y sesiones con licencia abierta.' }
];
const FREE_VIDEO_COLLECTIONS = [
    { title: 'Conciertos libres', icon: 'fa-tower-broadcast', query: 'music concert', description: 'Presentaciones audiovisuales con licencia abierta.' },
    { title: 'Archivo musical libre', icon: 'fa-film', query: 'rock music', description: 'Documentos y clips musicales de dominio público o Creative Commons.' }
];
const directCollectionCache = new Map();
const freeMediaCollectionCache = new Map();

async function recoverWithRockMetal() {
    const recovery = await fetchYouTubeSearch(ROCK_METAL_DISCOVERY_QUERY, 'video,playlist,channel', { maxResults: 20 });
    if (recovery.length) {
        renderYouTubeSearchResults(recovery, 'Sugerencias de rock y metal');
        showToast('Sin coincidencias asociadas: te mostramos rock y metal', 'fa-guitar');
        return true;
    }
    try {
        await searchOpenverse('rock metal');
        showToast('Sin coincidencias asociadas: te mostramos rock y metal', 'fa-guitar');
        return true;
    } catch (error) {
        return false;
    }
}

function mergeSearchResults(items) {
    const seen = new Set();
    return (items || []).filter(item => {
        const key = `${item?.resourceKind || item?.type || ''}:${item?.url || ''}`;
        if (!item?.url || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
function renderSearchResultsPage() {
    const state = activeSearchPagination;
    if (!state || state.query !== searchQuery) return;
    navigateWithTransition(() => {
        renderYouTubeSearchResults(state.youtubeResults, state.query);
        if (state.openverseResults.length) renderOpenverseSearchResults(state.openverseResults, state.query);
        renderSearchMoreControl();
    });
}
function renderSearchMoreControl() {
    const state = activeSearchPagination;
    const container = document.getElementById('dynamicSections');
    if (!container || !state || state.query !== searchQuery) return;
    searchMoreObserver?.disconnect();
    container.querySelector('#searchMoreWrap')?.remove();
    if (!state.youtubeNextPageToken && !state.openverseHasMore) return;
    const wrap = document.createElement('div');
    wrap.id = 'searchMoreWrap';
    wrap.className = 'catalog-more-wrap';
    wrap.innerHTML = '<button type="button" class="catalog-more" id="searchMoreButton"><i class="fas fa-plus"></i> Seguir cargando resultados</button>';
    container.appendChild(wrap);
    const button = wrap.querySelector('#searchMoreButton');
    button.onclick = () => loadMoreSearchResults();
    if ('IntersectionObserver' in window) {
        searchMoreObserver = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) void loadMoreSearchResults();
        }, { rootMargin: '500px 0px' });
        searchMoreObserver.observe(wrap);
    }
}
async function loadMoreSearchResults() {
    const state = activeSearchPagination;
    if (!state || state.loading || state.query !== searchQuery) return;
    if (!state.youtubeNextPageToken && !state.openverseHasMore) return;
    state.loading = true;
    const button = document.getElementById('searchMoreButton');
    if (button) { button.disabled = true; button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cargando más resultados...'; }
    try {
        const [youtubeResult, openverseResult] = await Promise.allSettled([
            state.youtubeNextPageToken
                ? fetchYouTubeSearch(state.query, channelFilter ? 'video,playlist' : 'video,playlist,channel', { channelId: channelFilter?.id, maxResults: 50, pageToken: state.youtubeNextPageToken, reserveContext: 'manual' })
                : Promise.resolve([]),
            state.openverseHasMore
                ? fetchOpenverseTracks(state.openverseQuery, 20, { page: state.openversePage + 1, reserveContext: 'manual', seed: { artist: state.query, title: state.query } })
                : Promise.resolve([])
        ]);
        if (state.query !== searchQuery || activeSearchPagination !== state) return;
        const nextYouTube = youtubeResult.status === 'fulfilled' ? youtubeResult.value || [] : [];
        const nextOpenverse = openverseResult.status === 'fulfilled' ? openverseResult.value || [] : [];
        state.youtubeResults = mergeSearchResults([...state.youtubeResults, ...nextYouTube]);
        state.openverseResults = mergeSearchResults([...state.openverseResults, ...nextOpenverse]);
        state.youtubeNextPageToken = String(nextYouTube.nextPageToken || '').trim();
        state.openversePage += 1;
        state.openverseHasMore = Boolean(nextOpenverse.nextPage || nextOpenverse.length >= 20);
        renderSearchResultsPage();
    } finally {
        state.loading = false;
        const nextButton = document.getElementById('searchMoreButton');
        if (nextButton) { nextButton.disabled = false; nextButton.innerHTML = '<i class="fas fa-plus"></i> Seguir cargando resultados'; }
    }
}
async function performSmartSearch(query, options = {}) {
    pushNowarfyHistory('search', {
        query: String(query || ''),
        channelId: channelFilter?.id || '',
        channelTitle: channelFilter?.title || ''
    });
    minimizeActiveVideoForNavigation();
    searchQuery = query;
    renderTasteChips(query);
    if (!channelFilter) rememberSearch(query);
    activeBrowseMode = 'search';
    searchMoreObserver?.disconnect();
    activeSearchPagination = { query, youtubeResults: [], youtubeNextPageToken: '', openverseResults: [], openverseQuery: channelFilter ? query : `${query} music`, openversePage: 1, openverseHasMore: false, loading: false };
    currentMood = null;
    document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('active'));

    const loader = document.getElementById('loader');
    const container = document.getElementById('dynamicSections');
    loader.style.display = 'flex';
    container.innerHTML = '';

    try {
        const localCandidates = await reserveSearchCandidates(query, { limit: 20 });
        const knownPool = [...(queue || []), ...(currentList || []), ...(homeVideos || []), ...(homeMusicVideos || []), ...(homeMusic || [])];
        const queryNeedle = String(query || '').toLowerCase().trim();
        const sessionCandidates = knownPool.filter(song => {
            if (!song?.url || !isRadioMusicTrack(song)) return false;
            const text = `${song.title || ''} ${song.artist || ''} ${song.description || ''}`.toLowerCase();
            return text.includes(queryNeedle);
        });
        const localSongs = [...localCandidates.map(candidate => ({ ...candidate, _fromReserve: true })), ...sessionCandidates].filter((song, index, all) => {
            const key = songKey(song);
            return all.findIndex(other => songKey(other) === key) === index;
        });
        const openverseQuery = channelFilter ? query : `${query} music`;
        const cachedSearchIsSufficient = !channelFilter && localSongs.length >= 3;
        const [youtubeResult, openverseResult] = await Promise.allSettled([
            cachedSearchIsSufficient
                ? Promise.resolve([])
                : (channelFilter
                    ? fetchYouTubeSearch(query, 'video,playlist', { channelId: channelFilter.id, maxResults: 50 })
                    : fetchYouTubeSearch(query, 'video,playlist,channel', { maxResults: 50 })),
            fetchOpenverseTracks(openverseQuery, 20, { page: 1, reserveContext: 'manual', seed: { artist: query, title: query } })
        ]);
        const fresh = youtubeResult.status === 'fulfilled' ? youtubeResult.value || [] : [];
        const openverseTracks = openverseResult.status === 'fulfilled' ? openverseResult.value || [] : [];
        const merged = mergeSearchResults([...localSongs, ...fresh]);
        activeSearchPagination.youtubeResults = merged;
        activeSearchPagination.youtubeNextPageToken = String(fresh.nextPageToken || '').trim();
        activeSearchPagination.openverseResults = mergeSearchResults(openverseTracks);
        activeSearchPagination.openverseHasMore = Boolean(openverseTracks.nextPage || openverseTracks.length >= 20);

        if (merged.length > 0) renderYouTubeSearchResults(merged, query);
        if (openverseTracks.length > 0) renderOpenverseSearchResults(openverseTracks, query);
        renderSearchMoreControl();
        if (!channelFilter && localSongs.length > 0 && fresh.length === 0) {
            showToast(cachedSearchIsSufficient ? `Resultados guardados reutilizados para "${query}"` : `YouTube sin resultados nuevos: usando candidatos guardados de ${inferArtistStyle(query, localSongs)}`, 'fa-database');
        }
        if (!merged.length && !openverseTracks.length) {
            if (channelFilter) renderEmptyState(`Sin resultados para "${query}" en este canal`);
            else if (!(await recoverWithRockMetal())) renderEmptyState(`Sin resultados para "${query}"`, 'No encontramos coincidencias ni propuestas musicales disponibles ahora.');
        }
    } catch (e) {
        console.warn('No se pudo completar la búsqueda solicitada', e);
        if (channelFilter || !(await recoverWithRockMetal())) {
            renderEmptyState(`Sin resultados para "${query}"`, 'No encontramos coincidencias ni propuestas de rock y metal disponibles ahora.');
        }
    } finally {
        if (loader.style.display === 'flex') loader.style.display = 'none';
    }
}

function browseChannel(channelId, channelTitle) {
    if (!channelId) return;
    void reserveDiscoveredCandidates([{
        url: String(channelId), type: 'yt', resourceKind: 'youtube#channel',
        title: String(channelTitle || 'Canal de YouTube'), artist: 'Canal de YouTube',
        channelId: String(channelId), channelTitle: String(channelTitle || 'Canal de YouTube')
    }], { context: 'channel_open', queryContext: `channel:${channelId}` });
    pushNowarfyHistory('channel', { channelId: String(channelId), channelTitle: String(channelTitle || '') });
    loadChannelProfile(channelId, channelTitle);
}

function clearChannelFilter() {
    const q = searchQuery;
    channelFilter = null;
    if (q) performSmartSearch(q); else resetView();
}

async function fetchOpenverseTracks(query, limit = 20, options = {}) {
    const page = Math.max(1, Number(options.page || 1));
    const response = await fetch(`/api/search?type=openverse&query=${encodeURIComponent(query)}&page=${page}&maxResults=${Math.min(Math.max(limit, 1), 20)}`);
    const data = await response.json();
    if (!response.ok || !data.results?.length) return [];
    const allowedAudioTypes = new Set(['mp3', 'mp32', 'ogg', 'opus', 'm4a', 'aac', 'wav', 'flac']);
    const unwantedAudioTerms = /\b(sound effect|sound-effect|sfx|foley|ambient|ambience|ambiente|noise|ruido|whoosh|impact|explosion|sample|sampling|loop|drum loop|drum circle|water|sonar|test tone|tone generator|field recording|field-recording|white noise|pink noise|audiobook|audio book|audiolibro|spoken word|narration|narrator|chapter|book reading|story|stories|lecture|podcast|interview|meditation|sleep music|children|bedtime)\b/i;
    const mappedTracks = data.results
        .filter(track => allowedAudioTypes.has(String(track.filetype || '').toLowerCase()))
        .filter(track => String(track.url || '').trim())
        .filter(track => String(track.title || '').trim() && String(track.creator || '').trim())
        .filter(track => !options.radioOnly || !/sound_effect|audiobook|audio_book|spoken|podcast|lecture/i.test(String(track.category || '')))
        .filter(track => !options.radioOnly || Number(track.duration) >= 60000)
        .filter(track => {
            if (!options.radioOnly) return true;
            const tags = Array.isArray(track.tags)
                ? track.tags.map(tag => typeof tag === 'object' ? tag.name || '' : tag).join(' ')
                : String(track.tags || '');
            const searchable = `${track.title || ''} ${track.creator || ''} ${track.category || ''} ${tags}`;
            return !unwantedAudioTerms.test(searchable);
        })
        .map(track => ({
            title: track.title, artist: track.creator,
            img: track.thumbnail || 'assets/nowarfy-icon-512.png', url: track.url, type: 'mp3',
            duration: track.duration ? Math.round(track.duration / 1000) : null,
            genre: (track.genres && track.genres[0]) || 'unknown',
            license: track.license || '',
            licenseVersion: track.license_version || '',
            filetype: track.filetype || '',
            sourceUrl: track.foreign_landing_url || track.detail_url || ''
        }))
        .sort((a, b) => (b.img ? 1 : 0) - (a.img ? 1 : 0));
    void reserveDiscoveredCandidates(mappedTracks, { context: options.reserveContext || 'manual', seed: options.seed || null, queryContext: `${query} openverse`.trim().toLowerCase() });
    mappedTracks.nextPage = data.pagination?.next || null;
    mappedTracks.page = page;
    return mappedTracks;
}

async function fetchCommonsVideos(query, limit = 12) {
    const cacheKey = `commons:${String(query || '').toLowerCase().trim()}`;
    if (freeMediaCollectionCache.has(cacheKey)) return freeMediaCollectionCache.get(cacheKey);
    const response = await fetch(`/api/search?type=commonsVideo&query=${encodeURIComponent(query)}&maxResults=${Math.min(Math.max(limit, 1), 20)}`);
    const data = await response.json();
    if (!response.ok || !Array.isArray(data.results)) return [];
    const mapped = data.results
        .filter(item => item?.url && item?.thumbnail && item?.license)
        .map(item => ({
            title: normalizeSourceText(item.title || 'Video libre'), artist: normalizeSourceText(item.creator || 'Wikimedia Commons'),
            img: item.thumbnail, url: item.url, type: 'freevideo', resourceKind: 'commons#video',
            duration: Number(item.duration) || null, license: normalizeSourceText(item.license), mime: item.mime || '',
            sourceUrl: item.sourceUrl || '', description: normalizeSourceText(item.description || ''),
            channelTitle: 'Wikimedia Commons'
        }));
    freeMediaCollectionCache.set(cacheKey, mapped);
    return mapped;
}

async function fetchFreeMusicCollection(collection) {
    const cacheKey = `openverse:${collection.query}`;
    if (freeMediaCollectionCache.has(cacheKey)) return freeMediaCollectionCache.get(cacheKey);
    const tracks = await fetchOpenverseTracks(collection.query, 20, { radioOnly: true, reserveContext: 'radio' });
    freeMediaCollectionCache.set(cacheKey, tracks);
    return tracks;
}

function renderOpenverseSearchResults(tracks, query) {
    if (!Array.isArray(tracks) || !tracks.length) return;
    renderLibraryRail(tracks.slice(0, 20), `Openverse · música de "${query}"`, "<i class='fas fa-headphones'></i>", false, {
        hint: 'Fuente abierta · resultados visibles siempre',
        showControls: true,
        className: 'free-music-rail openverse-search-rail'
    });
}
async function searchOpenverse(query) {
    const mappedResults = await fetchOpenverseTracks(query, 20);
    if (!mappedResults.length) throw new Error('No results');
    currentList = mappedResults;
    renderGrid(mappedResults, `Música: "${query}"`, "<i class='fas fa-headphones'></i>");
}

function setMood(mood) {
    currentMood = mood; searchQuery = ""; channelFilter = null;
    searchInput.value = ""; searchClearBtn.classList.remove('show');
    document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('active'));
    event.currentTarget.classList.add('active');
    performSmartSearch(mood);
}

function loadYouTubeAPI() {
    if (window.YT && window.YT.Player) { ytApiReady = true; return; }
    if (document.querySelector('script[data-youtoo-iframe-api]')) return;
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.dataset.youtooIframeApi = 'true';
    document.getElementsByTagName('script')[0].parentNode.insertBefore(tag, document.getElementsByTagName('script')[0]);
    window.onYouTubeIframeAPIReady = () => {
        ytApiReady = true;
        const pending = pendingYTRequest;
        pendingYTRequest = null;
        if (pending) initYTPlayer(pending.resourceId, pending.isPlaylist, pending.resumeSession || null, !!pending.deferAutoplay);
    };
}

function uniqueMediaByUrl(items, maxItems) {
    const seen = new Set();
    return items.filter(item => {
        const key = String(item?.url || '');
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    }).slice(0, maxItems);
}

let videoClassificationReviewTimer = null;
function videoSearchText(item) {
    const tags = Array.isArray(item?.tags) ? item.tags.map(tag => typeof tag === 'object' ? tag.name || '' : tag).join(' ') : String(item?.tags || item?.metadata?.tags || '');
    return `${item?.title || ''} ${item?.artist || ''} ${item?.channelTitle || ''} ${item?.description || ''} ${item?.genre || ''} ${tags}`.toLowerCase();
}
function isNonMusicalVideo(item) {
    if (!item?.url || !['yt', 'freevideo'].includes(item.type)) return false;
    if (item.type === 'freevideo') return true;
    const text = videoSearchText(item);
    const categoryId = String(item.categoryId || item.videoSnippet?.categoryId || '');
    const hasStrongMusicSignal = /official music video|music video|video musical|videoclip|official audio|lyric video|lyrics?|letra|band version|full album|álbum completo|album completo|full concert|live performance|presentación en vivo|canción|cancion|single|remix|cover|acoustic|instrumental|karaoke|song|track|concert|concierto|music video/.test(text);
    if (categoryId === '10' || hasStrongMusicSignal) return false;
    return /tutorial|how to|documentary|documental|vlog|podcast|interview|entrevista|news|noticias|review|reseña|reaction|reacción|gameplay|gaming|trailer|teaser|lecture|clase|curso|comedy|comedia|short film|cortometraje|live stream|streaming|sports|deportes|travel|viaje|cooking|cocina|technology|tecnología|unboxing|audiobook|audiolibro|lesson|tutorial/.test(text);
}
function musicalVideoPool(items, limit = 120) {
    return uniqueMediaByUrl((items || []).filter(item => item?.type === 'yt' && !isNonMusicalVideo(item)), limit);
}
function nonMusicalVideoPool(items, limit = 120) {
    return uniqueMediaByUrl((items || []).filter(isNonMusicalVideo), limit);
}
function reviewVideoClassification() {
    const pool = uniqueMediaByUrl([...(homeVideos || []), ...(homeMusicVideos || [])], 200);
    pool.forEach(item => {
        if (item?.type !== 'yt') return;
        const group = isNonMusicalVideo(item) ? 'non_music_video' : 'music_video';
        item.contentGroup = group;
        item.metadata = { ...(item.metadata || {}), contentGroup: group };
    });
}
function scheduleVideoClassificationReview() {
    if (videoClassificationReviewTimer) return;
    videoClassificationReviewTimer = window.setInterval(reviewVideoClassification, 5 * 60 * 1000);
}

function normalizeTasteTrack(item) {
    if (!item?.url || !item?.type) return null;
    return {
        ...item,
        resourceKind: item.resourceKind || (item.type === 'yt' ? 'youtube#video' : ''),
        artist: item.artist || item.channelTitle || 'Nowarfy',
        channelTitle: item.channelTitle || item.artist || ''
    };
}

function restoreCatalogCache() {
    try {
        const cached = JSON.parse(localStorage.getItem(CONTENT_CATALOG_CACHE_KEY));
        if (!cached || Date.now() - Number(cached.savedAt || 0) > CONTENT_CATALOG_CACHE_MAX_AGE_MS) return false;
        homeVideos = uniqueMediaByUrl(cached.videos || [], 24);
        homeMusicVideos = uniqueMediaByUrl(musicalVideoPool(cached.musicVideos || cached.videos || []), 24);
        homePlaylists = uniqueMediaByUrl(cached.playlists || [], 20);
        homeMusic = uniqueMediaByUrl(cached.music || [], 24);
        return homeVideos.length + homeMusicVideos.length + homePlaylists.length + homeMusic.length > 0;
    } catch (e) { return false; }
}

function persistCatalogCache() {
    try {
        localStorage.setItem(CONTENT_CATALOG_CACHE_KEY, JSON.stringify({
            savedAt: Date.now(), videos: homeVideos, musicVideos: homeMusicVideos, playlists: homePlaylists, music: homeMusic
        }));
    } catch (e) {}
}

function buildHomeRecommendations() {
    const taste = readTaste();
    const localActivity = [...taste.plays, ...favorites].map(normalizeTasteTrack).filter(Boolean);
    homeRecommended = uniqueMediaByUrl([...localActivity, ...homeMusicVideos, ...homeVideos, ...EMERGENCY_VIDEO_CATALOG], 24);
}

async function loadHomeCatalogSources() {
    const fromCache = restoreCatalogCache();
    if (!fromCache) {
        const localReserve = await readLocalReserveCandidates(120);
        const reservedVideos = localReserve.filter(item => item.type === 'yt' || item.resourceKind === 'youtube#video');
        const reservedAudio = localReserve.filter(item => item.type === 'mp3');
        const catalogVideos = uniqueMediaByUrl([...reservedVideos, ...EMERGENCY_VIDEO_CATALOG], 48);
        homeVideos = catalogVideos.slice(0, 24);
        homeMusicVideos = uniqueMediaByUrl(musicalVideoPool(catalogVideos), 24);
        homePlaylists = [];
        homeMusic = uniqueMediaByUrl(reservedAudio, 24);
        persistCatalogCache();
    }
    if (!homeVideos.length) homeVideos = uniqueMediaByUrl(EMERGENCY_VIDEO_CATALOG, 24);
    if (!homeMusicVideos.length) homeMusicVideos = uniqueMediaByUrl(musicalVideoPool([...homeVideos, ...EMERGENCY_VIDEO_CATALOG]), 24);
    if (!homePlaylists.length) homePlaylists = uniqueMediaByUrl(EMERGENCY_PLAYLISTS, 20);
    homeChannels = deriveChannels(uniqueMediaByUrl([...homeVideos, ...homeMusicVideos], 24));
    buildHomeRecommendations();
    refreshAmbientArtworkFromCatalog();
    return homeVideos.length + homeMusicVideos.length + homePlaylists.length + homeMusic.length + homeRecommended.length > 0;
}

async function resetView(options = {}) {
    pushNowarfyHistory('home');
    closeNowarfyMobileNav();
    minimizeActiveVideoForNavigation();
    searchQuery = ""; currentMood = null; channelFilter = null; activeBrowseMode = 'home';
    renderTasteChips();
    searchInput.value = ""; searchClearBtn.classList.remove('show');
    document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.nav-links li').forEach(l => l.classList.remove('active'));
    document.querySelector('.nav-links li:first-child').classList.add('active');

    if (homeFeedLoaded) {
        renderHomeFeed();
        if (!initialRadioQueueReady) {
            await ensureInitialRadioQueue();
            initialRadioQueueReady = true;
        }
        return;
    }
    if (homeFeedLoading) return;
    homeFeedLoading = true;
    const loader = document.getElementById('loader');
    const container = document.getElementById('dynamicSections');
    loader.style.display = 'flex';
    container.innerHTML = '';
    try {
        const hasContent = await loadHomeCatalogSources();
        homeFeedLoaded = hasContent;
        if (hasContent) {
            renderHomeFeed();
            if (!initialRadioQueueReady) {
                await ensureInitialRadioQueue();
                initialRadioQueueReady = true;
            }
        } else renderEmptyState('No pudimos cargar propuestas ahora', 'Probá recargar dentro de unos segundos o buscá un artista.');
    } finally {
        homeFeedLoading = false;
        loader.style.display = 'none';
    }
}

function featuredHash(value) {
    return Array.from(String(value)).reduce((total, char) => ((total << 5) - total + char.charCodeAt(0)) | 0, 0);
}

function getFeaturedEdition(videos) {
    const source = uniqueMediaByUrl(videos || [], (videos || []).length);
    if (!source.length) return { items: [], edition: 1, theme: FEATURED_THEMES[0] };
    const signature = source.map(item => String(item.url || '')).join('|');
    let previous = null;
    try { previous = JSON.parse(localStorage.getItem(FEATURED_ROTATION_STORAGE_KEY)); } catch (e) {}
    const seed = Math.abs(featuredHash(signature));
    const offset = previous?.signature === signature
        ? (Number(previous.offset || 0) + FEATURED_EDITION_SIZE) % source.length
        : seed % source.length;
    const edition = Math.floor(offset / FEATURED_EDITION_SIZE) + 1;
    const theme = FEATURED_THEMES[edition % FEATURED_THEMES.length];
    try { localStorage.setItem(FEATURED_ROTATION_STORAGE_KEY, JSON.stringify({ signature, offset, edition, at: Date.now() })); } catch (e) {}
    return { items: source.slice(offset).concat(source.slice(0, offset)), edition, theme };
}

function diversityKey(item) {
    return String(item?.url || item?.id || item?.videoId || '').trim();
}
function takeNovelItems(items, used, limit = 12) {
    const result = [];
    for (const item of uniqueMediaByUrl(items || [], (items || []).length)) {
        const key = diversityKey(item);
        if (!key || used.has(key)) continue;
        used.add(key);
        result.push(item);
        if (result.length >= limit) break;
    }
    return result;
}
function renderHomeWelcome(lastViewed) {
    const container = document.getElementById('dynamicSections');
    const welcome = document.createElement('button');
    welcome.type = 'button';
    welcome.className = 'home-welcome';
    if (lastViewed?.title) {
        welcome.innerHTML = `<span class="home-welcome-copy"><span class="home-welcome-brandline"><span class="home-welcome-logo"><img class="brand-lockup-mark" src="assets/nowarfy-logo-red-solid.png" alt=""><span class="brand-lockup-text"><strong>Nowarfy</strong><span>YouToo</span><sup class="brand-registered">®</sup></span></span><span class="home-welcome-kicker">Bienvenido de nuevo</span></span><h1>Seguimos desde donde quedaste</h1><p>Lo último que viste fue <strong>${escapeHtml(lastViewed.title)}</strong>${lastViewed.artist ? ` · ${escapeHtml(lastViewed.artist)}` : ''}. El reproductor empieza detenido: tocá esta tarjeta o el botón de reproducir cuando quieras continuar.</p></span>${lastViewed.img ? `<img class="home-welcome-art" src="${escapeHtml(lastViewed.img)}" alt="" loading="lazy">` : ''}`;
        welcome.addEventListener('click', () => resumeSongFromWelcome(lastViewed, 0));
    } else {
        welcome.innerHTML = `<span class="home-welcome-copy"><span class="home-welcome-brandline"><span class="home-welcome-logo"><img class="brand-lockup-mark" src="assets/nowarfy-logo-red-solid.png" alt=""><span class="brand-lockup-text"><strong>Nowarfy</strong><span>YouToo</span><sup class="brand-registered">®</sup></span></span><span class="home-welcome-kicker">Bienvenido a Nowarfy · YouToo</span></span><h1>Descubrí música real, sin límites</h1><p>Explorá artistas, canales y fuentes musicales. El reproductor empieza detenido para que vos elijas cuándo comenzar.</p></span>`;
    }
    container.appendChild(welcome);
}

function renderHomeQuickActions() {
    const container = document.getElementById('dynamicSections');
    const actions = document.createElement('div');
    actions.className = 'home-quick-actions';
    actions.innerHTML = `<button type="button" class="home-quick-action" onclick="searchInput.focus()"><i class="fas fa-magnifying-glass"></i><span><strong>Buscar música</strong><small>Encontrá un artista o canción</small></span></button>
        <button type="button" class="home-quick-action" onclick="openQueueFromSidebar()"><i class="fas fa-list-music"></i><span><strong>Ver playlist</strong><small>Revisá lo que sigue</small></span></button>
        <button type="button" class="home-quick-action" onclick="openNowarfyQr()"><i class="fas fa-qrcode"></i><span><strong>Vincular dispositivo</strong><small>Usá el pairing QR</small></span></button>`;
    container.appendChild(actions);
}

function renderHomeFeed() {
    const taste = readTaste();
    navigateWithTransition(() => {
        const container = document.getElementById('dynamicSections');
        container.innerHTML = '';
        currentList = [];
        const used = new Set();
        const lastViewed = normalizeTasteTrack(taste.plays[0]);
        renderHomeWelcome(lastViewed);
        renderHomeQuickActions();
        if (lastViewed) used.add(songKey(lastViewed));

        const recentArtists = [...new Set(taste.plays.map(item => String(item.artist || '').trim()).filter(Boolean))].slice(0, 10);
        if (recentArtists.length) {
            const artistItems = recentArtists.map(artist => {
                const lastPlay = taste.plays.find(p => String(p.artist || '').trim() === artist);
                return { title: artist, artist: 'Artista escuchado recientemente', img: lastPlay?.img || 'assets/nowarfy-icon-512.png', url: artist, type: 'search_trigger', query: artist };
            });
            renderLibraryRail(artistItems, 'Tus artistas recientes', "<i class='fas fa-microphone-lines'></i>", false, { hint: 'Basado en tu historial · tocá para buscar más', showControls: true, className: 'home-artists-rail' });
        }

        const recentVideos = uniqueMediaByUrl(taste.plays.map(normalizeTasteTrack).filter(item => item && (item.type === 'yt' || item.type === 'freevideo')), 3);
        if (recentVideos.length) renderLibraryRail(recentVideos, 'Últimos videos reproducidos', "<i class='fas fa-clock-rotate-left'></i>", false, { hint: 'Búsquedas y playlists · los 3 más recientes', showControls: true, className: 'home-mobile-recent-rail' });
        const resume = takeNovelItems(taste.plays.map(normalizeTasteTrack).filter(Boolean), used, 8);
        if (resume.length) renderLibraryRail(resume, 'Seguí desde donde quedaste', "<i class='fas fa-clock-rotate-left'></i>", false, { hint: 'Tu actividad reciente · sin repetir en otras sesiones', showControls: true, className: 'home-resume-rail' });
        const recommended = takeNovelItems(homeRecommended.filter(item => !isNonMusicalVideo(item)), used, 8);
        if (recommended.length) renderLibraryRail(recommended, taste.personalization && getTasteSeed() ? 'Recomendado para vos' : 'Para empezar ahora', "<i class='fas fa-wand-magic-sparkles'></i>", false, { hint: taste.personalization && getTasteSeed() ? 'Según tu actividad local · selección nueva' : 'Selección inicial · contenido no repetido', showControls: true, className: 'home-recommended-rail' });
        const edition = getFeaturedEdition(musicalVideoPool(homeVideos));
        const featured = takeNovelItems(edition.items, used, 8);
        if (featured.length >= 3) {
            renderLibraryRail(featured, 'Videos destacados', "<i class='fas fa-clapperboard'></i>", false, {
                className: `featured-rail featured-rail--${edition.theme}`,
                eyebrow: `Edición ${edition.edition}`,
                hint: 'Selección rotativa · sin repetir Inicio',
                showControls: true
            });
        }
        const musicVideos = takeNovelItems(musicalVideoPool(homeMusicVideos), used, 8);
        if (musicVideos.length >= 3) renderLibraryRail(musicVideos, 'Música para escuchar', "<i class='fab fa-youtube'></i>", false, { hint: 'Videoclips nuevos · sin repetir las sesiones anteriores', showControls: true });
        const playlists = takeNovelItems(homePlaylists.filter(hasUsablePlaylistItems), used, 12);
        if (playlists.length >= 2) renderLibraryRail(playlists, 'Listas y álbumes', "<i class='fas fa-layer-group'></i>", true, { hint: 'Colecciones diferentes para seguir explorando', showControls: true });
        const freeMusic = takeNovelItems(homeMusic, used, 12);
        if (freeMusic.length >= 2) renderLibraryRail(freeMusic, 'Música libre disponible', "<i class='fas fa-headphones'></i>", false, { hint: 'Audio con carátula y licencia · sin repetir videos', showControls: true });
        if (!resume.length && !recommended.length && !featured.length && !musicVideos.length && !playlists.length && !freeMusic.length) renderEmptyState('No hay opciones disponibles ahora', 'Probá recargar dentro de unos segundos o buscá un artista.');
        setTimeout(() => { initScrollAssemblyEngine(); observeScrollAssembly(); }, 40);
    });
}

function initNowarfyHistory() {
    const root = { nowarfy: true, view: 'home', root: true };
    const guard = { nowarfy: true, view: 'home', guard: true };
    history.replaceState(root, '', window.location.href);
    history.pushState(guard, '', window.location.href);
    nowarfyLastHistoryState = guard;
}

function pushNowarfyHistory(view, data = {}) {
    if (nowarfyRestoringHistory) return;
    const next = { nowarfy: true, view, ...data };
    const current = history.state;
    const sameRoute = current?.nowarfy && current.view === next.view &&
        (current.query || '') === (next.query || '') &&
        (current.section || '') === (next.section || '') &&
        (current.channelId || '') === (next.channelId || '') &&
        (current.playlistId || '') === (next.playlistId || '');
    nowarfyLastHistoryState = next;
    if (!sameRoute) history.pushState(next, '', window.location.href);
}

function closeNowarfyBackOverlays() {
    let closed = false;
    const sidebar = document.querySelector('.sidebar');
    if (sidebar?.classList.contains('mobile-nav-open')) { closeNowarfyMobileNav(); closed = true; }
    const authModal = document.getElementById('nowarfyAuthModal');
    if (authModal && !authModal.hidden) { closeNowarfyAuth(); closed = true; }
    const qrModal = document.getElementById('nowarfyQrModal');
    if (qrModal && !qrModal.hidden) { closeNowarfyQr(); closed = true; }
    const devicePicker = document.getElementById('nowarfyDevicePicker');
    if (devicePicker && !devicePicker.hidden) { devicePicker.hidden = true; closed = true; }
    const queuePanel = document.getElementById('queuePanel');
    if (queuePanel?.classList.contains('open')) { queuePanel.classList.remove('open'); closed = true; }
    const videoStage = document.getElementById('videoStage');
    if (videoStage?.classList.contains('visible') && isVisualVideo(currentQueueSong?.())) {
        setVideoStageMinimized(true);
        closed = true;
    }
    return closed;
}

async function restoreNowarfyHistory(state) {
    if (!state?.nowarfy || nowarfyRestoringHistory) return;
    nowarfyRestoringHistory = true;
    nowarfyLastHistoryState = state;
    try {
        if (state.view === 'home') await resetView({ fromHistory: true });
        else if (state.view === 'section') await showSection(state.section || 'home', { fromHistory: true });
        else if (state.view === 'search') {
            searchInput.value = state.query || '';
            searchClearBtn.classList.toggle('show', !!state.query);
            channelFilter = state.channelId ? { id: state.channelId, title: state.channelTitle || '' } : null;
            await performSmartSearch(state.query || '', { fromHistory: true });
        } else if (state.view === 'channel') {
            await loadChannelProfile(state.channelId, state.channelTitle || '');
        } else if (state.view === 'playlist') {
            await openPlaylist(state.playlist, { fromHistory: true });
        } else if (state.view === 'queue') openQueueFromSidebar({ fromHistory: true });
        else if (state.view === 'player') showFloatingPlayer({ fromHistory: true });
        else await resetView({ fromHistory: true });
    } finally {
        nowarfyRestoringHistory = false;
    }
}

window.addEventListener('popstate', event => {
    if (closeNowarfyBackOverlays()) {
        history.pushState(nowarfyLastHistoryState || { nowarfy: true, view: 'home' }, '', window.location.href);
        return;
    }
    if (event.state?.nowarfy) void restoreNowarfyHistory(event.state);
});

function activateNavigation(section) {
    closeNowarfyMobileNav();
    document.querySelectorAll('.nav-links li').forEach(item => item.classList.remove('active'));
    const primarySection = ['favorites', 'history', 'taste', 'playlists', 'queue'].includes(section) ? 'library' : section;
    document.querySelector(`[data-nav="${primarySection}"]`)?.classList.add('active');
}

async function ensureHomeCatalog() {
    if (homeFeedLoaded) return true;
    if (homeFeedLoading) return false;
    homeFeedLoading = true;
    const loader = document.getElementById('loader');
    const container = document.getElementById('dynamicSections');
    loader.style.display = 'flex';
    container.innerHTML = '';
    try {
        const hasContent = await loadHomeCatalogSources();
        homeFeedLoaded = hasContent;
        if (!hasContent) renderEmptyState('No pudimos cargar el catálogo', 'Probá buscar un artista o recargá dentro de unos segundos.');
        return hasContent;
    } finally {
        homeFeedLoading = false;
        loader.style.display = 'none';
    }
}

function openDiscoveryCollection(collection) {
    minimizeActiveVideoForNavigation();
    searchInput.value = collection.query;
    searchClearBtn.classList.add('show');
    channelFilter = null;
    performSmartSearch(collection.query);
}

function renderDiscoveryCards(title, intro, collections) {
    const container = document.getElementById('dynamicSections');
    container.innerHTML = '';
    currentList = [];
    const heading = document.createElement('div');
    heading.innerHTML = `<div class="section-title"><i class="fas fa-compass"></i> ${escapeHtml(title)}</div><p class="discovery-intro">${escapeHtml(intro)}</p>`;
    const grid = document.createElement('div');
    grid.className = 'discovery-grid';
    collections.forEach(collection => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'discovery-card';
        card.innerHTML = `<span class="discovery-card-icon"><i class="fas ${escapeHtml(collection.icon)}"></i></span><h3>${escapeHtml(collection.title)}</h3><p>${escapeHtml(collection.description)}</p>`;
        card.onclick = () => openDiscoveryCollection(collection);
        grid.appendChild(card);
    });
    container.appendChild(heading);
    container.appendChild(grid);
}

function channelEntityFromTaste(channel) {
    return {
        ...channel,
        url: channel.id,
        type: 'yt',
        resourceKind: 'youtube#channel',
        channelId: channel.id,
        channelTitle: channel.title,
        artist: 'Canal de YouTube'
    };
}
function channelStableKey(channel) {
    return String(channel?.channelId || channel?.id || channel?.url || '').trim();
}
function renderChannelHistoryRail() {
    const history = readTaste().channels
        .slice()
        .sort((a, b) => Number(b.at || 0) - Number(a.at || 0))
        .map(channelEntityFromTaste);
    const channels = itemsWithArtwork(uniqueMediaByUrl(history, 30));
    if (!channels.length) return false;
    const container = document.getElementById('dynamicSections');
    const section = document.createElement('section');
    section.className = 'library-rail-section channel-history-rail';
    section.innerHTML = `<div class="library-rail-title"><i class="fas fa-clock-rotate-left"></i><span>Últimos canales abiertos</span><span class="library-rail-hint">Historial · desplazá hacia la izquierda</span></div>`;
    const rail = document.createElement('div');
    rail.className = 'library-rail';
    channels.forEach((channel, index) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'card playlist-card library-card';
        card.innerHTML = `<div class="card-img-wrap"><span class="playlist-source-badge"><i class="fas fa-satellite-dish"></i> Canal</span><img src="${escapeHtml(channel.img || '')}" class="card-img loaded" loading="lazy" alt="" onerror="removeCardForMissingArtwork(this)"></div><div class="playlist-open"><i class="fas fa-arrow-up-right-from-square"></i> Abrir canal</div><div class="card-title">${escapeHtml(channel.title)}</div>${descriptionExcerpt(channel.description) ? `<p class="card-summary">${escapeHtml(descriptionExcerpt(channel.description))}</p>` : ''}`;
        card.style.animationDelay = `${Math.min(index * 0.03, 0.5)}s`;
        card.onclick = () => browseChannel(channel.id, channel.title);
        rail.appendChild(card);
    });
    section.appendChild(rail);
    container.appendChild(section);
    return true;
}
async function renderGlobalChannelRail(title, hint, { styleKey = '', limit = 24, seen = null } = {}) {
    const channels = await reserveGetGlobalCandidates({ source: 'youtube', kind: 'youtube#channel', styleKey, scope: 'search', limit });
    const visible = itemsWithArtwork(uniqueMediaByUrl(channels, limit)).filter(channel => {
        const key = channelStableKey(channel);
        if (!seen || !key) return true;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    if (!visible.length) return 0;
    renderChannelRow(visible, title, hint);
    return visible.length;
}
async function renderGenreChannels() {
    const container = document.getElementById('dynamicSections');
    const loader = document.getElementById('loader');
    container.innerHTML = '';
    currentList = [];
    loader.style.display = 'flex';
    try {
        const heading = document.createElement('div');
        heading.innerHTML = `<div class="section-title"><i class="fas fa-satellite-dish"></i> Canales</div><p class="discovery-intro">Canales reales organizados por historial, escucha actual y escenas musicales. Abrí uno para ver su descripción, estadísticas, listas y videos publicados.</p>`;
        container.appendChild(heading);
        const hasHistory = renderChannelHistoryRail();
        const globalChannels = await loadGlobalChannelCatalog({ reset: true });
        renderGlobalChannelLibrary();
        const renderedChannelKeys = new Set([
            ...readTaste().channels.map(channelStableKey),
            ...(globalChannels?.items || []).map(channelStableKey)
        ].filter(Boolean));
        const seed = currentList[0] || queue.find(item => item?._qid === currentPlayingQid) || homeVideos[0] || homeMusicVideos[0] || { title: getTasteSeed(), artist: getTasteSeed(), genre: currentMood || 'rock metal' };
        const relatedStyle = getRadioStyle(seed);
        let rendered = hasHistory ? 1 : 0;
        rendered += globalChannels?.items?.length || 0;
        rendered += await renderGlobalChannelRail(`Canales relacionados · ${relatedStyle}`, 'Según tu escucha actual y la reserva global', { styleKey: relatedStyle, limit: 24, seen: renderedChannelKeys });
        const settled = await Promise.allSettled(GENRE_CHANNEL_LISTS.map(async collection => {
            const saved = await reserveGetGlobalCandidates({ source: 'youtube', kind: 'youtube#channel', styleKey: collection.styleKey, scope: 'search', limit: 24 });
            if (saved.length >= 6) return saved;
            const fresh = await fetchYouTubeSearch(collection.query, 'channel', { maxResults: 8, reserveContext: 'channels' });
            return uniqueMediaByUrl([...saved, ...fresh.filter(item => item?.resourceKind === 'youtube#channel')], 24);
        }));
        settled.forEach((result, index) => {
            const channels = result.status === 'fulfilled' ? itemsWithArtwork(uniqueMediaByUrl(result.value, 24)).filter(channel => {
                const key = channelStableKey(channel);
                if (!key || renderedChannelKeys.has(key)) return false;
                renderedChannelKeys.add(key);
                return true;
            }) : [];
            if (!channels.length) return;
            rendered += channels.length;
            renderChannelRow(channels, GENRE_CHANNEL_LISTS[index].title, GENRE_CHANNEL_LISTS[index].description);
        });
        if (!rendered) renderEmptyState('No hay canales disponibles ahora', 'Probá volver a intentarlo cuando YouTube vuelva a responder o buscá un canal por nombre.');
    } finally {
        loader.style.display = 'none';
    }
}

async function loadGlobalPlaylistCatalog({ reset = false } = {}) {
    if (reset || !globalPlaylistCatalogState) {
        globalPlaylistCatalogState = { offset: 0, limit: 24, items: [], total: null, loading: false, done: false };
    }
    const state = globalPlaylistCatalogState;
    if (state.loading || state.done) return state;
    state.loading = true;
    try {
        const page = await reserveGetGlobalCandidates({ kind: 'playlist', scope: 'search', limit: state.limit, offset: state.offset });
        const localPage = state.offset === 0 ? await reserveGetLocalCandidates({ kind: 'playlist' }) : [];
        const combinedPage = [...page, ...localPage];
        const seen = new Set(state.items.map(item => reserveCandidateKey(item) || item.url));
        combinedPage.forEach(item => {
            const key = reserveCandidateKey(item) || item.url;
            if (!key || seen.has(key) || !hasUsablePlaylistItems(item)) return;
            seen.add(key);
            state.items.push({ ...item, type: 'yt', resourceKind: 'youtube#playlist', isPlaylist: true });
        });
        state.offset += page.length;
        const globalTotal = Number.isFinite(Number(page.total)) ? Number(page.total) : null;
        state.total = globalTotal === null ? Math.max(state.items.length, 0) : Math.max(globalTotal, state.items.length);
        state.done = page.length < state.limit || (globalTotal !== null && state.offset >= globalTotal);
    } catch (_) {
        state.done = true;
    } finally {
        state.loading = false;
    }
    return state;
}

function renderGlobalPlaylistLibrary() {
    const container = document.getElementById('dynamicSections');
    const state = globalPlaylistCatalogState;
    if (!container || !state) return;
    container.querySelector('[data-global-playlists]')?.remove();
    const playlists = itemsWithArtwork(uniqueMediaByUrl(state.items, 140)).filter(hasUsablePlaylistItems);
    if (!playlists.length) return;
    const section = document.createElement('section');
    section.dataset.globalPlaylists = 'true';
    section.className = 'global-playlists-section';
    const total = Number.isFinite(state.total) ? ` · ${formatCompactNumber(state.total)} recuperadas` : '';
    section.innerHTML = `<div class="section-title"><i class="fas fa-layer-group"></i> Listas de reproducción globales${escapeHtml(total)} <span class="library-rail-hint">Catálogo compartido · se alimenta con cada búsqueda e interacción</span></div>`;
    const grid = document.createElement('div');
    grid.className = 'grid';
    playlists.forEach((playlist, index) => grid.appendChild(buildPlaylistCard(playlist, index)));
    section.appendChild(grid);
    if (!state.done) {
        const wrap = document.createElement('div');
        wrap.className = 'catalog-more-wrap';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'catalog-more';
        button.innerHTML = '<i class="fas fa-plus"></i> Cargar más listas globales';
        button.onclick = async () => {
            button.disabled = true;
            button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cargando listas...';
            await loadGlobalPlaylistCatalog();
            renderGlobalPlaylistLibrary();
        };
        wrap.appendChild(button);
        section.appendChild(wrap);
    }
    container.appendChild(section);
}

async function loadGlobalChannelCatalog({ reset = false } = {}) {
    if (reset || !globalChannelCatalogState) {
        globalChannelCatalogState = { offset: 0, limit: 24, items: [], total: null, loading: false, done: false };
    }
    const state = globalChannelCatalogState;
    if (state.loading || state.done) return state;
    state.loading = true;
    try {
        const page = await reserveGetGlobalCandidates({ kind: 'channel', scope: 'search', limit: state.limit, offset: state.offset });
        const localPage = state.offset === 0 ? await reserveGetLocalCandidates({ kind: 'channel' }) : [];
        const combinedPage = [...page, ...localPage];
        const seen = new Set(state.items.map(item => reserveCandidateKey(item) || item.url));
        combinedPage.forEach(item => {
            const key = reserveCandidateKey(item) || item.url;
            if (!key || seen.has(key)) return;
            seen.add(key);
            state.items.push({ ...item, type: 'yt', resourceKind: 'youtube#channel', channelId: item.channelId || item.sourceId || item.url, channelTitle: item.channelTitle || item.title });
        });
        state.offset += page.length;
        const globalTotal = Number.isFinite(Number(page.total)) ? Number(page.total) : null;
        state.total = globalTotal === null ? Math.max(state.items.length, 0) : Math.max(globalTotal, state.items.length);
        state.done = page.length < state.limit || (globalTotal !== null && state.offset >= globalTotal);
    } catch (_) {
        state.done = true;
    } finally {
        state.loading = false;
    }
    return state;
}

function renderGlobalChannelLibrary() {
    const container = document.getElementById('dynamicSections');
    const state = globalChannelCatalogState;
    if (!container || !state) return;
    const oldSection = container.querySelector('[data-global-channels]');
    const nextSibling = oldSection?.nextSibling || null;
    oldSection?.remove();
    const channels = itemsWithArtwork(uniqueMediaByUrl(state.items, 140));
    if (!channels.length) return;
    const previousCount = container.children.length;
    renderChannelRow(channels, 'Canales globales recuperados', 'Catálogo compartido · se alimenta con cada búsqueda e interacción');
    const section = container.children[previousCount];
    if (!section) return;
    if (nextSibling?.parentNode === container) container.insertBefore(section, nextSibling);
    section.dataset.globalChannels = 'true';
    const total = Number.isFinite(state.total) ? ` · ${formatCompactNumber(state.total)} recuperados` : '';
    const title = section.querySelector('.section-title');
    if (title) title.innerHTML = `<i class="fas fa-satellite-dish"></i> Canales globales${escapeHtml(total)} <span class="library-rail-hint">Catálogo compartido · se alimenta con cada búsqueda e interacción</span>`;
    if (!state.done) {
        const wrap = document.createElement('div');
        wrap.className = 'catalog-more-wrap';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'catalog-more';
        button.innerHTML = '<i class="fas fa-plus"></i> Cargar más canales globales';
        button.onclick = async () => {
            button.disabled = true;
            button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cargando canales...';
            await loadGlobalChannelCatalog();
            renderGlobalChannelLibrary();
        };
        wrap.appendChild(button);
        section.appendChild(wrap);
    }
}

function renderExploreCollections() {
    navigateWithTransition(() => {
        renderDiscoveryCards('Explorar', 'Elegí una colección para ejecutar una búsqueda real y ver resultados nuevos, sin reciclar los mismos videos de Inicio.', EXPLORE_COLLECTIONS);
        const container = document.getElementById('dynamicSections');
        const filters = document.createElement('div');
        filters.className = 'section-filter-row';
        filters.innerHTML = `<span class="section-filter-label">Ver también</span>
            <button type="button" class="section-filter-btn is-active" onclick="showSection('explore')"><i class="fas fa-compass"></i> Todo</button>
            <button type="button" class="section-filter-btn" onclick="showSection('music')"><i class="fas fa-headphones"></i> Música</button>
            <button type="button" class="section-filter-btn" onclick="showSection('videos')"><i class="fas fa-clapperboard"></i> Videos</button>
            <button type="button" class="section-filter-btn" onclick="showSection('channels')"><i class="fas fa-satellite-dish"></i> Canales</button>
            <button type="button" class="section-filter-btn" onclick="showSection('playlists')"><i class="fas fa-list-ul"></i> Listas</button>`;
        container.insertBefore(filters, container.children[1] || null);
    });
}

function renderLibraryHub() {
    navigateWithTransition(() => {
        const container = document.getElementById('dynamicSections');
        container.innerHTML = `<div class="section-title"><i class="fas fa-book-open"></i> Biblioteca</div>
            <p class="discovery-intro">Todo lo que guardaste, escuchaste o estás preparando, en un solo lugar.</p>
            <div class="library-hub-grid">
                <button type="button" class="library-hub-card" data-library-target="favorites"><i class="fas fa-heart"></i><strong>Favoritos</strong><span>Tus canciones guardadas</span></button>
                <button type="button" class="library-hub-card" data-library-target="history"><i class="fas fa-clock-rotate-left"></i><strong>Historial</strong><span>Volvé a lo que escuchaste</span></button>
                <button type="button" class="library-hub-card" data-library-target="playlists"><i class="fas fa-list-ul"></i><strong>Listas</strong><span>Álbumes y playlists</span></button>
                <button type="button" class="library-hub-card" data-library-target="queue"><i class="fas fa-list-music"></i><strong>Playlist actual</strong><span>Lo que sigue reproduciéndose</span></button>
                <button type="button" class="library-hub-card" data-library-target="taste"><i class="fas fa-shield-halved"></i><strong>Tus datos</strong><span>Privacidad y personalización</span></button>
            </div>`;
        container.querySelectorAll('[data-library-target]').forEach(card => {
            card.addEventListener('click', () => card.dataset.libraryTarget === 'queue' ? openQueueFromSidebar() : showSection(card.dataset.libraryTarget));
        });
    });
}

async function appendFreeMusicCollections() {
    const settled = await Promise.allSettled(FREE_MUSIC_COLLECTIONS.map(collection => fetchFreeMusicCollection(collection)));
    const rows = settled.map((result, index) => ({ collection: FREE_MUSIC_COLLECTIONS[index], tracks: result.status === 'fulfilled' ? result.value : [] }))
        .filter(row => row.tracks.length);
    rows.forEach(({ collection, tracks }) => {
        renderLibraryRail(tracks, collection.title, `<i class="fas ${collection.icon}"></i>`, false, {
            hint: `${collection.description} · Openverse · 5 visibles`, showControls: true, className: 'free-music-rail'
        });
    });
    return rows.flatMap(row => row.tracks);
}

async function appendFreeVideoCollections() {
    const settled = await Promise.allSettled(FREE_VIDEO_COLLECTIONS.map(collection => fetchCommonsVideos(collection.query, 12)));
    const rows = settled.map((result, index) => ({ collection: FREE_VIDEO_COLLECTIONS[index], videos: result.status === 'fulfilled' ? result.value : [] }))
        .filter(row => row.videos.length);
    rows.forEach(({ collection, videos }) => {
        renderLibraryRail(videos, collection.title, `<i class="fas ${collection.icon}"></i>`, false, {
            hint: `${collection.description} · Wikimedia Commons · 5 visibles`, showControls: true, className: 'free-video-rail'
        });
    });
    return rows.flatMap(row => row.videos);
}

async function renderVideosSection({ silent = false } = {}) {
    const ready = await ensureHomeCatalog();
    reviewVideoClassification();
    if (!ready) return;
    const container = document.getElementById('dynamicSections');
    container.innerHTML = '';
    document.getElementById('loader').style.display = 'none';
    const allYouTubeVideos = uniqueMediaByUrl([...(homeVideos || []), ...(homeMusicVideos || [])], 160);
    const musicalVideos = musicalVideoPool(allYouTubeVideos, 120);
    const nonMusicalVideos = nonMusicalVideoPool(allYouTubeVideos, 120);
    currentList = [...musicalVideos, ...nonMusicalVideos];
    if (musicalVideos.length) renderGrid(musicalVideos, 'Videos musicales', "<i class='fab fa-youtube'></i>");
    if (nonMusicalVideos.length) renderGrid(nonMusicalVideos, 'Videos no musicales · descubrimientos', "<i class='fas fa-clapperboard'></i>");
    const freeVideos = await appendFreeVideoCollections();
    currentList = uniqueMediaByUrl([...currentList, ...freeVideos], 160);
    if (!musicalVideos.length && !nonMusicalVideos.length && !freeVideos.length) renderEmptyState('No hay videos disponibles ahora', 'Probá buscar un artista o tema.');
    if (!silent && nonMusicalVideos.length) showToast(`${nonMusicalVideos.length} videos quedaron en "No musicales"`, 'fa-filter');
}

scheduleVideoClassificationReview();

function renderPlaybackHistory() {
    const taste = readTaste();
    const playable = taste.plays.filter(item => item?.url && item?.type);
    navigateWithTransition(() => {
        const container = document.getElementById('dynamicSections');
        container.innerHTML = '';
        document.getElementById('loader').style.display = 'none';
        if (!taste.plays.length) {
            renderEmptyState('Todavía no hay reproducciones guardadas', 'Lo que escuches o mires desde ahora aparecerá acá, solo en este dispositivo.');
            return;
        }
        if (playable.length) {
            currentList = playable;
            renderGrid(playable, 'Historial de reproducción', "<i class='fas fa-clock-rotate-left'></i>");
        } else {
            renderEmptyState('Tu historial ya está guardado', 'Las nuevas reproducciones conservarán también su enlace para poder volver a abrirlas desde acá.');
        }
    });
}

function openQueueFromSidebar(options = {}) {
    pushNowarfyHistory('queue');
    minimizeActiveVideoForNavigation();
    activeBrowseMode = 'queue';
    activateNavigation('queue');
    const panel = document.getElementById('queuePanel');
    if (!panel.classList.contains('open')) toggleQueuePanel();
    else renderQueue();
}

function showFloatingPlayer(options = {}) {
    pushNowarfyHistory('player');
    minimizeActiveVideoForNavigation();
    activeBrowseMode = 'player';
    activateNavigation('player');
    if (!isFloating) toggleFloatingMode();
    document.getElementById('playerBar').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function minimizeActiveVideoForNavigation() {
    const song = currentQueueSong();
    if (isVisualVideo(song)) setVideoStageMinimized(true, { autoReason: 'navigation' });
}

async function showSection(section, options = {}) {
    pushNowarfyHistory('section', { section });
    minimizeActiveVideoForNavigation();
    activeBrowseMode = section;
    activateNavigation(section);
    
    if (section === 'library') { renderLibraryHub(); return; }
    if (section === 'favorites') {
        navigateWithTransition(() => {
            document.getElementById('dynamicSections').innerHTML = '';
            document.getElementById('loader').style.display = 'none';
            currentList = favorites;
            if (favorites.length === 0) renderEmptyState('Todavía no tenés favoritos', 'Tocá el corazón de una canción para guardarla acá.');
            else renderGrid(favorites, 'Tus Favoritos', "<i class='fas fa-heart'></i>");
        });
        return;
    }
    if (section === 'history') { renderPlaybackHistory(); return; }
    if (section === 'taste') { renderTasteData(); return; }

    if (section === 'explore') { renderExploreCollections(); return; }
    if (section === 'channels') { await renderGenreChannels(); return; }
    const ready = await ensureHomeCatalog();
    if (!ready) return;
    const container = document.getElementById('dynamicSections');
    container.innerHTML = '';
    if (section === 'playlists') {
        currentList = [];
        const savedPlaylists = readTaste().playlists.map(item => ({
            url: item.id, title: item.title, artist: item.artist || 'YouTube', img: item.img || '',
            description: item.description || '', channelId: item.channelId || '', type: 'playlist', resourceKind: 'youtube#playlist', isPlaylist: true, itemCount: item.itemCount ?? null
        }));
        await loadGlobalPlaylistCatalog({ reset: true });
        navigateWithTransition(() => {
            renderGlobalPlaylistLibrary();
            if (savedPlaylists.length) renderPlaylistGrid(savedPlaylists, 'Listas abiertas anteriormente');
            if (homePlaylists.length) renderPlaylistGrid(homePlaylists, savedPlaylists.length ? 'Listas sugeridas para explorar' : 'Listas destacadas');
            if (!globalPlaylistCatalogState?.items.length && !savedPlaylists.length && !homePlaylists.length) renderEmptyState('No hay listas disponibles ahora', 'Probá buscar el nombre de un artista o álbum.');
        });
        return;
    }
    if (section === 'videos') {
        await renderVideosSection();
        return;
    }
    if (section === 'music') {
        const expandedFreeMusic = await appendFreeMusicCollections();
        navigateWithTransition(() => {
            currentList = [...homeMusicVideos, ...homeMusic];
            if (homeMusicVideos.length) renderGrid(homeMusicVideos, 'Música de YouTube', "<i class='fab fa-youtube'></i>");
            if (homeMusic.length) renderGrid(homeMusic, 'Música libre complementaria', "<i class='fas fa-headphones'></i>");
            currentList = uniqueMediaByUrl([...homeMusicVideos, ...homeMusic, ...expandedFreeMusic], 140);
            if (!homeMusicVideos.length && !homeMusic.length && !expandedFreeMusic.length) renderEmptyState('No hay música disponible ahora', 'Probá buscar un artista o tema.');
        });
    }
}

function renderEmptyState(title, subtitle) {
    const container = document.getElementById('dynamicSections');
    container.innerHTML = `<div class="empty-state">
        <i class="fas fa-record-vinyl"></i>
        <strong>${escapeHtml(title)}</strong>
        ${subtitle ? `<span>${escapeHtml(subtitle)}</span>` : ''}
    </div>`;
}

function renderYouTubeSearchResults(list, query) {
    const channels = list.filter(result => result.resourceKind === 'youtube#channel');
    const playlists = list.filter(result => result.resourceKind === 'youtube#playlist' && hasUsablePlaylistItems(result)).map((item, index) => ({ ...item, sourceIndex: index }));
    const videos = list.filter(result => result.resourceKind === 'youtube#video').map((item, index) => ({ ...item, sourceIndex: index }));

    if (!channels.length && !playlists.length && !videos.length) {
        renderEmptyState(`Sin resultados para "${query}"`);
        return;
    }

    currentList = videos;
    const container = document.getElementById('dynamicSections');
    container.innerHTML = '';

    if (channelFilter) {
        const chip = document.createElement('div');
        chip.innerHTML = `<div class="channel-filter-chip">
            <i class="fas fa-satellite-dish"></i>
            <span>Viendo canal: ${escapeHtml(channelFilter.title)}</span>
            <button type="button" onclick="clearChannelFilter()" aria-label="Quitar filtro de canal"><i class="fas fa-xmark"></i></button>
        </div>`;
        container.appendChild(chip);
    }

    if (channels.length) renderChannelRow(channels, channelFilter ? 'Canales relacionados' : `Canales: "${query}"`);
    if (playlists.length) renderPlaylistGrid(playlists, channelFilter ? 'Listas de reproducción del canal' : `Listas y álbumes: "${query}"`);
    if (videos.length) renderGrid(videos, channelFilter ? 'Videos y música del canal' : `Videos individuales: "${query}"`, "<i class='fas fa-clapperboard'></i>");
}

function renderChannelRow(channels, title, hint = 'Canales encontrados en YouTube') {
    const visibleChannels = itemsWithArtwork(channels);
    if (!visibleChannels.length) return;
    const container = document.getElementById('dynamicSections');
    const section = document.createElement('div');
    section.innerHTML = `<div class="section-title"><i class="fas fa-satellite-dish"></i> ${escapeHtml(title)} <span class="library-rail-hint">${escapeHtml(hint)}</span></div>`;
    const scroll = document.createElement('div');
    scroll.className = 'channel-scroll';

    visibleChannels.forEach(ch => {
        const chip = document.createElement('div');
        chip.className = 'channel-chip';
        chip.innerHTML = `
            <div class="channel-avatar-wrap">
                <img src="${escapeHtml(ch.img || '')}" alt="" loading="lazy" onerror="this.closest('.channel-chip').remove();">
                <span class="channel-badge"><i class="fas fa-play"></i></span>
            </div>
            <span class="channel-chip-title">${escapeHtml(ch.title)}</span>
            <span class="channel-chip-desc">Canal</span>`;
        chip.onclick = () => browseChannel(ch.url, ch.title);
        scroll.appendChild(chip);
    });

    section.appendChild(scroll);
    container.appendChild(section);
}

function renderSongList(list, title, icon, options = {}) {
    const visibleSongs = itemsWithArtwork(list);
    if (!visibleSongs.length) return;
    const container = document.getElementById('dynamicSections');
    const section = document.createElement('div');
    if (!options.skipTitle) {
        section.innerHTML = `<div class="section-title">${icon} ${escapeHtml(title)}</div>`;
    }
    const songList = document.createElement('div');
    songList.className = 'song-list';

    visibleSongs.forEach((song, idx) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'song-row';
        row.dataset.idx = song.sourceIndex ?? idx;
        const artistClickable = !!song.channelId;
        row.innerHTML = `
            <span class="song-row-number">${idx + 1}</span>
            <img src="${escapeHtml(song.img || '')}" class="song-row-img" loading="lazy" alt="" onerror="this.closest('.song-row').remove();">
            <span class="song-row-details">
                <span class="song-row-title" title="${escapeHtml(song.title)}">${escapeHtml(song.title)}</span>
                <span class="song-row-artist${artistClickable ? ' artist-link' : ''}">${escapeHtml(song.artist)}</span>
                ${descriptionExcerpt(song.description, 92) ? `<span class="song-row-summary" title="${escapeHtml(song.description)}">${escapeHtml(descriptionExcerpt(song.description, 92))}</span>` : ''}
            </span>
            <span class="song-row-actions">
                <span class="song-row-duration">${formatContentDuration(song.duration)}</span>
                <button type="button" class="song-row-addq song-row-favorite${isFavoriteSong(song) ? ' active' : ''}" title="Guardar en favoritos" aria-label="Guardar en favoritos"><i class="${isFavoriteSong(song) ? 'fas' : 'far'} fa-heart"></i></button>
                <button type="button" class="song-row-addq" title="Agregar a Playlist" aria-label="Agregar a Playlist"><i class="fas fa-list"></i></button>
                <i class="fas fa-play song-row-play" aria-hidden="true"></i>
            </span>`;
        row.onclick = () => selectSong(song, song.sourceIndex ?? idx);
        row.querySelector('.song-row-favorite').onclick = (e) => {
            e.stopPropagation();
            toggleFavoriteSong(song, e.currentTarget);
        };
        row.querySelector('.song-row-addq:not(.song-row-favorite)').onclick = (e) => {
            e.stopPropagation();
            addToQueue(song);
        };
        if (artistClickable) {
            row.querySelector('.song-row-artist').onclick = (e) => {
                e.stopPropagation();
                browseChannel(song.channelId, song.channelTitle || song.artist);
            };
        }
        songList.appendChild(row);
    });

    section.appendChild(songList);
    container.appendChild(section);
}

function renderPlaylistGrid(list, title) {
    const visiblePlaylists = itemsWithArtwork(list).filter(hasUsablePlaylistItems);
    if (!visiblePlaylists.length) return;
    const container = document.getElementById('dynamicSections');
    const section = document.createElement('div');
    section.innerHTML = `<div class="section-title"><i class="fas fa-layer-group"></i> ${escapeHtml(title)}</div>`;
    const grid = document.createElement('div');
    grid.className = 'grid';
    visiblePlaylists.forEach((playlist, idx) => grid.appendChild(buildPlaylistCard(playlist, idx)));
    section.appendChild(grid);
    container.appendChild(section);
}

function returnFromPlaylist() {
    const state = activePlaylistCatalog;
    activePlaylistCatalog = null;
    if (state?.returnMode === 'channel' && activeChannelCatalog?.channel) {
        activeBrowseMode = 'channel';
        renderChannelCatalog();
        return;
    }
    if (state?.returnMode === 'home') { resetView(); return; }
    performSmartSearch(state?.returnQuery || searchQuery || state?.playlist?.title || ROCK_METAL_DISCOVERY_QUERY);
}

function renderOpenedPlaylist() {
    const state = activePlaylistCatalog;
    if (!state) return;
    navigateWithTransition(() => {
        const container = document.getElementById('dynamicSections');
        container.innerHTML = '';
        currentList = state.tracks;

        const hero = document.createElement('div');
        hero.className = 'playlist-hero';
        const total = Number(state.pageInfo?.totalResults || state.tracks.length);
        const countLabel = Number.isFinite(total) && total > 0 ? `${new Intl.NumberFormat('es-UY').format(total)} videos` : 'Lista de reproducción';
        
        hero.innerHTML = `
            <div class="playlist-hero-top">
                <img src="${escapeHtml(state.playlist.img || '')}" class="playlist-hero-img" alt="" onerror="this.src='https://www.gstatic.com/youtube/src/web/htdocs/img/no_thumbnail.jpg'">
                <div class="playlist-hero-info">
                    <span class="playlist-hero-eyebrow">Lista de reproducción</span>
                    <h1 class="playlist-hero-title" title="${escapeHtml(state.playlist.title)}">${escapeHtml(state.playlist.title)}</h1>
                    <div class="playlist-hero-meta">
                        <span class="playlist-hero-artist">${escapeHtml(state.playlist.artist || 'YouTube')}</span>
                        <span class="playlist-hero-sep">·</span>
                        <span>${countLabel}</span>
                    </div>
                </div>
            </div>
            <div class="playlist-hero-actions">
                <button type="button" class="playlist-hero-play" title="Reproducir toda la lista" aria-label="Reproducir toda la lista">
                    <i class="fas fa-play"></i>
                </button>
                <button type="button" class="video-stage-close" style="margin:0; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1);">
                    <i class="fas fa-arrow-left"></i> Volver
                </button>
            </div>`;

        hero.querySelector('.playlist-hero-play').onclick = () => {
            startPrebuiltPlaylistPlayback(state.playlist, state.tracks, state.pageInfo || {}, state.nextPageToken || '');
        };
        hero.querySelector('.video-stage-close').onclick = returnFromPlaylist;
        if (state.playlist.channelId) {
            hero.querySelector('.playlist-hero-artist').onclick = () => browseChannel(state.playlist.channelId, state.playlist.artist);
        }

        container.appendChild(hero);
        renderSongList(state.tracks, `Contenido de la lista`, "<i class='fas fa-list-music'></i>", { skipTitle: true });
        if (state.nextPageToken) addCatalogMore(container, 'Cargar más de esta lista', () => loadMoreOpenPlaylist(state.nextPageToken));
    });
}

function startPrebuiltPlaylistPlayback(playlist, tracks, pageInfo = {}, nextPageToken = '') {
    if (!playlist?.url || !tracks?.length) return false;
    queuePlaybackMode = 'prebuilt_playlist';
    queuePlaylistContext = {
        playlistId: String(playlist.url), title: String(playlist.title || 'Lista de reproducción'),
        artist: String(playlist.artist || playlist.channelTitle || 'YouTube'), img: playlist.img || '',
        channelId: playlist.channelId || '', totalResults: Number(pageInfo.totalResults || tracks.length),
        nextPageToken: String(nextPageToken || ''), nativePlayback: true
    };
    continuousPlayback = true;
    localStorage.setItem(CONTINUOUS_PLAYBACK_STORAGE_KEY, 'true');
    queue = [];
    queueSeenKeys = new Set();
    queueRound = 0;
    appendPrebuiltPlaylistTracks(tracks);
    persistQueueMode();
    persistQueue();
    renderContinuousPlaybackControls();
    renderQueue();
    playQueueAt(0, { sourceIdx: tracks[0].sourceIndex ?? 0, playlistId: String(playlist.url), forceNewYouTubePlayer: true });
    showToast(`Reproduciendo playlist · ${queue.length} videos en orden`, 'fa-list-music');
    return true;
}

async function openPlaylist(playlist, options = {}) {
    minimizeActiveVideoForNavigation();
    if (playlist?.url) {
        void reserveDiscoveredCandidates([{ ...playlist, type: 'yt', resourceKind: 'youtube#playlist', isPlaylist: true }], {
            context: 'playlist_open',
            queryContext: `playlist:${playlist.url}`
        });
    }
    pushNowarfyHistory('playlist', {
        playlistId: String(playlist?.url || ''),
        playlist: {
            url: String(playlist?.url || ''), title: String(playlist?.title || 'Lista de reproducción'),
            artist: String(playlist?.artist || playlist?.channelTitle || 'YouTube'), img: playlist?.img || '',
            description: playlist?.description || '', channelId: playlist?.channelId || ''
        }
    });
    rememberPlaylist(playlist);
    const loader = document.getElementById('loader');
    const container = document.getElementById('dynamicSections');
    loader.style.display = 'flex';
    container.innerHTML = '';
    try {
        const response = await fetch(`/api/search?type=youtube&action=playlistItems&playlistId=${encodeURIComponent(playlist.url)}&maxResults=24`);
        const data = await response.json();
        if (!response.ok || !data.items?.length) throw new Error('playlist_unavailable');
        const tracks = mapPlaylistVideoItems(data.items, { channelId: playlist.channelId || '', channelTitle: playlist.artist || '', img: playlist.img || '', collectionId: playlist.url, collectionTitle: playlist.title, collectionImg: playlist.img || '' });
        if (!tracks.length) throw new Error('playlist_empty');
        const totalResults = Number(data.pageInfo?.totalResults);
        const hydratedPlaylist = Number.isFinite(totalResults) && totalResults > 0 ? { ...playlist, itemCount: totalResults } : playlist;
        void reserveDiscoveredCandidates(tracks, { context: 'playlist', queryContext: `playlist:${playlist.url}` });
        activePlaylistCatalog = {
            playlist: hydratedPlaylist,
            tracks,
            pageInfo: data.pageInfo || {},
            nextPageToken: data.nextPageToken || '',
            returnMode: activeBrowseMode,
            returnQuery: searchQuery
        };
        if (hydratedPlaylist !== playlist) rememberPlaylist(hydratedPlaylist);
        renderOpenedPlaylist();
        if (options.playNow) startPrebuiltPlaylistPlayback(hydratedPlaylist, tracks, data.pageInfo || {}, data.nextPageToken || '');
    } catch (error) {
        activePlaylistCatalog = null;
        renderEmptyState('No pudimos abrir esta lista', 'La lista puede ser privada, estar vacía o no permitir reproducción. No mostramos videos de otra colección como reemplazo.');
    } finally {
        loader.style.display = 'none';
    }
}

async function loadMoreOpenPlaylist(pageToken) {
    const state = activePlaylistCatalog;
    if (!state?.playlist?.url || !pageToken) return;
    const response = await fetch(`/api/search?type=youtube&action=playlistItems&playlistId=${encodeURIComponent(state.playlist.url)}&pageToken=${encodeURIComponent(pageToken)}&maxResults=24`);
    const data = await response.json();
    if (!response.ok) throw new Error('more_playlist_items_unavailable');
    const nextTracks = mapPlaylistVideoItems(data.items, { channelId: state.playlist.channelId || '', channelTitle: state.playlist.artist || '', img: state.playlist.img || '', collectionId: state.playlist.url, collectionTitle: state.playlist.title, collectionImg: state.playlist.img || '' }, state.tracks.length);
    state.tracks = [...state.tracks, ...nextTracks];
    void reserveDiscoveredCandidates(nextTracks, { context: 'playlist', queryContext: `playlist:${state.playlist.url}` });
    state.pageInfo = data.pageInfo || state.pageInfo;
    state.nextPageToken = data.nextPageToken || '';
    if (queuePlaybackMode === 'prebuilt_playlist' && queuePlaylistContext?.playlistId === String(state.playlist.url)) {
        appendPrebuiltPlaylistTracks(nextTracks);
        queuePlaylistContext.nextPageToken = state.nextPageToken;
        queuePlaylistContext.totalResults = Number(state.pageInfo?.totalResults || queuePlaylistContext.totalResults || state.tracks.length);
        persistQueueMode();
        persistQueue();
        renderQueue();
    }
    renderOpenedPlaylist();
}

function buildMediaCard(song, idx) {
    const div = document.createElement('div');
    div.className = 'card';
    div.dataset.idx = song.sourceIndex ?? idx;
    div.style.animationDelay = `${Math.min(idx * 0.03, 0.5)}s`;
    const artistClickable = !!song.channelId;
    const isFreeVideo = song.type === 'freevideo' || song.resourceKind === 'commons#video';
    const isVideo = song.resourceKind === 'youtube#video' || isFreeVideo;
    const isDirectAudio = song.type === 'mp3';
    const imageErrorAction = "removeCardForMissingArtwork(this)";
    div.classList.toggle('video-card', isVideo);
    div.classList.toggle('audio-card', isDirectAudio);
    div.innerHTML = `
        <div class="card-img-wrap">
            ${isVideo && song.type !== 'search_trigger' ? `<span class="video-source-badge"><i class="fas ${isFreeVideo ? 'fa-leaf' : 'fa-play'}"></i> ${isFreeVideo ? 'Libre' : 'Video'}</span><span class="card-duration">${formatContentDuration(song.duration)}</span>` : ''}
            <div class="skeleton"></div>
            <img src="${escapeHtml(song.img || '')}" class="card-img" loading="lazy"
                 onload="this.classList.add('loaded')"
                 onerror="${imageErrorAction}">
            <div class="card-spinner">
                <div class="orbit-spinner" style="--s:26px;--d:5px;"><i></i><i></i><i></i></div>
                <span>Cargando</span>
            </div>
            ${song.type !== 'search_trigger' ? `<button type="button" class="card-favorite${isFavoriteSong(song) ? ' active' : ''}" title="Guardar en favoritos" aria-label="Guardar en favoritos"><i class="${isFavoriteSong(song) ? 'fas' : 'far'} fa-heart"></i></button>
            <div class="card-actions" aria-label="Acciones rápidas">
                <button type="button" class="card-addq" title="Agregar a Playlist" aria-label="Agregar a Playlist"><i class="fas fa-list"></i></button>
                <button type="button" class="play-btn" title="Reproducir" aria-label="Reproducir"><i class="fas fa-play"></i></button>
            </div>` : ''}
        </div>
        <div class="card-title" title="${escapeHtml(song.title)}">${escapeHtml(song.title)}</div>
        <div class="card-desc${artistClickable ? ' artist-link' : ''}">${escapeHtml(song.artist)}</div>
        <div class="card-meta">${escapeHtml(contentMetaLabel(song))}${videoStatsLabel(song) ? `<span class="card-stats">${escapeHtml(videoStatsLabel(song))}</span>` : ''}</div>
        ${descriptionExcerpt(song.description) ? `<p class="card-summary" title="${escapeHtml(song.description)}">${escapeHtml(descriptionExcerpt(song.description))}</p>` : ''}`;
    div.onclick = () => {
        if (song.type === 'search_trigger' && song.query) {
            performSmartSearch(song.query);
            return;
        }
        selectSong(song, song.sourceIndex ?? idx);
    };
    if (song.type !== 'search_trigger') {
        div.querySelector('.card-favorite').onclick = (e) => {
            e.stopPropagation();
            toggleFavoriteSong(song, e.currentTarget);
        };
        div.querySelector('.card-addq').onclick = (e) => {
            e.stopPropagation();
            addToQueue(song);
        };
    }
    if (artistClickable) {
        div.querySelector('.card-desc').onclick = (e) => {
            e.stopPropagation();
            browseChannel(song.channelId, song.channelTitle || song.artist);
        };
    }
    return div;
}

function buildPlaylistCard(playlist, idx) {
    const div = document.createElement('div');
    const count = Number(playlist?.itemCount);
    const hasCount = Number.isFinite(count) && count > 0;
    div.className = 'card playlist-card';
    div.dataset.playlistId = String(playlist?.url || '');
    div.setAttribute('role', 'button');
    div.tabIndex = 0;
    div.setAttribute('aria-label', `Abrir lista ${playlist?.title || 'de YouTube'}`);
    div.style.animationDelay = `${Math.min(idx * 0.03, 0.5)}s`;
    div.innerHTML = `
        <div class="card-img-wrap">
            <span class="playlist-source-badge"><i class="fas fa-list"></i> Lista</span>
            <img src="${escapeHtml(playlist.img || '')}" class="card-img loaded" loading="lazy" alt="" onerror="removeCardForMissingArtwork(this)">
            <div class="playlist-card-actions" aria-label="Acciones de la lista">
                <span class="playlist-count-badge" title="Cantidad de videos de la playlist"><i class="fas fa-film"></i> ${hasCount ? `${new Intl.NumberFormat('es-UY').format(count)} videos` : 'Cantidad pendiente'}</span>
                <button type="button" class="playlist-play-btn" title="Reproducir lista completa" aria-label="Reproducir lista completa"><i class="fas fa-play"></i></button>
            </div>
        </div>
        <div class="playlist-open"><i class="fas fa-list-music"></i> Abrir lista de YouTube</div>
        <div class="card-title" title="${escapeHtml(playlist.title)}">${escapeHtml(playlist.title)}</div>
        <div class="card-desc">${escapeHtml(playlist.artist || 'Lista de YouTube')}</div>
        ${descriptionExcerpt(playlist.description) ? `<p class="card-summary" title="${escapeHtml(playlist.description)}">${escapeHtml(descriptionExcerpt(playlist.description))}</p>` : ''}`;
    div.onclick = () => openPlaylist(playlist);
    div.onkeydown = (event) => {
        if (event.target !== div || !['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        openPlaylist(playlist);
    };
    div.querySelector('.playlist-play-btn').onclick = async (event) => {
        event.stopPropagation();
        const button = event.currentTarget;
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        try { await openPlaylist(playlist, { playNow: true }); }
        finally {
            if (button.isConnected) {
                button.disabled = false;
                button.innerHTML = '<i class="fas fa-play"></i>';
            }
        }
    };
    return div;
}

function renderLibraryRail(list, title, icon, isPlaylist = false, options = {}) {
    const visibleItems = itemsWithArtwork(list).filter(item => !isPlaylist || hasUsablePlaylistItems(item));
    if (!visibleItems.length) return;
    const container = document.getElementById('dynamicSections');
    const section = document.createElement('section');
    section.className = `library-rail-section ${options.className || ''}`.trim();
    const eyebrow = options.eyebrow ? `<span class="featured-edition">${escapeHtml(options.eyebrow)}</span>` : '';
    const hint = options.hint || '5 visibles · deslizá para explorar';
    const controls = options.showControls ? `<span class="library-rail-controls"><button type="button" class="library-rail-nav" data-direction="-1" aria-label="Ver videos anteriores"><i class="fas fa-chevron-left"></i></button><button type="button" class="library-rail-nav" data-direction="1" aria-label="Ver más videos"><i class="fas fa-chevron-right"></i></button></span>` : '';
    section.innerHTML = `<div class="library-rail-title">${icon} <span>${escapeHtml(title)}</span>${eyebrow}<span class="library-rail-hint">${escapeHtml(hint)}</span>${controls}</div>`;
    const rail = document.createElement('div');
    rail.className = 'library-rail';
    const batchSize = 5;
    let rendered = 0;
    const appendBatch = () => {
        let nextItems = visibleItems.slice(rendered, rendered + batchSize);
        if (!nextItems.length) {
            nextItems = visibleItems.slice(0, batchSize);
        }
        nextItems.forEach((item, offset) => {
            const index = (rendered + offset) % visibleItems.length;
            const card = isPlaylist ? buildPlaylistCard(item, index) : buildMediaCard(item, index);
            card.classList.add('library-card');
            rail.appendChild(card);
        });
        rendered += nextItems.length;
        return true;
    };
    rail._appendBatch = appendBatch;
    appendBatch();
    rail.addEventListener('scroll', () => {
        const closeToEnd = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 120;
        if (closeToEnd) appendBatch();
    }, { passive: true });
    if (options.showControls) {
        section.querySelectorAll('.library-rail-nav').forEach(button => {
            button.addEventListener('click', () => {
                const direction = Number(button.dataset.direction) || 1;
                rail.scrollBy({ left: direction * Math.max(rail.clientWidth * 0.82, 260), behavior: 'smooth' });
            });
        });
    }
    section.appendChild(rail);
    container.appendChild(section);
    setTimeout(() => { initRailDragScroll(); initAutoMovingCarousels(); }, 20);
}

function renderGrid(list, title, icon) {
    const visibleMedia = itemsWithArtwork(list);
    if (!visibleMedia.length) return;
    const container = document.getElementById('dynamicSections');
    const section = document.createElement('div');
    section.innerHTML = `<div class="section-title">${icon} ${escapeHtml(title)}</div>`;
    const grid = document.createElement('div');
    grid.className = 'grid';
    visibleMedia.forEach((song, idx) => grid.appendChild(buildMediaCard(song, idx)));
    section.appendChild(grid);
    container.appendChild(section);
    setTimeout(() => { if (typeof observeScrollAssembly === 'function') observeScrollAssembly(section); }, 20);
}

function setAmbientArtwork(item, lockToCurrent = false) {
    if (!hasValidArtwork(item)) return false;
    const background = document.getElementById('ambientArtworkBackground');
    if (!background) return false;
    const imageUrl = String(item.img || item.thumbnail || '').trim();
    const probe = new Image();
    probe.onload = () => {
        const safeUrl = imageUrl.replace(/"/g, '%22').replace(/\\/g, '%5C');
        background.style.backgroundImage = `url("${safeUrl}")`;
        background.classList.add('is-visible');
    };
    probe.onerror = () => {};
    probe.src = imageUrl;
    if (lockToCurrent) ambientArtworkLockedToCurrent = true;
    return true;
}

function ambientArtworkCandidates() {
    return uniqueMediaByUrl([
        ...homeRecommended,
        ...homeMusicVideos,
        ...homeVideos,
        ...homeMusic,
        ...homePlaylists
    ], 80).filter(hasValidArtwork);
}

function rotateAmbientArtwork() {
    if (ambientArtworkLockedToCurrent || document.visibilityState !== 'visible') return;
    const candidates = ambientArtworkCandidates();
    if (!candidates.length) return;
    ambientArtworkIndex = (ambientArtworkIndex + 1) % candidates.length;
    setAmbientArtwork(candidates[ambientArtworkIndex]);
}

function refreshAmbientArtworkFromCatalog() {
    if (ambientArtworkLockedToCurrent) return;
    const candidates = ambientArtworkCandidates();
    if (!candidates.length) return;
    ambientArtworkIndex = Math.abs(featuredHash(candidates.map(item => item.url).join('|'))) % candidates.length;
    setAmbientArtwork(candidates[ambientArtworkIndex]);
    if (!ambientArtworkRotationTimer) ambientArtworkRotationTimer = setInterval(rotateAmbientArtwork, 14000);
}

// --- RESERVA LOCAL DE CANDIDATOS (IndexedDB + fallback localStorage) ---
const RESERVE_DB_NAME = 'nowarfy_reserve_v1';
const RESERVE_DB_VERSION = 1;
const RESERVE_CANDIDATES_STORE = 'candidates';
const RESERVE_QUERIES_STORE = 'queries';
const RESERVE_META_STORE = 'reserveMeta';
const RESERVE_FALLBACK_KEY = 'nowarfy_discovery_reserve_v1';
const RESERVE_MAX_CANDIDATES = 1000;
const GLOBAL_RESERVE_ENDPOINT = '/api/reserve';
let reserveDbPromise = null;
let globalReserveSyncInFlight = false;
let globalReservePendingEntries = [];

function reserveCandidateKey(song) {
    if (!song?.url) return '';
    if (song.type === 'yt') return `yt:${String(song.url).trim()}`;
    if (song.type === 'mp3') return `${song.source || 'openverse'}:${String(song.sourceUrl || song.url).trim()}`;
    return `${song.type || 'media'}:${String(song.sourceUrl || song.url).trim()}`;
}
function reserveStyleKey(song, seed = null) {
    const explicit = String(song?.genre || '').trim().toLowerCase();
    if (explicit && explicit !== 'unknown') return explicit;
    return typeof getRadioStyle === 'function' ? getRadioStyle(seed || song) : 'rock metal';
}
function normalizeReserveCandidate(song, { context = 'manual', seed = null, queryContext = '' } = {}) {
    if (!song?.url || !['yt', 'mp3', 'freevideo'].includes(song.type)) return null;
    const candidateKey = reserveCandidateKey(song);
    if (!candidateKey) return null;
    const styleKey = reserveStyleKey(song, seed);
    return {
        ...song,
        candidateKey,
        source: song.source || (song.type === 'yt' ? 'youtube' : song.type === 'freevideo' ? 'commons' : 'openverse'),
        sourceId: String(song.sourceId || song.url),
        styleKey,
        radioEligible: (song.type === 'mp3' || song.resourceKind === 'youtube#video') && typeof isRadioMusicTrack === 'function' ? isRadioMusicTrack(song) : false,
        contentGroup: song.type === 'yt' ? (isNonMusicalVideo(song) ? 'non_music_video' : 'music_video') : (song.type === 'freevideo' ? 'free_video' : 'music_audio'),
        context,
        queryContext: String(song.queryContext || queryContext || '').trim(),
        metadata: {
            resourceKind: song.resourceKind || '',
            isPlaylist: Boolean(song.isPlaylist),
            itemCount: song.itemCount ?? null,
            channelId: song.channelId || '',
            channelTitle: song.channelTitle || '',
            publishedAt: song.publishedAt || '',
            viewCount: song.viewCount || '',
            likeCount: song.likeCount || '',
            commentCount: song.commentCount || '',
            definition: song.definition || '',
            captionsAvailable: Boolean(song.captionsAvailable),
            contentGroup: song.type === 'yt' ? (isNonMusicalVideo(song) ? 'non_music_video' : 'music_video') : (song.type === 'freevideo' ? 'free_video' : 'music_audio')
        },
        discoveredAt: Number(song.discoveredAt || Date.now()),
        lastSeenAt: Date.now(),
        lastUsedAt: song.lastUsedAt || null,
        useCount: Number(song.useCount || 0),
        status: song.status || 'available',
        expiresAt: Number(song.expiresAt || (Date.now() + (song.type === 'yt' ? 30 : 14) * 24 * 60 * 60 * 1000))
    };
}
function openReserveDb() {
    if (reserveDbPromise) return reserveDbPromise;
    if (!window.indexedDB) return Promise.resolve(null);
    reserveDbPromise = new Promise(resolve => {
        try {
            const request = indexedDB.open(RESERVE_DB_NAME, RESERVE_DB_VERSION);
            request.onupgradeneeded = event => {
                const db = event.target.result;
                const candidates = db.objectStoreNames.contains(RESERVE_CANDIDATES_STORE)
                    ? event.target.transaction.objectStore(RESERVE_CANDIDATES_STORE)
                    : db.createObjectStore(RESERVE_CANDIDATES_STORE, { keyPath: 'candidateKey' });
                if (!candidates.indexNames.contains('styleKey')) candidates.createIndex('styleKey', 'styleKey', { unique: false });
                if (!candidates.indexNames.contains('radioEligible')) candidates.createIndex('radioEligible', 'radioEligible', { unique: false });
                if (!candidates.indexNames.contains('lastUsedAt')) candidates.createIndex('lastUsedAt', 'lastUsedAt', { unique: false });
                if (!candidates.indexNames.contains('source')) candidates.createIndex('source', 'source', { unique: false });
                if (!candidates.indexNames.contains('status')) candidates.createIndex('status', 'status', { unique: false });
                if (!db.objectStoreNames.contains(RESERVE_QUERIES_STORE)) db.createObjectStore(RESERVE_QUERIES_STORE, { keyPath: 'queryKey' });
                if (!db.objectStoreNames.contains(RESERVE_META_STORE)) db.createObjectStore(RESERVE_META_STORE, { keyPath: 'id' });
            };
            request.onsuccess = event => resolve(event.target.result);
            request.onerror = () => resolve(null);
        } catch (error) { resolve(null); }
    });
    return reserveDbPromise;
}
function readReserveFallback() {
    try {
        const value = JSON.parse(localStorage.getItem(RESERVE_FALLBACK_KEY) || '[]');
        return Array.isArray(value) ? value : [];
    } catch (error) { return []; }
}
async function readLocalReserveCandidates(limit = 120) {
    const localFallback = readReserveFallback();
    const db = await openReserveDb();
    if (!db) return localFallback.slice(0, limit);
    const localItems = await new Promise(resolve => {
        try {
            const request = db.transaction(RESERVE_CANDIDATES_STORE, 'readonly').objectStore(RESERVE_CANDIDATES_STORE).getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => resolve([]);
        } catch (error) { resolve([]); }
    });
    return [...localItems, ...localFallback]
        .filter(item => item?.url && item.status !== 'invalid' && item.status !== 'expired' && (!item.expiresAt || Number(item.expiresAt) > Date.now()))
        .sort((a, b) => Number(a.lastUsedAt || 0) - Number(b.lastUsedAt || 0))
        .slice(0, limit);
}
function writeReserveFallback(items) {
    try {
        localStorage.setItem(RESERVE_FALLBACK_KEY, JSON.stringify(items.slice(-200)));
    } catch (error) {}
}
async function globalReserveRequest(url = GLOBAL_RESERVE_ENDPOINT, options = {}) {
    try {
        const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
        const data = await response.json().catch(() => ({}));
        return response.ok ? data : null;
    } catch (error) { return null; }
}
function flushReserveGlobal() {
    if (globalReserveSyncInFlight || !globalReservePendingEntries.length) return;
    const batch = globalReservePendingEntries.splice(0, 100);
    globalReserveSyncInFlight = true;
    void globalReserveRequest(GLOBAL_RESERVE_ENDPOINT, {
        method: 'POST',
        body: JSON.stringify({ action: 'upsert', entries: batch, discoveredBy: nowarfyAuthUser?.id || nowarfyAnonymousId })
    }).finally(() => {
        globalReserveSyncInFlight = false;
        flushReserveGlobal();
    });
}
function reserveSyncGlobal(entries) {
    if (!Array.isArray(entries) || !entries.length) return;
    const merged = new Map(globalReservePendingEntries.map(item => [item.candidateKey, item]));
    entries.forEach(entry => merged.set(entry.candidateKey, { ...merged.get(entry.candidateKey), ...entry }));
    globalReservePendingEntries = [...merged.values()];
    flushReserveGlobal();
}
function reserveQueryKey(source, query, styleKey = '', resourceTypes = '', channelId = '') {
    return [source, resourceTypes || 'all', channelId || 'all', styleKey || 'rock metal', query].map(value => String(value || '').trim().toLowerCase()).join(':').slice(0, 512);
}
async function reserveGetQueryState({ source = 'youtube', query = '', styleKey = '', queryKey = '' } = {}) {
    const params = new URLSearchParams({ action: 'query', source, query, styleKey });
    if (queryKey) params.set('queryKey', queryKey);
    const data = await globalReserveRequest(`${GLOBAL_RESERVE_ENDPOINT}?${params.toString()}`);
    return data?.query || null;
}
function reserveSaveQueryState(payload) {
    if (!payload?.source || !payload?.query) return;
    void globalReserveRequest(GLOBAL_RESERVE_ENDPOINT, {
        method: 'POST',
        body: JSON.stringify({ action: 'query-upsert', ...payload, discoveredBy: nowarfyAuthUser?.id || nowarfyAnonymousId })
    });
}
async function reserveGetGlobalCandidates({ styleKey = '', artist = '', source = '', query = '', scope = 'radio', kind = '', limit = 20, offset = 0, discoveredBy = '' } = {}) {
    const params = new URLSearchParams({ action: 'search', styleKey, artist, source, query, scope, kind, limit: String(Math.min(Math.max(Number(limit) || 20, 1), 50)) });
    if (Number(offset) > 0) params.set('offset', String(Math.max(0, Number(offset) || 0)));
    if (discoveredBy) params.set('discoveredBy', String(discoveredBy));
    const data = await globalReserveRequest(`${GLOBAL_RESERVE_ENDPOINT}?${params.toString()}`);
    const results = Array.isArray(data?.results) ? data.results : [];
    results.total = Number.isFinite(Number(data?.total)) ? Number(data.total) : null;
    return results;
}
async function reserveDiscoveredCandidates(songs, options = {}) {
    const entries = (songs || []).map(song => normalizeReserveCandidate(song, options)).filter(Boolean);
    if (!entries.length) return;
    reserveSyncGlobal(entries);
    const db = await openReserveDb();
    if (!db) {
        const merged = new Map(readReserveFallback().map(item => [item.candidateKey, item]));
        entries.forEach(entry => merged.set(entry.candidateKey, { ...merged.get(entry.candidateKey), ...entry }));
        writeReserveFallback([...merged.values()].slice(-200));
        return;
    }
    await new Promise(resolve => {
        try {
            const transaction = db.transaction(RESERVE_CANDIDATES_STORE, 'readwrite');
            const store = transaction.objectStore(RESERVE_CANDIDATES_STORE);
            entries.forEach(entry => {
                const getRequest = store.get(entry.candidateKey);
                getRequest.onsuccess = () => {
                    const previous = getRequest.result || {};
                    store.put({
                        ...previous,
                        ...entry,
                        radioEligible: Boolean(previous.radioEligible || entry.radioEligible),
                        discoveredAt: previous.discoveredAt || entry.discoveredAt,
                        useCount: Number(previous.useCount || entry.useCount || 0),
                        lastUsedAt: previous.lastUsedAt || entry.lastUsedAt || null
                    });
                };
            });
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => resolve();
            transaction.onabort = () => resolve();
        } catch (error) { resolve(); }
    });
    void reserveTrim();
}
async function reserveGetLocalCandidates({ kind = '' } = {}) {
    const db = await openReserveDb();
    let items = [];
    if (db) {
        items = await new Promise(resolve => {
            try {
                const request = db.transaction(RESERVE_CANDIDATES_STORE, 'readonly').objectStore(RESERVE_CANDIDATES_STORE).getAll();
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => resolve([]);
            } catch (error) { resolve([]); }
        });
    }
    items = [...items, ...readReserveFallback()];
    items = [...new Map(items.map(item => [item.candidateKey || reserveCandidateKey(item), item])).values()];
    return items.filter(item => {
        if (item.status === 'invalid' || item.status === 'expired') return false;
        if (!kind) return true;
        if (kind === 'playlist') return item.resourceKind === 'youtube#playlist' || item.type === 'playlist' || item.isPlaylist;
        if (kind === 'channel') return item.resourceKind === 'youtube#channel';
        if (kind === 'video') return item.resourceKind === 'youtube#video';
        return item.type === kind;
    });
}
async function reserveGetCandidates({ styleKey = '', artist = '', source = '', limit = 20 } = {}) {
    const db = await openReserveDb();
    let items = await reserveGetGlobalCandidates({ styleKey, artist, source, limit });
    if (db) {
        const localItems = await new Promise(resolve => {
            try {
                const request = db.transaction(RESERVE_CANDIDATES_STORE, 'readonly').objectStore(RESERVE_CANDIDATES_STORE).getAll();
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => resolve([]);
            } catch (error) { resolve([]); }
        });
        items = [...items, ...localItems];
    }
    items = [...items, ...readReserveFallback()];
    items = [...new Map(items.map(item => [item.candidateKey || reserveCandidateKey(item), item])).values()];
    const style = String(styleKey || '').toLowerCase();
    const targetArtist = String(artist || '').toLowerCase();
    return items
        .filter(item => item.radioEligible && item.status !== 'invalid' && item.status !== 'expired')
        .filter(item => !source || item.source === source)
        .filter(item => !style || String(item.styleKey || '').toLowerCase() === style || String(item.styleKey || '').toLowerCase().includes(style))
        .filter(item => !targetArtist || String(item.artist || '').toLowerCase().includes(targetArtist))
        .filter(item => !item.expiresAt || Number(item.expiresAt) > Date.now())
        .sort((a, b) => Number(a.lastUsedAt || 0) - Number(b.lastUsedAt || 0) || Number(b.lastSeenAt || 0) - Number(a.lastSeenAt || 0))
        .slice(0, limit);
}
const ARTIST_STYLE_HINTS = {
    'mana': 'latin rock',
    'maná': 'latin rock',
    'soda stereo': 'latin rock',
    'caifanes': 'latin rock',
    'heroes del silencio': 'latin rock',
    'héroes del silencio': 'latin rock',
    'los enanitos verdes': 'latin rock',
    'enanitos verdes': 'latin rock',
    'los fabulosos cadillacs': 'latin rock',
    'la renga': 'latin rock',
    'rata blanca': 'latin metal',
    'metallica': 'heavy metal',
    'iron maiden': 'heavy metal',
    'black sabbath': 'heavy metal',
    'slipknot': 'nu metal',
    'linkin park': 'nu metal',
    'nirvana': 'grunge',
    'foo fighters': 'alternative rock'
};
function inferArtistStyle(query, candidates = []) {
    const normalized = String(query || '').trim().toLowerCase();
    const known = Object.entries(ARTIST_STYLE_HINTS).find(([artist]) => normalized.includes(artist));
    if (known) return known[1];
    const fromCandidate = candidates.find(candidate => candidate?.genre && candidate.genre !== 'unknown')?.genre;
    if (fromCandidate) return String(fromCandidate).toLowerCase();
    const text = candidates.map(candidate => `${candidate.title || ''} ${candidate.artist || ''} ${candidate.description || ''}`).join(' ').toLowerCase();
    return ['latin rock', 'alternative rock', 'grunge', 'punk rock', 'hard rock', 'heavy metal', 'metal'].find(style => text.includes(style)) || 'rock';
}
async function reserveSearchCandidates(query, { styleKey = '', limit = 20, kind = '', offset = 0, discoveredBy = '' } = {}) {
    const db = await openReserveDb();
    let items = await reserveGetGlobalCandidates({ styleKey, query, scope: 'search', kind, limit, offset, discoveredBy });
    if (db) {
        const localItems = await new Promise(resolve => {
            try {
                const request = db.transaction(RESERVE_CANDIDATES_STORE, 'readonly').objectStore(RESERVE_CANDIDATES_STORE).getAll();
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => resolve([]);
            } catch (error) { resolve([]); }
        });
        items = [...items, ...localItems];
    }
    items = [...items, ...readReserveFallback()];
    items = [...new Map(items.map(item => [item.candidateKey || reserveCandidateKey(item), item])).values()];
    const needle = String(query || '').toLowerCase().trim();
    const style = String(styleKey || '').toLowerCase().trim();
    return items.filter(item => {
        if (item.status === 'invalid' || item.status === 'expired') return false;
        if (item.expiresAt && Number(item.expiresAt) <= Date.now()) return false;
        const text = `${item.title || ''} ${item.artist || ''} ${item.description || ''}`.toLowerCase();
        const matchesQuery = !needle || text.includes(needle);
        const matchesStyle = !style || String(item.styleKey || '').toLowerCase().includes(style);
        return matchesQuery && matchesStyle;
    }).sort((a, b) => Number(a.lastUsedAt || 0) - Number(b.lastUsedAt || 0)).slice(0, limit);
}

async function reserveMarkUsed(song) {
    const key = reserveCandidateKey(song);
    if (!key) return;
    const db = await openReserveDb();
    if (!db) return;
    try {
        const transaction = db.transaction(RESERVE_CANDIDATES_STORE, 'readwrite');
        const store = transaction.objectStore(RESERVE_CANDIDATES_STORE);
        const request = store.get(key);
        request.onsuccess = () => {
            if (request.result) store.put({ ...request.result, status: 'played', lastUsedAt: Date.now(), useCount: Number(request.result.useCount || 0) + 1 });
        };
    } catch (error) {}
    void globalReserveRequest(GLOBAL_RESERVE_ENDPOINT, {
        method: 'POST',
        body: JSON.stringify({ action: 'mark-used', candidateKey: key })
    });
}
async function reserveTrim() {
    const db = await openReserveDb();
    if (!db) return;
    try {
        const transaction = db.transaction(RESERVE_CANDIDATES_STORE, 'readwrite');
        const store = transaction.objectStore(RESERVE_CANDIDATES_STORE);
        const request = store.getAll();
        request.onsuccess = () => {
            const items = request.result || [];
            const expired = items.filter(item => item.status === 'invalid' || (item.expiresAt && Number(item.expiresAt) < Date.now()));
            expired.forEach(item => store.delete(item.candidateKey));
            if (items.length > RESERVE_MAX_CANDIDATES) {
                items.sort((a, b) => Number(a.lastUsedAt || 0) - Number(b.lastUsedAt || 0));
                items.slice(0, items.length - RESERVE_MAX_CANDIDATES).forEach(item => store.delete(item.candidateKey));
            }
        };
    } catch (error) {}
}

// --- CLAVE única de canción (para no repetir en la cola) ---
function songKey(song) { return `${(song.title || '').toLowerCase().trim()}|${(song.artist || '').toLowerCase().trim()}`; }
function withQid(song) { return { ...song, _qid: ++queueIdCounter }; }

function persistQueueMode() {
    try {
        localStorage.setItem(QUEUE_MODE_STORAGE_KEY, queuePlaybackMode);
        if (queuePlaybackMode === 'prebuilt_playlist' && queuePlaylistContext) {
            localStorage.setItem(QUEUE_PLAYLIST_STORAGE_KEY, JSON.stringify(queuePlaylistContext));
        } else {
            localStorage.removeItem(QUEUE_PLAYLIST_STORAGE_KEY);
        }
    } catch (error) {}
}

function setRadioQueueMode() {
    queuePlaybackMode = 'radio';
    queuePlaylistContext = null;
    persistQueueMode();
}

function isNativeYouTubePlaylistPlayback() {
    return queuePlaybackMode === 'prebuilt_playlist' && !!queuePlaylistContext?.nativePlayback && !!queuePlaylistContext?.playlistId;
}

function syncNativeYouTubePlaylistPosition() {
    if (!isNativeYouTubePlaylistPlayback() || !ytPlayer?.getPlaylistIndex) return false;
    let nativeIndex = -1;
    try { nativeIndex = Number(ytPlayer.getPlaylistIndex()); } catch (error) { return false; }
    if (!Number.isInteger(nativeIndex) || nativeIndex < 0) return false;
    if (nativeIndex >= queue.length && queuePlaylistContext?.nextPageToken) {
        void loadNextPrebuiltPlaylistPage(currentPlayingQid, { nativeOnly: true });
    }
    const nativeSong = queue[nativeIndex];
    if (!nativeSong) return false;
    if (currentPlayingQid !== nativeSong._qid) {
        currentIndex = nativeIndex;
        currentPlayingQid = nativeSong._qid;
        currentSourceIdx = nativeSong.sourceIndex ?? nativeIndex;
        updateNowPlaying(nativeSong);
        updateMediaSession(nativeSong);
        rememberPlay(nativeSong);
        persistQueue();
        renderQueue();
    } else {
        currentIndex = nativeIndex;
    }
    return true;
}

function appendPrebuiltPlaylistTracks(tracks) {
    const playable = (tracks || []).filter(track => track?.url);
    if (!playable.length) return 0;
    const playlistId = isNativeYouTubePlaylistPlayback() ? queuePlaylistContext.playlistId : '';
    const queuedTracks = playable.map(track => withQid(playlistId ? { ...track, youtubePlaylistId: playlistId } : track));
    queue.push(...queuedTracks);
    queuedTracks.forEach(track => queueSeenKeys.add(songKey(track)));
    return queuedTracks.length;
}

function finishPrebuiltPlaylistPlayback(message = 'Terminó la playlist') {
    clearAutomaticAdvance();
    isPlaying = false;
    stopSilentLoop();
    persistVideoResumeSession(true);
    updateIcon();
    updatePlaybackState();
    showToast(message, 'fa-circle-check');
}

async function loadNextPrebuiltPlaylistPage(targetQid, options = {}) {
    if (automaticQueueRecoveryInFlight || queuePlaybackMode !== 'prebuilt_playlist') return false;
    const context = queuePlaylistContext;
    const pageToken = String(context?.nextPageToken || '');
    if (!context?.playlistId || !pageToken) return false;
    automaticQueueRecoveryInFlight = true;
    context.nextPageToken = '';
    try {
        const response = await fetch(`/api/search?type=youtube&action=playlistItems&playlistId=${encodeURIComponent(context.playlistId)}&pageToken=${encodeURIComponent(pageToken)}&maxResults=24`);
        const data = await response.json();
        if (!response.ok) throw new Error('playlist_page_unavailable');
        const nextTracks = mapPlaylistVideoItems(data.items, {
            channelId: context.channelId || '', channelTitle: context.artist || '', img: context.img || '',
            collectionId: context.playlistId, collectionTitle: context.title, collectionImg: context.img || ''
        }, queue.length);
        if (!nextTracks.length) throw new Error('playlist_page_empty');
        appendPrebuiltPlaylistTracks(nextTracks);
        context.nextPageToken = data.nextPageToken || '';
        context.totalResults = Number(data.pageInfo?.totalResults || context.totalResults || queue.length);
        if (activePlaylistCatalog?.playlist?.url === context.playlistId) {
            activePlaylistCatalog.tracks = [...activePlaylistCatalog.tracks, ...nextTracks];
            activePlaylistCatalog.pageInfo = data.pageInfo || activePlaylistCatalog.pageInfo;
            activePlaylistCatalog.nextPageToken = context.nextPageToken;
        }
        void reserveDiscoveredCandidates(nextTracks, { context: 'playlist', queryContext: `playlist:${context.playlistId}` });
        persistQueueMode();
        persistQueue();
        renderQueue();
        if (activePlaylistCatalog?.playlist?.url === context.playlistId) renderOpenedPlaylist();
        if (options.nativeOnly) {
            syncNativeYouTubePlaylistPosition();
            persistQueue();
            renderQueue();
            return true;
        }
        if (currentPlayingQid !== targetQid) return false;
        const targetIndex = queue.findIndex(item => item._qid === targetQid);
        const nextIndex = targetIndex + 1;
        if (nextIndex >= 0 && nextIndex < queue.length) {
            playQueueAt(nextIndex);
            return true;
        }
        finishPrebuiltPlaylistPlayback('La playlist no tiene más videos reproducibles');
        return false;
    } catch (error) {
        context.nextPageToken = '';
        persistQueueMode();
        persistQueue();
        finishPrebuiltPlaylistPlayback('No pudimos cargar la siguiente página de esta playlist');
        return false;
    } finally {
        automaticQueueRecoveryInFlight = false;
    }
}

function advancePrebuiltPlaylist(targetQid) {
    if (queuePlaybackMode !== 'prebuilt_playlist' || !targetQid) return false;
    if (isNativeYouTubePlaylistPlayback() && ytPlayer) {
        syncNativeYouTubePlaylistPosition();
        const nativeIndex = queue.findIndex(item => item._qid === currentPlayingQid);
        const playlistIds = typeof ytPlayer.getPlaylist === 'function' ? ytPlayer.getPlaylist() : [];
        if (nativeIndex >= 0 && nativeIndex + 1 < queue.length && ytPlayer.playVideoAt) {
            ytPlayer.playVideoAt(nativeIndex + 1);
            return true;
        }
        if (Number.isInteger(nativeIndex) && nativeIndex >= 0 && nativeIndex + 1 < playlistIds.length && ytPlayer.nextVideo) {
            ytPlayer.nextVideo();
            return true;
        }
        if (queuePlaylistContext?.nextPageToken) {
            void loadNextPrebuiltPlaylistPage(targetQid, { nativeOnly: true });
            return true;
        }
        return false;
    }
    const index = queue.findIndex(item => item._qid === targetQid);
    if (index < 0) return false;
    const nextIndex = index + 1;
    if (nextIndex < queue.length) {
        playQueueAt(nextIndex);
        return true;
    }
    if (queuePlaylistContext?.nextPageToken) {
        void loadNextPrebuiltPlaylistPage(targetQid);
        return true;
    }
    return false;
}

async function selectSong(song, sourceIdx) {
    // Si estamos en modo control remoto (no somos el reproductor), enviar comando al dispositivo activo
    if (nowarfyAuthUser && nowarfyRemoteSession && !nowarfyRemoteIsPlayer) {
        await sendRemotePlaySongCommand(song, 0);
        return;
    }
    
    setRadioQueueMode();
    const q = withQid(song);
    queue = [q];
    queueSeenKeys = new Set([songKey(q)]);
    queueRound = 0;
    persistQueue();
    renderQueue();
    playQueueAt(0, { sourceIdx });
    void reserveDiscoveredCandidates([song], { context: 'radio', seed: song });
    growQueueIfNeeded(true);
}

async function resumeSongFromWelcome(song, sourceIdx = 0) {
    // Si estamos en modo control remoto, enviar al reproductor
    if (nowarfyAuthUser && nowarfyRemoteSession && !nowarfyRemoteIsPlayer) {
        await sendRemotePlaySongCommand(song, sourceIdx);
        return;
    }
    
    setRadioQueueMode();
    const resume = readVideoResumeSession();
    const matches = resume && String(resume.resourceId) === String(song?.url) && (!resume.type || resume.type === song?.type);
    if (!matches) { selectSong(song, sourceIdx); return; }
    const existingIndex = queue.findIndex(item => String(item.url) === String(song.url) && item.type === song.type);
    if (existingIndex >= 0) {
        playQueueAt(existingIndex, { sourceIdx, resumeSession: { ...resume, wasPlaying: true }, restoreMinimized: !!resume.minimized });
        return;
    }
    const q = withQid(song);
    queue = [q];
    queueSeenKeys = new Set([songKey(q)]);
    queueRound = 0;
    persistQueue();
    renderQueue();
    playQueueAt(0, { sourceIdx, resumeSession: { ...resume, wasPlaying: true }, restoreMinimized: !!resume.minimized });
    void reserveDiscoveredCandidates([song], { context: 'radio', seed: song });
    growQueueIfNeeded(true);
}

async function addToQueue(song) {
    const k = songKey(song);
    if (queueSeenKeys.has(k)) { showToast('Ya está en la Playlist', 'fa-circle-info'); return; }
    
    // Si estamos en modo control remoto, enviar al reproductor
    if (nowarfyAuthUser && nowarfyRemoteSession && !nowarfyRemoteIsPlayer) {
        await sendRemoteAddToQueueCommand(song);
        return;
    }
    
    const q = withQid(song);
    queueSeenKeys.add(k);
    queue.push(q);
    void reserveDiscoveredCandidates([song], { context: 'queue', seed: song, queryContext: 'queue' });
    persistQueue();
    renderQueue();
    showToast('Añadido a la cola', 'fa-list');
    if (currentPlayingQid == null) playQueueAt(queue.length - 1);
}

async function sendRemoteAddToQueueCommand(song) {
    // Enviar canción para agregar a la cola del reproductor
    const commandId = `${nowarfyRemoteDeviceId || 'device'}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const command = { type: 'addToQueue', song: { ...song, _qid: `remote-${Date.now()}` }, commandId };
    
    // Optimistic update: mostrar que se está enviando
    showToast(`Agregando "${song.title}" a la cola del reproductor...`, 'fa-list');
    
    // Enviar por BroadcastChannel primero
    if (nowarfyBroadcastChannelReady && nowarfyBroadcastChannel) {
        try { nowarfyBroadcastChannel.postMessage({ type: 'remote-command', senderDeviceId: nowarfyRemoteDeviceId, commandId, command }); } catch (_) {}
    }
    
    // Enviar por Supabase Realtime
    if (nowarfyRemoteBroadcastReady && nowarfyRemoteChannel) {
        try { await nowarfyRemoteChannel.send({ type: 'broadcast', event: 'remote-command', payload: { commandId, senderDeviceId: nowarfyRemoteDeviceId, command } }); } catch (_) {}
    }
    
    // Fallback a base de datos
    await nowarfySupabase.from('youtoo_remote_commands').insert({ session_id: nowarfyRemoteSession.id, user_id: nowarfyAuthUser.id, device_id: nowarfyRemoteDeviceId, command });
}

async function sendRemotePlaySongCommand(song, startIndex = 0) {
    // Enviar comando para reproducir una canción específica en el reproductor
    const commandId = `${nowarfyRemoteDeviceId || 'device'}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const command = { type: 'playSong', song: { ...song, _qid: `remote-${Date.now()}` }, startIndex, commandId };
    
    // Optimistic update: mostrar que se está enviando
    showToast(`Reproduciendo "${song.title}" en el reproductor...`, 'fa-play');
    
    // Enviar por BroadcastChannel primero para respuesta instantánea
    if (nowarfyBroadcastChannelReady && nowarfyBroadcastChannel) {
        try { nowarfyBroadcastChannel.postMessage({ type: 'remote-command', senderDeviceId: nowarfyRemoteDeviceId, commandId, command }); } catch (_) {}
    }
    
    // Enviar por Supabase Realtime
    if (nowarfyRemoteBroadcastReady && nowarfyRemoteChannel) {
        try { await nowarfyRemoteChannel.send({ type: 'broadcast', event: 'remote-command', payload: { commandId, senderDeviceId: nowarfyRemoteDeviceId, command } }); } catch (_) {}
    }
    
    // Fallback a base de datos
    await nowarfySupabase.from('youtoo_remote_commands').insert({ session_id: nowarfyRemoteSession.id, user_id: nowarfyAuthUser.id, device_id: nowarfyRemoteDeviceId, command });
}

function getCurrentContentLink(song) {
    if (!song?.url) return '';
    if (song.type === 'yt') {
        return song.isPlaylist
            ? `https://www.youtube.com/playlist?list=${encodeURIComponent(song.url)}`
            : `https://www.youtube.com/watch?v=${encodeURIComponent(song.url)}`;
    }
    return song.sourceUrl || song.url;
}

function currentQueueSong() {
    if (nowarfyAuthUser && nowarfyRemoteSession && !nowarfyRemoteIsPlayer && nowarfyRemoteShadowSong) return nowarfyRemoteShadowSong;
    return currentIndex >= 0 ? queue[currentIndex] || nowarfyRemoteShadowSong : nowarfyRemoteShadowSong;
}

function updateCurrentActionControls(song) {
    const hasLink = !!getCurrentContentLink(song);
    const canDownload = !!(song?.type === 'mp3' && song?.url && song?.license);
    document.getElementById('shareWhatsappBtn').disabled = !hasLink;
    document.getElementById('copyCurrentLinkBtn').disabled = !hasLink;
    const download = document.getElementById('downloadCurrentBtn');
    download.hidden = !canDownload;
    download.disabled = !canDownload;
    if (canDownload) download.title = `Descargar audio directo · ${song.license}${song.licenseVersion ? ` ${song.licenseVersion}` : ''}`;
}

function openCurrentArtist() {
    const song = currentQueueSong();
    if (!song?.artist) { showToast('No hay un artista disponible para abrir', 'fa-user-music'); return; }
    if (song.channelId) browseChannel(song.channelId, song.channelTitle || song.artist);
    else performSmartSearch(song.artist);
}

function openCurrentCollection() {
    const song = currentQueueSong();
    if (!song) { showToast('Elegí una pista primero', 'fa-compact-disc'); return; }
    if (song.collectionId) {
        openPlaylist({ url: song.collectionId, title: song.collectionTitle || 'Lista de reproducción', img: song.collectionImg || song.img || '', channelId: song.channelId || '', artist: song.channelTitle || song.artist || '' });
        return;
    }
    if (song.isPlaylist) { openPlaylist(song); return; }
    showToast('Este contenido no pertenece a una lista o álbum navegable', 'fa-compact-disc');
}

function updateNowPlaying(song) {
    setAmbientArtwork(song, true);
    const title = document.getElementById('currTitle');
    const artist = document.getElementById('currArtist');
    const cover = document.getElementById('playerCover');
    title.textContent = song.title || 'Selecciona una canción';
    artist.textContent = song.artist || '...';
    const img = document.getElementById('currentImg');
    if (song.img) { img.src = song.img; img.style.display = 'block'; cover.classList.add('has-art'); }
    else { img.src = ''; img.style.display = 'none'; cover.classList.remove('has-art'); }
    const collectionAvailable = !!(song.collectionId || song.isPlaylist);
    const artistAvailable = !!(song.channelId || song.artist);
    title.classList.toggle('is-link', collectionAvailable);
    artist.classList.toggle('is-link', artistAvailable);
    title.disabled = !collectionAvailable;
    artist.disabled = !artistAvailable;
    updateCurrentActionControls(song);
    updateFavButton(song);
}

async function copyTextToClipboard(text) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
    const input = document.createElement('textarea');
    input.value = text;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
}

function copyCurrentLink() {
    const song = currentQueueSong();
    const link = getCurrentContentLink(song);
    if (!link) { showToast('No hay un enlace disponible todavía', 'fa-link'); return; }
    copyTextToClipboard(link).then(() => showToast('Enlace copiado', 'fa-link')).catch(() => showToast('No pudimos copiar el enlace', 'fa-triangle-exclamation'));
}

function shareCurrentToWhatsApp() {
    const song = currentQueueSong();
    const link = getCurrentContentLink(song);
    if (!link) { showToast('No hay un enlace disponible todavía', 'fa-whatsapp'); return; }
    const label = `${song.title || 'Contenido'}${song.artist ? ` · ${song.artist}` : ''}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(`${label}\n${link}`)}`, '_blank', 'noopener,noreferrer');
}

function downloadCurrentTrack() {
    const song = currentQueueSong();
    if (!(song?.type === 'mp3' && song?.url && song?.license)) {
        showToast('La descarga solo está disponible para audio directo con licencia', 'fa-download');
        return;
    }
    const anchor = document.createElement('a');
    anchor.href = song.url;
    const extension = String(song.filetype || 'mp3').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'mp3';
    anchor.download = `${String(song.title || 'nowarfy-audio').replace(/[^a-z0-9áéíóúüñ _.-]/gi, '').trim() || 'nowarfy-audio'}.${extension}`;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    showToast(`Descarga iniciada · ${song.license}`, 'fa-download');
}

async function ensureInitialRadioQueue() {
    if (queue.length > 0) {
        if (currentPlayingQid == null) {
            currentIndex = 0;
            currentPlayingQid = queue[0]._qid;
            updateNowPlaying(queue[0]);
        }
        renderQueue();
        return;
    }
    const catalogCandidates = uniqueMediaByUrl([
        ...homeMusicVideos,
        ...homeMusic,
        ...homeVideos,
        ...homeRecommended,
        ...EMERGENCY_VIDEO_CATALOG
    ], 120).filter(song => song?.url && isRadioMusicTrack(song));
    if (!catalogCandidates.length) return;
    const initialSongs = [];
    const initialKeys = new Set();
    for (const song of catalogCandidates) {
        const key = songKey(song);
        if (initialKeys.has(key)) continue;
        initialKeys.add(key);
        initialSongs.push(withQid(song));
        if (initialSongs.length >= QUEUE_BATCH) break;
    }
    queue = initialSongs;
    queueSeenKeys = new Set(queue.map(songKey));
    queueRound = 0;
    currentIndex = 0;
    currentPlayingQid = queue[0]._qid;
    currentSourceIdx = queue[0].sourceIndex ?? null;
    updateNowPlaying(queue[0]);
    persistQueue();
    renderQueue();
}

function nextQueueIndex() {
    if (!queue.length) return -1;
    const idx = queue.findIndex(item => item._qid === currentPlayingQid);
    return idx >= 0 ? (idx + 1) % queue.length : 0;
}

function getStandbyAudioEl() { return activeAudioEl === audioEl ? nextAudioEl : audioEl; }

function prepareNextDirectAudio() {
    const nextIndex = nextQueueIndex();
    const next = queue[nextIndex];
    if (nextIndex === currentIndex || !next || next.type !== 'mp3' || !next.url) return;
    const standby = getStandbyAudioEl();
    if (standby.dataset.queueId === String(next._qid)) return;
    standby.pause();
    standby.src = next.url;
    standby.dataset.queueId = String(next._qid);
    standby.load();
}

function applyResumeSessionToMedia(media, song, resumeSession) {
    if (!media || !song || !resumeSession || String(resumeSession.resourceId) !== String(song.url)) return;
    const position = Math.max(0, Number(resumeSession.position) || 0);
    const apply = () => {
        if (currentQueueSong()?.url !== song.url || media !== activeAudioEl) return;
        const duration = Number(media.duration);
        media.currentTime = duration > 0 ? Math.min(position, Math.max(0, duration - 0.25)) : position;
    };
    if (media.readyState >= 1) apply();
    else media.addEventListener('loadedmetadata', apply, { once: true });
}
function bindDirectAudioEvents(audio) {
    audio.ontimeupdate = () => {
        if (audio !== activeAudioEl) return;
        updateProgress(audio.currentTime, audio.duration);
        updateMediaPosition(audio.duration, audio.currentTime);
        const current = queue[currentIndex];
        const next = queue[nextQueueIndex()];
        const remaining = Number(audio.duration) - Number(audio.currentTime);
        if (!crossfadeInProgress && current?.type === 'mp3' && next?.type === 'mp3' && Number.isFinite(remaining) && remaining > 0 && remaining <= CROSSFADE_SECONDS) beginDirectAudioCrossfade();
    };
    audio.onended = () => {
        if (audio === activeAudioEl && !crossfadeInProgress) {
            clearVideoResumeSession();
            queueAutomaticAdvance('direct-ended');
        }
    };
    audio.onpause = () => {
        if (mediaTransitionInProgress || audio !== activeAudioEl || audio.ended || crossfadeInProgress || String(audio.dataset.queueId || '') !== String(currentPlayingQid || '')) return;
        if ((document.visibilityState === 'hidden' || (typeof document.hasFocus === 'function' && !document.hasFocus())) && !NOWARFY_AUDIO_PRIORITY_MODE && !playbackStoppedByUser && !externalAudioFocusInterrupted && isPlaying) {
            schedulePossibleExternalAudioYield('direct-audio-paused');
            return;
        }
        if (NOWARFY_AUDIO_PRIORITY_MODE && !playbackStoppedByUser && !audio.ended) {
            isPlaying = true;
            startSilentLoop();
            const playAttempt = audio.play?.();
            if (playAttempt?.catch) playAttempt.catch(() => {});
            updateIcon();
            updatePlaybackState();
            return;
        }
        isPlaying = false;
        persistVideoResumeSession(true);
        updateIcon();
        updatePlaybackState();
        if (nowarfyRemoteIsPlayer) void publishNowarfyRemoteState();
    };
    audio.onwaiting = () => { if (audio === activeAudioEl) setTrackLoading(true, currentSourceIdx); };
    audio.onplaying = () => {
        if (audio !== activeAudioEl) return;
        if (externalAudioFocusInterrupted) { audio.pause(); return; }
        playbackStoppedByUser = false;
        isPlaying = true;
        updateIcon();
        updatePlaybackState();
        setTrackLoading(false);
        if (!progressInterval) startProgress(audio);
        prepareNextDirectAudio();
        if (nowarfyRemoteIsPlayer) void publishNowarfyRemoteState();
    };
    audio.onerror = () => {
        if (audio !== activeAudioEl) return;
        setTrackLoading(false);
        showToast('No se pudo reproducir esta pista; seguimos con la siguiente', 'fa-triangle-exclamation');
        queueAutomaticAdvance('direct-error');
    };
}

function cancelDirectCrossfade() {
    if (!crossfadeInProgress) return;
    clearInterval(crossfadeTimer);
    const standby = getStandbyAudioEl();
    standby.pause();
    standby.currentTime = 0;
    standby.dataset.queueId = '';
    activeAudioEl.volume = parseFloat(document.getElementById('volumeSlider').value) || 0;
    crossfadeInProgress = false;
}

function finishDirectCrossfade(nextIndex, outgoing, incoming) {
    clearInterval(crossfadeTimer);
    outgoing.pause();
    outgoing.currentTime = 0;
    outgoing.dataset.queueId = '';
    activeAudioEl = incoming;
    crossfadeInProgress = false;
    currentIndex = nextIndex;
    const song = queue[nextIndex];
    currentPlayingQid = song._qid;
    currentSourceIdx = null;
    updateNowPlaying(song);
    rememberPlay(song);
    updateMediaSession(song);
    persistQueue();
    renderQueue();
    startProgress(incoming);
    prepareNextDirectAudio();
}

function beginDirectAudioCrossfade() {
    if (!continuousPlayback || crossfadeInProgress) return;
    const nextIndex = nextQueueIndex();
    const next = queue[nextIndex];
    if (nextIndex === currentIndex || !next || next.type !== 'mp3' || !next.url) return;
    const outgoing = activeAudioEl;
    const incoming = getStandbyAudioEl();
    crossfadeInProgress = true;
    incoming.pause();
    incoming.src = next.url;
    incoming.currentTime = 0;
    incoming.dataset.queueId = String(next._qid);
    incoming.volume = 0;
    bindDirectAudioEvents(incoming);
    incoming.play().then(() => {
        const startedAt = performance.now();
        const tick = () => {
            const progress = Math.min(1, (performance.now() - startedAt) / (CROSSFADE_SECONDS * 1000));
            const baseVolume = parseFloat(document.getElementById('volumeSlider').value) || 0;
            outgoing.volume = baseVolume * (1 - progress);
            incoming.volume = baseVolume * progress;
            if (progress >= 1) finishDirectCrossfade(nextIndex, outgoing, incoming);
        };
        tick();
        crossfadeTimer = setInterval(tick, 50);
    }).catch(() => { crossfadeInProgress = false; queueAutomaticAdvance('crossfade-error'); });
}

function playQueueAt(idx, options = {}) {
    if (idx < 0 || idx >= queue.length) return;
    clearAutomaticAdvance();
    playbackStoppedByUser = false;
    const previousSong = currentQueueSong();
    currentIndex = idx;
    const song = queue[idx];
    const reuseYouTubePlayer = previousSong?.type === 'yt' && song?.type === 'yt' && ytPlayer?.loadVideoById && !options.forceNewYouTubePlayer;
    const resumeSession = ['yt', 'mp3', 'freevideo'].includes(song.type) && options.resumeSession && String(options.resumeSession.resourceId) === String(song.url) && (!options.resumeSession.type || options.resumeSession.type === song.type)
        ? options.resumeSession
        : null;
    currentPlayingQid = song._qid;
    currentSourceIdx = options.sourceIdx ?? null;
    resetLyricsPanel();
    ytPlayCommandAt = 0;
    pendingVideoResumeSession = resumeSession;
    restoreVideoMinimizedAfterReady = !!(resumeSession && song.type === 'yt' && options.restoreMinimized);
    if (!resumeSession) clearVideoResumeSession();
    updateNowPlaying(song);
    rememberPlay(song);
    void reserveMarkUsed(song);
    mediaTransitionInProgress = true;
    stopAll({ preserveYouTubePlayer: reuseYouTubePlayer });
    mediaTransitionInProgress = false;
    updateMediaSession(song);
    setTrackLoading(true, currentSourceIdx);
    persistQueue();
    renderQueue();

    if (song.type === 'yt') {
        const deferYTAutoplay = !!options.deferAutoplay || externalAudioFocusInterrupted;
        if (!deferYTAutoplay && resumeSession?.wasPlaying !== false) startSilentLoop();
        freeVideoEl.pause();
        freeVideoEl.removeAttribute('src');
        freeVideoEl.hidden = true;
        showVideoStage(song);
        if (reuseYouTubePlayer) {
            ytPlaybackIntent = !deferYTAutoplay && resumeSession?.wasPlaying !== false;
            const startSeconds = resumeSession && Number(resumeSession.position) > 0 ? Number(resumeSession.position) : 0;
            try {
                if (ytPlaybackIntent) ytPlayer.loadVideoById({ videoId: song.url, startSeconds });
                else ytPlayer.cueVideoById({ videoId: song.url, startSeconds });
                if (ytPlaybackIntent) {
                    startSilentLoop();
                    requestYouTubePlayback('reused-iframe');
                    armYouTubeStartupWatchdog(song.url);
                }
            } catch (error) {
                stopAll();
                initYTPlayer(song.url, song.isPlaylist, resumeSession, deferYTAutoplay);
            }
        } else if (ytApiReady && window.YT && window.YT.Player) {
            const nativePlaylistId = options.playlistId || (isNativeYouTubePlaylistPlayback() && queuePlaylistContext?.playlistId);
            initYTPlayer(nativePlaylistId || song.url, !!nativePlaylistId || song.isPlaylist, resumeSession, deferYTAutoplay);
        } else {
            pendingYTRequest = { resourceId: song.url, isPlaylist: song.isPlaylist, resumeSession, deferAutoplay: deferYTAutoplay };
            loadYouTubeAPI();
        }
    } else if (song.type === 'freevideo') {
        document.getElementById('yt-player-container').innerHTML = '';
        showVideoStage(song);
        freeVideoEl.hidden = false;
        activeAudioEl = freeVideoEl;
        freeVideoEl.src = song.url;
        freeVideoEl.dataset.queueId = String(song._qid);
        applyVolume(parseFloat(document.getElementById('volumeSlider').value));
        bindDirectAudioEvents(freeVideoEl);
        freeVideoEl.onloadedmetadata = () => {
            applyResumeSessionToMedia(freeVideoEl, song, resumeSession);
            if (freeVideoEl === activeAudioEl && currentQueueSong()?.type === 'freevideo') renderVideoStageDetails({ ...song, duration: freeVideoEl.duration || song.duration });
        };
        freeVideoEl.load();
        const shouldAutoplayFreeVideo = !options.deferAutoplay && !externalAudioFocusInterrupted && resumeSession?.wasPlaying !== false;
        if (shouldAutoplayFreeVideo) freeVideoEl.play().catch(e => { setTrackLoading(false); showToast('No se pudo reproducir este video libre', 'fa-triangle-exclamation'); });
        else setTrackLoading(false);
    } else {
        hideVideoStage(false);
        activeAudioEl = audioEl;
        nextAudioEl.pause();
        nextAudioEl.currentTime = 0;
        nextAudioEl.dataset.queueId = '';
        audioEl.src = song.url;
        audioEl.dataset.queueId = String(song._qid);
        applyVolume(parseFloat(document.getElementById('volumeSlider').value));
        bindDirectAudioEvents(audioEl);
        audioEl.onloadedmetadata = () => applyResumeSessionToMedia(audioEl, song, resumeSession);
        const shouldAutoplayAudio = !options.deferAutoplay && !externalAudioFocusInterrupted && resumeSession?.wasPlaying !== false;
        if (shouldAutoplayAudio) audioEl.play().catch(e => { setTrackLoading(false); showToast('No se pudo reproducir esta pista', 'fa-triangle-exclamation'); });
        else setTrackLoading(false);
    }
}

function getRadioStyle(seedSong) {
    const explicit = String(seedSong?.genre || '').trim().toLowerCase();
    if (explicit && explicit !== 'unknown') return explicit;
    const artistName = String(seedSong?.artist || '').trim().toLowerCase();
    const artistHint = typeof ARTIST_STYLE_HINTS !== 'undefined'
        ? Object.entries(ARTIST_STYLE_HINTS).find(([artist]) => artistName === artist || artistName.includes(artist))?.[1]
        : null;
    if (artistHint) return artistHint;
    const text = `${seedSong?.title || ''} ${seedSong?.description || ''} ${seedSong?.artist || ''} ${currentMood || ''}`.toLowerCase();
    const styles = ['heavy metal', 'metalcore', 'nu metal', 'hard rock', 'alternative rock', 'punk rock', 'grunge', 'industrial metal', 'rock', 'metal'];
    return styles.find(style => text.includes(style)) || (currentMood ? String(currentMood).toLowerCase() : 'rock metal');
}

async function fetchSameArtistTracks(seedSong, count) {
    if (!seedSong || seedSong.type !== 'yt' || !seedSong.artist) return [];
    const style = getRadioStyle(seedSong);
    let raw = [];
    if (seedSong.channelId) {
        raw = await fetchYouTubeSearch(seedSong.artist, 'video', { channelId: seedSong.channelId, maxResults: Math.min(count, 20), reserveContext: 'radio', seed: seedSong });
    }
    if (raw.length < count) {
        const extra = await fetchYouTubeSearch(`${seedSong.artist} ${style} official music`, 'video', { maxResults: count, reserveContext: 'radio', seed: seedSong });
        const artistLower = seedSong.artist.toLowerCase();
        const filtered = extra.filter(s => (s.artist || '').toLowerCase().includes(artistLower) || artistLower.includes((s.artist || '').toLowerCase()));
        raw = raw.concat(filtered);
    }
    return raw.slice(0, count);
}

async function fetchRockMetalTracks(count, style = 'rock metal', seedSong = null) {
    return fetchYouTubeSearch(`${style} official music`, 'video', { maxResults: Math.min(Math.max(count, 6), 20), reserveContext: 'radio', seed: seedSong });
}

async function fetchOpenverseGenreTracks(seedSong, count) {
    const style = getRadioStyle(seedSong);
    const query = `${style} music`;
    const queryVariants = [...new Set([`${style} music`, `${style} song`, `${style} instrumental music`])];
    let cached = [];
    try {
        const store = JSON.parse(localStorage.getItem(OPENVERSE_RADIO_CACHE_KEY) || '{}');
        const entry = store[query];
        if (entry && Date.now() - Number(entry.savedAt || 0) < OPENVERSE_RADIO_CACHE_MAX_AGE_MS) {
            cached = Array.isArray(entry.tracks) ? entry.tracks : [];
        }
    } catch (e) {}
    let fresh = [];
    try {
        const freshResults = await Promise.allSettled(queryVariants.map(variant =>
            fetchOpenverseTracks(variant, Math.min(Math.max(count, 10), 20), { radioOnly: true, reserveContext: 'radio', seed: seedSong })
        ));
        const freshKeys = new Set();
        freshResults.forEach(result => {
            if (result.status !== 'fulfilled') return;
            result.value.filter(isRadioMusicTrack).forEach(track => {
                const key = reserveCandidateKey(track) || songKey(track);
                if (!freshKeys.has(key)) { freshKeys.add(key); fresh.push(track); }
            });
        });
        if (fresh.length) {
            try {
                const store = JSON.parse(localStorage.getItem(OPENVERSE_RADIO_CACHE_KEY) || '{}');
                store[query] = { savedAt: Date.now(), tracks: fresh.slice(0, 40) };
                localStorage.setItem(OPENVERSE_RADIO_CACHE_KEY, JSON.stringify(store));
            } catch (e) {}
        }
    } catch (e) {}
    const reserved = await reserveGetCandidates({ styleKey: style, source: 'openverse', limit: Math.max(count, 20) });
    return [...fresh, ...cached, ...reserved, ...homeMusic].filter(isRadioMusicTrack);
}

async function fetchJamendoGenreTracks(seedSong, count) {
    const style = getRadioStyle(seedSong);
    const query = `${style} music`;
    try {
        const response = await fetch(`/api/search?type=jamendo&query=${encodeURIComponent(query)}&style=${encodeURIComponent(style)}&maxResults=${Math.min(Math.max(count, 10), 20)}`);
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.results)) return [];
        const tracks = data.results.map(track => ({
            ...track,
            type: 'mp3',
            source: 'jamendo',
            sourceId: String(track.sourceId || track.id || track.url),
            img: track.img || track.thumbnail || 'assets/nowarfy-icon-512.png',
            genre: track.genre || style,
            license: track.license || 'Jamendo catalog license',
            sourceUrl: track.sourceUrl || ''
        })).filter(isRadioMusicTrack);
        void reserveDiscoveredCandidates(tracks, { context: 'radio', seed: seedSong });
        return tracks;
    } catch (e) {
        return [];
    }
}

async function fetchSimilarArtistTracks(seedSong, count) {
    if (!seedSong || !seedSong.artist) return fetchRockMetalTracks(count, getRadioStyle(seedSong), seedSong);
    const artist = seedSong.artist;
    const style = getRadioStyle(seedSong);
    try {
        const [radio, related] = await Promise.all([
            fetchYouTubeSearch(`${artist} ${style} radio mix`, 'video', { maxResults: Math.max(6, Math.ceil(count * 0.7)), reserveContext: 'radio', seed: seedSong }),
            fetchYouTubeSearch(`${style} artists similar to ${artist}`, 'video', { maxResults: Math.max(6, Math.ceil(count * 0.6)), reserveContext: 'radio', seed: seedSong })
        ]);
        const artistLower = artist.toLowerCase();
        const merged = shuffleArray([...radio, ...related]).filter(s => (s.artist || '').toLowerCase() !== artistLower);
        return merged.slice(0, count);
    } catch (e) { return []; }
}

function isRadioMusicTrack(song) {
    if (!song?.url || !['yt', 'mp3'].includes(song.type)) return false;
    const text = `${song.title || ''} ${song.artist || ''} ${song.description || ''} ${song.genre || ''}`.toLowerCase();
    if (/audiobook|audio book|audiolibro|spoken word|narration|narrator|chapter|book reading|story|stories|lecture|podcast|interview|meditation|sleep music|children|bedtime|sound effect|foley|noise|ambient/.test(text)) return false;
    if (song.type === 'yt' && song.categoryId && String(song.categoryId) !== '10') return false;
    if (song.type === 'yt' && typeof isNonMusicalVideo === 'function' && isNonMusicalVideo(song)) return false;
    if (song.type === 'yt' && Number(song.duration) > 0 && Number(song.duration) < 60) return false;
    return true;
}

function appendUniqueSongs(candidates, target, limit) {
    for (const song of candidates || []) {
        if (target.length >= limit || !song?.url) break;
        if (!isRadioMusicTrack(song)) continue;
        const key = songKey(song);
        if (queueSeenKeys.has(key)) continue;
        queueSeenKeys.add(key);
        target.push(withQid(song));
    }
}

async function buildAutomaticBatch(seed) {
    const added = [];
    const style = getRadioStyle(seed);
    const remaining = () => QUEUE_BATCH - added.length;

    if (queueRound === 0) {
        appendUniqueSongs(await fetchSameArtistTracks(seed, remaining()), added, QUEUE_BATCH);
        if (remaining() > 0 && seed?.artist) {
            appendUniqueSongs(await reserveGetCandidates({ styleKey: style, artist: seed.artist, limit: remaining() }), added, QUEUE_BATCH);
        }
        queueRound = 1;
    }

    if (remaining() > 0) {
        appendUniqueSongs(await fetchSimilarArtistTracks(seed, remaining()), added, QUEUE_BATCH);
        if (remaining() > 0) {
            appendUniqueSongs(await reserveGetCandidates({ styleKey: style, limit: remaining() }), added, QUEUE_BATCH);
        }
    }

    if (remaining() > 0) {
        appendUniqueSongs(await fetchOpenverseGenreTracks(seed, remaining()), added, QUEUE_BATCH);
    }

    if (remaining() > 0) {
        appendUniqueSongs(await fetchJamendoGenreTracks(seed, remaining()), added, QUEUE_BATCH);
    }
    if (remaining() > 0) {
        appendUniqueSongs(await fetchRockMetalTracks(remaining(), getRadioStyle(seed), seed), added, QUEUE_BATCH);
    }

    return added;
}

async function growQueueIfNeeded(force = false) {
    if (queueFetching || queue.length === 0) return;
    const idx = queue.findIndex(s => s._qid === currentPlayingQid);
    const atPlaylistEnd = idx >= 0 && idx + 1 >= queue.length;
    if (!force && !atPlaylistEnd) return;
    const seed = queue[idx] || queue[queue.length - 1];
    if (!seed) return;
    queueFetching = true;
    toggleQueueLoadingHint(true);
    try {
        const added = await buildAutomaticBatch(seed);
        if (added.length) {
            queue = queue.concat(added);
            persistQueue();
            renderQueue();
        }
    } catch (e) {}
    finally { queueFetching = false; toggleQueueLoadingHint(false); }
}

function toggleQueueLoadingHint(show) {
    const hint = document.getElementById('queueLoadingHint');
    if (hint) hint.classList.toggle('show', show);
}

function clearVideoResumeSession() {
    try { localStorage.removeItem(VIDEO_RESUME_STORAGE_KEY); } catch (e) {}
    pendingVideoResumeSession = null;
    lastVideoResumeSaveAt = 0;
}

function getLocalPlaybackPosition(song = currentQueueSong()) {
    if (!song || !['yt', 'mp3', 'freevideo'].includes(song.type)) return null;
    if (nowarfyRemoteSession && !nowarfyRemoteIsPlayer) return null;
    if (song.type === 'yt') return ytPlayer?.getCurrentTime ? Number(ytPlayer.getCurrentTime()) || 0 : null;
    return activeAudioEl ? Number(activeAudioEl.currentTime) || 0 : null;
}
function persistVideoResumeSession(force = false) {
    const song = currentQueueSong();
    const position = getLocalPlaybackPosition(song);
    if (!song?.url || position === null) return;
    const now = Date.now();
    if (!force && now - lastVideoResumeSaveAt < 3000) return;
    try {
        localStorage.setItem(VIDEO_RESUME_STORAGE_KEY, JSON.stringify({
            qid: currentPlayingQid,
            resourceId: song.url,
            type: song.type,
            isPlaylist: !!song.isPlaylist,
            position: Math.max(0, position),
            wasPlaying: !!isPlaying,
            minimized: !!videoStageMinimized,
            savedAt: now
        }));
        lastVideoResumeSaveAt = now;
    } catch (e) {}
}

function readVideoResumeSession() {
    try {
        const saved = JSON.parse(localStorage.getItem(VIDEO_RESUME_STORAGE_KEY));
        if (!saved || !saved.resourceId || !Number.isFinite(Number(saved.position))) return null;
        if (!Number.isFinite(Number(saved.savedAt)) || Date.now() - Number(saved.savedAt) > VIDEO_RESUME_MAX_AGE_MS) return null;
        return saved;
    } catch (e) { return null; }
}

function persistQueue() {
    try {
        localStorage.setItem('nowarfy_queue', JSON.stringify(queue));
        localStorage.setItem('nowarfy_queue_qid', currentPlayingQid == null ? '' : String(currentPlayingQid));
        localStorage.setItem('nowarfy_queue_round', String(queueRound));
        persistQueueMode();
    } catch (e) {}
}

function restoreQueueFromStorage() {
    try {
        const savedQueue = JSON.parse(localStorage.getItem('nowarfy_queue'));
        if (!Array.isArray(savedQueue) || !savedQueue.length) return;
        const savedMode = localStorage.getItem(QUEUE_MODE_STORAGE_KEY);
        const savedContext = savedMode === 'prebuilt_playlist' ? JSON.parse(localStorage.getItem(QUEUE_PLAYLIST_STORAGE_KEY) || 'null') : null;
        queuePlaybackMode = savedMode === 'prebuilt_playlist' && savedContext?.playlistId ? 'prebuilt_playlist' : 'radio';
        queuePlaylistContext = queuePlaybackMode === 'prebuilt_playlist' ? savedContext : null;
        queue = queuePlaybackMode === 'prebuilt_playlist'
            ? savedQueue.filter(item => item?.type === 'yt' && item?.url)
            : savedQueue.filter(isRadioMusicTrack);
        if (!queue.length) return;
        queueSeenKeys = new Set(queue.map(songKey));
        queueIdCounter = queue.reduce((max, s) => Math.max(max, s._qid || 0), 0);
        queueRound = parseInt(localStorage.getItem('nowarfy_queue_round'), 10) || 0;
        const savedQid = localStorage.getItem('nowarfy_queue_qid');
        const qid = savedQid ? parseInt(savedQid, 10) : null;
        const idx = queue.findIndex(s => s._qid === qid);
        if (idx === -1) return;
        currentIndex = idx;
        currentPlayingQid = qid;
        const song = queue[idx];
        updateNowPlaying(song);

        const resume = readVideoResumeSession();
        if (['yt', 'mp3', 'freevideo'].includes(song.type) && resume && String(resume.resourceId) === String(song.url) && (!resume.type || resume.type === song.type) && (!resume.qid || Number(resume.qid) === Number(qid))) {
            pendingVideoResumeSession = resume;
        }
    } catch (e) {}
}

function toggleQueuePanel() {
    const panel = document.getElementById('queuePanel');
    const overlay = document.getElementById('queueOverlay');
    const open = panel.classList.toggle('open');
    overlay.classList.toggle('show', open);
    document.getElementById('queueToggleBtn').classList.toggle('active', open);
    if (open) renderQueue();
}
function closeQueuePanel() {
    document.getElementById('queuePanel').classList.remove('open');
    document.getElementById('queueOverlay').classList.remove('show');
    document.getElementById('queueToggleBtn').classList.remove('active');
}

function clearQueue() {
    if (queue.length === 0) return;
    const current = currentQueueSong() || queue[currentIndex];
    if (!current) return;
    queue = [current];
    queueSeenKeys = new Set([songKey(current)]);
    currentIndex = 0;
    currentPlayingQid = current._qid;
    currentSourceIdx = null;
    queueRound = 1;
    if (queuePlaybackMode === 'prebuilt_playlist' && queuePlaylistContext) queuePlaylistContext.nextPageToken = '';
    persistQueue();
    renderQueue();
    showToast(queuePlaybackMode === 'prebuilt_playlist'
        ? 'Se quitaron los videos siguientes; continúa la playlist actual'
        : 'Se quitaron las canciones siguientes; continúa la actual', 'fa-trash');
}

function removeFromQueue(qid) {
    const idx = queue.findIndex(s => s._qid === qid);
    if (idx === -1) return;
    queue.splice(idx, 1);
    persistQueue();
    renderQueue();
    showToast('Quitada de la cola', 'fa-xmark');
}

function reorderQueue(srcQid, targetQid, insertBefore) {
    const srcIdx = queue.findIndex(s => s._qid === srcQid);
    if (srcIdx === -1) return;
    const [item] = queue.splice(srcIdx, 1);
    let targetIdx = queue.findIndex(s => s._qid === targetQid);
    if (targetIdx === -1) targetIdx = queue.length;
    queue.splice(insertBefore ? targetIdx : targetIdx + 1, 0, item);
    persistQueue();
    renderQueue();
}

function setupQueueTrashDropzone() {
    const trash = document.getElementById('queueTrash');
    if (!trash) return;
    trash.addEventListener('dragover', (e) => { e.preventDefault(); trash.classList.add('drag-hover'); });
    trash.addEventListener('dragleave', () => trash.classList.remove('drag-hover'));
    trash.addEventListener('drop', (e) => {
        e.preventDefault();
        trash.classList.remove('drag-hover');
        if (dragSrcQid != null) removeFromQueue(dragSrcQid);
    });
}

function renderQueue() {
    renderContinuousPlaybackControls();
    currentIndex = queue.findIndex(s => s._qid === currentPlayingQid);
    const list = document.getElementById('queueList');
    const sub = document.getElementById('queueSub');
    const badge = document.getElementById('queueCountBadge');
    if (!list) return;

    if (badge) { badge.textContent = String(queue.length); badge.classList.toggle('show', queue.length > 0); }
    const queueModeLabel = queuePlaybackMode === 'prebuilt_playlist'
        ? `playlist de YouTube${queuePlaylistContext?.title ? ` · ${queuePlaylistContext.title}` : ''}`
        : 'radio automática';
    if (sub) sub.textContent = queue.length
        ? `${queue.length} canción${queue.length === 1 ? '' : 'es'} · ${queueModeLabel} · ${continuousPlayback ? 'reproducción continua' : 'se detiene al terminar'}`
        : `La Playlist está vacía · ${continuousPlayback ? 'continua lista' : 'una pista por vez'}`;

    list.innerHTML = '';
    if (queue.length === 0) {
        list.innerHTML = `<div class="queue-empty"><i class="fas fa-compact-disc"></i><p>Elegí una canción para armar tu Playlist automática: 20 del mismo artista y después más de artistas similares.</p></div>`;
        document.getElementById('queueTrash').classList.remove('show');
        return;
    }

    queue.forEach((song, idx) => {
        const row = document.createElement('div');
        const isPlayingRow = song._qid === currentPlayingQid;
        row.className = 'queue-row-item' + (isPlayingRow ? ' playing' : '');
        row.draggable = true;
        row.dataset.qid = String(song._qid);
        row.innerHTML = `
            <i class="fas fa-grip-lines queue-drag-handle" title="Arrastrar para reordenar o quitar"></i>
            <img src="${escapeHtml(song.img || '')}" class="queue-row-img" loading="lazy" alt="" onerror="this.closest('.queue-row').remove();">
            <div class="queue-row-info">
                <div class="queue-row-title">${escapeHtml(song.title)}</div>
                <div class="queue-row-artist">${escapeHtml(song.artist)}</div>
            </div>
            ${isPlayingRow ? '<i class="fas fa-volume-up queue-playing-icon" title="Sonando ahora"></i>' : ''}
            <button type="button" class="queue-row-remove" title="Quitar de Playlist" aria-label="Quitar de Playlist"><i class="fas fa-xmark"></i></button>`;

        row.addEventListener('click', (e) => {
            if (e.target.closest('.queue-row-remove') || e.target.closest('.queue-drag-handle')) return;
            playQueueAt(idx);
        });
        row.querySelector('.queue-row-remove').addEventListener('click', (e) => {
            e.stopPropagation();
            removeFromQueue(song._qid);
        });
        row.addEventListener('dragstart', (e) => {
            dragSrcQid = song._qid;
            row.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', String(song._qid)); } catch (err) {}
            document.getElementById('queueTrash').classList.add('show');
        });
        row.addEventListener('dragend', () => {
            row.classList.remove('dragging');
            document.querySelectorAll('.queue-row-item.drag-over-top, .queue-row-item.drag-over-bottom').forEach(r => r.classList.remove('drag-over-top', 'drag-over-bottom'));
            document.getElementById('queueTrash').classList.remove('show', 'drag-hover');
            dragSrcQid = null;
        });
        row.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (dragSrcQid == null || dragSrcQid === song._qid) return;
            const rect = row.getBoundingClientRect();
            const before = (e.clientY - rect.top) < rect.height / 2;
            row.classList.toggle('drag-over-top', before);
            row.classList.toggle('drag-over-bottom', !before);
        });
        row.addEventListener('dragleave', () => row.classList.remove('drag-over-top', 'drag-over-bottom'));
        row.addEventListener('drop', (e) => {
            e.preventDefault();
            row.classList.remove('drag-over-top', 'drag-over-bottom');
            if (dragSrcQid == null || dragSrcQid === song._qid) return;
            const rect = row.getBoundingClientRect();
            const before = (e.clientY - rect.top) < rect.height / 2;
            reorderQueue(dragSrcQid, song._qid, before);
        });

        list.appendChild(row);
    });
}

function getVideoSuggestions(song) {
    const currentId = String(song?.url || '');
    const candidates = [...currentList, ...homeVideos]
        .filter(item => item && (item.type === 'yt' || item.resourceKind === 'youtube#video'))
        .filter(item => String(item.url || '') && String(item.url || '') !== currentId);
    const seen = new Set();
    const unique = candidates.filter(item => {
        const id = String(item.url || '');
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
    });
    const sameChannel = song?.channelId ? unique.filter(item => item.channelId === song.channelId) : [];
    const otherVideos = unique.filter(item => !song?.channelId || item.channelId !== song.channelId);
    return [...sameChannel, ...otherVideos].slice(0, 8);
}

function renderContinuousPlaybackControls() {
    const playerButton = document.getElementById('continuousPlayerToggle');
    const queueButton = document.getElementById('continuousQueueToggle');
    [playerButton, queueButton].filter(Boolean).forEach(button => {
        button.classList.toggle('on', continuousPlayback);
        button.setAttribute('aria-pressed', String(continuousPlayback));
        button.title = continuousPlayback ? 'Reproducción continua activada' : 'Reproducción continua desactivada';
    });
    if (queueButton) queueButton.innerHTML = `<i class="fas fa-infinity"></i> ${continuousPlayback ? 'Continua' : 'Una pista'}`;
}

function toggleContinuousPlayback() {
    continuousPlayback = !continuousPlayback;
    localStorage.setItem(CONTINUOUS_PLAYBACK_STORAGE_KEY, String(continuousPlayback));
    if (!continuousPlayback) {
        clearAutomaticAdvance();
        cancelDirectCrossfade();
    }
    renderContinuousPlaybackControls();
    renderQueue();
    const detail = 'mediaSession' in navigator
        ? 'Los controles del sistema y auriculares siguen disponibles'
        : 'El navegador puede limitar controles de pantalla bloqueada';
    showToast(continuousPlayback ? `Reproducción continua activada · ${detail}` : 'Reproducción continua desactivada: la pista actual se detendrá al terminar', continuousPlayback ? 'fa-infinity' : 'fa-stop');
}

function renderVideoAutoplayToggle() {
    const button = document.getElementById('videoAutoplayToggle');
    if (!button) return;
    button.classList.toggle('on', videoAutoplay);
    button.setAttribute('aria-pressed', String(videoAutoplay));
    button.innerHTML = `<i class="fas fa-forward"></i> ${videoAutoplay ? 'Sugerencias auto' : 'Solo cola'}`;
}

function toggleVideoAutoplay() {
    videoAutoplay = !videoAutoplay;
    localStorage.setItem(VIDEO_AUTOPLAY_STORAGE_KEY, String(videoAutoplay));
    renderVideoAutoplayToggle();
    showToast(videoAutoplay ? 'Sugerencias automáticas activadas' : 'Sugerencias pausadas; la cola sigue sonando', 'fa-forward');
}

function renderVideoSuggestions(song) {
    const wrapper = document.getElementById('videoSuggestions');
    const list = document.getElementById('videoSuggestionsList');
    const context = document.getElementById('videoSuggestionsContext');
    if (song?.type === 'freevideo') {
        list.innerHTML = '';
        wrapper.classList.remove('visible');
        return;
    }
    const suggestions = getVideoSuggestions(song);
    list.innerHTML = '';
    if (!suggestions.length) {
        wrapper.classList.remove('visible');
        return;
    }
    const fromSameChannel = suggestions.filter(item => song?.channelId && item.channelId === song.channelId).length;
    context.textContent = fromSameChannel ? `Incluye ${fromSameChannel} del mismo canal` : 'Selección relacionada';
    suggestions.forEach(item => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'video-suggestion';
        button.innerHTML = `<span class="video-suggestion-thumb"><img src="${escapeHtml(item.img || '')}" alt="" loading="lazy" onerror="this.closest('button').remove();"><i class="fas fa-play"></i></span><span><span class="video-suggestion-title">${escapeHtml(item.title || 'Video')}</span><span class="video-suggestion-artist">${escapeHtml(item.channelTitle || item.artist || 'YouTube')}</span></span>`;
        button.onclick = () => selectSong(item, item.sourceIndex ?? 0);
        list.appendChild(button);
    });
    wrapper.classList.add('visible');
    renderVideoAutoplayToggle();
}

function continueVideoAutoplay() {
    const current = queue[currentIndex];
    if (!current || current.type !== 'yt') return false;
    const currentQueueIndex = queue.findIndex(item => item._qid === currentPlayingQid);
    if (currentQueueIndex >= 0 && currentQueueIndex + 1 < queue.length) {
        playQueueAt(currentQueueIndex + 1);
        return true;
    }
    return false;
}

function clearAutomaticAdvance() {
    if (automaticAdvanceTimer) window.clearTimeout(automaticAdvanceTimer);
    automaticAdvanceTimer = null;
    automaticAdvanceTargetQid = null;
}

function appendAutomaticFallback(song) {
    if (!song?.url) return false;
    const key = songKey(song);
    if (queueSeenKeys.has(key)) return false;
    const queued = withQid(song);
    queueSeenKeys.add(key);
    queue.push(queued);
    persistQueue();
    renderQueue();
    playQueueAt(queue.length - 1, { sourceIdx: song.sourceIndex ?? null });
    return true;
}

function findAutomaticFallback(current) {
    const currentId = String(current?.url || '');
    const candidates = [...currentList, ...homeMusic, ...homeMusicVideos, ...homeVideos]
        .filter(item => item?.url && String(item.url) !== currentId && isRadioMusicTrack(item));
    return candidates.find(item => !queueSeenKeys.has(songKey(item))) || null;
}

async function recoverAutomaticQueue(targetQid) {
    if (automaticQueueRecoveryInFlight || playbackStoppedByUser || currentPlayingQid !== targetQid) return false;
    automaticQueueRecoveryInFlight = true;
    try {
        const current = currentQueueSong();
        await growQueueIfNeeded();
        if (playbackStoppedByUser || currentPlayingQid !== targetQid) return false;
        const currentQueueIndex = queue.findIndex(item => item._qid === targetQid);
        if (currentQueueIndex >= 0 && currentQueueIndex + 1 < queue.length) {
            playQueueAt(currentQueueIndex + 1);
            return true;
        }
        const immediateFallback = findAutomaticFallback(current);
        return appendAutomaticFallback(immediateFallback);
    } catch (error) {
        return false;
    } finally {
        automaticQueueRecoveryInFlight = false;
    }
}

function queueAutomaticAdvance(reason = 'ended') {
    const targetQid = currentPlayingQid;
    if (!targetQid || playbackStoppedByUser || automaticAdvanceTargetQid === targetQid) return;
    if (!continuousPlayback) {
        isPlaying = false;
        clearAutomaticAdvance();
        updateIcon();
        updatePlaybackState();
        persistVideoResumeSession(true);
        stopSilentLoop();
        return;
    }
    automaticAdvanceTargetQid = targetQid;
    const advance = async () => {
        automaticAdvanceTimer = null;
        if (playbackStoppedByUser || currentPlayingQid !== targetQid) return;
        if (nextSong(false)) return;
        if (await recoverAutomaticQueue(targetQid)) return;
        isPlaying = false;
        stopSilentLoop();
        updateIcon();
        updatePlaybackState();
        if (reason.endsWith('error')) showToast('No encontramos otra pista reproducible en este momento', 'fa-triangle-exclamation');
    };
    if (document.visibilityState === 'hidden') Promise.resolve().then(advance);
    else automaticAdvanceTimer = window.setTimeout(advance, 180);
}

function isVisualVideo(song) {
    return !!song && (song.type === 'yt' || song.type === 'freevideo');
}

function lyricsTextKey(value) {
    return normalizeSourceText(value)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function lyricsArtistName(song) {
    return normalizeSourceText(song?.artist || song?.channelTitle || '')
        .replace(/\b(official|music|channel|canal)\b/gi, ' ')
        .replace(/\s*[-|·–—]\s*(?:topic|official)\s*$/i, ' ')
        .replace(/(?:vevo|topic)$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
}
function lyricsTrackTitle(song) {
    let title = normalizeSourceText(song?.title || '')
        .replace(/\s*[([{]([^\])}]{0,120})[\])}]/g, (full, inner) => /\b(?:official|music|video|audio|lyrics?|lyric|visualizer|hd|hq|4k|vevo)\b/i.test(inner) ? ' ' : full)
        .replace(/\s+(?:official\s+)?(?:music\s+)?(?:video|audio|lyrics?|lyric|visualizer|hd|hq|4k)\s*$/i, ' ')
        .replace(/\s*[|·–—-]\s*(?:official|music|audio|video|lyrics?|lyric|visualizer|vevo)\b.*$/i, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const artist = lyricsTextKey(lyricsArtistName(song));
    const embedded = title.match(/^(.{2,100}?)\s+[-–—|·]\s+(.{2,160})$/);
    if (embedded) {
        const prefix = lyricsTextKey(embedded[1]);
        const compactPrefix = prefix.replace(/\s/g, '');
        const compactArtist = artist.replace(/\s/g, '');
        if (prefix === artist || (compactPrefix && compactPrefix === compactArtist)) title = embedded[2].trim();
    }
    return title;
}

function lyricsSongKey(song) {
    return `${lyricsTextKey(lyricsArtistName(song))}::${lyricsTextKey(lyricsTrackTitle(song))}`;
}

function lyricsEligibleSong(song) {
    if (!song || song.isPlaylist || !['yt', 'mp3'].includes(song.type)) return false;
    const artist = lyricsArtistName(song);
    const title = lyricsTrackTitle(song);
    if (!artist || !title || /^(youtube|canal|unknown|nowarfy)$/i.test(artist)) return false;
    if (song.type === 'yt' && typeof isNonMusicalVideo === 'function' && isNonMusicalVideo(song)) return false;
    const text = `${title} ${artist} ${song.description || ''}`.toLowerCase();
    if (/podcast|interview|entrevista|audiobook|audiolibro|spoken word|lecture|narration|chapter|news|noticias|tutorial|review|reaction/.test(text)) return false;
    return true;
}

function readLyricsCache() {
    try {
        const cache = JSON.parse(localStorage.getItem(LYRICS_CACHE_KEY) || '{}');
        return cache && typeof cache === 'object' ? cache : {};
    } catch (error) { return {}; }
}

function writeLyricsCache(key, value) {
    try {
        const cache = readLyricsCache();
        cache[key] = { ...value, savedAt: Date.now() };
        const entries = Object.entries(cache)
            .sort(([, a], [, b]) => Number(b?.savedAt || 0) - Number(a?.savedAt || 0))
            .slice(0, LYRICS_CACHE_MAX_ITEMS);
        localStorage.setItem(LYRICS_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch (error) {}
}

function readCachedLyrics(key) {
    const entry = readLyricsCache()[key];
    if (!entry || Date.now() - Number(entry.savedAt || 0) > LYRICS_CACHE_MAX_AGE_MS) return null;
    return entry.data?.found && entry.data?.verified ? entry.data : null;
}

function plainLyricsFromRecord(track) {
    if (track?.plainLyrics) return String(track.plainLyrics).trim();
    const synced = String(track?.syncedLyrics || '').trim();
    return synced.replace(/^\s*\[[^\]]+\]\s*/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

function resetLyricsPanel() {
    lyricsRequestToken += 1;
    lyricsLoadingKey = '';
    currentLyrics = null;
    lyricsZoom = 1;
    const button = document.getElementById('lyricsToggleBtn');
    const panel = document.getElementById('lyricsPanel');
    const content = document.getElementById('lyricsContent');
    const status = document.getElementById('lyricsToolbarStatus');
    const source = document.getElementById('lyricsSourceLabel');
    const zoomValue = document.getElementById('lyricsZoomValue');
    if (button) { button.hidden = true; button.setAttribute('aria-expanded', 'false'); button.innerHTML = '<i class="fas fa-music"></i> Ver letra'; }
    if (panel) panel.hidden = true;
    if (content) { content.textContent = ''; content.style.fontSize = ''; }
    if (status) status.textContent = 'Letra verificada';
    if (source) source.textContent = 'Coincidencia corroborada por metadatos disponibles y la fuente pública.';
    if (zoomValue) zoomValue.textContent = '100%';
}

function renderLyricsPanel(data, song) {
    const text = plainLyricsFromRecord(data?.track);
    if (!data?.found || !data?.verified || !text || currentQueueSong()?.url !== song?.url) return false;
    const button = document.getElementById('lyricsToggleBtn');
    const status = document.getElementById('lyricsToolbarStatus');
    const content = document.getElementById('lyricsContent');
    const source = document.getElementById('lyricsSourceLabel');
    const sourceLink = document.getElementById('lyricsSourceLink');
    if (!button || !status || !content || !source || !sourceLink) return false;
    currentLyrics = { ...data, resourceId: song.url };
    content.textContent = text;
    button.hidden = false;
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = '<i class="fas fa-music"></i> Ver letra';
    status.textContent = `Letra verificada · ${data.track.source || 'fuente pública'}`;
    source.textContent = 'Coincidencia corroborada por metadatos disponibles y la fuente pública.';
    sourceLink.href = data.track.sourceUrl || 'https://lrclib.net/';
    return true;
}

async function loadVerifiedLyrics(song) {
    if (!lyricsEligibleSong(song)) return;
    const key = lyricsSongKey(song);
    if (currentLyrics?.resourceId === song.url || lyricsLoadingKey === key) return;
    lyricsLoadingKey = key;
    const token = ++lyricsRequestToken;
    const cached = readCachedLyrics(key);
    if (cached) { renderLyricsPanel(cached, song); lyricsLoadingKey = ''; return; }
    const params = new URLSearchParams({ title: lyricsTrackTitle(song), artist: lyricsArtistName(song) });
    const duration = Number(song.duration);
    if (Number.isFinite(duration) && duration > 0) params.set('duration', String(Math.round(duration)));
    try {
        const response = await fetch(`/api/lyrics?${params.toString()}`, { headers: { Accept: 'application/json' } });
        const data = await response.json().catch(() => null);
        if (token !== lyricsRequestToken || currentQueueSong()?.url !== song?.url) return;
        if (!response.ok || !data?.found || !data?.verified) return;
        writeLyricsCache(key, { data });
        renderLyricsPanel(data, song);
    } catch (error) {}
    finally {
        if (lyricsLoadingKey === key) lyricsLoadingKey = '';
    }
}

function toggleLyricsPanel() {
    const button = document.getElementById('lyricsToggleBtn');
    const panel = document.getElementById('lyricsPanel');
    if (!button || button.hidden || !panel || !currentLyrics) return;
    const show = panel.hidden;
    panel.hidden = !show;
    button.setAttribute('aria-expanded', String(show));
    button.innerHTML = show ? '<i class="fas fa-eye-slash"></i> Ocultar letra' : '<i class="fas fa-music"></i> Ver letra';
    if (show) document.getElementById('lyricsScroll')?.focus?.({ preventScroll: true });
}

function applyLyricsZoom() {
    const content = document.getElementById('lyricsContent');
    const value = document.getElementById('lyricsZoomValue');
    if (content) content.style.fontSize = `${lyricsZoom}rem`;
    if (value) value.textContent = `${Math.round(lyricsZoom * 100)}%`;
}

function changeLyricsZoom(delta) {
    if (!currentLyrics) return;
    lyricsZoom = Math.min(1.6, Math.max(.75, Math.round((lyricsZoom + Number(delta || 0)) * 100) / 100));
    applyLyricsZoom();
}

function resetLyricsZoom() {
    lyricsZoom = 1;
    applyLyricsZoom();
}

function renderVideoStageDetails(song) {
    const meta = document.getElementById('videoStageMeta');
    const description = document.getElementById('videoStageDescription');
    const channelButton = document.getElementById('videoStageChannelBtn');
    if (!meta || !description || !channelButton) return;
    const duration = formatContentDuration(song?.duration);
    const isFreeVideo = song?.type === 'freevideo';
    const channel = isFreeVideo ? 'Wikimedia Commons' : (song?.channelTitle || song?.artist || 'Canal público de YouTube');
    const kind = isFreeVideo ? `Video libre${song?.license ? ` · ${song.license}` : ''}` : (song?.isPlaylist ? 'Lista de reproducción' : 'Video de YouTube');
    const entries = [
        { icon: 'fa-clock', label: duration === '—' ? 'Duración en el reproductor' : duration },
        { icon: song?.isPlaylist ? 'fa-list' : 'fa-clapperboard', label: kind },
        { icon: isFreeVideo ? 'fa-leaf' : 'fa-satellite-dish', label: channel }
    ];
    meta.innerHTML = entries.map(entry => `<span><i class="fas ${entry.icon}"></i>${escapeHtml(entry.label)}</span>`).join('');
    const cleanDescription = descriptionExcerpt(song?.description || '', 430);
    description.textContent = cleanDescription || (isFreeVideo ? 'Clip con licencia abierta alojado en Wikimedia Commons.' : 'No hay una descripción pública disponible para este video.');
    description.classList.toggle('is-empty', !cleanDescription);
    channelButton.hidden = !song?.channelId;
    void loadVerifiedLyrics(song);
}

function openVideoStageChannel() {
    const song = currentQueueSong();
    if (!song?.channelId) { showToast('No hay un canal disponible para abrir', 'fa-satellite-dish'); return; }
    browseChannel(song.channelId, song.channelTitle || song.artist || 'Canal de YouTube');
}

function updateVideoStageToggle(isVisible) {
    const button = document.getElementById('videoStageToggleBtn');
    if (!button) return;
    const song = currentQueueSong();
    const isVideo = isVisualVideo(song);
    const minimized = isVideo && Boolean(isPlaying) && !isVisible;
    const copy = button.querySelector('.video-stage-toggle-copy');
    const reason = videoStageAutoHiddenReason;
    button.hidden = !minimized;
    button.classList.toggle('video-minimized', minimized);
    if (minimized) {
        const automatic = reason === 'document-hidden' || reason === 'out-of-view' || reason === 'navigation';
        const smallText = automatic ? 'Ocultado para ahorrar carga' : 'El audio sigue activo';
        if (copy) copy.innerHTML = `<strong>Mostrar video</strong><small>${smallText}</small>`;
        button.title = automatic ? 'El video no estaba visible; volver a mostrarlo' : 'El video sigue activo · volver a mostrar';
        button.setAttribute('aria-label', automatic ? 'El video se ocultó automáticamente; volver a mostrar video' : 'El video sigue activo; volver a mostrar video');
    }
}

function setVideoStageMinimized(minimized, options = {}) {
    const stage = document.getElementById('videoStage');
    const song = currentQueueSong();
    if (!stage || !isVisualVideo(song)) return;
    videoStageMinimized = !!minimized;
    videoStageManualMinimized = videoStageMinimized && options.manual === true;
    if (videoStageMinimized) videoStageNeedsVisualRefresh = true;
    videoStageAutoHiddenReason = videoStageMinimized ? (options.autoReason || (options.manual ? '' : videoStageAutoHiddenReason)) : '';
    stage.classList.toggle('visible', !videoStageMinimized);
    if (videoStageMinimized) stage.classList.remove('is-error');
    if (song.type === 'yt' && ytPlayer?.setPlaybackQuality) {
        try { ytPlayer.setPlaybackQuality(videoStageMinimized ? 'small' : 'auto'); } catch (error) {}
    }
    updateVideoStageToggle(!videoStageMinimized);
    persistVideoResumeSession(true);
    if (!videoStageMinimized && options.focus) {
        window.requestAnimationFrame(() => stage.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
}

function clearYouTubeEmbedFallback() {
    const fallback = document.getElementById('videoEmbedFallback');
    const openButton = document.getElementById('videoEmbedOpenBtn');
    const popupButton = document.getElementById('videoEmbedPopupBtn');
    youtubeEmbedFallbackUrl = '';
    if (fallback) fallback.hidden = true;
    if (openButton) { openButton.href = '#'; openButton.removeAttribute('aria-disabled'); }
    if (popupButton) popupButton.disabled = false;
}

function showYouTubeEmbedFallback(song, errorCode = '') {
    const fallback = document.getElementById('videoEmbedFallback');
    const title = document.getElementById('videoEmbedFallbackTitle');
    const message = document.getElementById('videoEmbedFallbackMessage');
    const openButton = document.getElementById('videoEmbedOpenBtn');
    const popupButton = document.getElementById('videoEmbedPopupBtn');
    const stage = document.getElementById('videoStage');
    const url = getCurrentContentLink(song);
    if (!fallback || !title || !message || !openButton || !popupButton || !stage || !url) return;
    youtubeEmbedFallbackUrl = url;
    title.textContent = song?.title || 'Este video necesita YouTube';
    const reason = Number(errorCode) === 101 || Number(errorCode) === 150
        ? 'El creador no permite la reproducción dentro de otras páginas.'
        : 'YouTube no pudo reproducirlo dentro del reproductor integrado.';
    message.textContent = `${reason} Podés abrirlo en una ventana compacta oficial sin cerrar Nowarfy.`;
    openButton.href = url;
    openButton.setAttribute('aria-label', `Ver ${song?.title || 'este video'} en YouTube`);
    popupButton.disabled = false;
    fallback.hidden = false;
    stage.classList.add('is-error');
}

function openYouTubeCompactWindow() {
    const song = currentQueueSong();
    const url = youtubeEmbedFallbackUrl || getCurrentContentLink(song);
    if (!url || song?.type !== 'yt') return;
    const features = 'popup=yes,width=720,height=450,resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,status=no';
    let popup = null;
    try { popup = window.open(url, 'nowarfy-youtube-compact', features); } catch (error) { popup = null; }
    if (!popup) {
        showToast('Chrome bloqueó la ventana; permití ventanas emergentes para abrir YouTube en flotante', 'fa-up-right-and-down-left-from-center');
        return;
    }
    youtubeCompactWindow = popup;
    try { popup.focus(); } catch (error) {}
    showToast('YouTube se abrió en una ventana compacta; Nowarfy sigue abierto', 'fab fa-youtube');
}

function showVideoStage(song, options = {}) {
    const stage = document.getElementById('videoStage');
    const fallback = document.getElementById('videoEmbedFallback');
    const keepFallback = !!(fallback && !fallback.hidden && youtubeEmbedFallbackUrl && youtubeEmbedFallbackUrl === getCurrentContentLink(song));
    if (!keepFallback) {
        clearYouTubeEmbedFallback();
        stage.classList.remove('is-error');
    }
    setVideoFramePoster(song, false);
    const hiddenDocument = document.visibilityState === 'hidden';
    stage.classList.toggle('visible', !hiddenDocument);
    videoStageMinimized = hiddenDocument;
    videoStageManualMinimized = false;
    videoStageAutoHiddenReason = hiddenDocument ? 'document-hidden' : '';
    if (song.type === 'yt' && ytPlayer?.setPlaybackQuality) {
        try { ytPlayer.setPlaybackQuality(hiddenDocument ? 'small' : 'auto'); } catch (error) {}
    }
    document.getElementById('videoStageTitle').textContent = song.title || (song.type === 'freevideo' ? 'Video libre' : 'Video de YouTube');
    document.getElementById('videoStageArtist').textContent = song.type === 'freevideo' ? `${song.artist || 'Wikimedia Commons'} · ${song.license || 'licencia abierta'}` : (song.channelTitle || song.artist || '');
    const kicker = document.querySelector('.video-stage-kicker');
    const note = document.querySelector('.video-stage-note');
    if (kicker) kicker.textContent = song.type === 'freevideo' ? 'Reproduciendo video libre' : 'Reproduciendo desde YouTube';
    if (note) note.textContent = song.type === 'freevideo' ? 'Archivo público de Wikimedia Commons. Revisá la ficha de origen para atribución y licencia.' : 'Datos extraídos de la ficha pública del video. Algunos videos pueden estar restringidos por su creador, región o YouTube.';
    renderVideoStageDetails(song);
    renderVideoSuggestions(song);
    updateVideoStageToggle(!videoStageMinimized);
    if (options.restoreFrame && song.type === 'yt') refreshYouTubeVideoFrame('show');
    if (options.focus && !videoStageMinimized) window.requestAnimationFrame(() => stage.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

function hideVideoStage(pauseVideo = false, options = {}) {
    const song = currentQueueSong();
    if (!isVisualVideo(song)) {
        videoStageMinimized = false;
        document.getElementById('videoStage').classList.remove('visible', 'is-error');
        updateVideoStageToggle(true);
        return;
    }
    setVideoStageMinimized(true, options);
    if (pauseVideo && isPlaying) {
        if (song.type === 'yt' && ytPlayer) ytPlayer.pauseVideo();
        else if (song.type === 'freevideo') freeVideoEl.pause();
        isPlaying = false;
        if (song.type === 'yt') persistVideoResumeSession(true);
        updateIcon();
        updatePlaybackState();
    }
}

function setVideoFramePoster(song, restoring = false) {
    const poster = document.getElementById('videoFramePoster');
    if (!poster) return;
    const source = String(song?.img || '').trim();
    poster.onerror = () => { poster.hidden = true; poster.classList.remove('is-restoring'); };
    poster.src = source;
    poster.alt = source ? `Miniatura de ${song?.title || 'la pista actual'}` : '';
    poster.hidden = !source;
    poster.classList.toggle('is-restoring', restoring && !!source);
}

function finishVideoFrameRestore(expectedUrl) {
    const poster = document.getElementById('videoFramePoster');
    if (!poster || currentQueueSong()?.url !== expectedUrl) return;
    poster.classList.remove('is-restoring');
    window.setTimeout(() => {
        if (currentQueueSong()?.url === expectedUrl && poster) poster.hidden = true;
    }, 1250);
}

function reloadYouTubeVideoVisual(expectedUrl) {
    const song = currentQueueSong();
    if (!song || song.type !== 'yt' || String(song.url) !== expectedUrl || !ytPlayer) return false;
    if (videoFrameRestoreAwaitingPlayer === expectedUrl) return false;
    let state = null;
    let position = 0;
    try {
        state = ytPlayer.getPlayerState?.();
        position = Math.max(0, Number(ytPlayer.getCurrentTime?.() || 0));
    } catch (error) {}
    const shouldPlay = !!ytPlaybackIntent && !playbackStoppedByUser && (isPlaying || state === window.YT?.PlayerState?.PLAYING);
    try {
        if (isNativeYouTubePlaylistPlayback()) {
            if (!shouldPlay || !ytPlayer.playVideoAt || !ytPlayer.getPlaylistIndex) return false;
            const playlistIndex = Number(ytPlayer.getPlaylistIndex());
            if (!Number.isFinite(playlistIndex) || playlistIndex < 0) return false;
            ytPlayer.playVideoAt(playlistIndex);
            if (position > 1) window.setTimeout(() => { if (currentQueueSong()?.url === expectedUrl) ytPlayer.seekTo?.(position, true); }, 260);
        } else if (shouldPlay && ytPlayer.loadVideoById) {
            ytPlayer.loadVideoById({ videoId: expectedUrl, startSeconds: position, suggestedQuality: 'auto' });
        } else if (!shouldPlay && ytPlayer.cueVideoById) {
            ytPlayer.cueVideoById({ videoId: expectedUrl, startSeconds: position, suggestedQuality: 'auto' });
        } else return false;
    } catch (error) {
        return false;
    }
    videoFrameRestoreAwaitingPlayer = expectedUrl;
    window.setTimeout(() => {
        if (videoFrameRestoreAwaitingPlayer === expectedUrl) videoFrameRestoreAwaitingPlayer = '';
    }, 1600);
    return true;
}

function refreshYouTubeVideoFrame(reason = 'restore') {
    const song = currentQueueSong();
    const stage = document.getElementById('videoStage');
    const frame = document.querySelector('#yt-player-container iframe');
    const frameBox = document.querySelector('#videoStage .video-frame');
    if (!stage?.classList.contains('visible') || song?.type !== 'yt' || !ytPlayer || !frameBox) return;
    const expectedUrl = String(song.url);
    setVideoFramePoster(song, true);
    clearTimeout(videoFrameRefreshTimer);
    const reflow = () => {
        if (currentQueueSong()?.url !== expectedUrl || !stage.classList.contains('visible')) return;
        const rect = frameBox.getBoundingClientRect();
        const width = Math.max(1, Math.floor(rect.width || frameBox.clientWidth));
        const height = Math.max(1, Math.floor(rect.height || frameBox.clientHeight));
        try { ytPlayer.setSize?.(width, height); } catch (error) {}
        if (frame) {
            frame.style.display = 'block';
            frame.style.visibility = 'hidden';
            void frame.offsetHeight;
            frame.style.visibility = 'visible';
        }
        videoStageNeedsVisualRefresh = false;
    };
    window.requestAnimationFrame(() => {
        reflow();
        videoFrameRefreshTimer = window.setTimeout(() => {
            reloadYouTubeVideoVisual(expectedUrl);
            reflow();
            window.setTimeout(() => {
                reflow();
                let state = null;
                try { state = ytPlayer.getPlayerState?.(); } catch (error) {}
                if (ytPlaybackIntent && state !== window.YT?.PlayerState?.PLAYING) requestYouTubePlayback(`visual-${reason}`);
                finishVideoFrameRestore(expectedUrl);
            }, 320);
        }, 260);
    });
}

function toggleVideoStageVisibility() {
    const song = currentQueueSong();
    if (!isVisualVideo(song)) { showToast('No hay un video activo para mostrar', 'fa-clapperboard'); return; }
    const stage = document.getElementById('videoStage');
    if (stage.classList.contains('visible')) hideVideoStage(false, { manual: true });
    else {
        showVideoStage(song, { focus: true, restoreFrame: true });
        if (song.type === 'freevideo') { freeVideoEl.style.display = 'block'; }
    }
}

function setupVideoStageObserver() {
    const stage = document.getElementById('videoStage');
    if (!stage || !window.IntersectionObserver) return;
    videoStageObserver?.disconnect();
    videoStageObserver = new IntersectionObserver(entries => {
        const entry = entries[0];
        const song = currentQueueSong();
        if (!entry || !isVisualVideo(song)) return;
        const rect = entry.boundingClientRect;
        if (!videoStageMinimized && stage.classList.contains('visible')) {
            const scrolledOut = (rect.top < -15 || rect.bottom < 120 || entry.intersectionRatio < 0.85) && rect.height > 0;
            if (scrolledOut) {
                setVideoStageMinimized(true, { autoReason: 'out-of-view' });
            }
        } else if (videoStageMinimized && videoStageAutoHiddenReason === 'out-of-view') {
            const scrolledIn = rect.top >= -10 && rect.bottom > 200 && entry.intersectionRatio > 0.65;
            if (scrolledIn) {
                setVideoStageMinimized(false);
            }
        }
    }, { root: null, threshold: [0, 0.15, 0.5, 0.65, 0.75, 0.85, 1.0], rootMargin: '0px 0px 0px 0px' });
    videoStageObserver.observe(stage);
}

function setupVideoStageVisibilityAwareness() {
    document.addEventListener('visibilitychange', () => {
        const stage = document.getElementById('videoStage');
        const song = currentQueueSong();
        if (document.visibilityState === 'hidden' && stage?.classList.contains('visible') && isVisualVideo(song)) {
            setVideoStageMinimized(true, { autoReason: 'document-hidden' });
        }
    });
}

function initYTPlayer(resourceId, isPlaylist = false, resumeSession = null, deferAutoplay = false) {
    pendingVideoResumeSession = resumeSession || pendingVideoResumeSession;
    clearTimeout(ytStartupTimer);
    ytStartupTimer = null;
    document.getElementById('yt-player-container').innerHTML = '<div id="yt-player"></div>';
    const playerConfig = {
        host: 'https://www.youtube-nocookie.com',
        height: '100%',
        width: '100%',
        playerVars: { 'autoplay': deferAutoplay ? 0 : 1, 'controls': 1, 'playsinline': 1, 'enablejsapi': 1, 'rel': 0, 'modestbranding': 1, 'origin': window.location.origin },
        events: { 'onReady': onYTReady, 'onStateChange': onYTStateChange, 'onError': onYTError }
    };

    if (isPlaylist) {
        playerConfig.playerVars.listType = 'playlist';
        playerConfig.playerVars.list = resourceId;
    } else {
        playerConfig.videoId = resourceId;
    }

    ytPlaybackIntent = !deferAutoplay;
    ytPlayer = new YT.Player('yt-player', playerConfig);
}

function requestYouTubePlayback(reason = 'retry') {
    const song = currentQueueSong();
    if (externalAudioFocusInterrupted) return false;
    if (!ytPlayer || song?.type !== 'yt' || !ytPlaybackIntent || playbackStoppedByUser) return false;
    let state = null;
    try { state = ytPlayer.getPlayerState?.(); } catch (error) { state = null; }
    if (window.YT?.PlayerState?.PLAYING != null && state === YT.PlayerState.PLAYING) {
        startSilentLoop();
        return true;
    }
    const now = Date.now();
    if (now - ytPlayCommandAt < YT_PLAY_RETRY_THROTTLE_MS) return false;
    ytPlayCommandAt = now;
    try {
        ytPlayer.playVideo();
        startSilentLoop();
        return true;
    } catch (error) {
        return false;
    }
}

function armYouTubeStartupWatchdog(expectedUrl, attempt = 0) {
    clearTimeout(ytStartupTimer);
    ytStartupTimer = setTimeout(() => {
        if (currentQueueSong()?.url !== expectedUrl || playbackStoppedByUser || externalAudioFocusInterrupted || !ytPlaybackIntent || !ytPlayer?.getPlayerState) return;
        requestYouTubePlayback(`startup-timeout-retry-${attempt + 1}`);
        let state = null;
        try { state = ytPlayer.getPlayerState(); } catch (error) { return; }
        if (state === window.YT?.PlayerState?.PLAYING) return;
        if (attempt < 3 || String(externalAudioFocusLastState).startsWith('probable:')) {
            armYouTubeStartupWatchdog(expectedUrl, attempt < 3 ? attempt + 1 : 0);
            return;
        }
        setTrackLoading(false);
        document.getElementById('videoStage')?.classList.add('is-error');
        showToast('YouTube está tardando en responder; no cambiamos de pista todavía', 'fa-hourglass-half');
    }, 12000);
}

function onYTReady(event) {
    if (event?.target && event.target !== ytPlayer) return;
    const v = parseFloat(document.getElementById('volumeSlider').value);
    if (ytPlayer.setVolume) ytPlayer.setVolume(v * 100);
    const song = currentQueueSong();
    if (song?.type === 'yt' && ytPlayer.getDuration) {
        renderVideoStageDetails({ ...song, duration: song.duration || ytPlayer.getDuration() });
    }
    clearYouTubeEmbedFallback();
    const resume = pendingVideoResumeSession;
    pendingVideoResumeSession = null;
    if (resume && song?.type === 'yt' && String(resume.resourceId) === String(song.url)) {
        const position = Math.max(0, Number(resume.position) || 0);
        if (position > 1 && ytPlayer.seekTo) ytPlayer.seekTo(position, true);
        if (resume.wasPlaying === false && ytPlayer.pauseVideo) ytPlayer.pauseVideo();
        if (restoreVideoMinimizedAfterReady) {
            restoreVideoMinimizedAfterReady = false;
            window.setTimeout(() => setVideoStageMinimized(true), 0);
        }
    }
    if (song?.type === 'yt' && !externalAudioFocusInterrupted && !playbackStoppedByUser && !(resume?.wasPlaying === false) && ytPlayer.playVideo) {
        ytPlaybackIntent = true;
        requestYouTubePlayback('ready');
        armYouTubeStartupWatchdog(song.url);
    }
}
function onYTStateChange(event) {
    if (event?.target && event.target !== ytPlayer) return;
    if (event.data === YT.PlayerState.PLAYING) {
        if (externalAudioFocusInterrupted) {
            try { ytPlayer?.pauseVideo?.(); } catch (error) {}
            return;
        }
        externalAudioFocusLastState = '';
        if (isNativeYouTubePlaylistPlayback()) syncNativeYouTubePlaylistPosition();
        clearTimeout(ytStartupTimer);
        ytStartupTimer = null;
        playbackStoppedByUser = false;
        isPlaying = true;
        startSilentLoop();
        setTrackLoading(false);
        if (!progressInterval) startProgress(ytPlayer);
        if (nowarfyRemoteIsPlayer) void publishNowarfyRemoteState();
    } else if (event.data === YT.PlayerState.PAUSED) {
        const pageHasFocus = typeof document.hasFocus === 'function' ? document.hasFocus() : document.visibilityState !== 'hidden';
        if (document.visibilityState !== 'hidden' && pageHasFocus && !externalAudioFocusInterrupted && isPlaying) {
            ytPlaybackIntent = false;
            playbackStoppedByUser = true;
            stopSilentLoop();
            clearTimeout(ytStartupTimer);
            ytStartupTimer = null;
            isPlaying = false;
            persistVideoResumeSession(true);
            updateIcon();
            updatePlaybackState();
            if (nowarfyRemoteIsPlayer) void publishNowarfyRemoteState();
            return;
        }
        if ((document.visibilityState === 'hidden' || !pageHasFocus) && !NOWARFY_AUDIO_PRIORITY_MODE && ytPlaybackIntent && !playbackStoppedByUser && !externalAudioFocusInterrupted) {
            schedulePossibleExternalAudioYield('youtube-paused-out-of-focus');
            return;
        }
        const shouldKeepPlaying = ytPlaybackIntent && !playbackStoppedByUser;
        if (shouldKeepPlaying) {
            isPlaying = true;
            startSilentLoop();
            requestYouTubePlayback('background-paused');
        } else {
            stopSilentLoop();
            clearTimeout(ytStartupTimer);
            ytStartupTimer = null;
            isPlaying = false;
            persistVideoResumeSession(true);
        }
        if (nowarfyRemoteIsPlayer) void publishNowarfyRemoteState();
    } else if (event.data === YT.PlayerState.BUFFERING) {
        setTrackLoading(true, currentIndex);
    } else if (event.data === YT.PlayerState.ENDED) {
        ytPlaybackIntent = false;
        isPlaying = false;
        stopSilentLoop();
        clearVideoResumeSession();
        queueAutomaticAdvance('youtube-ended');
    }
    updateIcon();
    updatePlaybackState();
}
function onYTError(event) {
    if (event?.target && event.target !== ytPlayer) return;
    if (externalAudioFocusInterrupted) return;
    clearTimeout(ytStartupTimer);
    ytStartupTimer = null;
    ytPlaybackIntent = false;
    stopSilentLoop();
    setTrackLoading(false);
    isPlaying = false;
    const song = currentQueueSong();
    showYouTubeEmbedFallback(song, event?.data);
    showToast('YouTube no permite este video dentro del IFrame; podés abrirlo desde aquí', 'fab fa-youtube');
    updateIcon();
    updatePlaybackState();
}

function togglePlay() {
    if (nowarfyAuthUser && nowarfyRemoteSession && !nowarfyRemoteIsPlayer) { void sendNowarfyCommand('toggle', null, true); return; }
    if (externalAudioFocusInterrupted) { showToast('Nowarfy cedió el audio a otra aplicación', 'fa-volume-high'); return; }
    nowarfyAudioUnlocked = true;
    if (currentIndex === -1 || !queue[currentIndex]) return;
    if (!ytPlayer && !audioEl.src && !freeVideoEl.src) {
        const resume = pendingVideoResumeSession;
        const explicitResume = resume ? { ...resume, wasPlaying: true } : null;
        playQueueAt(currentIndex, explicitResume ? { resumeSession: explicitResume, restoreMinimized: !!explicitResume.minimized } : {});
        return;
    }
    const song = queue[currentIndex];
    if (isPlaying) {
        playbackStoppedByUser = true;
        clearAutomaticAdvance();
    } else {
        playbackStoppedByUser = false;
    }
    if (song.type === 'yt') {
        if (ytPlayer) {
            if (isPlaying) { ytPlaybackIntent = false; ytPlayer.pauseVideo(); stopSilentLoop(); }
            else { ytPlaybackIntent = true; ytPlayer.playVideo(); startSilentLoop(); }
            isPlaying = !isPlaying;
        }
    } else {
        if (crossfadeInProgress) cancelDirectCrossfade();
        if (isPlaying) {
            activeAudioEl.pause();
            stopSilentLoop();
            isPlaying = false;
        } else {
            const playAttempt = activeAudioEl.play();
            startSilentLoop();
            isPlaying = true;
            if (playAttempt?.catch) {
                playAttempt.catch(() => {
                    isPlaying = false;
                    stopSilentLoop();
                    setTrackLoading(false);
                    updateIcon();
                    updatePlaybackState();
                    showToast('El navegador bloqueó la reproducción; tocá Reproducir para habilitarla', 'fa-play');
                });
            }
        }
    }
    updateIcon();
    updatePlaybackState();
}

function nextSong(manual = false) {
    if (manual && nowarfyAuthUser && nowarfyRemoteSession && !nowarfyRemoteIsPlayer) { void sendNowarfyCommand('next'); return true; }
    if (queue.length === 0) return false;
    if (queuePlaybackMode === 'prebuilt_playlist') {
        const advanced = advancePrebuiltPlaylist(currentPlayingQid);
        if (advanced) return true;
        if (!manual) finishPrebuiltPlaylistPlayback('Terminó la playlist de YouTube');
        else showToast('Ya estás en el último video de esta playlist', 'fa-flag-checkered');
        return true;
    }
    if (manual && shuffleMode) {
        playQueueAt(Math.floor(Math.random() * queue.length));
        return true;
    }
    const current = queue[currentIndex];
    if (!manual && current?.type === 'yt') return continueVideoAutoplay();
    const idx = queue.findIndex(s => s._qid === currentPlayingQid);
    if (idx === -1) return false;
    if (!manual && queue.length === 1) return false;
    let next = idx + 1;
    if (next >= queue.length) {
        void recoverAutomaticQueue(currentPlayingQid);
        return true;
    }
    playQueueAt(next);
    return true;
}
function prevSong() {
    if (nowarfyAuthUser && nowarfyRemoteSession && !nowarfyRemoteIsPlayer) { void sendNowarfyCommand('prev'); return; }
    if (queue.length === 0) return;
    const idx = queue.findIndex(s => s._qid === currentPlayingQid);
    let prev = idx - 1;
    if (prev < 0) prev = queue.length - 1;
    playQueueAt(prev);
}
function stopAll(options = {}) {
    const preserveYouTubePlayer = options.preserveYouTubePlayer === true;
    clearAutomaticAdvance();
    clearTimeout(ytStartupTimer);
    ytStartupTimer = null;
    ytPlaybackIntent = false;
    ytPlayCommandAt = 0;
    if (ytPlayer && !preserveYouTubePlayer) { ytPlayer.stopVideo(); ytPlayer.destroy(); ytPlayer = null; }
    if (!preserveYouTubePlayer) pendingYTRequest = null;
    freeVideoEl.pause();
    freeVideoEl.currentTime = 0;
    freeVideoEl.removeAttribute('src');
    freeVideoEl.dataset.queueId = '';
    freeVideoEl.hidden = true;
    clearInterval(crossfadeTimer);
    crossfadeInProgress = false;
    [audioEl, nextAudioEl].forEach(audio => { audio.pause(); audio.currentTime = 0; audio.dataset.queueId = ''; });
    activeAudioEl = audioEl;
    if (progressInterval) clearInterval(progressInterval);
    progressInterval = null;
    isPlaying = false;
    updateIcon();
    updatePlaybackState();
    progFill.style.width = '0%';
    progThumb.style.left = '0%';
}

function startProgress(source) {
    if (progressInterval) clearInterval(progressInterval);
    progressInterval = setInterval(() => {
        if (isSeeking) return;
        let curr, dur;
        if (source === ytPlayer) {
            curr = source.getCurrentTime();
            dur = source.getDuration();
        } else { curr = source.currentTime; dur = source.duration; }
        persistVideoResumeSession();
        if (dur) {
            const pct = (curr / dur) * 100;
            updateMediaPosition(dur, curr);
            progFill.style.width = `${pct}%`;
            progThumb.style.left = `${pct}%`;
            currTimeEl.innerText = format(curr);
            totalTimeEl.innerText = format(dur);
        }
    }, 500);
}

function updateProgress(curr, dur) {
    if (isSeeking) return;
    if (dur) {
        const pct = (curr / dur) * 100;
        progFill.style.width = `${pct}%`;
        progThumb.style.left = `${pct}%`;
        currTimeEl.innerText = format(curr);
        totalTimeEl.innerText = format(dur);
    }
}

function getDuration() {
    if (currentIndex === -1 || !queue[currentIndex]) return 0;
    const song = queue[currentIndex];
    if (song.type === 'yt' && ytPlayer && ytPlayer.getDuration) return ytPlayer.getDuration();
    if (song.type === 'mp3' || song.type === 'freevideo') return activeAudioEl.duration || 0;
    return 0;
}

function commitSeek(pct) {
    if (nowarfyAuthUser && nowarfyRemoteSession && !nowarfyRemoteIsPlayer) { void sendNowarfyCommand('seekPercent', Math.max(0, Math.min(1, Number(pct))) * 100, true); return; }
    if (currentIndex === -1 || !queue[currentIndex]) return;
    const song = queue[currentIndex];
    if (song.type === 'yt' && ytPlayer) { const d = ytPlayer.getDuration(); if (d) ytPlayer.seekTo(d * pct, true); }
    else if ((song.type === 'mp3' || song.type === 'freevideo') && activeAudioEl.duration) { activeAudioEl.currentTime = activeAudioEl.duration * pct; }
    persistVideoResumeSession(true);
}

function seekBy(deltaSeconds) {
    if (nowarfyAuthUser && nowarfyRemoteSession && !nowarfyRemoteIsPlayer) { void sendNowarfyCommand('seekDelta', Number(deltaSeconds) || 0); return; }
    if (currentIndex === -1 || !queue[currentIndex]) return;
    const song = queue[currentIndex];
    if (song.type === 'yt' && ytPlayer) {
        const t = Math.max(0, ytPlayer.getCurrentTime() + deltaSeconds);
        ytPlayer.seekTo(t, true);
    } else if (song.type === 'mp3' || song.type === 'freevideo') {
        activeAudioEl.currentTime = Math.max(0, Math.min(activeAudioEl.duration || 0, activeAudioEl.currentTime + deltaSeconds));
    }
    persistVideoResumeSession(true);
}

function setupProgressDrag() {
    function pctFromEvent(e) {
        const rect = progressTrack.getBoundingClientRect();
        let x = e.clientX - rect.left;
        x = Math.max(0, Math.min(x, rect.width));
        return rect.width ? x / rect.width : 0;
    }
    function preview(pct) {
        progFill.style.width = `${pct * 100}%`;
        progThumb.style.left = `${pct * 100}%`;
        const dur = getDuration();
        if (dur) currTimeEl.innerText = format(dur * pct);
    }
    let pendingPct = 0;
    function onMove(e) { pendingPct = pctFromEvent(e); preview(pendingPct); }
    function onUp() {
        isSeeking = false;
        progressTrack.classList.remove('dragging');
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        commitSeek(pendingPct);
    }
    progressTrack.addEventListener('pointerdown', (e) => {
        if (currentIndex === -1) return;
        isSeeking = true;
        progressTrack.classList.add('dragging');
        pendingPct = pctFromEvent(e);
        preview(pendingPct);
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
    });
}

function updateIcon() {
    document.getElementById('playIcon').style.display = isPlaying ? 'none' : 'inline';
    document.getElementById('pauseIcon').style.display = isPlaying ? 'inline' : 'none';
    document.getElementById('playerCover')?.classList.toggle('is-spinning', !!isPlaying);
    updateVideoStageToggle(!videoStageMinimized);
}

function setTrackLoading(loading, idx) {
    document.getElementById('playBtn').classList.toggle('loading', loading);
    document.querySelectorAll('.card.is-loading, .song-row.is-loading').forEach(c => c.classList.remove('is-loading'));
    if (loading && idx != null && idx !== -1) {
        const item = document.querySelector(`.card[data-idx="${idx}"], .song-row[data-idx="${idx}"]`);
        if (item) item.classList.add('is-loading');
    }
}
function format(sec) { if (!sec || isNaN(sec)) return "0:00"; const m = Math.floor(sec / 60); const s = Math.floor(sec % 60); return `${m}:${s < 10 ? '0' + s : s}`; }

function isFavoriteSong(song) {
    return !!song && favorites.some(favorite => favorite.title === song.title && favorite.artist === song.artist);
}

function syncFavoriteControl(control, song) {
    if (!control) return;
    const active = isFavoriteSong(song);
    control.classList.toggle('active', active);
    control.title = active ? 'Quitar de favoritos' : 'Guardar en favoritos';
    control.setAttribute('aria-label', control.title);
    const icon = control.querySelector('i');
    if (icon) icon.className = `${active ? 'fas' : 'far'} fa-heart`;
}

function toggleFavoriteSong(song, control = null) {
    if (!song) return false;
    const idx = favorites.findIndex(favorite => favorite.title === song.title && favorite.artist === song.artist);
    if (idx >= 0) {
        favorites.splice(idx, 1);
        showToast('Quitado de favoritos', 'fa-heart-crack');
    } else {
        favorites.push(song);
        showToast('Añadido a favoritos', 'fa-heart');
    }
    localStorage.setItem('nowarfy_favs', JSON.stringify(favorites));
    scheduleNowarfyTasteSync();
    syncFavoriteControl(control, song);
    updateFavButton(currentQueueSong());
    return idx < 0;
}

function toggleFavorite() {
    const song = currentQueueSong();
    if (song) toggleFavoriteSong(song);
}

function updateFavButton(song) {
    const button = document.getElementById('favBtn');
    if (!button) return;
    const exists = isFavoriteSong(song);
    button.className = exists ? 'fas fa-heart fav-btn active' : 'far fa-heart fav-btn';
}
function toggleShuffle() { shuffleMode = !shuffleMode; const icon = document.getElementById('shuffleIcon'); icon.classList.toggle('on', shuffleMode); icon.style.opacity = shuffleMode ? '1' : '0.5'; }

function initVolume() {
    const saved = parseFloat(localStorage.getItem('nowarfy_vol'));
    const vol = isNaN(saved) ? 0.8 : saved;
    document.getElementById('volumeSlider').value = vol;
    applyVolume(vol);
}
function setVolume(v) {
    v = Math.max(0, Math.min(1, parseFloat(v)));
    lastVolume = v;
    if (nowarfyAuthUser && nowarfyRemoteSession && !nowarfyRemoteIsPlayer) {
        const slider = document.getElementById('volumeSlider');
        if (slider) { slider.value = v; slider.style.background = `linear-gradient(to right, var(--accent) ${v * 100}%, #535353 ${v * 100}%)`; }
        localStorage.setItem('nowarfy_vol', v);
        void sendNowarfyCommand('volume', Math.round(v * 100), true);
        return;
    }
    if (externalAudioFocusInterrupted) {
        const slider = document.getElementById('volumeSlider');
        if (slider) { slider.value = v; slider.style.background = `linear-gradient(to right, var(--accent) ${v * 100}%, #535353 ${v * 100}%)`; }
        externalAudioFocusVolume = v;
        localStorage.setItem('nowarfy_vol', v);
        return;
    }
    applyVolume(v);
    localStorage.setItem('nowarfy_vol', v);
}
function applyPlaybackVolume(v) {
    const safe = Math.max(0, Math.min(1, Number(v) || 0));
    audioEl.volume = safe;
    nextAudioEl.volume = safe;
    freeVideoEl.volume = safe;
    if (ytPlayer && ytPlayer.setVolume) ytPlayer.setVolume(safe * 100);
}
function applyVolume(v) {
    const safe = Math.max(0, Math.min(1, parseFloat(v)));
    applyPlaybackVolume(safe);
    const slider = document.getElementById('volumeSlider');
    slider.value = safe;
    slider.style.background = `linear-gradient(to right, var(--accent) ${safe * 100}%, #535353 ${safe * 100}%)`;
    const icon = document.getElementById('volIcon');
    icon.className = (safe == 0 ? 'fas fa-volume-mute' : safe < 0.5 ? 'fas fa-volume-down' : 'fas fa-volume-up') + ' btn-control';
}
function getCurrentPlaybackVolume(song = currentQueueSong()) {
    try {
        if (song?.type === 'yt' && ytPlayer?.getVolume) return Math.max(0, Math.min(1, Number(ytPlayer.getVolume()) / 100));
        if (activeAudioEl) return Math.max(0, Math.min(1, Number(activeAudioEl.volume)));
    } catch (error) {}
    return Math.max(0, Math.min(1, Number(lastVolume) || 0));
}
function fadeNowarfyVolume(target, duration = 280) {
    const safeTarget = Math.max(0, Math.min(1, Number(target) || 0));
    const start = getCurrentPlaybackVolume();
    clearInterval(externalAudioFocusFadeTimer);
    return new Promise(resolve => {
        const startedAt = performance.now();
        const tick = () => {
            const progress = Math.min(1, (performance.now() - startedAt) / duration);
            const eased = 1 - Math.pow(1 - progress, 3);
            const value = start + (safeTarget - start) * eased;
            applyPlaybackVolume(value);
            if (progress >= 1) {
                clearInterval(externalAudioFocusFadeTimer);
                externalAudioFocusFadeTimer = null;
                resolve();
            }
        };
        tick();
        externalAudioFocusFadeTimer = window.setInterval(tick, 32);
    });
}
function toggleMute() {
    const slider = document.getElementById('volumeSlider');
    const current = parseFloat(slider.value);
    if (current > 0) { lastVolume = current; setVolume(0); }
    else { setVolume(lastVolume || 0.8); }
}

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        const tag = document.activeElement.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        switch (e.code) {
            case 'Space': e.preventDefault(); togglePlay(); break;
            case 'ArrowRight': seekBy(5); break;
            case 'ArrowLeft': seekBy(-5); break;
            case 'ArrowUp': e.preventDefault(); adjustVolume(0.05); break;
            case 'ArrowDown': e.preventDefault(); adjustVolume(-0.05); break;
        }
    });
}
function adjustVolume(delta) {
    const slider = document.getElementById('volumeSlider');
    let v = Math.min(1, Math.max(0, parseFloat(slider.value) + delta));
    setVolume(v);
}

function setupBackgroundPlaybackSupport() {
    [audioEl, nextAudioEl, freeVideoEl, silentAudioLoop].forEach(media => {
        if (!media) return;
        media.setAttribute('preload', media === silentAudioLoop ? 'auto' : 'metadata');
        if (media !== audioEl && media !== nextAudioEl && media !== silentAudioLoop) media.setAttribute('playsinline', '');
        media.addEventListener('play', updatePlaybackState);
        media.addEventListener('pause', updatePlaybackState);
        media.addEventListener('ended', updatePlaybackState);
    });
    if ('mediaSession' in navigator) {
        try { navigator.mediaSession.playbackState = 'none'; } catch (e) {}
    }
    setupAudioSessionSupport();
}
function pauseNowarfyForExternalAudio() {
    if (NOWARFY_AUDIO_PRIORITY_MODE || externalAudioFocusInterrupted) return;
    const song = currentQueueSong();
    const wasIntendedToPlay = !playbackStoppedByUser && (isPlaying || (song?.type === 'yt' && ytPlaybackIntent));
    if (!wasIntendedToPlay) return;
    externalAudioFocusInterrupted = true;
    externalAudioFocusResumePending = true;
    const restoreVolume = getCurrentPlaybackVolume(song);
    externalAudioFocusVolume = Number.isFinite(restoreVolume) ? restoreVolume : Math.max(0, Math.min(1, Number(lastVolume) || 0));
    if (song?.type === 'yt') ytPlaybackIntent = false;
    stopSilentLoop();
    isPlaying = false;
    void fadeNowarfyVolume(0, 280).then(() => {
        if (!externalAudioFocusInterrupted || currentQueueSong()?.url !== song?.url) return;
        if (song?.type === 'yt') {
            try { ytPlayer?.pauseVideo?.(); } catch (error) {}
        } else {
            try { activeAudioEl?.pause?.(); } catch (error) {}
        }
    });
    persistVideoResumeSession(true);
    updateIcon();
    updatePlaybackState();
}

function scheduleExternalAudioResumeCheck(expectedQid, reason = 'resume-check') {
    clearTimeout(externalAudioFocusResumeCheckTimer);
    if (!externalAudioFocusInterrupted || !externalAudioFocusResumePending || playbackStoppedByUser) return;
    const delay = EXTERNAL_AUDIO_RESUME_RETRY_MS + (Math.min(externalAudioFocusRecoveryAttempts, 8) * 750);
    externalAudioFocusResumeCheckTimer = window.setTimeout(() => {
        externalAudioFocusResumeCheckTimer = null;
        if (currentPlayingQid !== expectedQid || playbackStoppedByUser || !externalAudioFocusInterrupted) return;
        if (navigator.audioSession?.state === 'interrupted') {
            scheduleExternalAudioResumeCheck(expectedQid, 'audio-session-still-interrupted');
            return;
        }
        resumeNowarfyAfterExternalAudio(reason);
    }, delay);
}

function resumeNowarfyAfterExternalAudio(reason = 'external-audio-ended') {
    if (NOWARFY_AUDIO_PRIORITY_MODE || !externalAudioFocusInterrupted || externalAudioFocusResumeAttempting) return;
    if (navigator.audioSession?.state === 'interrupted') return;
    clearTimeout(externalAudioFocusRecoveryTimer);
    externalAudioFocusRecoveryTimer = null;
    const shouldResume = externalAudioFocusResumePending && !playbackStoppedByUser && !!currentPlayingQid;
    if (!shouldResume) {
        externalAudioFocusInterrupted = false;
        externalAudioFocusResumePending = false;
        externalAudioFocusLastState = '';
        clearTimeout(externalAudioFocusResumeCheckTimer);
        externalAudioFocusResumeCheckTimer = null;
        updatePlaybackState();
        return;
    }
    const song = currentQueueSong();
    if (!song) return;
    const expectedQid = currentPlayingQid;
    const restoreVolume = Number.isFinite(externalAudioFocusVolume) ? externalAudioFocusVolume : Math.max(0, Math.min(1, Number(lastVolume) || 0));
    externalAudioFocusRecoveryAttempts += 1;
    externalAudioFocusResumeAttempting = true;
    externalAudioFocusInterrupted = false;
    externalAudioFocusResumePending = false;
    externalAudioFocusLastState = '';
    externalAudioFocusVolume = null;
    isPlaying = false;
    let playStarted = false;
    if (song.type === 'yt' && ytPlayer?.playVideo) {
        ytPlaybackIntent = true;
        playStarted = requestYouTubePlayback(reason);
        startSilentLoop();
        void fadeNowarfyVolume(restoreVolume, 360);
    } else if (activeAudioEl?.play) {
        const playAttempt = activeAudioEl.play();
        playStarted = true;
        if (playAttempt?.catch) playAttempt.catch(() => { playStarted = false; isPlaying = false; updateIcon(); });
        void fadeNowarfyVolume(restoreVolume, 360);
    }
    if (playStarted) isPlaying = true;
    updateIcon();
    updatePlaybackState();
    window.setTimeout(() => {
        externalAudioFocusResumeAttempting = false;
        const current = currentQueueSong();
        if (currentPlayingQid !== expectedQid || playbackStoppedByUser) return;
        let playing = false;
        if (current?.type === 'yt') {
            try { playing = ytPlayer?.getPlayerState?.() === window.YT?.PlayerState?.PLAYING; } catch (error) { playing = false; }
        } else playing = !!(activeAudioEl && !activeAudioEl.paused);
        if (playing) {
            externalAudioFocusRecoveryAttempts = 0;
            return;
        }
        externalAudioFocusInterrupted = true;
        externalAudioFocusResumePending = true;
        externalAudioFocusLastState = `probable:resume-rejected:${reason}`;
        isPlaying = false;
        stopSilentLoop();
        persistVideoResumeSession(true);
        updateIcon();
        updatePlaybackState();
        scheduleExternalAudioResumeCheck(expectedQid, 'resume-rejected');
    }, 1100);
}

function schedulePossibleExternalAudioYield(reason = 'unexpected-pause') {
    if (NOWARFY_AUDIO_PRIORITY_MODE || externalAudioFocusInterrupted || playbackStoppedByUser || !currentPlayingQid) return;
    const song = currentQueueSong();
    const wasIntendedToPlay = isPlaying || (song?.type === 'yt' && ytPlaybackIntent);
    if (!wasIntendedToPlay) return;
    externalAudioFocusInterrupted = true;
    externalAudioFocusResumePending = true;
    externalAudioFocusLastState = `probable:${reason}`;
    const restoreVolume = getCurrentPlaybackVolume(song);
    externalAudioFocusVolume = Number.isFinite(restoreVolume) ? restoreVolume : Math.max(0, Math.min(1, Number(lastVolume) || 0));
    if (song?.type === 'yt') ytPlaybackIntent = false;
    stopSilentLoop();
    isPlaying = false;
    void fadeNowarfyVolume(0, 280).then(() => {
        if (!externalAudioFocusInterrupted || currentQueueSong()?.url !== song?.url) return;
        if (song?.type === 'yt') {
            try { ytPlayer?.pauseVideo?.(); } catch (error) {}
        } else {
            try { activeAudioEl?.pause?.(); } catch (error) {}
        }
    });
    persistVideoResumeSession(true);
    updateIcon();
    updatePlaybackState();
    clearTimeout(externalAudioFocusRecoveryTimer);
    externalAudioFocusRecoveryTimer = null;
}

function scheduleExternalAudioResume(reason = 'focus-return') {
    if (NOWARFY_AUDIO_PRIORITY_MODE || !externalAudioFocusInterrupted || navigator.audioSession?.state === 'interrupted') return;
    clearTimeout(externalAudioFocusRecoveryTimer);
    externalAudioFocusRecoveryTimer = window.setTimeout(() => {
        externalAudioFocusRecoveryTimer = null;
        resumeNowarfyAfterExternalAudio();
    }, EXTERNAL_AUDIO_RESUME_DELAY_MS);
}

function handleAudioSessionStateChange() {
    const state = String(navigator.audioSession?.state || '');
    externalAudioFocusLastState = state;
    if (state === 'interrupted') pauseNowarfyForExternalAudio();
    else if (!NOWARFY_AUDIO_PRIORITY_MODE && state !== 'interrupted' && externalAudioFocusInterrupted) resumeNowarfyAfterExternalAudio();
}

function setupAudioSessionSupport() {
    const session = navigator.audioSession;
    if (!session?.addEventListener) return;
    try { session.type = 'playback'; } catch (error) {}
    session.addEventListener('statechange', handleAudioSessionStateChange);
    handleAudioSessionStateChange();
}

function startSilentLoop() {
    if (!silentAudioLoop || externalAudioFocusInterrupted) return;
    if (silentAudioLoop.ended) silentAudioLoop.currentTime = 0;
    const playAttempt = silentAudioLoop.play();
    if (playAttempt?.catch) playAttempt.catch(() => {});
}
function stopSilentLoop() {
    if (!silentAudioLoop) return;
    silentAudioLoop.pause();
}
function updateMediaSession(song) {
    if (!('mediaSession' in navigator) || !song) return;
    try {
        const nextSongKey = `${song.type || ''}:${song.url || ''}`;
        navigator.mediaSession.metadata = new MediaMetadata({
            title: song.title || 'Nowarfy YouToo',
            artist: song.artist || song.channelTitle || 'Nowarfy',
            album: 'Nowarfy YouToo',
            artwork: song.img ? [{ src: song.img, sizes: '512x512', type: 'image/png' }] : []
        });
        if (!mediaSessionHandlersReady || mediaSessionSongKey !== nextSongKey) {
            const registerAction = (action, handler) => {
                try { navigator.mediaSession.setActionHandler(action, handler); } catch (e) {}
            };
            registerAction('play', () => { if (!isPlaying) togglePlay(); });
            registerAction('pause', () => { if (isPlaying) togglePlay(); });
            registerAction('stop', () => { if (isPlaying) togglePlay(); });
            registerAction('previoustrack', prevSong);
            registerAction('nexttrack', () => nextSong(true));
            registerAction('seekbackward', (d) => seekBy(-(d.seekOffset || 10)));
            registerAction('seekforward', (d) => seekBy(d.seekOffset || 10));
            registerAction('seekto', (d) => {
                const duration = getDuration();
                if (duration && Number.isFinite(d.seekTime)) commitSeek(d.seekTime / duration);
            });
            mediaSessionHandlersReady = true;
            mediaSessionSongKey = nextSongKey;
        }
    } catch (e) {}
}
function updateMediaPosition(duration, position) {
    if (!('mediaSession' in navigator) || !('setPositionState' in navigator.mediaSession)) return;
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position)) return;
    const safePosition = Math.min(Math.max(position, 0), duration);
    try { navigator.mediaSession.setPositionState({ duration, position: safePosition, playbackRate: 1 }); } catch (e) {}
}
function updatePlaybackState() {
    if (!('mediaSession' in navigator)) return;
    try { navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'; } catch (e) {}
}
function setupPlaybackContinuity() {
    const inspectCurrentPlayback = () => {
        if (externalAudioFocusInterrupted || playbackStoppedByUser || !currentPlayingQid) return;
        const current = currentQueueSong();
        if (!current) return;
        if (current.type === 'mp3' && isPlaying && activeAudioEl?.ended) {
            queueAutomaticAdvance('direct-ended-fallback');
            return;
        }
        if (current.type === 'mp3' && NOWARFY_AUDIO_PRIORITY_MODE && !playbackStoppedByUser && activeAudioEl?.paused && !activeAudioEl?.ended) {
            const playAttempt = activeAudioEl.play?.();
            if (playAttempt?.catch) playAttempt.catch(() => {});
            return;
        }
        if (current.type !== 'yt' || !ytPlayer?.getPlayerState || !window.YT) return;
        let state = null;
        let position = 0;
        let duration = 0;
        try {
            state = ytPlayer.getPlayerState();
            position = Number(ytPlayer.getCurrentTime?.() || 0);
            duration = Number(ytPlayer.getDuration?.() || 0);
        } catch (error) { return; }
        if (state === YT.PlayerState.ENDED || (duration > 0 && position >= Math.max(0, duration - YT_END_EARLY_TOLERANCE_SECONDS) && ytPlaybackIntent)) {
            queueAutomaticAdvance('youtube-timed-ended-fallback');
            return;
        }
        if (state === YT.PlayerState.BUFFERING || state === YT.PlayerState.PLAYING) return;
        if (ytPlaybackIntent && !playbackStoppedByUser && (state === YT.PlayerState.PAUSED || state === YT.PlayerState.UNSTARTED || state === YT.PlayerState.CUED)) {
            if (!isPlaying) {
                isPlaying = true;
                updateIcon();
                updatePlaybackState();
            }
            startSilentLoop();
            requestYouTubePlayback(`heartbeat-${state}`);
        }
    };
    automaticAdvanceTimer = null;
    window.setInterval(inspectCurrentPlayback, PLAYBACK_CONTINUITY_CHECK_MS);
    silentAudioLoop?.addEventListener('timeupdate', inspectCurrentPlayback);
    silentAudioLoop?.addEventListener('playing', inspectCurrentPlayback);
    silentAudioLoop?.addEventListener('pause', () => {
        if (mediaTransitionInProgress || NOWARFY_AUDIO_PRIORITY_MODE || externalAudioFocusInterrupted || playbackStoppedByUser || (document.visibilityState !== 'hidden' && (typeof document.hasFocus !== 'function' || document.hasFocus()))) return;
        schedulePossibleExternalAudioYield('anchor-paused-out-of-focus');
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && externalAudioFocusInterrupted) scheduleExternalAudioResume('visibility-return');
        inspectCurrentPlayback();
    });
    window.addEventListener('focus', () => {
        if (externalAudioFocusInterrupted) scheduleExternalAudioResume('focus-return');
        inspectCurrentPlayback();
    });
}

function setupBackgroundPersistence() {
    const save = () => { persistQueue(); persistVideoResumeSession(true); updatePlaybackState(); if (nowarfyRemoteIsPlayer) void publishNowarfyRemoteState(); };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });
    window.addEventListener('pagehide', save);
    window.addEventListener('freeze', save);
}

let deferredInstallPrompt = null;

function isStandaloneApp() {
    return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
}

async function requestPwaInstall() {
    const installButton = document.getElementById('pwaInstallBtn');
    if (!deferredInstallPrompt) {
        const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
        showToast(isIOS ? 'En Safari: Compartir → Agregar a pantalla de inicio' : 'La instalación estará disponible cuando el navegador termine de preparar la aplicación', 'fa-mobile-screen-button');
        return;
    }
    deferredInstallPrompt.prompt();
    const result = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installButton.hidden = true;
    showToast(result.outcome === 'accepted' ? 'Nowarfy se instaló en este dispositivo' : 'Instalación cancelada', result.outcome === 'accepted' ? 'fa-circle-check' : 'fa-circle-xmark');
}

let nowarfyHardResetInFlight = false;
async function hardResetNowarfy(event) {
    event?.preventDefault?.();
    if (nowarfyHardResetInFlight) return;
    nowarfyHardResetInFlight = true;
    const button = event?.currentTarget?.closest?.('.brand-youtoo') || document.querySelector('.brand-youtoo');
    button?.setAttribute('aria-busy', 'true');
    try {
        if ('caches' in window) {
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.filter(name => /^nowarfy(?:-|$)/i.test(name)).map(name => caches.delete(name)));
        }
        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.map(registration => registration.update().catch(() => null)));
        }
        const freshUrl = new URL(window.location.href);
        freshUrl.searchParams.set('_nowarfy_reload', String(Date.now()));
        window.location.replace(freshUrl.toString());
    } catch (error) {
        window.location.reload();
    }
}

function setupInstallableApp() {
    const installButton = document.getElementById('pwaInstallBtn');
    if (installButton) installButton.addEventListener('click', requestPwaInstall);
    window.addEventListener('beforeinstallprompt', event => {
        event.preventDefault();
        deferredInstallPrompt = event;
        if (installButton && !isStandaloneApp()) installButton.hidden = false;
    });
    window.addEventListener('appinstalled', () => {
        deferredInstallPrompt = null;
        if (installButton) installButton.hidden = true;
        showToast('Nowarfy ya está instalada', 'fa-circle-check');
    });
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (installButton && isIOS && !isStandaloneApp()) installButton.hidden = false;
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
    }, { once: true });
}

let nowarfyQrPreviousFocus = null;
function openNowarfyQr() {
    const modal = document.getElementById('nowarfyQrModal');
    if (!modal) return;
    nowarfyQrPreviousFocus = document.activeElement;
    modal.hidden = false;
    document.body.classList.add('qr-modal-open');
    modal.querySelector('.nowarfy-qr-close')?.focus();
}
function closeNowarfyQr() {
    const modal = document.getElementById('nowarfyQrModal');
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.body.classList.remove('qr-modal-open');
    nowarfyQrPreviousFocus?.focus?.();
}
window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeNowarfyQr();
});

// --- MODO FLOTANTE (ARRASTRE + RETORNO) ---
let isFloating = false;

function toggleFloatingMode() {
    isFloating = !isFloating;

    if (isFloating) {
        playerBar.classList.add('floating');
        pipBtn.classList.add('active');
        pipBtn.classList.remove('fa-compress-arrows-alt');
        pipBtn.classList.add('fa-expand-arrows-alt');
        makeDraggable(playerBar);
        showToast('Reproductor flotante activado', 'fa-up-right-and-down-left-from-center');
    } else {
        playerBar.classList.remove('floating');
        pipBtn.classList.remove('active');
        pipBtn.classList.remove('fa-expand-arrows-alt');
        pipBtn.classList.add('fa-compress-arrows-alt');
        playerBar.onmousedown = null;
        playerBar.style.top = '';
        playerBar.style.left = '';
        playerBar.style.right = '';
    }
}

function makeDraggable(element) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

    element.onmousedown = dragMouseDown;

    function dragMouseDown(e) {
        e = e || window.event;
        if (e.target.closest('button, .fav-btn, input, .volume-slider, .progress-track, .floating-restore-btn')) return;
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        const rect = element.getBoundingClientRect();
        element.style.top = rect.top + 'px';
        element.style.left = rect.left + 'px';
        element.style.right = 'auto';
        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
        e = e || window.event;
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;

        let newTop = element.offsetTop - pos2;
        let newLeft = element.offsetLeft - pos1;

        const maxTop = window.innerHeight - element.offsetHeight - 8;
        const maxLeft = window.innerWidth - element.offsetWidth - 8;
        newTop = Math.min(Math.max(8, newTop), Math.max(8, maxTop));
        newLeft = Math.min(Math.max(8, newLeft), Math.max(8, maxLeft));

        element.style.top = newTop + "px";
        element.style.left = newLeft + "px";
    }

    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;
    }
}

handleNowarfyPairingLink();
void initNowarfyAuth();
setTimeout(() => {
    initTouchSwipeGestures();
    initScrollAssemblyEngine();
}, 100);
