import { createAppState, persistAppState } from './state.js';

// Bootstrap modular aislado: todavía no reemplaza script.js.
const appState = createAppState();
const persist = () => persistAppState(appState);

window.NowarfyModules = Object.freeze({
  appState,
  persistAppState: persist
});

// Persistencia defensiva del estado modular sin interferir con el reproductor legado.
window.addEventListener('pagehide', persist, { passive: true });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persist();
}, { passive: true });
