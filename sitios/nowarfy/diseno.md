# Diseño de Nowarfy · YouToo (versión mejorada)

## Estructura del sitio

1. **Barra lateral (Sidebar)**
   - Logo y marca
   - Botones de menú, cuenta y QR
   - Grupos de navegación:
     - Descubrir (Inicio, Explorar, Canales, Listas, Videos, Música)
     - Tu biblioteca (Favoritos, Historial)
     - Tu experiencia (Playlist, Reproductor, Tus datos)

2. **Área de contenido**
   - Barra de búsqueda fija en la parte superior
   - Rail de categorías de descubrimiento (taste‑chips)
   - Sección principal de video/reproductor (video‑stage) con:
     - Marco de video / fallback de YouTube
     - Información del video (título, artista, descripción, letras)
     - Acciones de video (canal, ocultar video)
   - Lista de sugerencias de videos (video‑suggestions) que se muestra/oculta mediante una barra deslizable (vista dividida)

3. **Reproductor fijo en la parte inferior (player‑bar)**
   - Portada del álbum / pista actual
   - Información de pista (título, artista) y botón de favorito
   - Controles de reproducción (anterior, play/pause, siguiente, cola, reproducción continua)
   - Barra de progreso con tiempo transcurrido / total
   - Controles de utilidad (aleatorio, volumen, compartir WhatsApp, copiar enlace, descargar, modo flotante, picture‑in‑picture)

4. **Paneles emergentes**
   - Modal de autenticación (inicio de sesión / registro)
   - Modal de código QR
   - Panel de cola de reproducción (deslizable desde la derecha)
   - Notificaciones tipo toast

## Paleta de colores (extraída del CSS)

| Variable | Hex | Uso |
|----------|-----|-----|
| --accent | `#a78bfa` | Primario (botones activos, enlaces, acentos) |
| --accent-hover | `#c4b5fd` | Estado hover de acentos |
| --accent-2 | `#5eead4` | Secundario (iconos, detalles) |
| --bg-black | `#0a0a12` | Fondo general (modo YouToo) |
| --bg-dark | `#0f1020` | Fondo de áreas de contenido |
| --bg-card | `#17182b` | Tarjetas, fondos de paneles |
| --bg-hover | `#22233b` | Hover de tarjetas y elementos interactivos |
| --text-white | `#ffffff` | Texto principal |
| --text-gray | var(--text-gray, `#b3b3b3`) | Texto secundario, placeholders |
| --border-soft | `rgba(190,188,255,.13)` | Bordes sutiles de tarjetas y secciones |

## Tipografías

- **Títulos**: `Sora` (Google Fonts) – pesos 600, 700, 800
- **Cuerpo**: `Manrope` (Google Fonts) – pesos 400, 500, 600, 700, 800

Ambas se cargan mediante `<link>` en el `<head>`.

## Notas de experiencia de usuario (UX/UI)

- **Vista dividida**: una barra arrastrable entre el video‑stage y la lista de sugerencias permite alternar rápidamente entre ver el video y explorar la cola/up‑next sin perder el contexto de reproducción.
- **Carrusel de acciones**: los botones principales de reproducción (Me gusta, Compartir, Descargar, Letras) se sitúan como iconos únicamente justo debajo de la barra de progreso, siguiendo el patrón de YouTube Music, logrando acceso con el pulgar y una interfaz menos cargada.
- **Letras en el carrusel**: el botón de letras se integra al carrusel, haciendo que la letra sea toggleable sin salir del flujo de reproducción.
- **Barra de progreso mejorada**: aumento de grosor y cambio de color al arrastrar (scrubbing) para retroalimentación visual clara.
- **Filtros inteligentes**: se añadirá un pequeño panel de filtros sobre la búsqueda (o en el menú de descubrír) para ordenar por estado de ánimo, actividad o género, inspirado en los Smart Filters de Spotify.
- **Ocultar / No mostrar nuevamente**: cada tarjeta de video y fila de la cola tendrá un menú de tres puntos con la opción “Ocultar de esta lista”, que envía una señal negativa al algoritmo de recomendaciones.
- **Botón “No me gusta” (pulgar abajo)**: colocado encima o al lado de la barra de progreso para dar feedback negativo inmediato mientras suena la pista.
- **Control de cola avanzado**: incluir shuffle inteligente, repetir, temporizador de sueño y switch claro de Autoplay.
- **Modo DJ por voz (experimental)**: al mantener pulsado un ícono de micrófono, el usuario podrá decir un estado de ánimo (más energía, más relajado, etc.) y la lista de sugerencias se reordenará en tiempo real usando la Web Speech API.
- **Tema claro/oscuro**: se proveerá un selector de tema que altere las variables `--bg-*` y `--text-*`, permitiendo al usuario elegir según preferencia o selon el modo del sistema.
- **Accesibilidad**: todos los controles tendrán `aria-label` descriptivos, suficiente contraste de colores (verificado con WCAG AA) y navegabilidad completa mediante teclado (Tab/Enter/Space).
- **Renderizado diferido (lazy loading)**: imágenes de miniaturas y iframes de video se cargarán únicamente cuando se acerquen al viewport, mejorando el tiempo de carga inicial.
- **PWA optimizada**: el manifest ya existe; se añadirá un service worker básico para cachear assets críticos y permitir instalación desde el navegador como app progresiva.
- **Feedback visual**: toast o animación sutil al compartir, descargar o marcar como favorito para confirmar la acción.

## Próximos pasos

1. Implementar la vista dividida y el carrusel de acciones en `index.html` y `styles.css`.
2. Añadir los filtros inteligentes, acciones de ocultar y botón “No me gusta”.
3. Mejorar la cola con los nuevos controles y el modo DJ por voz.
4. Generar el ZIP de distribución y la propuesta comercial.