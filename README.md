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

## Despliegue

El repo está conectado a Vercel. Cada push a `main` dispara un deploy automático según `vercel.json` (sin build command, `outputDirectory` es la raíz del repo).

## Cron jobs

- `/api/cleanup-reserve` corre todos los días a las 03:17 (UTC) para limpiar reservas expiradas en Supabase (definido en `vercel.json`).

## Licencia

Todos los derechos reservados. Ver [LICENSE](./LICENSE).
