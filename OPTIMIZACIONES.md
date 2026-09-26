# Optimizaciones y mejoras prioritarias

Este documento ordena las mejoras recomendadas para Nowarfy en el orden más eficiente para reducir riesgo y mejorar mantenibilidad.

## 1) Hardening del backend y API

Objetivo: estabilizar los endpoints de Vercel y evitar errores silenciosos.

### Tareas
- [ ] Revisar y normalizar validaciones en [api/search.js](api/search.js)
- [ ] Validar parámetros obligatorios y errores HTTP consistentes
- [ ] Agregar manejo de timeouts / fallbacks para APIs externas
- [ ] Reducir la cantidad de requests paralelos innecesarios
- [ ] Normalizar respuestas con estructura uniforme de error
- [ ] Revisar límites de caché y encabezados de respuesta

### Archivos clave
- [api/search.js](api/search.js)
- [api/reserve.js](api/reserve.js)
- [api/lyrics.js](api/lyrics.js)
- [api/cleanup-reserve.js](api/cleanup-reserve.js)

---

## 2) Refactor del frontend principal

Objetivo: dejar [script.js](script.js) más legible y sostenible sin cambiar la funcionalidad.

### Tareas
- [ ] Separar lógica de auth, sincronización, player, UI y PWA
- [ ] Extraer helpers reutilizables y reducir duplicación
- [ ] Ordenar funciones por dominio en lugar de por archivo monolítico
- [ ] Mejorar nombres y comentarios para facilitar mantenimiento
- [ ] Revisar estados de carga, errores y mensajes al usuario

### Archivos clave
- [script.js](script.js)
- [app.js](app.js)
- [index.html](index.html)

---

## 3) Seguridad y privacidad

Objetivo: evitar exposición de secretos y datos sensibles.

### Tareas
- [ ] Revisar variables públicas en el cliente
- [ ] Confirmar que no haya claves hardcodeadas en archivos visibles
- [ ] Revalidar uso de Supabase y endpoints públicos
- [ ] Controlar qué configuración se envía al navegador
- [ ] Documentar variables de entorno obligatorias en [README.md](README.md)

---

## 4) Mejoras de experiencia de usuario

Objetivo: que la app se sienta más estable y clara.

### Tareas
- [ ] Mejorar feedback de loading y errores con mensajes más claros
- [ ] Ajustar transiciones y estados de conexión
- [ ] Revisar accesibilidad en botones, formularios y modales
- [ ] Mejorar manejo de favoritos, búsquedas y sincronización entre dispositivos
- [ ] Reducir comportamientos inconsistentes en la UI

---

## 5) Validación y pruebas del flujo real

Objetivo: verificar que cada mejora no rompa comportamiento crítico.

### Tareas
- [ ] Probar flujo de búsqueda
- [ ] Probar flujo de reserva
- [ ] Probar flujo de letras
- [ ] Probar servicio offline / service worker
- [ ] Verificar comportamiento con auth anónima y autenticada
- [ ] Revisar que no haya regresiones en Vercel

---

## Orden recomendado de ejecución

1. Backend / API hardening
2. Refactor del frontend principal
3. Seguridad y privacidad
4. UX y accesibilidad
5. Validación final y pruebas de regresión

## Archivos de referencia
- [README.md](README.md)
- [api/search.js](api/search.js)
- [script.js](script.js)
- [styles.css](styles.css)
- [.github/agents/nowar-maintainer.agent.md](.github/agents/nowar-maintainer.agent.md)

---

## Siguiente acción

Empezar por la sección 1 y luego continuar secuencialmente con la 2. Así reducen riesgos y se corrigen problemas reales antes de largarse a refactors visuales.
