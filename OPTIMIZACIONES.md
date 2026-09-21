# Índice de optimizaciones de Nowarfy

> Registro centralizado de mejoras de rendimiento, experiencia de carga y mantenibilidad. Este documento se actualiza junto con el código para conservar el contexto de cada cambio.

**Última actualización:** 2026-09-20  
**Rama de trabajo:** `chore/ux-pairing`  
**Estado general:** navegación y pairing QR implementados; optimizaciones profundas de carga y arquitectura pendientes.

## Cómo leer este registro

Cada optimización tiene un identificador estable. El estado **Aplicada** indica que existe una implementación en el repositorio. **Planificada** indica que la mejora fue priorizada, pero todavía no se incorporó. **En validación** indica que el código existe, aunque todavía falta medir su impacto en producción. **Descartada** se reserva para propuestas que no compensan su complejidad o riesgo.

La prioridad **P0** corresponde a mejoras de impacto alto y bajo riesgo. **P1** corresponde a mejoras importantes que requieren cambios moderados. **P2** corresponde a mejoras estructurales o de escalabilidad.

## Resumen de estado

| Estado | Cantidad | Significado |
|---|---:|---|
| Aplicada | 9 | Ya está implementada en el repositorio. |
| En validación | 1 | Está implementada y necesita medición real. |
| Planificada | 9 | Está registrada para una siguiente iteración. |
| Descartada | 0 | No hay propuestas descartadas actualmente. |

## Mejoras aplicadas

| ID | Prioridad | Optimización | Área | Evidencia o ubicación | Estado |
|---|---|---|---|---|---|
| OPT-001 | P0 | Evitar búsquedas remotas durante el arranque de la portada | Red / carga inicial | `loadHomeCatalogSources()` y flujo de búsqueda en `script.js` | Aplicada |
| OPT-002 | P0 | Cachear y actualizar el shell de la PWA con Service Worker | Caché / disponibilidad | `sw.js`, `CACHE_NAME = 'nowarfy-shell-v40'` | Aplicada |
| OPT-003 | P0 | Usar `network-first` para navegación y caché para recursos estáticos | Caché / despliegue | `sw.js` y headers de `vercel.json` | Aplicada |
| OPT-004 | P1 | Evitar lecturas duplicadas del estado modular | Estado / persistencia | `state.js`, `app.js` y commits de refactor de estado | Aplicada |
| OPT-005 | P1 | Cargar el reproductor de YouTube cuando se necesita | Reproducción / carga inicial | Flujo `loadYouTubeAPI()` en `script.js` | Aplicada |
| OPT-006 | P1 | Reducir la navegación visible y agrupar funciones relacionadas | UX / trabajo de renderizado | Navegación principal y `renderLibraryHub()` | Aplicada |
| OPT-007 | P1 | Añadir pairing QR dinámico y registrar el dispositivo vinculado | Red / experiencia multidispositivo | `buildNowarfyPairingUrl()`, `handleNowarfyPairingLink()` y modal QR | Aplicada |
| OPT-008 | P0 | Mostrar el estado real de sincronización en vez de un estado estático | UX / sincronización | `updateNowarfyConnectionStatus()` y `data-state` del panel lateral | En validación |

## Mejoras planificadas

| ID | Prioridad | Optimización | Impacto esperado | Implementación propuesta | Dependencias |
|---|---|---|---|---|---|
| OPT-101 | P0 | Convertir `assets/youtoo-mark-compact.png` a WebP o AVIF | Reduce aproximadamente 2 MB del peso de recursos | Generar variantes comprimidas, actualizar referencias y conservar PNG como fallback | Validar calidad visual |
| OPT-102 | P0 | Añadir `width`, `height`, `decoding="async"` y lazy loading a imágenes | Reduce cambios de layout y trabajo inicial del navegador | Aplicarlo a tarjetas, rails y logos fuera del primer viewport | Revisar componentes de render |
| OPT-103 | P0 | Renderizar menos contenido en Inicio durante la primera carga | Reduce consultas, nodos DOM y tiempo hasta la primera interacción | Mostrar bienvenida, una fila recomendada y una fila destacada; diferir el resto | Definir qué filas son prioritarias |
| OPT-104 | P0 | Cargar rails adicionales con `IntersectionObserver` | Traslada trabajo fuera de la ruta crítica | Convertir cada rail diferible en una unidad que se monta al entrar en viewport | OPT-103 |
| OPT-105 | P0 | Pausar o ralentizar timers cuando la pestaña está oculta | Reduce CPU y batería en móviles | Centralizar `visibilitychange` y ajustar intervalos de progreso, remoto y clasificación | Revisar continuidad de audio |
| OPT-106 | P0 | Agrupar escrituras en `localStorage` | Reduce bloqueos síncronos del hilo principal | Crear `schedulePersist()` con ventana de 300–500 ms | Auditar todos los puntos de persistencia |
| OPT-107 | P1 | Cancelar búsquedas superadas con `AbortController` | Evita respuestas fuera de orden y trabajo de red innecesario | Mantener un controlador por búsqueda y abortar la anterior | Revisar APIs `/api/search` |
| OPT-108 | P1 | Cachear respuestas de catálogo con TTL | Reduce latencia y carga de APIs | `remoteCatalogCache` en memoria y `localStorage` persistente con TTL por fuente | Aplicada |
| OPT-109 | P1 | Dividir `script.js` por responsabilidades | Reduce parseo inicial y mejora mantenibilidad | `modules/core.js`, `state-and-taste.js`, `catalog.js`, `reserve.js`, `playback-queue.js`, `lyrics-video.js` y `player-pwa.js` | Aplicada |
| OPT-110 | P1 | Separar CSS crítico del CSS de vistas secundarias | Reduce bloqueo de render | Mantener layout y portada en CSS inicial; cargar estilos de modales y secciones bajo demanda | OPT-109 |
| OPT-111 | P2 | Mover historial y colas grandes a IndexedDB | Evita límites y costos de `localStorage` | Crear una capa de almacenamiento asíncrono con migración gradual | Diseñar migración compatible |
| OPT-112 | P2 | Virtualizar la Playlist cuando crezca | Mantiene estable el DOM con colas largas | Renderizar solo las filas cercanas al viewport | OPT-111 |

## Roadmap recomendado

### Fase 1: mejoras de bajo riesgo

La primera fase debería concentrarse en OPT-101, OPT-102, OPT-105 y OPT-106. Son cambios acotados que pueden reducir peso, trabajo de CPU y bloqueos síncronos sin modificar el comportamiento principal del reproductor.

### Fase 2: optimización de la carga inicial

La segunda fase debería aplicar OPT-103 y OPT-104. La portada no necesita montar todos los catálogos antes de que el usuario interactúe. El objetivo es que la búsqueda y la primera recomendación estén disponibles antes de cargar contenido secundario.

### Fase 3: red y arquitectura

La tercera fase debería incluir OPT-107, OPT-108, OPT-109 y OPT-110. Estas mejoras requieren mayor coordinación, pero reducen solicitudes repetidas y permiten que las funciones menos usadas no afecten la ruta inicial.

### Fase 4: escalabilidad local

La última fase debería aplicar OPT-111 y OPT-112 cuando el historial y las colas reales indiquen que el almacenamiento o el DOM son un límite. No conviene introducir IndexedDB o virtualización antes de medir esa necesidad.

## Métricas de aceptación

Cada optimización debe verificarse con una comparación antes/después. Como mínimo, el registro debe conservar estos datos cuando se implemente una fase:

| Métrica | Objetivo inicial |
|---|---|
| Peso transferido de la primera carga | Reducirlo sin degradar la experiencia visual |
| Tiempo hasta mostrar la primera interfaz utilizable | Mantenerlo por debajo de la carga actual |
| Tiempo hasta la primera recomendación | Mostrar contenido útil antes de cargar catálogos secundarios |
| LCP (Largest Contentful Paint) | Mejorar sin aumentar el CLS |
| INP (Interaction to Next Paint) | Mantener la navegación y búsqueda responsivas |
| CLS (Cumulative Layout Shift) | Evitar saltos por imágenes y reproductor |
| Solicitudes de red iniciales | Reducir solicitudes no esenciales |
| Uso de CPU con pestaña oculta | Reducir timers activos y trabajo de clasificación |
| Tiempo de parseo y ejecución de JavaScript | Reducirlo mediante carga diferida y división de módulos |

## Registro de cambios

| Fecha | Cambio | Responsable |
|---|---|---|
| 2026-09-21 | Implementación de OPT-108: caché de respuestas de YouTube, Openverse y Commons en memoria y `localStorage`, con TTL de 5, 15 y 30 minutos respectivamente | Manus AI |
| 2026-09-21 | Implementación de OPT-109: división de `script.js` en siete módulos de responsabilidades, con bootstrap compatible con handlers inline y precache del Service Worker | Manus AI |
| 2026-09-20 | Creación del índice y consolidación de optimizaciones existentes y propuestas | Manus AI |

## Referencias

[1]: https://web.dev/articles/vitals "Web Vitals — métricas de experiencia de usuario"
[2]: https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API "Intersection Observer API — MDN Web Docs"
[3]: https://developer.mozilla.org/en-US/docs/Web/API/AbortController "AbortController — MDN Web Docs"
[4]: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API "IndexedDB API — MDN Web Docs"
[5]: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API "Service Worker API — MDN Web Docs"
