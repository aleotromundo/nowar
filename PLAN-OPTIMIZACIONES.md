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

Se aplicó OPT-102: las imágenes de tarjetas, logos, QR y portada del reproductor declaran dimensiones y usan `decoding="async"`, manteniendo `loading="lazy"` en contenido fuera de la ruta inicial. Esto reduce el riesgo de CLS y trabajo de decodificación prioritario.

OPT-101 queda preparado para una siguiente modificación porque `assets/youtoo-mark-compact.png` no tiene referencias activas en el frontend actual; convertirlo sin sustituir una referencia real no reduciría el peso transferido.

OPT-105 y OPT-106 quedan especificadas para el siguiente commit, después de introducir pruebas de regresión sobre reproducción, cola, pairing y ciclo de vida. La política prevista detendrá timers no críticos con `visibilitychange` y agrupará las escrituras de cola en una ventana de 350 ms, forzando un `flush` en `pagehide`, `freeze` y ocultación.

## Validación

Ejecutar `node --check script.js`, `git diff --check`, verificar el Service Worker y probar Inicio, reproducción, cola, navegación a segundo plano y pairing QR. La comparación de producción debe registrar peso transferido, LCP, CLS, INP, solicitudes iniciales y CPU con la pestaña oculta.

## Próximo paso

Implementar OPT-105 y OPT-106 con cambios pequeños y medibles; luego abordar OPT-103 y OPT-104 mediante una lista explícita de rails prioritarios y `IntersectionObserver`, sin diferir bienvenida, acciones rápidas ni la primera recomendación.

## Referencias

- [Web Vitals](https://web.dev/articles/vitals)
- [Intersection Observer API](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API)
- [Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)
- [Web Storage API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API)
