# Estado independiente de PuntosFieles

Comprobaciones externas mediante [Upptime](https://upptime.js.org/), con versión
fijada por SHA. GitHub Actions ejecuta el monitor; GitHub Pages aloja la página
fuera de la VM de PF. No usa Codemagic, aplicaciones nativas ni claves de PF.

## Operación

- `Comprobaciones externas` se programa cada cinco minutos, desplazado de la hora
  en punto. GitHub puede retrasar o suspender ejecuciones. La pantalla cambia a
  **sin datos recientes** después de veinte minutos; nunca prolonga un verde viejo.
- `response-time` conserva cada comprobación y su fecha real, incluso sin cambios
  de estado. Upptime confirma los fallos con sus reintentos antes de registrarlos.
- Los incidentes permanecen en Issues con etiqueta `status`. No se borran los
  breves. Añadir actualizaciones públicas como comentarios; no incluir datos de
  clientes, credenciales ni diagnósticos internos. La vista acepta únicamente
  eventos del bot o colaboradores autorizados y muestra texto escapado.
- Para mantenimiento, usar etiqueta `maintenance` y las fechas `start`/`end` en
  el formato documentado por Upptime. La página diferencia mantenimiento e
  incidentes. No etiquetar como caída general la configuración de un negocio.
- Revisar la ejecución de Actions si los datos envejecen. Los workflows
  programados de repositorios públicos pueden desactivarse tras inactividad;
  supervisar este monitor además de los servicios que comprueba.
- `Publicar página independiente` cambia solo cuando cambia `site/` o se ejecuta
  manualmente. Las observaciones se obtienen del JSON público del repositorio,
  sin reconstruir el sitio cada cinco minutos ni desplegar PF.

## Alcance

La disponibilidad de páginas y la conexión de API/base de datos no prueban todos
los canjes, la entrega de correos o WhatsApp, la actualización física de Wallet,
ni la conexión POS de cada negocio. No se publican porcentajes de disponibilidad
histórica ni se inventan observaciones anteriores al comienzo del monitor.

`src/scripts/prepare-status-site.mjs <directorio-nuevo>` prepara el repositorio
independiente desde el checkout de PF. Nunca copiar `.env`, secretos o todo el
repositorio PF. Revisar el artefacto, crear `traficogt/puntos-estado`, activar Pages
con Actions, empujar y ejecutar ambos workflows solo al liberar el trabajo.

Fuentes: [Upptime](https://upptime.js.org/docs/),
[configuración](https://upptime.js.org/docs/configuration/),
[programación en GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
