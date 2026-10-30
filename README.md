# Nowarfy · YouToo

Biblioteca audiovisual de rock, metal, videos, música y canales públicos. PWA instalable construida como sitio estático (HTML/CSS/JS) con funciones serverless en Vercel para búsqueda, reservas y letras de canciones.

🔗 **Sitio en producción:** https://nowar-rose.vercel.app

## Stack

- **Frontend:** HTML + CSS + JavaScript vanilla (sin build step), PWA con Service Worker (`sw.js`) y manifest instalable.
- **Backend:** funciones serverless de Vercel en `/api` (Node.js).
- **Base de datos / auth:** Supabase (Postgres + autenticación de usuarios).
- **Fuentes de contenido:** YouTube Data API, Openverse, Jamendo.
- **Hosting:** Vercel.

## Estructura del proyecto

```
├── api/
│   ├── auth-config.js      # Config pública de Supabase para el cliente
│   ├── search.js           # Búsqueda de videos/canales/playlists (YouTube + Openverse)
│   ├── reserve.js          # Guarda resultados de búsqueda como "reserva" en Supabase
│   ├── cleanup-reserve.js  # Cron job diario: limpia reservas viejas
│   └── lyrics.js           # Búsqueda y scoring de letras de canciones
├── assets/                 # Iconos, logo, sonidos, QR
├── index.html               # Punto de entrada del sitio
├── script.js                 # Lógica del frontend
├── styles.css                 # Estilos
├── sw.js                    # Service Worker (cache del app shell)
├── manifest.webmanifest    # Manifest de la PWA
├── vercel.json              # Config de despliegue, rewrites y cron
└── verify_search_flow.py    # Script de verificación del flujo de búsqueda (no productivo)
```

## Variables de entorno

Configurar en **Vercel → Project Settings → Environment Variables** (ver `.env.example`):

| Variable | Uso |
|---|---|
| `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto de Supabase |
| `SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave anónima (pública) de Supabase, usada por el cliente |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave de servicio de Supabase (solo backend, nunca exponer al cliente) |
| `YOUTUBE_API_KEY` | Clave de YouTube Data API v3 |
| `OPENVERSE_CLIENT_ID` / `OPENVERSE_CLIENT_SECRET` | Credenciales opcionales de Openverse (funciona sin ellas, con límite público) |
| `JAMENDO_CLIENT_ID` | Cliente de la API de Jamendo |
| `CRON_SECRET` | Secreto para autenticar el cron de limpieza de reservas (`/api/cleanup-reserve`) |

Ninguna clave va hardcodeada en el código: todo se lee desde `process.env` en las funciones de `/api`, y el cliente recibe solo lo público a través de `auth-config.js`.

## Desarrollo local

Al no tener build step, alcanza con servir los archivos estáticos y, si se necesita probar `/api`, usar la CLI de Vercel:

```bash
npm i -g vercel
vercel dev
```

Esto levanta tanto el sitio estático como las funciones serverless con las variables de entorno definidas en un `.env.local` (ver `.env.example`).

## Sincronización entre dispositivos

El modo remoto usa un modelo de **un reproductor y N controles** (tipo Spotify Connect):

| Tabla (Supabase, no versionada en este repo) | Uso |
|---|---|
| `youtoo_remote_sessions` | Una fila por usuario. `active_device_id` es el único reproductor; `state` guarda canción, cola, volumen y posición. |
| `youtoo_remote_devices` | Dispositivos vistos en los últimos 25 s. `last_seen_at` se actualiza cada 3 s. |
| `youtoo_remote_commands` | Comandos (`toggle`, `next`, `seekPercent`, `handoff`…) cuando el broadcast no alcanza. |

Transporte: `BroadcastChannel` para pestañas del mismo navegador y Supabase Realtime para dispositivos distintos; si ninguno confirma, el comando se inserta en la tabla. El reproductor publica su estado cada 3 s con `position` + `positionAt`, así los controles calculan el progreso sin depender de su propio reloj.

Los controles **no reproducen audio por defecto**: solo reflejan el estado. Para que un dispositivo reproduzca hay que elegirlo en *Cuenta → Elegir dispositivo de reproducción* o desde el acceso flotante de dispositivos (ver abajo), y el navegador puede exigir una interacción previa en ese dispositivo (política de autoplay). Si la exige, aparece el aviso **Desbloquear audio** en el equipo que recibió la reproducción; un toque alcanza y el control remoto sigue funcionando.

### Acceso flotante y sonido en ambos equipos

Después de elegir un dispositivo queda un botón flotante (abajo a la derecha, sobre la barra del reproductor) con el nombre del equipo activo. Desde ahí se puede volver a cambiar de dispositivo sin pasar por *Cuenta*.

El botón **Sonar también acá** (solo en los controles, no en el reproductor principal) activa una copia local opt-in: ese equipo reproduce la misma pista, pausa y posición que el reproductor principal. La sincronización es aproximada (se corrige si la deriva supera ~3,5 s y depende del estado que llega cada 3 s), no es audio sincronizado muestra a muestra. La preferencia se guarda por dispositivo en `nowarfy_mirror_playback_v1`. El equipo espejo no publica estado para no pisar al reproductor principal.

### Diagnóstico de sincronización

En *Cuenta* hay un panel colapsable (solo visible con sesión iniciada) que muestra en vivo: rol, IDs cortos de dispositivo y sesión, versión del estado, estado de Realtime y `BroadcastChannel`, posición recibida/publicada, cola, último comando y un log de los últimos 6 eventos. Sirve para ver el protocolo funcionando al cambiar de dispositivo; no modifica nada. El botón **Copiar diagnóstico** genera un texto listo para pegar en un issue.

## Ecualizador

La vista clásica (`modules/classic.js`) tiene un EQ de 10 bandas. Solo puede procesar **audio del mismo documento**, así que:

- **Funciona** en pistas de audio directo (Openverse/Freesound, Jamendo, Commons) y en videos libres de Wikimedia Commons, siempre que el servidor responda con CORS. Antes de conectar un medio se hace una prueba `fetch` en modo CORS; si falla, la pista se reproduce sin EQ y se avisa en el panel.
- **No funciona con YouTube**: el reproductor vive en un iframe de otro origen y la IFrame API no expone su audio. No hay forma de ecualizarlo desde la página.
- **Puente de audio**: con una pista de YouTube en reproducción, el botón *Buscar versión de audio del mismo tema* busca el mismo título en Openverse y Jamendo, elige el candidato con mejor coincidencia de título/artista/duración, verifica CORS y reemplaza la entrada de la cola para que el EQ sí se aplique.

El ecualizador y el crossfade son excluyentes: mientras el EQ está activo se desactiva el crossfade para no rutear dos elementos a la vez.

## Despliegue

El repo está conectado a Vercel. Cada push a `main` dispara un deploy automático según `vercel.json` (sin build command, `outputDirectory` es la raíz del repo).

## Cron jobs

- `/api/cleanup-reserve` corre todos los días a las 03:17 (UTC) para limpiar reservas expiradas en Supabase (definido en `vercel.json`).

## Licencia

Todos los derechos reservados. Ver [LICENSE](./LICENSE).
