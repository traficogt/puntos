# PuntosFieles: auditoría SEO

Fecha: 2026-11-12. Alcance: auditoría de la portada de https://puntosfieles.com/ y comprobación de todas las rutas públicas de su sitemap, metadatos, contenido rastreable, imágenes, enlaces, datos estructurados y controles de indexación. Se revisaron además alias públicos y una pantalla de tarjeta en el dominio de aplicación. Los archivos `*-before*` documentan producción antes de los cambios; `*-after-local*` y `verification.json` documentan la versión local, todavía pendiente de integración/despliegue desde esta tarea.

## A. Resumen

**Valoración: buena base técnica, con mejoras puntuales.** Las cinco páginas del sitemap responden 200 con su canonical propio y sin bloqueo de indexación. La portada ofrece texto HTML suficiente para explicar el servicio y sus límites, soporte real y enlaces funcionales. No se detectó un bloqueo de indexación en el dominio principal.

**Puntuación global: datos insuficientes.** No se asigna un número de SEO ni de rendimiento: falta Search Console y la API PageSpeed limitó la consulta por cuota. La confianza es alta para los elementos HTTP/HTML observados y baja para rankings, tráfico y Core Web Vitals, que no se han medido.

Hallazgos principales:

1. `/precios` tenía título poco específico y carecía de imagen y otros metadatos sociales. Corregido localmente.
2. `www.puntosfieles.com` no resolvió; el resolver público devolvió una consulta A sin respuesta. Pendiente de DNS/TLS/redirección. El dominio principal funciona.
3. La captación editorial y la medición orgánica todavía no pueden evaluarse: no hay guías publicadas y no se consultó Search Console. Esto no prueba un problema de ranking.

Oportunidades concretas:

1. Publicar los metadatos de planes ya preparados y comprobar la respuesta pública.
2. Mantener una descripción coherente de marca, servicio y soporte mediante los datos estructurados preparados, todos basados en contenido existente.
3. Desarrollar guías basadas en experiencia propia y medir su descubrimiento con Search Console.

## B. Hallazgos verificados

Los hallazgos se revisaron manualmente y se pasaron por `finding_verifier.py`: 11 entradas, 11 conservadas, ninguna duplicada. El verificador deduplica; no sustituye la evidencia ni la revisión humana. Los resultados completos, incluido el impacto de cada hallazgo, están en [verified-findings.json](evidence/verified-findings.json).

| Área | Severidad | Confianza | Hallazgo | Evidencia | Corrección |
|---|---|---|---|---|---|
| Metadatos de planes | Warning | Confirmed | La página de planes tiene un título genérico y metadatos sociales incompletos. | precios-before.html: título «Planes para tu negocio · PuntosFieles»; og:image, og:site_name, og:locale y twitter:image ausentes. social-plans.json lo confirma. | Aplicado localmente: título específico de planes de lealtad, descripción consistente y metadatos completos, reutilizando la imagen existente. |
| Cobertura de dominio | Warning | Confirmed | La variante www no resuelve durante la auditoría. | verification.json: www falla en getaddrinfo; www-dns.json: consulta pública A devuelve NOERROR sin Answer. El dominio principal responde 200. | Pendiente de infraestructura: habilitar DNS/TLS de www y redirigir permanentemente a https://puntosfieles.com conservando ruta y parámetros. |
| Datos estructurados | Info | Confirmed | Los datos existentes identifican la marca y el sitio, pero no conectan el servicio y las páginas de planes y ayuda. | home-before-parse.json contiene Organization y WebSite; precios-before.html y soporte-before.html no contienen JSON-LD. | Aplicado localmente: WebPage y Service en portada, WebPage en planes y ContactPage en soporte, relacionados con los mismos @id. |
| Contenido | Info | Confirmed | La biblioteca de guías aún no tiene artículos publicados. | src/content/guides/manifest.json tiene articles: []; /guias/ muestra el estado vacío y noindex, follow, noarchive. | Crear posteriormente guías basadas en procedimientos y experiencia reales, con autoría y fechas verificables. Mantener noindex mientras esté vacía. |
| Core Web Vitals | Info | Hypothesis | No hay una medición utilizable de Core Web Vitals en esta auditoría. | pagespeed-mobile.json: API de Google limitada por cuota; performance_score es null. | Medir con PageSpeed/Search Console o Lighthouse autorizado; no atribuir puntuación ni afirmar una mejora de velocidad. |
| AI y robots | Info | Confirmed | No existe llms.txt, sin que ello constituya un requisito de Google Search. | llms.json devuelve 404; Google Search Central indica que no hacen falta archivos o marcado especiales para sus funciones de IA. robots.txt permite búsqueda y bloquea varios crawlers de entrenamiento mediante Cloudflare. | Conservar la política existente y priorizar contenido HTML útil, enlaces, metadatos e indexabilidad. |
| Rastreo y sitemap | Pass | Confirmed | Las cinco URLs del sitemap son públicas, canónicas y accesibles. | public-routes-before.json: /, /soporte, /privacidad, /terminos y /precios responden 200, canonical propio y sin noindex. robots.txt declara sitemap.xml. | Conservar y comprobar después del despliegue. |
| Privacidad de indexación | Pass | Confirmed | Las pantallas de aplicación conservan noindex y las guías vacías quedan fuera del sitemap. | /customer.html redirige al host app; /mi-tarjeta/ devuelve X-Robots-Tag: noindex, nofollow. /guias/ conserva noindex. | Conservar la separación de hosts y sus pruebas existentes. |
| Enlaces | Pass | Confirmed | No se detectan enlaces rotos en la portada. | broken-links.json: 9 comprobados, 0 rotos, 0 timeouts; la demo redirige al host de aplicación y termina en 200. /precios está enlazada en la navegación. | Conservar enlaces; no añadir enlaces artificiales para cumplir cuotas del recolector. |
| Imágenes y texto | Pass | Confirmed | La portada entrega su contenido principal en HTML e imagen hero dimensionada y ligera. | home-before.html: un H1, texto visible en HTML, hero WebP 1000×667 con alt y fetchpriority=high; recurso público pesa 84.348 bytes. | Conservar diseño, fuentes, dimensiones y alt. |
| Canonicalización | Pass | Confirmed | HTTP y los alias HTML auditados llegan a las URLs canónicas. | verification.json confirma http→https; public-routes-before.json confirma /index.html→/ y /precios.html→/precios. | Conservar redirecciones y cubrir la variante www cuando se configure. |

### Cambios preparados

- `public/precios.html`: título «Planes de programas de lealtad | PuntosFieles», descripción específica consistente entre HTML, Open Graph, Twitter y JSON-LD; imagen existente con dimensiones y texto alternativo; `max-image-preview:large`; relación con la entidad del servicio y el sitio. La comparación de planes sigue viniendo del catálogo del servidor; no se introducen precios provisionales ni ofertas inventadas.
- `public/index.html`: descripción y nombre alternativo de la organización; entidades `WebPage` y `Service` enlazadas con los identificadores existentes. La información procede de la tarjeta, puntos, recompensas, sucursales y accesos ya descritos en el contenido.
- `public/soporte.html`: `ContactPage` asociada a la organización y al sitio, usando el título, descripción y contacto ya publicados.

Estos cambios describen mejor las páginas; no garantizan que Google cambie títulos, snippets, ranking o resultados enriquecidos. `Service`, `WebPage` y `ContactPage` se usan como descripción semántica, sin prometer una función especial de Search. Se conservaron los cuerpos de página byte por byte, los estilos, las fuentes, las URLs canónicas, el catálogo de precios y las APIs.

### Evidencia de las comprobaciones

- [Rutas públicas](evidence/public-routes-before.json) y [sitemap](evidence/sitemap.xml): `/`, `/soporte`, `/privacidad`, `/terminos`, `/precios`; canonical propio, HTTP 200. La biblioteca vacía `/guias/` mantiene `noindex` y no aparece en el sitemap.
- [Enlaces](evidence/broken-links.json): nueve enlaces distintos comprobados en portada; ocho llegan sin redirección y uno —la demo— redirige al host de aplicación; ninguno roto ni con timeout.
- [Portada parseada](evidence/home-before-parse.json): un H1, metadatos completos, contenido disponible en HTML; imagen WebP 1000×667 con dimensiones, alt y prioridad. El recurso público pesa 84.348 bytes. Las fuentes están alojadas localmente y conservan `font-display: swap`; no se cambiaron.
- [Robots de producción](evidence/robots.txt): búsqueda permitida y sitemap declarado, con política adicional de Cloudflare para varios crawlers de entrenamiento. No se alteró esa política.
- [Verificación local](evidence/verification.json): metadatos y esquemas analizados; cuerpos idénticos a `HEAD`; imagen social y logo responden 200; HTTP redirige al dominio HTTPS principal.
- Tests ejecutados: `NODE_ENV=test node --test tests/unit/public-search.test.js tests/unit/public-plans.test.js tests/unit/landing-page-contract.test.js tests/unit/guides.test.js`. **18 aprobados, 0 fallidos.** Cubren sitemap, hosts privados, aliases, renderizado del catálogo y reglas de publicación de guías. `git diff --check` sin errores.

## C. Plan priorizado

El [ACTION-PLAN.md](ACTION-PLAN.md) separa lo implementado de lo pendiente: desplegar y verificar los tres HTML, cubrir la variante www, revisar Search Console, medir rendimiento y preparar contenido editorial basado en evidencia propia. Ninguna publicación ni cambio de infraestructura se realizó desde esta subtarea.

## D. Desconocidos, límites del entorno y falsos positivos

- **Core Web Vitals:** [PageSpeed](evidence/pagespeed-mobile.json) devolvió límite de cuota; no hay valores utilizables de LCP, INP o CLS. No se han medido mejoras de velocidad. Las buenas señales de HTML e imagen no sustituyen datos de usuarios reales.
- **Indexación, tráfico y conversiones:** no se accedió a una propiedad de Search Console. Un 200 con canonical correcto confirma disponibilidad técnica, no inclusión en el índice, posicionamiento o volumen de búsquedas. No se consultaron datos de palabras clave, competencia ni backlinks; no se estiman volúmenes.
- **Lectura web:** la herramienta de navegación no abrió el sitio. Las solicitudes HTTPS directas con los recolectores revisados sí funcionaron; no se tomó ese fallo de herramienta como caída del sitio.
- **Dependencias:** el primer intento carecía de BeautifulSoup. Se repitieron los checks afectados una vez usando el entorno temporal que ya disponía de `requests` y `beautifulsoup4`; los JSON finales reemplazan los intentos sin parser.
- **Limitación de `validate_schema.py`:** su comprobación raíz exige `@type` incluso cuando un documento JSON-LD usa un `@graph` válido. Conservamos el grafo existente y verificamos cada entidad con su contexto heredado; [todos los nodos pasan](evidence/schema-validation.json). No se alteró la sintaxis correcta para satisfacer ese falso positivo. No se realizó una prueba remota de elegibilidad con Rich Results Test.
- **Falsos positivos del recolector:** `/precios` no es una página huérfana: la navegación de portada enlaza a ella. No se exige un número arbitrario de enlaces ni se considera que tener menos de 500/800 palabras sea por sí mismo un problema. Tampoco se usan puntuaciones inglesas Flesch-Kincaid para juzgar estas páginas en español.
- **AI:** `/llms.txt` responde 404. La alarma automática no se adopta como problema SEO: Google declara que sus funciones de IA no requieren archivos ni esquemas especiales. Las políticas de bots de entrenamiento no equivalen a bloquear Googlebot.
- **Seguridad:** el recolector menciona HSTS sin `includeSubDomains`. No se trata como penalización SEO ni se cambia una política que requiere revisar todos los subdominios.
- **Contenido/editorial:** no se inventaron artículos, autores, testimonios, precios, direcciones, horarios, resultados de clientes ni reseñas. El catálogo de guías vacío se conserva como decisión de publicación.

## Método y fuentes

Se utilizó la skill [Agentic-SEO-Skill](https://github.com/Bhanunamikaze/Agentic-SEO-Skill), commit `445c46c268d947fac25c4b57d38aaf723129fe62`, con sus instrucciones `seo-page`, rúbrica y referencias de calidad/esquemas. Sus referencias de febrero/mayo de 2026 superan 90 días a la fecha de auditoría; los criterios aplicados se contrastaron con documentación oficial. No se adoptan afirmaciones no sustentadas sobre multiplicadores de visibilidad de IA, densidad de palabras clave o mínimos de palabras como reglas de Google.

Recolectores empleados: `fetch_page.py`, `parse_html.py`, `robots_checker.py`, `llms_txt_checker.py`, `pagespeed.py`, `security_headers.py`, `broken_links.py`, `redirect_checker.py`, `readability.py`, `social_meta.py`, `internal_links.py`, `finding_verifier.py` y `validate_schema.py`. Se revisaron imports, llamadas de red, lectura de archivos y carga de entorno antes de ejecutarlos. Se ejecutaron desde una carpeta temporal, con entorno vacío salvo PATH, sin HOME ni credenciales; la raíz de la skill no tenía `.env`. No se leyó el `.env` de producción.

Fuentes primarias consultadas el 2026-11-12:

- [Google: títulos de resultados](https://developers.google.com/search/docs/appearance/title-link): títulos descriptivos, únicos y concisos, sin exigir un número fijo de caracteres.
- [Google: snippets y descripciones](https://developers.google.com/search/docs/appearance/snippet): descripciones que resumen realmente la página; su presentación en resultados depende de Google.
- [Google: datos de organización](https://developers.google.com/search/docs/appearance/structured-data/organization): identificación de la organización con propiedades relevantes y verificables.
- [Google: políticas de datos estructurados](https://developers.google.com/search/docs/appearance/structured-data/sd-policies): el marcado debe reflejar contenido visible y veraz.
- [Google: sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap): incluir URLs canónicas deseadas; no añadir fechas de modificación artificiales, prioridad ni frecuencia como supuestos factores de ranking.
- [Google: funciones de IA](https://developers.google.com/search/docs/appearance/ai-features): aplican fundamentos SEO habituales; no se necesitan archivos de texto ni markup especiales.

No se generó dashboard HTML. Los entregables son este reporte, el plan y la carpeta `evidence/`. Esta subtarea no desplegó, hizo commit ni push y no tocó aplicaciones nativas o workflows de construcción.
