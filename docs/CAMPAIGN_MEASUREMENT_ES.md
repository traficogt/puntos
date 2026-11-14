# Medición de campañas de PuntosFieles

Actualizado: 14 de noviembre de 2026. Website y API; no requiere una nueva versión nativa.

## Antes de activar

En **Campañas dirigidas**, el propietario define una tasa habitual de regreso, el aumento mínimo que valdría la pena detectar, el plazo de observación y un período de conciliación. Son supuestos previos, no una tasa calculada a partir del resultado. La oferta conserva su vigencia de 7, 14 o 30 días; la observación puede durar hasta 180 días y la conciliación entre 0 y 30 días adicionales.

El planificador aproxima el tamaño para dos proporciones independientes, alfa bilateral del 5% y potencia del 80%. Usa varianza combinada bajo la hipótesis nula y separada bajo la alternativa; omite corrección de continuidad, agrupamiento y pérdidas. Por ejemplo, pasar de 20% a 26% con reparto 50/50 requiere aproximadamente 772 participantes por grupo bajo estos supuestos. Es orientación, no garantía. Una audiencia menor sigue pudiendo ejecutar un piloto; la pantalla advierte que no alcanza el plan. No se debe extender una prueba hasta conseguir un resultado favorable.

Se permite repartir 50/50, además de los porcentajes anteriores. Fisher–Yates con aleatoriedad criptográfica asigna una cantidad fija a cada grupo al activar, y esa asignación se conserva. No aplicamos una prueba binomial de desbalance a cantidades que fueron fijadas por diseño. El plan no puede cambiar tras su creación; los plazos se fijan al activar. Los clientes anteriores que no envían `measurement_plan` conservan su contrato.

## Qué entra en la comparación

Todos los asignados permanecen en el denominador: compradores, no compradores y cuentas después eliminadas. La falta de seguimiento se muestra y limita la interpretación. La actividad previa se captura al activar cada nueva campaña experimental, usando la duración de observación o, sin plan, la vigencia de la oferta. Ese registro no se reescribe cuando llegan datos posteriores.

Las compras usan `purchase_occurred_at` cuando existe evidencia de fecha y `created_at` como alternativa explícita para registros antiguos o contemporáneos. `created_at` conserva siempre la recepción en PF. POS y pedidos autenticados pueden suministrar fechas de recibo; el reloj de un dispositivo sin conexión queda identificado como `client_reported`. Estas fechas son evidencia aportada por la fuente, no una auditoría independiente. Las fechas inválidas o futuras se rechazan. El límite temporal es inclusivo al inicio y exclusivo al final; no se incluye ninguna transacción registrada o supuestamente ocurrida después del momento de consulta.

Los recibos POS observados se retienen sin datos de contacto: origen, venta, fechas, resultado de enlace y transacción. Los reintentos no duplican ventas. Se muestran los recibos sin correspondencia y rechazados, pero no se inventa un denominador de todas las ventas del POS. Los datos inválidos sin identificadores utilizables y las ventas que nunca llegaron a PF no están incluidos. No es posible asignar un recibo sin cliente al grupo con o sin oferta; esa tasa por grupo se informa como desconocida.

Los ingresos registrados descuentan recibos de devolución asociados sin duplicar una reversión total del libro. Las devoluciones pendientes y las que todavía no tienen venta original se muestran como limitaciones; estas últimas no se atribuyen a ningún grupo. Una devolución parcial pendiente puede aportar una estimación neta y a la vez bloquear una conclusión. Revertir puntos o agotar su vigencia no crea una compra nueva. No se reescribe el libro histórico.

## Calidad y ofertas simultáneas

Se comprueban cantidades asignadas frente a observadas, cuentas no disponibles, fuentes atrasadas, fechas de dispositivo, recibos no enlazados, devoluciones, actividad anterior y elegibilidad para otras campañas. Una campaña pausada antes del período no se cuenta como oferta simultánea. La actividad previa diferente puede ocurrir por azar y no prueba que la aleatorización sea inválida. Los clientes coincidentes permanecen en sus grupos.

La coincidencia con otra oferta indica elegibilidad, no exposición confirmada. Los mensajes aceptados por un proveedor no prueban entrega o lectura, y tener un pase no prueba haber visto una actualización. No atribuimos a la campaña puntos normales, campañas generales, mensajes externos o promociones desconocidas como si tuviéramos exposición completa.

## Resultado, seguimiento y costos

Wilson describe la incertidumbre de la tasa de cada grupo y Newcombe (método 10, sin corrección de continuidad) la diferencia absoluta. La conclusión principal usa el plazo fijo completo, seguido del período de conciliación. Se muestra por separado la actividad mientras la oferta era válida y después de su vencimiento, usando siempre las asignaciones originales. El intervalo posterior es exploratorio: no prueba por sí solo que se adelantaron compras ni que el efecto persistirá. Si no existe un período posterior, no se calcula un intervalo para él.

La diferencia de ventas sigue siendo descriptiva: diferencia de ventas netas por cliente asignado multiplicada por el tamaño del grupo con oferta. No contiene un intervalo de ventas ni prueba ingresos causados por la promoción.

El propietario registra costos directos de cumplimiento de premios, mensajes y otros gastos, además del margen bruto supuesto y el costo de compromisos todavía pendientes. Un campo vacío es desconocido; cero es un valor expresamente confirmado. Cada corrección agrega una revisión. La contribución aproximada es la diferencia descriptiva de ventas por el margen, menos los costos realizados. El escenario que cumple todos los compromisos pendientes se presenta aparte. No es utilidad contable, valoración formal de pasivos ni ganancia causal. El margen ya debe descontar el costo habitual del producto; no se debe descontar dos veces. Los puntos fungibles no permiten atribuir automáticamente un canje a una campaña específica.

La recomendación comienza por el problema verificable o la etapa actual, señala la incertidumbre y propone una acción. Una diferencia favorable de regreso no basta para recomendar repetir con beneficio económico. Los costos, seguimiento y captura desconocidos impiden esa conclusión.

## Cortes y revisiones

Consultar es de solo lectura. **Guardar corte** crea una copia inmutable de los resultados, costos, calidad, decisión y fecha de consulta. Una consulta posterior señala si los hechos o la etapa cambiaron respecto del último corte. El historial permite comparar las cifras anteriores. La conciliación es un plazo acordado de revisión, no una orden de descartar compras tardías: nuevos hechos pueden cambiar incluso un resultado pasado. El mismo `request_id` no duplica una revisión.

## API y seguridad

Todas las rutas bajo `/api/admin/growth-campaigns` exigen propietario, negocio de la sesión y funciones de campañas/analítica. Los POST exigen CSRF y origen válido. Las tablas nuevas tienen RLS forzada y privilegios de lectura/inserción para costos y cortes. Ninguna operación de medición envía mensajes.

- `POST /measurement-plan`: previsualiza `measurement_plan`, `duration_days`, `holdout_percent`, `available_members` (entero o null).
- `POST /` y `/prepare`: aceptan el plan opcional y preservan los demás campos anteriores.
- `GET /:id`: conserva los campos existentes y agrega `planning`, `diagnostics`, `offer_period`, `followup`, `contribution`, `decision`, `costs` y `report_revision` dentro de `results`.
- `POST /:id/measurement-costs`: `request_id` y los cinco costos/margen opcionales más notas. No acepta negocio, actor ni cifras calculadas desde el cliente.
- `POST /:id/measurement-reports`: `request_id`; guarda un corte del cálculo del servidor.
- `GET /:id/measurement-reports`: últimas 50 revisiones con sus cifras y decisiones originales.

## Fuentes metodológicas

- Newcombe, R. G. (1998). Interval estimation for the difference between independent proportions: Comparison of eleven methods. *Statistics in Medicine, 17*(8), 873–890. https://doi.org/10.1002/(SICI)1097-0258(19980430)17:8%3C873::AID-SIM779%3E3.0.CO;2-I
- NIST/SEMATECH. *e-Handbook of Statistical Methods: Confidence intervals*. https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm
- statsmodels. *samplesize_proportions_2indep_onetail* y código de proporciones. https://www.statsmodels.org/stable/generated/statsmodels.stats.proportion.samplesize_proportions_2indep_onetail.html
- Microsoft Research. (2021). *Data quality: Fundamental building blocks for trustworthy A/B testing analysis*. https://www.microsoft.com/en-us/research/articles/data-quality-fundamental-building-blocks-for-trustworthy-a-b-testing-analysis/
