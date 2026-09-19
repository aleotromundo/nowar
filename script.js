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

function remoteStatus(message) { const el = document.getElementById('nowarfyRemoteStatus'); if (el) el.textContent = message; }
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
async function teardownNowarfyRemoteControl() { if (nowarfyRemoteStateTimer) clearInterval(nowarfyRemoteStateTimer); if (nowarfyDeviceRefreshTimer) clearInterval(nowarfyDeviceRefreshTimer); nowarfyRemoteStateTimer = null; nowarfyDeviceRefreshTimer = null; if (nowarfyRemoteShadowTimer) clearInterval(nowarfyRemoteShadowTimer); nowarfyRemoteShadowTimer = null; nowarfyRemoteDevices = []; nowarfyRemoteBroadcastReady = false; nowarfyRemoteSeenCommandIds.clear(); if (nowarfyRemoteChannel && nowarfySupabase) await nowarfySupabase.removeChannel(nowarfyRemoteChannel); nowarfyRemoteChannel = null; nowarfyRemoteSession = null; nowarfyRemoteShadowSong = null; nowarfyRemoteShadowState = null; nowarfyRemoteDeviceId = null; nowarfyRemoteIsPlayer = false; }
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
async function sendNowarfyCommand(type, value = null) {
    if (!nowarfySupabase || !nowarfyAuthUser || !nowarfyRemoteSession) return;
    if (nowarfyRemoteIsPlayer) { await executeNowarfyRemoteCommand({ type, value }); return; }
    const commandId = `${nowarfyRemoteDeviceId || 'device'}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const command = { type, value, commandId };
    const isRealtimeCommand = ['volume', 'seekPercent', 'seekDelta'].includes(type);
    let broadcastSent = false;
    if (nowarfyRemoteBroadcastReady && nowarfyRemoteChannel) {
        try {
            const response = await nowarfyRemoteChannel.send({ type: 'broadcast', event: 'remote-command', payload: { commandId, senderDeviceId: nowarfyRemoteDeviceId, command } });
            broadcastSent = response?.status === 'ok' || response?.status === 'success';
        } catch (_) { broadcastSent = false; }
    }
    if (isRealtimeCommand && broadcastSent) return;
    const result = await nowarfySupabase.from('youtoo_remote_commands').insert({ session_id: nowarfyRemoteSession.id, user_id: nowarfyAuthUser.id, device_id: nowarfyRemoteDeviceId, command });
    if (result.error && !broadcastSent) remoteStatus('No se pudo enviar el comando remoto.');
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
        const song = command.value;
        if (song && song.url) {
            setRadioQueueMode();
            const q = withQid(song);
            queue = [q];
            queueSeenKeys = new Set([songKey(q)]);
            queueRound = 0;
            persistQueue();
            renderQueue();
            playQueueAt(0, {});
            growQueueIfNeeded(true);
        }
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

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = normalizeSourceText(str);
    return div.innerHTML;
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
                <img class="channel-profile-avatar" src="${thumb?.url || ''}" alt="" onerror="this.style.visibility='hidden'">
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
            .slice(
