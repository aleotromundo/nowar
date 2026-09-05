# Propuesta de mejora – Nowarfy · YouToo

## Resumen de los requerimientos y diagnóstico
Se trabajó sobre la aplicación web **Nowarfy · YouToo**, un reproductor de video y audio inspirado en YouTube y Spotify. El objetivo era modernizar la interfaz, mejorar la experiencia de usuario y añadir funcionalidades de control y descubrimiento basadas en las mejores prácticas de las plataformas líderes.

**Diagnóstico de mejora**
- La interfaz original mostraba el video y la lista de sugerencias en secciones estáticas, lo que obligaba al usuario a alejarse del reproductor para ver la cola.
- Los botones de acción (favorito, compartir, descargar, letras) estaban dispersos y no siempre accesibles con una mano.
- Falta de mecanismos de retroalimentación explícita para afinar recomendaciones (como “No me gusta” o ocultar contenido).
- La cola de reproducción carecía de controles avanzados (shuffle inteligente, temporizador de sueño, etc.).
- No había opción de tema claro/oscuro ni personalización visual.

## Tres mejoras estrella implementadas
1. **Vista dividida con splitter arrastrable**  
   Se creó un contenedor dividido que permite al usuario ajustar el espacio entre el video‑stage y la lista de sugerencias/cola, siguiendo el patrón de YouTube Music (dual‑pane). Esto brinda acceso instantáneo a la cola sin abandonar la reproducción.

2. **Carrusel de acciones bajo la barra de progreso**  
   Los botones de Favorito, Compartir por WhatsApp, Copiar enlace, Descargar audio y Letra se agrupan como iconos únicamente justo debajo de la barra de progreso, facilitando el uso con el pulgar y manteniendo la interfaz limpia.

3. **Controles de recomendación y cola avanzados**  
   - Botón “No me gusta” (pulgar abajo) para enviar señal negativa inmediata.  
   - Opción “Ocultar de esta lista” en el menú de tres puntos de cada tarjeta y fila de cola.  
   - Filtros inteligentes por estado de ánimo, actividad y género (inspirados en Smart Filters de Spotify).  
   - Cola con shuffle inteligente, repetir, temporizador de sueño y switch claro de Autoplay.  
   - Experimento de DJ por voz (Web Speech API) para ajustar la lista de sugerencias mediante comandos de voz.

## Precios del kit (según tabla de decisión del Kit Desarrollo Web Libre)
- **Landing simple**: desde 500 €  
- **Sitio completo**: desde 1 500 €  
- **Mantenimiento mensual**: 79 €/mes (incluye actualizaciones menores, soporte y mejoras continuas)

*Nota*: El trabajo realizado corresponde a una mejora de sitio existente; el valor aproximado estaría dentro del rango de **sitio completo**, considerando las funcionalidades añadidas y el esfuerzo de diagnóstico, diseño, construcción y empaquetado.

## Firma
- **Nombre**: Tu Nombre  
- **Contacto**: tu.email@example.com  
- **Fecha**: 2026-09-05

---  
*Esta propuesta se basa en los rangos de precios indicados en el Kit Desarrollo Web Libre y en el esfuerzo estimado para entregar los archivos requerimientos.json, diseno.md, index.html (mejorado) y sitio.zip listo para publicar.*