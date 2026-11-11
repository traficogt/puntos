# Lectura de campañas y límites de la evidencia

Actualizado: 11 de noviembre de 2026. Alcance: web y API; no cambia la asignación, los incentivos ni las versiones nativas.

El detalle mantiene los campos anteriores y añade `results.measurement` y, por grupo, `observed_members`, `unavailable_members` y `return_rate_interval`. La asignación aleatoria se fija al activar la campaña; los denominadores incluyen a todos los asignados, también quienes no compraron. La consulta toma campañas, compras, mensajes y estado de importación en una sola instantánea SQL.

Las compras se cuentan por `transactions.created_at`, desde el inicio incluido hasta el vencimiento excluido, sin fechas posteriores a la consulta. Se incluyen compras con puntos pendientes; se excluyen reversiones, ajustes y filas de canje. Una importación tardía puede quedar fuera. Las devoluciones parciales pendientes de conciliación pueden afectar las ventas registradas.

## Incertidumbre

Las tasas muestran intervalos Wilson bilaterales al 95%. La diferencia en puntos porcentuales usa Newcombe sin corrección de continuidad (método 10), combinando los intervalos de grupos independientes. Referencias: [NIST, intervalos de proporciones](https://itl.nist.gov/div898/handbook/prc/section2/prc241.htm) y [Newcombe (1998), Statistics in Medicine 17:873–890](https://doi.org/10.1002/(SICI)1097-0258(19980430)17:8%3C873::AID-SIM779%3E3.0.CO;2-I).

No se declara una diferencia concluyente mientras la campaña sigue en curso, se ha pausado, falta seguimiento de clientes, los recuentos de asignación no coinciden o la conexión informa datos incompletos. Menos de 30 clientes por grupo activa una precaución adicional; 30 no es un cálculo de potencia ni garantiza suficiencia. Los intervalos permanecen disponibles para mostrar incertidumbre. Las ofertas breves no tienen control y son descriptivas.

Los intervalos suponen independencia y una ventana fija; no corrigen consultas repetidas, promociones simultáneas, sesgos de captura ni contagio entre clientes. Una diferencia al cierre sigue necesitando interpretación del negocio y calidad de registros; no acredita rentabilidad.

## Costos y mensajes

La diferencia de ventas es la diferencia de promedios por cliente asignado multiplicada por el grupo con oferta. El campo anterior `estimated_incremental_sales_q` se conserva por compatibilidad, pero la web lo presenta como diferencia descriptiva, sin prometer ingreso causado por la campaña. El sufijo heredado `_q` se formatea con la moneda del negocio.

El costo usa la estimación por punto guardada al crear la campaña. Un costo desconocido sigue siendo desconocido, no cero. No incluye mensajes, operación, puntos ordinarios, otros incentivos ni utilidad contable.

`messages.accepted` significa aceptación del proveedor. `delivered` y `read` permanecen `null` porque no existe evidencia de esos eventos en este reporte. Ni la aceptación, ni tener una tarjeta Wallet, demuestran que alguien vio una oferta.

## Validación

Las pruebas cubren extremos y grupos desiguales, denominadores tras bajas y eliminación, compras pendientes/revertidas, aislamiento de negocio, ventana temporal, sincronización atrasada y campañas interrumpidas. Los resultados de demostración son ficticios y no envían mensajes. La validación de registros reales y de impacto comercial se hace en el piloto.
