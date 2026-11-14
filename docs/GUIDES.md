# Publicar guías de PuntosFieles

La sección vive en `/guias/`. No usa una base de datos ni un CMS. El servidor carga `src/content/guides/manifest.json` al arrancar y valida su estructura con Zod. Evalúa la fecha de publicación en cada petición; una guía programada se hace visible sin reiniciar el servidor ni modificar el catálogo cuando llega su hora.

## Comportamiento público

- `draft` permanece privado, incluso si sus fechas ya pasaron. Las rutas de borradores, artículos futuros y artículos inexistentes responden 404 con `noindex, follow, noarchive`, sin revelar título ni contenido. La variante con barra final también responde 404. No hay URL pública de vista previa.
- `scheduled` requiere un instante `publishAt` y una fecha `datePublished`. Aparece cuando el reloj del servidor alcanza ese instante, tanto en su ruta como en el índice y el sitemap. El estado sigue siendo `scheduled` después de publicarse: no necesita una tarea que lo cambie.
- `published` aparece inmediatamente si no tiene fechas futuras. Si incluye `publishAt`, se respeta ese instante; si solo incluye `datePublished`, se espera hasta que llegue esa fecha en Guatemala. Se conservan las publicaciones antiguas sin fechas, sin inventar una fecha para ellas.
- Sin artículos visibles, `/guias/` muestra un estado vacío útil, lleva `noindex, follow, noarchive` y queda fuera del sitemap. La primera publicación hace indexable el índice.
- `/guias` redirige a `/guias/`; cada artículo usa `/guias/slug-en-espanol`, sin barra final. Solo los artículos visibles obtienen redirección desde su variante con barra.
- El host de la aplicación y los hosts desconocidos no publican las guías. El origen de marketing configurado determina los enlaces canonical y del sitemap.
- Las respuestas de guías —incluidos índice, redirecciones y 404— y del sitemap llevan `Cache-Control: no-store`. El service worker del sitio debe excluir `/guias`, `/guias/*` y `/sitemap.xml`, tanto de almacenamiento como de recuperación de versiones anteriores. `robots.txt` puede conservarse durante una hora porque su enlace al sitemap no cambia con cada publicación.
- El sitemap incluye `lastmod` solo para artículos con una fecha real: `dateModified` si existe, o `datePublished`. No inventa fechas para páginas o artículos sin ellas.

## Esquema del catálogo

El documento tiene `version: 1` y `articles: []`. Cada entrada admite:

| Campo | Uso |
| --- | --- |
| `status` | `draft`, `published` o `scheduled`. |
| `slug` | Único, de 1 a 120 caracteres: minúsculas `a-z`, números y guiones simples entre palabras. Escribir `como`, `fidelizacion` y `ninos`, sin tildes, ñ, espacios ni codificación URL. No cambiarlo después de publicar sin preparar una redirección. |
| `title` | Título real, entre 1 y 180 caracteres. |
| `description` | Resumen real, hasta 320 caracteres; obligatorio para `published` y `scheduled`. |
| `body` | Lista de bloques; al menos uno para `published` y `scheduled`. |
| `author` | Opcional: `{ "type": "Person" o "Organization", "name": nombre real, "url": URL HTTPS opcional }`. Solo incluir una autoría verificada. |
| `publishAt` | Instante ISO 8601 con segundos y zona explícita: `2026-11-21T09:00:00-06:00` o `2026-11-21T15:00:00Z`. Obligatorio para `scheduled`. No se aceptan horas sin zona ni fechas inexistentes. |
| `datePublished` | Fecha real `AAAA-MM-DD`; obligatoria cuando hay `publishAt` y debe coincidir con su día en `America/Guatemala`. Aparece en la página y los datos estructurados. |
| `dateModified` | Opcional: fecha de una revisión real; nunca anterior a `datePublished`. Omitirla si no ha habido una revisión publicada. |
| `category` | Opcional: nombre de la sección editorial. |
| `hero` | Opcional: imagen de portada con `src`, `alt`, `width` y `height`; puede incluir `srcSmall` y `caption`. |
| `references` | Opcional en el esquema: lista de `{ "id", "citation", "apa", "href", "italic"? }`. `id` usa las reglas de slug y es único dentro del artículo; `citation` es la etiqueta de la cita; `apa` contiene la referencia completa; `href` debe ser HTTPS. `italic`, si existe, contiene los fragmentos de texto que requieren cursiva. La política editorial exige citas y referencias en todos los artículos. |
| `methodNote` | Opcional: lista de párrafos breves sobre métodos, alcance y límites de la evidencia. |
| `readingMinutes` | Opcional: estimación de lectura en minutos enteros positivos. |
| `artCredit` | Opcional: crédito o aclaración editorial ya aprobado para esa ilustración. No establece una política general de divulgación. |

Los bloques admitidos son:

```json
{ "type": "heading", "text": "Encabezado de sección" }
{ "type": "paragraph", "text": "Texto del párrafo." }
{ "type": "list", "ordered": false, "items": ["Primer punto", "Segundo punto"] }
{ "type": "link", "text": "Consultar la fuente", "href": "https://example.com/fuente" }
{ "type": "figure", "src": "/images/articles/escena.webp", "alt": "Descripción concreta de la escena.", "width": 1536, "height": 1024, "caption": "Pie de ilustración opcional." }
{ "type": "callout", "text": "Una idea que conviene recordar.", "note": "Una precisión opcional." }
```

Son ejemplos de formato, no contenido para publicar. `heading` produce un H2; el H1 viene del título. `ordered`, `caption`, `srcSmall` y `note` son opcionales. Portadas y figuras aceptan únicamente archivos WebP o PNG bajo `/images/articles/`, sin rutas externas, consultas ni segmentos de navegación. Las dimensiones deben ser enteros positivos y el texto alternativo no puede estar vacío.

Los enlaces de bloque pueden ser HTTPS o rutas locales que empiecen por `/`, como `/guias/otra-guia` o `/#contacto`. Todo el texto se escapa: HTML y Markdown no se interpretan, y no existen bloques de HTML libre. Las referencias usan texto, con formato controlado por el renderer. Verificar los pasajes originales y los metadatos de cada fuente, las citas autor–fecha en el texto y su correspondencia con la lista APA antes de aprobar un artículo.

## Calendario aprobado

La primera guía ya está publicada. Las cinco siguientes salen los sábados a horas diurnas distintas, elegidas al azar una sola vez y guardadas en el catálogo. La zona es **`America/Guatemala` (UTC−06:00)**. Las horas no vuelven a sortearse al reiniciar ni al recibir una petición.

| Fecha local | `publishAt` | Equivalente UTC |
| --- | --- | --- |
| 2026-11-21 | `2026-11-21T17:11:00-06:00` | `2026-11-21T23:11:00Z` |
| 2026-11-28 | `2026-11-28T10:48:00-06:00` | `2026-11-28T16:48:00Z` |
| 2026-12-05 | `2026-12-05T14:03:00-06:00` | `2026-12-05T20:03:00Z` |
| 2026-12-12 | `2026-12-12T11:50:00-06:00` | `2026-12-12T17:50:00Z` |
| 2026-12-19 | `2026-12-19T12:39:00-06:00` | `2026-12-19T18:39:00Z` |

El catálogo y las imágenes deben estar desplegados antes del primer vencimiento. El reloj del servidor debe mantenerse sincronizado. No hace falta cron, un servicio externo, una petición de activación ni una nueva compilación cada semana. Si el servidor está detenido al vencer una fecha, la guía estará disponible en la primera petición después de volver a funcionar; conserva la fecha programada en sus metadatos.

Para cancelar una publicación, cambiar la entrada a `draft` y desplegar el catálogo actualizado antes del vencimiento. El estado `draft` prevalece sobre cualquier fecha conservada. Para reprogramarla, cambiar `publishAt` y `datePublished` juntos, revisar las fechas y desplegar. Editar el archivo en disco sin recargar el proceso no cambia el catálogo que ya está en memoria.

## Preparar y previsualizar

1. Añadir una entrada real con `status: "draft"`. Puede empezar solo con `slug` y `title`; completar descripción y cuerpo antes de previsualizarla como artículo.
2. Verificar el catálogo:

   ```sh
   node --input-type=module -e "await import('./src/content/guides/catalog.js'); console.log('Catálogo válido')"
   ```

3. Iniciar la vista previa local de las publicaciones disponibles:

   ```sh
   node src/content/guides/preview.mjs
   ```

   Abrir `http://127.0.0.1:4280/guias/`. Para ver un borrador completo o una guía programada, pasar su slug:

   ```sh
   node src/content/guides/preview.mjs slug-del-articulo
   ```

   El proceso convierte esa entrada en publicada solo en memoria. Si su fecha es futura, simula su momento de publicación para conservar los metadatos de la vista previa; el índice local puede mostrar otras publicaciones que estén disponibles en ese momento. No modifica el archivo. Usa `GUIDES_PREVIEW_PORT=4281` si el puerto está ocupado. La vista previa escucha únicamente en `127.0.0.1`, lleva cabecera noindex/noarchive y no necesita secretos ni acceso a la base de datos. No debe exponerse mediante un túnel público. Detener con Ctrl+C.

## Publicar y comprobar

1. Revisar texto, hechos, fuentes, autoría, fechas, referencias, ilustraciones y enlaces. Comprobar el diseño en móvil y escritorio.
2. Usar `published` para la publicación inicial aprobada y `scheduled` con las fechas aprobadas para las siguientes. El índice muestra primero las publicaciones más recientes.
3. Ejecutar `node --test tests/unit/guides.test.js tests/unit/guides-schedule.test.js tests/unit/public-search.test.js` y los controles habituales del repositorio.
4. Seguir el proceso normal de revisión y despliegue del sitio, con reinicio del servidor para cargar el nuevo catálogo. Las fechas posteriores se cumplen sin más reinicios. No se modifican ni publican aplicaciones nativas.
5. Comprobar la ruta inicial, canonical, respuesta 200, ausencia de noindex y presencia en `/sitemap.xml`. Comprobar 404 y ausencia de títulos de las guías futuras. La inclusión en el sitemap no garantiza indexación ni posiciones en Google.

El montaje del servidor es `app.use(createGuides({ marketingOrigin: config.MARKETING_ORIGIN }))`, después de `createSearchVisibility` y antes del enrutamiento por host y archivos estáticos. Ambos componentes validan el mismo catálogo y consultan la hora en cada petición. En fixtures se puede pasar `guides` y una función `now` a ambos; los ayudantes `getPublishedGuides(guides, now)` y `getGuideSearchPaths(guides, now)` también admiten ese reloj. Nunca se deben alimentar estos parámetros desde una petición pública.
