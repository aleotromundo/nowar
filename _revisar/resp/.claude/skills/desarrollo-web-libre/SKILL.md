---
name: desarrollo-web-libre
description: Ayuda al usuario a entender sus necesidades, diseñar, construir y empaquetar un sitio web (landing o sitio completo) basado en una descripción o referencia de referencia, entregando sitio nuevo + diagnóstico de mejora + propuesta comercial + zip listo para publicar. Usa esta skill siempre que el usuario diga "crear sitio", "diseñar web", "mejorar sitio", o pase una descripción/URL de referencia.
---

# Desarrollo Web Libre

Recibes una descripción de lo que el usuario necesita (por ejemplo: "una landing para mi café", "una web completa para mi tienda de ropa", o una URL de referencia). Entregas, en `sitios/[nombre]/`:

- `requerimientos.json` – resumen de lo que el usuario quiere (negocio, objetivo, audiencia, funcionalidades, colores, tipografías, contenido clave)
- `diseno.md` – boceto de estructura, paleta de colores, tipografías y notas de UX/UI
- `index.html` (y opcionalmente otras páginas) – sitio construido, responsive, con CSS y JS inline o en archivos separados (motion-kit opcional)
- `sitio.zip` – lista para publicar (HTML, CSS, JS, assets)
- `propuesta.md` – documento para presentar al cliente con diagnóstico, mejoras y precios

Trabaja SOLO con sitios públicos de referencia o con autorización explícita. Si el usuario intenta pasarte código privado o datos sin permiso, recuérdale la regla de seguridad del kit y para.

**Dos reglas de supervivencia** (una sesión de desarrollo puede cortarse):
- **Contexto ligero**: NO leas PDFs/PPTX/archivos pesados enteros — extrae solo lo necesario (textos, colores, imágenes de bajo peso).
- **Escribe cada entregable EN CUANTO lo tengas** (no acumules trabajo en memoria). Si la sesión se corta, lo escrito queda — y al reanudar ("continúa el sitio donde lo dejaste") retomas por el primer archivo que falte.

## Fase 1 · Reconocimiento y requerimientos

1. Entender la necesidad: pregunta al usuario (o usa la descripción provista) para obtener:
   - Nombre del negocio o proyecto
   - Objetivo del sitio (información, venta, reservas, portafolio…)
   - Audiencia objetivo
   - Funcionalidades clave (formulario, galería, menú, tienda, blog…)
   - Contenido que ya tiene (textos, imágenes, logos) – si los proporciona, guárdalos en `original/`
   - Referencias de estilo (URLs de sitios que le gustan, o palabras como "moderno", "elegante", "juguetón")
2. Si se proporciona una URL de referencia y tiene permiso para usarla, descarga el HTML (igual que en cazador) a `original/referencia.html` para extraer estructura y estilos, pero NO copiar contenido sin permiso.
3. Extrae el branding real si se proporciona logo o colores: guárdalos en `original/` y anótalos en `requerimientos.json`.
4. Formato de `requerimientos.json`:
```json
{
  "negocio": "",
  "objetivo": "",
  "audiencia": "",
  "funcionalidades": [],
  "contenido": {
    "textos": [],
    "imagenes": [],
    "logo": ""
  },
  "branding": {
    "colores": { "primario": "", "secundario": "", "fondo": "", "texto": "" },
    "tipografias": { "titulos": "", "cuerpo": "" }
  },
  "referencias": []
}
```
Todo lo que se acuerde aquí será la base para el diseño y la construcción.

## Fase 2 · Diseño (`diseno.md`)

Entrega un documento breve que incluya:
- Esquema de estructura (qué secciones tendrá el sitio y en qué orden)
- Paleta de colores propuesta (en hex) y tipografías (Google Fonts o similares)
- Notas de experiencia de usuario: navegabilidad, llamados a acción, legibilidad
- Si corresponde, boceto wireframe en formato ASCII o descripción de bloques.

## Fase 3 · Construcción (`index.html` y assets)

- Crea un sitio responsive de una o varias páginas según lo acordado.
- Usa HTML semántico, CSS moderno (flexbox/grid) y, si deseas animaciones simples, puedes copiar `motion-kit/motion.css` y `motion-kit/motion.js` (opcional) y referenciarlos.
- Guarda cualquier imagen o logo usado en una carpeta `assets/` y referencia con rutas relativas (`assets/...`).
- Asegúrate de incluir `<meta name="viewport">`, `<title>` descriptivo y enlaces funcionales (mailto:, tel:, etc.).
- Si el sitio tiene más de una página, crea los archivos necesarios (por ejemplo `about.html`, `gallery.html`) y mantén una navegación coherente.

## Fase 4 · Empaquetado (`sitio.zip`)

Antes de empaquetar, verifica que el sitio funciona localmente (abre `index.html` en el navegador y checa que no haya enlaces rotos).

Crea un zip con TODO lo necesario para publicar: el/los HTML, CSS, JS y la carpeta `assets/`. NO incluyas la carpeta `original/` ni los archivos `.md` o `.json` de trabajo.

Usa el comando de empaquetado indicado en `.claude/setup-completado.json` (dejado por `/setup`). Si no existe, usa una alternativa portable (por ejemplo, PowerShell `Compress-Archive` o `tar -a -cf` o Python zipfile).

Verifica que el zip comienza con los bytes `PK`.

## Fase 5 · Propuesta (`propuesta.md`)

Rellena la plantilla `plantilla-propuesta.md` (en la raíz del kit) con:
- Resumen de los requerimientos y diagnóstico de mejora (si se mejoró un sitio existente)
- 3 mejoras estrella del sitio construido
- Precios del kit (según rangos de la tabla de decisión)
- Firma con nombre y contacto del usuario (tomados de `setup-completado.json`).

## Al entregar

Resume en 5 líneas: qué entendiste que necesitabas, qué diseñaste y construiste, dónde está cada archivo, cuánto ha costado la sesión aproximadamente y el siguiente paso (revisión con el cliente o publicación).