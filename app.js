import { createAppState, persistAppState } from './state.js';

// Primer punto de entrada modular. Todavía no reemplaza script.js:
// permite validar el estado compartido sin alterar el arranque existente.
const appState = createAppState();
window.NowarfyModules = Object.freeze({
  appState,
  persistAppState: () => persistAppState(appState)
});
