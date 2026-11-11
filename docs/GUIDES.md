# Publicar guías de PuntosFieles

La sección vive en `/guias/`. El catálogo real empieza vacío: no se han publicado artículos. No usa una base de datos ni un CMS. El servidor carga `src/content/guides/manifest.json` al arrancar y valida su estructura con Zod.

## Comportamiento público

- Sin artículos publicados, `/guias/` muestra el estado vacío con enlaces útiles. Lleva `noindex, follow, noarchive` en HTML y cabecera y queda fuera del sitemap.
- Solo las entradas con `status: "published"` aparecen en la lista, en su ruta y en el sitemap. La primera publicación también hace indexable el índice `/guias/`.
- Los borradores y las rutas inexistentes responden 404. No se publican títulos ni contenido de borradores. No hay URL pública de vista previa.
- `/guias` redirige a `/guias/`; cada artículo usa `/guias/slug-en-espanol`, sin barra final.
- El host de la aplicación no publica las guías. La sección usa el origen de marketing configurado para sus canonical y metadatos.

## Esquema del catálogo

El documento tiene `version: 1` y `articles: []`. Cada entrada tiene:

| Campo | Uso |
| --- | --- |
| `status` | `draft` o `published`. No hay publicación programada por fecha. |
| `slug` | Único, de 1 a 120 caracteres: minúsculas `a-z`, números y guiones simples entre palabras. Escribir `como`, `fidelizacion` y `ninos`, sin tildes, ñ, espacios ni codificación URL. No cambiarlo después de publicar sin preparar una redirección. |
| `title` | Título real, entre 1 y 180 caracteres. |
| `description` | Resumen real, hasta 320 caracteres; obligatorio al publicar. |
| `body` | Lista de bloques; al menos uno al publicar. |
| `author` | Opcional: `{ "type": "Person" o "Organization", "name": nombre real, "url": URL HTTPS opcional }`. Solo incluir una autoría verificada. |
| `datePublished` | Opcional: fecha real `AAAA-MM-DD`. No se inventa automáticamente. |
| `dateModified` | Opcional: fecha de una revisión real; nunca anterior a `datePublished`. |

Los bloques admitidos son:

```json
{ "type": "heading", "text": "Encabezado de sección" }
{ "type": "paragraph", "text": "Texto del párrafo." }
{ "type": "list", "ordered": false, "items": ["Primer punto", "Segundo punto"] }
{ "type": "link", "text": "Consultar la fuente", "href": "https://example.com/fuente" }
```

Son ejemplos de formato, no contenido para publicar. `heading` produce un H2; el H1 viene del título. `ordered` es opcional. Los enlaces pueden ser HTTPS o rutas locales que empiecen por `/`, como `/guias/otra-guia` o `/#contacto`. El texto se escapa: HTML y Markdown no se interpretan. Así se evita introducir scripts o marcado accidental. Las fechas y la autoría que se proporcionen aparecen tanto en el artículo como en los datos estructurados `Article`.

## Preparar y previsualizar

1. Añadir una entrada real con `status: "draft"`. Puede empezar solo con `slug` y `title`; completar descripción y cuerpo antes de previsualizarla como artículo.
2. Verificar el catálogo:

   ```sh
   node --input-type=module -e "await import('./src/content/guides/catalog.js'); console.log('Catálogo válido')"
   ```

3. Iniciar la vista previa local del índice vacío o de las publicaciones existentes:

   ```sh
   node src/content/guides/preview.mjs
   ```

   Abrir `http://127.0.0.1:4280/guias/`. Para ver un borrador completo, pasar su slug:

   ```sh
   node src/content/guides/preview.mjs slug-del-borrador
   ```

   El proceso convierte esa entrada en publicada solo en memoria; no modifica el archivo. Usa `GUIDES_PREVIEW_PORT=4281` si el puerto está ocupado. La vista previa escucha únicamente en `127.0.0.1`, lleva cabecera noindex/noarchive y no necesita secretos ni acceso a la base de datos. No debe exponerse mediante un túnel público. Detener con Ctrl+C.

## Publicar

1. Revisar el texto, los hechos, las fuentes, la autoría, las fechas y los enlaces. Comprobar el diseño en móvil y escritorio.
2. Cambiar únicamente la entrada aprobada a `status: "published"`. La lista respeta el orden del catálogo.
3. Ejecutar `node --test tests/unit/guides.test.js tests/unit/public-search.test.js` y los controles habituales del repositorio. El test que mantiene vacío el catálogo es una protección inicial: al autorizar el primer artículo, actualizar esa expectativa explícitamente y conservar las pruebas de borradores, sitemap y metadatos.
4. Seguir el proceso normal de revisión y despliegue del sitio, con reinicio del servidor para cargar el catálogo. No hay publicación automática desde este documento ni cambios en las aplicaciones nativas.
5. Comprobar la ruta, canonical, respuesta 200, ausencia de noindex en las publicaciones y presencia en `/sitemap.xml`. El sitemap puede conservarse en caché hasta una hora. La inclusión en el sitemap no garantiza indexación ni posiciones en Google.

El montaje del servidor es `app.use(createGuides({ marketingOrigin: config.MARKETING_ORIGIN }))`, después de `createSearchVisibility` y antes del enrutamiento por host y archivos estáticos. Ambos componentes cargan el mismo catálogo. En fixtures se puede pasar `guides` a ambos; nunca se debe alimentar este parámetro desde una petición pública.
