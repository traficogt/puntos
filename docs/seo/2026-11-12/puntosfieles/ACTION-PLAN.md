# PuntosFieles: plan SEO

Fecha: 2026-11-12. Alcance: sitio público PuntosFieles. Las prioridades parten de [hallazgos verificados](evidence/verified-findings.json).

| Orden | Acción | Estado | Impacto / esfuerzo | Dependencia |
|---|---|---|---|---|
| 1 | Completar título, descripción y metadatos sociales de `/precios`. | Implementado y verificado localmente en `public/precios.html`. | Quick win: claridad en búsquedas y enlaces compartidos / bajo. | Despliegue selectivo del HTML. |
| 2 | Conectar marca, servicio y páginas públicas mediante JSON-LD veraz. | Implementado y verificado en `public/index.html`, `public/precios.html` y `public/soporte.html`. | Maintenance: descripción semántica / bajo. | Desplegar los tres archivos juntos para mantener los identificadores relacionados. |
| 3 | Comprobar metadatos y ausencia de `noindex` tras desplegar las tres URLs. | Pendiente de despliegue por el responsable de integración. | Quick win: confirmar lo servido por CDN/origen / bajo. | Acceso a las páginas desplegadas; conservar noindex de la aplicación. |
| 4 | Habilitar `www.puntosfieles.com` como alias con TLS y redirección permanente al dominio principal. | Pendiente de configuración DNS/hosting. | Maintenance: recuperar visitantes de la variante www / bajo a medio. | Revisar DNS, TLS y regla de redirección con conservación de ruta y query. No se requiere cambiar la URL canónica. |
| 5 | Revisar propiedad de Search Console; enviar `https://puntosfieles.com/sitemap.xml` si falta y usar Inspección de URL para portada y planes. | Pendiente de acceso a Search Console; no se presupone que la propiedad falte. | Strategic: verificar indexación y medir consultas/clics / bajo. | Cuenta autorizada del propietario. |
| 6 | Medir LCP, INP y CLS; priorizar cualquier optimización según resultados reales. | Pendiente; PageSpeed devolvió límite de cuota. | Strategic: rendimiento / esfuerzo según hallazgos. | API disponible o datos de Search Console; las fuentes y el diseño siguen intactos. |
| 7 | Preparar primeras guías útiles basadas en la operación real. | Siguiente fase editorial. | Strategic: consultas informativas / medio. | Experiencia propia verificable, autoría y fechas reales, revisión editorial. |

Temas candidatos para la siguiente fase: cómo definir puntos y recompensas para un café; diferencia entre QR de registro y QR de tarjeta; cómo guardar y usar una tarjeta en Apple Wallet o la Billetera de Google. Explicar límites y flujos reales con ejemplos propios, sin publicar cifras de éxito ni casos de clientes sin evidencia. El sistema actual incorpora al hub y al sitemap los artículos cuando se publican; mantener la biblioteca vacía fuera del índice hasta entonces.

No hay bloqueadores de indexación confirmados en el dominio principal. No se añadieron precios, testimonios, direcciones, horarios, reseñas ni funciones nuevas. Tampoco se modificaron las apps, estilos, fuentes, APIs, datos o la política de bots.

Validación terminada: 18 tests relevantes aprobados; JSON-LD analizado por nodo; metadatos completos; cuerpo de las tres páginas idéntico al de `HEAD`; `git diff --check` limpio. Véase [verificación](evidence/verification.json) y [nota del validador](evidence/schema-validation.json).
