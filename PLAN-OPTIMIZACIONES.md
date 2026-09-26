# Plan técnico de optimizaciones de Nowarfy

**Fecha:** 2026-09-20. **Alcance inicial:** OPT-101 a OPT-106.

## Diagnóstico

La aplicación es HTML/CSS/JavaScript sin build step. `script.js` concentra aproximadamente 340 KB; la portada monta varios rails en una sola pasada y `assets/youtoo-mark-compact.png` mide 1920×1920 y pesa aproximadamente 2 MB. Las tarjetas ya usan lazy loading, pero no declaran dimensiones ni `decoding`, mientras que la cola y otros estados realizan escrituras síncronas en `localStorage`. También existen timers de progreso, clasificación y sincronización remota activos al ocultar la pestaña.

## Roadmap

| Fase | Optimización | Criterio de aceptación |
|---|---|---|
| 1 | OPT-101, OPT-102, OPT-105 y OPT-106 | Sin errores de sintaxis; menor CLS y trabajo en segundo plano; cola y reproducción intactas. |
| 2 | OPT-103 y OPT-104 | Inicio interactivo antes de montar rails secundarios; montaje diferido mediante `IntersectionObserver`. |
| 3 | OPT-107 a OPT-110 | Búsquedas cancelables, caché TTL, separación de módulos y CSS crítico medidos. |
| 4 | OPT-111 y OPT-112 | Incorporar IndexedDB o virtualización solo cuando existan límites observables. |

## Trabajo aplicado en esta iteración

Se aplicaron OPT-102, OPT-103, OPT-104, OPT-105, OPT-107, OPT-109 y OPT-110: las imágenes de tarjetas, logos, QR y portada del reproductor declaran dimensiones y usan `decoding="async"`, manteniendo `loading="lazy"` en contenido fuera de la ruta inicial. Inicio monta primero bienvenida, acciones rápidas, recomendación y destacados; los rails secundarios usan placeholders con altura estable y se montan una sola vez con `IntersectionObserver` y `rootMargin` de 320 px. El gestor de visibilidad pausa el progreso visual, la clasificación, la rotación de artwork, el refresco de dispositivos y el shadow remoto cuando la pestaña queda oculta. El heartbeat del dispositivo que actúa como reproductor continúa activo para no romper la sesión remota; al volver a la pestaña se recrean los timers necesarios sin duplicarlos. Las búsquedas nuevas abortan solicitudes anteriores y usan `requestId` para descartar respuestas tardías durante navegación o paginación. `script.js` ahora es un bootstrap de 17 líneas que carga secuencialmente siete módulos de responsabilidades, preservando los globals requeridos por `index.html` y los handlers inline. `styles.css` conserva los estilos críticos con 87.305 bytes, mientras que `styles-secondary.css` contiene 48.204 bytes de estilos de cola, modales, catálogo, letras, video y animaciones; se precarga sin bloquear y se sirve con caché del Service Worker.

OPT-101 queda preparado para una siguiente modificación porque `assets/youtoo-mark-compact.png` no tiene referencias activas en el frontend actual; convertirlo sin sustituir una referencia real no reduciría el peso transferido.

OPT-106 quedó implementada: la cola separa `persistQueueNow()` de `persistQueue()`, agrupa cambios sucesivos durante 350 ms y usa `flushNowarfyPersistence()` para forzar la escritura inmediata. El flush se ejecuta al ocultar, en `pagehide` y en `freeze`, evitando perder cambios pendientes sin retrasar favoritos, volumen, pairing ni preferencias de usuario.

## Validación

Ejecutar `node --check script.js`, `git diff --check`, verificar el Service Worker y probar Inicio, reproducción, cola, navegación a segundo plano y pairing QR. La comparación de producción debe registrar peso transferido, LCP, CLS, INP, solicitudes iniciales y CPU con la pestaña oculta.

## Próximo paso

Medir en producción el impacto de la carga inicial y abordar OPT-101 solo si el asset tiene referencias activas. OPT-108 quedó implementada con caché en memoria para la sesión y persistencia breve en `localStorage`: YouTube usa 5 minutos, Openverse 15 minutos y Wikimedia Commons 30 minutos. Las claves incluyen los parámetros que modifican la respuesta, incluyendo la página y el token de paginación, y solo se guardan respuestas exitosas. OPT-109 y OPT-110 quedan listas para comparar nuevamente contra sus líneas base de JavaScript y CSS en producción; la próxima tarea accionable es OPT-111 solo si el tamaño real de historial y colas justifica migrar a IndexedDB.

## Referencias

- [Web Vitals](https://web.dev/articles/vitals)
- [Intersection Observer API](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API)
- [Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)
- [Web Storage API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API)
