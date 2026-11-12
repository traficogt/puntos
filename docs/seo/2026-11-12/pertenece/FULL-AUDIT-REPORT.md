# Pertenece — auditoría SEO

## Resumen

Alcance: auditoría de la página de inicio pública **https://pertenecegt.com/**, su fuente local, robots, sitemap, metadatos, enlaces, imagen social y presentación móvil. Fecha: 12 de noviembre de 2026. La captura final de metadatos ya contiene el título revisado y `hola@pertenecegt.com`.

**Estado: base técnica publicada y rastreable. Puntuación global: datos insuficientes**, porque faltan datos de Search Console y Core Web Vitals; no se infieren posiciones, tráfico o indexación efectiva.

Los bloqueos de lanzamiento se atendieron durante el trabajo: la portada pública responde HTTP 200, ya no contiene el `noindex` de la vista previa y su canonical apunta al dominio nuevo. Se añadieron imagen social propia y datos estructurados. El texto de portada, metadatos e imagen se centra ahora en carnés de membresía, configuración acompañada y consulta de vigencia, reduciendo las referencias comerciales a país, idioma y moneda.

Las comprobaciones pendientes más útiles son el último despliegue de la imagen versionada y las insignias Wallet, el cierre funcional de Turnstile, la indexación efectiva en Search Console y la medición de rendimiento cuando la API permita consultarla. Las tres oportunidades atendidas son la coherencia del dominio, las vistas previas sociales y una propuesta de valor más clara.

## Hallazgos verificados

| Área | Severidad | Confianza | Hallazgo | Evidencia | Acción |
|---|---|---|---|---|---|
| Caché de imagen social | Warning | Confirmed | La fuente ya versiona la imagen social revisada; falta comprobar ese último despliegue público. | combined-final-check.json: fuente con og-pertenece.jpg?v=2, HTML público aún sin versión en la captura 03:33 UTC. La variante ?v=2 devuelve el JPEG revisado idéntico al local. | Publicar el HTML final ya preparado y verificar que og:image y twitter:image apunten a ?v=2. |
| Rendimiento | Info | Hypothesis | Core Web Vitals y el rendimiento de campo permanecen sin medir. | pagespeed.json: Google API rate limited; performance_score null y field_data_available false. | Consultar PageSpeed/CrUX cuando haya cuota y datos suficientes. |
| AI/GEO | Info | Confirmed | Los rastreadores heredan reglas permisivas; llms.txt no existe. | robots.json: Allow / para *; llms.json: llms.txt y llms-full.txt 404. | Priorizar rastreabilidad, contenido útil y datos estructurados fieles; no añadir archivos para subir una puntuación automática. |
| Indexación | Pass | Confirmed | La portada pública responde 200 y permite indexación. | live-analysis.json: meta robots y X-Robots-Tag = index, follow, max-image-preview:large; fetch público HTTP 200. | Comprobar la indexación real en Search Console; no está demostrada por HTTP 200. |
| Dominio y rastreo | Pass | Confirmed | Canonical, sitemap y variantes del dominio convergen en la raíz HTTPS. | Canonical https://pertenecegt.com/; robots.txt 200 permite / y declara sitemap.xml; sitemap XML 200 con una URL; HTTP 301 a HTTPS y www 308 al dominio principal. | Conservar estas señales al publicar cambios. |
| Metadatos sociales | Pass | Confirmed | Open Graph y Twitter incluyen imagen propia y texto de membresías. | social.json sin campos obligatorios ausentes; JPEG 1200×630, HTTP 200. La variante ?v=2 entrega los 72,547 bytes locales; la URL sin versión conserva la imagen previa en caché. | Los dos metadatos locales ya usan ?v=2; comprobar la versión al concluir el último despliegue. |
| Datos estructurados | Pass | Confirmed | Organization y WebSite JSON-LD coinciden con la marca y el servicio en preparación. | live-analysis.json: Pertenece, URL raíz, hola@pertenecegt.com, es-GT y descripción sin precios, reseñas ni verificación de identidad inventados. validate_schema.py pasa. | Actualizar solo con datos reales cuando cambie la oferta. |
| Contenido y móvil | Pass | Confirmed | El texto prioriza el valor de la membresía y conserva límites claros de la demostración. | Título público Carnés digitales para membresías  /  Pertenece; browser-copy-check.json: 1440/390/320px sin desbordamiento, un H1, sin alegatos visibles de país/idioma/moneda; simulación identificada. Revisión combinada final: ambas insignias Wallet locales visibles, en línea a 1440px y apiladas a 390/320px, con rótulo de ejemplo; capturas inspeccionadas. | Mantener la distinción entre demostración y servicio disponible. |
| Contacto | Pass | Confirmed | El correo público conserva su enlace mailto legible; se corrigió la ofuscación observada inicialmente. | combined-final-check.json, 03:33 UTC: href mailto:hola@pertenecegt.com presente y /cdn-cgi/l/email-protection ausente en HTML público. | La comprobación funcional de Turnstile se realiza en el trabajo paralelo de publicación; no se enviaron correos de prueba desde esta auditoría. |

## Seguimiento de caché

A las 03:31 UTC la URL de imagen sin versión devolvió 72,149 bytes de la copia anterior. `?v=2` devolvió HTTP 200 y 72,547 bytes idénticos al archivo local revisado. La fuente final ya usa `?v=2` en ambos metadatos sociales. La captura de las 03:33 UTC todavía precede a ese último despliegue y a las nuevas insignias Wallet; el responsable publicará ambos después de las comprobaciones. Este detalle no bloquea la indexación de la portada.

## Evidencia e impacto

- **Indexación:** las instrucciones de HTML y HTTP coinciden. Retirar `noindex` elimina ese bloqueo concreto; no garantiza aparecer en Google. [Documentación de robots de Google](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag).
- **Dominio:** canonical autorreferente, sitemap y redirecciones del dominio coinciden. El anterior `/credenciales/` en PuntosFieles sigue siendo una vista previa con `X-Robots-Tag: noindex, nofollow`; no es la portada canónica. Si esa dirección debe retirarse definitivamente, una redirección permanente puede consolidar el destino. [Canonicalización de Google](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls).
- **Identidad:** WebSite expresa el nombre preferido del sitio y Organization describe solo datos presentes en el contenido. No se inventaron dirección, teléfono, ratings, precios, clientes ni un servicio de validación operativa. [Nombres de sitio](https://developers.google.com/search/docs/appearance/site-names) y [Organization](https://developers.google.com/search/docs/appearance/structured-data/organization).
- **IA:** el texto útil ya está en HTML. No se añadió marcado FAQ ni SearchAction ficticio. La ausencia de un archivo `llms.txt` no se trata como un fallo: Google indica que sus funciones de IA no requieren optimizaciones técnicas adicionales. [Funciones de IA de Google Search](https://developers.google.com/search/docs/appearance/ai-features).

## Plan priorizado

1. Publicar el HTML final con imagen social versionada e insignias Wallet; cerrar la verificación funcional de Turnstile en el trabajo paralelo. El correo público ya conserva un mailto legible.
2. Inspeccionar la portada y enviar el sitemap desde una propiedad verificada de Search Console cuando exista acceso autorizado.
3. Medir Core Web Vitals con resultados reales; modificar recursos solo si la medición o una prueba de navegador justifica el cambio.
4. Actualizar la oferta y los datos estructurados cuando se definan tarifas y capacidades disponibles, conservando el carácter ilustrativo del QR de muestra.

## Limitaciones y controles de calidad

- PageSpeed devolvió límite de cuota. No se publica una puntuación inventada ni se clasifica esto como defecto del sitio.
- Un intento del script de redirecciones falló por red de este entorno (`redirects.json`); una comprobación posterior de las variantes sí produjo HTTP 301/308/200 (`redirect-variants.json`).
- `readability.py` aplica una fórmula de legibilidad en inglés a texto español y emite recomendaciones genéricas ajenas al sitio. Su valoración y plantillas se excluyeron del diagnóstico. El recuento de palabras también depende de qué elementos extraiga cada script.
- Se descartaron falsos positivos automáticos: elevar HTTP a HTTPS no es un fallo de contenido mixto; la falta de `llms.txt` no es crítica; los rastreadores que heredan `Allow /` no están bloqueados; la URL técnica de ofuscación no es una página editorial huérfana; una portada de una sola página no necesita enlaces internos ficticios.
- Las referencias incluidas en la habilidad tienen fechas anteriores a 90 días. Las conclusiones técnicas se contrastaron con la documentación oficial consultada en esta sesión; no se usaron sus afirmaciones no sustentadas sobre ranking o IA.
- Las capturas locales comprueban texto y distribución con solicitudes externas bloqueadas. No son una prueba integral de contacto, seguridad, accesibilidad o dispositivos nativos. Los avisos del detector sobre pequeños rótulos ilustrativos preexistentes quedan en `copy-design-check.json`; esta tarea conservó CSS y tipografías.
- No se accedió a `prod.env`, Search Console, analítica, buzones ni datos de miembros. No se enviaron consultas por el formulario como parte de esta auditoría.

## Revisión combinada final

Se volvió a ejecutar la revisión local después de añadir las insignias oficiales de Apple Wallet y Google Wallet, el correo protegido contra ofuscación y los callbacks de Turnstile. A 1440, 390 y 320 píxeles no hay desbordamiento horizontal. Las insignias cargan desde archivos locales, respetan su proporción, se apilan en móvil y quedan identificadas como ejemplo de una invitación. Se inspeccionaron las capturas. No se necesitó otro cambio de HTML. La comprobación del formulario real sigue separada de estas pruebas visuales.

En capturas largas de un elemento, Chromium incluyó un artefacto del enlace fijo de salto; las capturas del viewport y la medición (`top: -100px`, `bottom: -48.8px`, sin foco) confirman que no aparece sobre el contenido durante el uso normal.

## Artefactos

- `FULL-AUDIT-REPORT.md` y `ACTION-PLAN.md`: diagnóstico y seguimiento.
- `live-page.html`, `live-analysis.json`, `source-analysis.json`: contenido y metadatos observados.
- `robots.json`, `launch-evidence.json`, `redirect-variants.json`, `headers.json`, `links.json`, `social.json`, `internal-links.json`, `llms.json`, `pagespeed.json`: comprobaciones públicas.
- `findings-raw.json` y `findings-verified.json`: hallazgos pasados por el verificador de la habilidad.
- `browser-copy-check.json`, `combined-final-check.json`, `copy-*.jpg`, `wallet-section-*.jpg`, `wallet-viewport-*.jpg`: verificación visual local y comparación pública final.
- `social-image.html` y `render-social-image.cjs`: fuente reproducible de `public/credenciales/og-pertenece.jpg` (1200×630). Reutiliza Fraunces, Inter y Bricolage Grotesque existentes.

No se generó un dashboard HTML ni se modificaron apps nativas.
